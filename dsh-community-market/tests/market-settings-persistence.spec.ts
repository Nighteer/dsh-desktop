import { mkdtemp, rm,writeFile,readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { boot } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import { pathToFileURL } from 'node:url'
import {parse as parseYaml,stringify as stringifyYaml} from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { DSH_1024STORE_ADAPTER_ID, DSH_1024STORE_PROVIDER_ID } from '../src/adapters/dsh-1024store.js'
import { SettingsCatalogSourceStore, type MarketSettingsDocument } from '../src/catalog/source-store.js'
import type { LocalSourceRecord } from '../src/contracts/index.js'
import { registerMarketSettings } from '../src/host/routes.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!()
})

async function temporarySettingsFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-market-settings-'))
  cleanups.push(async () => { await rm(dir, { recursive: true, force: true }) })
  return join(dir, 'cordis.patch.yml')
}

async function bootMarketSettings(path: string) {
  const root=dirname(path),schema=join(root,'forms.mjs'),config=join(root,'cordis.yml')
  await writeFile(join(root,'package.json'),JSON.stringify({name:'market-settings-fixture',private:true,type:'module',dsh:{profile:{bundles:[]}}}))
  await writeFile(config,'[]\n')
  await writeFile(schema,`import z from ${JSON.stringify(import.meta.resolve('@deepseek-ai/schemastery'))};export const Config=z.object({sources:z.array(z.any()).default([]).volatile(),label:z.string().default('default').volatile()});export function apply(){}`)
  try{await readFile(path)}catch{await writeFile(path,stringifyYaml([{insert:[{id:'community-market',name:pathToFileURL(schema).href},{id:SIBLING_NAMESPACE,name:pathToFileURL(schema).href},{id:'settings',name:import.meta.resolve('@deepseek-ai/dsh-settings')}]}]))}
  const patches=parseYaml(await readFile(path,'utf8'))
  const ctx=await boot('market-settings-test',config,patches,async child=>{
    child.provide('profileContext',{name:'test',dir:root,patchPath:path,installAnchor:root,home:root,cwd:root,startedBundles:[],overlays:[]})
    await child.plugin(ConfigEditor)
  },pathToFileURL(join(root,'package.json')).href)
  let disposed = false
  const dispose = async () => {
    if (disposed) return
    disposed = true
    await ctx.fiber.dispose()
  }
  cleanups.push(dispose)
  return { ctx, scope: registerMarketSettings(ctx), dispose }
}

const source: LocalSourceRecord = {
  sourceRecordId: '018f1f77-a5c4-7b73-a9ae-0242ac120002',
  registrationKind: 'built-in',
  adapterId: DSH_1024STORE_ADAPTER_ID,
  providerId: DSH_1024STORE_PROVIDER_ID,
  builtInProviderKey: 'dsh-1024store',
  enabled: true,
  order: 0,
}

const SIBLING_NAMESPACE = 'market-persistence-fixture'

describe('community market profile-native settings', () => {
  it('restores sources in a new Host context', async () => {
    const path = await temporarySettingsFile()
    const first = await bootMarketSettings(path)

    await first.scope.update({ sources: [source] })
    await first.dispose()

    const second = await bootMarketSettings(path)
    expect(second.scope.get()).toMatchObject({ sources: [source] } satisfies MarketSettingsDocument)
  })

  it('preserves another plugin namespace while persisting market settings', async () => {
    const path = await temporarySettingsFile()
    const first = await bootMarketSettings(path)
    await first.ctx.settings.update(SIBLING_NAMESPACE,{ label: 'retained across restart' })

    await new SettingsCatalogSourceStore(first.scope).save([source])
    await first.dispose()

    const second = await bootMarketSettings(path)
    expect(second.ctx.settings.describe().find(row=>row.ns===SIBLING_NAMESPACE)?.value).toMatchObject({ label: 'retained across restart' })
    expect(second.scope.get()).toMatchObject({ sources: [source] } satisfies MarketSettingsDocument)
  })
})
