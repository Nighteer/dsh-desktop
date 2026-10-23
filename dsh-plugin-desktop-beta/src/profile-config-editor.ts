/** Profile forms for Desktop's launcher-composed tree (not the CLI bundle tree).
 * Native ConfigEditor recomposes CLI bundles and would remove launcher-owned
 * enterprise fences, Electron providers and PPT. Keep those rows intact and
 * edit only the addressed entry through Loader's ordinary config validation.
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context, resolveConfig } from '@deepseek-ai/cordis'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { isMap, isSeq, parseDocument, Scalar, visit } from 'yaml'

export class DesktopProfileConfigEditor extends ConfigEditor {
  /** Desktop reads old settings explicitly; never let the core rename user files on boot. */
  readonly preserveLegacyDocument = true
  private readonly inheritedValues: Map<string, Record<string, unknown>>
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly desktopContext: Context, config: { base: PatchOptions[] }) {
    super(desktopContext)
    this.inheritedValues = new Map(composeEntries([config.base]).map(row => [row.id,
      structuredClone((row.config ?? {}) as Record<string, unknown>)]))
  }

  private document(text: string) {
    const document = parseDocument(text, {customTags:[{tag:'tag:yaml.org,2002:js',resolve:(value:string)=>({__jsExpr:value})}]})
    if (document.errors[0]) throw document.errors[0]
    if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
    return document
  }

  override configuration(): ReturnType<ConfigEditor['configuration']> {
    let text: string
    try { text = readFileSync(this.documentPath, 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; text = '[]\n' }
    const rows = this.document(text).toJS() as PatchOptions[]
    return this.entries().map(entry => ({
      entry,
      inherited:structuredClone(this.inheritedValues.get(entry.options.id) ?? {}),
      override:structuredClone((rows.findLast(row=>row.id===entry.options.id && row.insert===undefined)?.config ?? {}) as Record<string,unknown>),
    }))
  }

  override edit(entry: Entry, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
    const operation = async (): Promise<void> => {
      const profile = this.desktopContext.profileContext
      await withFileLock(join(profile.dir, 'package.json'), async () => {
        if (!this.entries().includes(entry) || entry.fiber?.state !== 2) throw new Error('Configuration entry is no longer active')
        const current = structuredClone((entry.options.config ?? {}) as Record<string, unknown>)
        const next = change(current, structuredClone(this.inheritedValues.get(entry.options.id) ?? {}))
        const fiber = entry.fiber
        const validated: unknown = fiber.ctx.waterfall(fiber, 'internal/config', next, () => next)
        resolveConfig(fiber.runtime!, validated)
        let before: string
        try { before = await readFile(this.documentPath, 'utf8') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; before = '[]\n' }
        const document = this.document(before)
        const rows = document.contents
        if (!isSeq(rows)) throw new Error('Profile patch must be a YAML sequence')
        const index = rows.items.findLastIndex((item, index) => isMap(item) && document.getIn([index,'id'])===entry.options.id && !item.has('insert') && (!item.has('name') || document.getIn([index,'name'])===entry.options.name))
        if (index < 0) document.add(document.createNode({id:entry.options.id,name:entry.options.name,config:next}))
        else document.setIn([index,'config'],document.createNode(next))
        visit(document,{Map(_key,node){
          if(node.items.length!==1 || typeof node.get('__jsExpr')!=='string')return
          const expression=new Scalar(node.get('__jsExpr'));expression.tag='tag:yaml.org,2002:js';return expression
        }})
        await writeFileAtomic(this.documentPath, String(document), {mode:0o600})
        try { await entry.update({config:next}) }
        catch (error) {
          await writeFileAtomic(this.documentPath, before, {mode:0o600})
          await entry.update({config:current})
          throw error
        }
      })
    }
    const run = (): Promise<void> => {
      const hmr=this.desktopContext.get('hmr')
      return hmr===undefined?operation():hmr.runExclusive(operation)
    }
    const pending=this.tail.then(run)
    this.tail=pending.catch(()=>{})
    return pending
  }
}
