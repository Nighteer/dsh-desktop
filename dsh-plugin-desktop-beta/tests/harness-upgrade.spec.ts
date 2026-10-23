/** New-runtime integration without Electron, employee data, or external services. */
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it, expect } from 'vitest'
import { boot, getDshRuntimeVersion, evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'
import { DesktopProfileConfigEditor } from '../src/profile-config-editor.ts'
import { desktopInstallAnchor, prepareDesktopProfile } from '../src/profile.ts'
import type {} from '@deepseek-ai/dsh-settings'

describe('Harness 0.2 Desktop migration boundaries', () => {
  it('uses the selected official runtime and accepts compatible prerelease plugins without bypasses', () => {
    expect(getDshRuntimeVersion()).toBe('0.2.1-rc.2')
    expect(evaluatePluginCompatibility({engines:{dsh:'^0.2.0-rc.1'}}, {}, '0.2.1-rc.2')).toBeUndefined()
  })

  it('prepares the full new bundle family while preserving old startup documents and unrelated files', () => {
    const root=mkdtempSync(join(tmpdir(),'lets-harness-upgrade-profile-'))
    try {
      const legacy='dsh-desktop:\n  mode: advanced\n  port: 0\n'
      writeFileSync(join(root,'settings.yaml'),legacy)
      writeFileSync(join(root,'employee-document.txt'),'keep')
      const prepared=prepareDesktopProfile('1',root,'win32','desktop',undefined,{requested:'disabled',effective:'disabled',legacyDefaulted:false})
      expect(prepared.mode).toBe('advanced')
      expect(prepared.profile.layers.find(row=>row.packageName==='@deepseek-ai/dsh-web-app')?.patchPaths.length).toBeGreaterThan(1)
      expect(readFileSync(join(root,'settings.yaml'),'utf8')).toBe(legacy)
      expect(readFileSync(join(root,'employee-document.txt'),'utf8')).toBe('keep')
    } finally { rmSync(root,{recursive:true,force:true}) }
  })

  it('persists native forms without recomposing away Desktop-owned rows or accepting invalid configuration', async () => {
    const root=mkdtempSync(join(tmpdir(),'lets-harness-upgrade-config-'))
    let ctx: Awaited<ReturnType<typeof boot>>|undefined
    try {
      const patchPath=join(root,'cordis.patch.yml')
      const configPath=join(root,'cordis.yml')
      writeFileSync(join(root,'package.json'),'{"name":"upgrade-config-fixture","private":true,"type":"module"}\n')
      writeFileSync(patchPath,'# keep employee notes\n[]\n')
      writeFileSync(join(root,'settings.yaml'),'# legacy file must remain\nui-theme:\n  preference: dark\n')
      writeFileSync(configPath,'[]\n')
      const module=join(root,'probe.mjs')
      writeFileSync(module,`import z from ${JSON.stringify(import.meta.resolve('@deepseek-ai/schemastery'))};\nexport const Config=z.object({count:z.number().min(1).default(1).volatile()});\nexport function apply(){}\n`)
      const patches=[{insert:[{id:'upgrade-probe',name:pathToFileURL(module).href},{id:'desktop-security-marker',name:pathToFileURL(module).href},{id:'settings',name:import.meta.resolve('@deepseek-ai/dsh-settings')}]}]
      ctx=await boot('lets-upgrade-test',configPath,patches,async child=>{
        child.provide('profileContext',{name:'desktop',dir:root,patchPath,installAnchor:desktopInstallAnchor(),home:root,cwd:root,startedBundles:[],overlays:[],telemetryDisabledEnv:'1'})
        await child.plugin(DesktopProfileConfigEditor,{base:patches})
      },pathToFileURL(join(root,'package.json')).href)
      const marker=[...ctx.loader.entries()].find(row=>row.options.id==='desktop-security-marker')!
      const fiber=marker.fiber
      expect(ctx.settings.describe().find(row=>row.ns==='upgrade-probe')?.value).toEqual({count:1})
      await ctx.settings.update('upgrade-probe',{count:3})
      expect(ctx.settings.describe().find(row=>row.ns==='upgrade-probe')?.value).toEqual({count:3})
      const persisted=readFileSync(patchPath,'utf8')
      expect(persisted).toContain('# keep employee notes')
      expect(persisted).toContain('count: 3')
      expect(marker.fiber).toBe(fiber)
      expect(marker.fiber?.state).toBe(2)
      await expect(ctx.settings.update('upgrade-probe',{count:0})).rejects.toThrow()
      expect(readFileSync(patchPath,'utf8')).toBe(persisted)
      expect(readFileSync(join(root,'settings.yaml'),'utf8')).toContain('# legacy file must remain')
    } finally { await ctx?.fiber.dispose();rmSync(root,{recursive:true,force:true}) }
  })
})
