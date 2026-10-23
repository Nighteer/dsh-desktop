/** Test artifacts intentionally retained: this suite never removes files or directories. */
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {Readable} from 'node:stream'
import {Context} from '@deepseek-ai/cordis'
import {composeEntries} from '@deepseek-ai/dsh-app-boot'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {DesktopPluginManagerController, desktopInstallTarget} from '../src/desktop-plugin-manager.ts'
import {DesktopPluginsService} from '../src/desktop-plugins.ts'
import {desktopInstallAnchor, ensureDesktopProfile, prepareDesktopProfile} from '../src/profile.ts'
import type {DesktopPnpm} from '../src/pnpm.ts'

const roots = resolve(process.cwd(), '../.enterprise-local/plugin-manager-tests')
const disposers: (() => Promise<void>)[] = []
afterEach(async () => {for (const dispose of disposers.splice(0).reverse()) await dispose()})
async function fixture() {
  mkdirSync(roots, {recursive: true})
  const root = mkdtempSync(join(roots, 'case-')), homeDir = join(root, 'home'), profileDir = ensureDesktopProfile(homeDir)
  const statePath = join(root, 'state', 'plugins.json'), path = join(profileDir, 'package.json')
  const original = readFileSync(path, 'utf8')
  function add(name: string) {
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    manifest.dependencies = {...manifest.dependencies, [name]: '1.2.3'}
    manifest.dsh.profile.bundles.push(name)
    writeFileSync(path, JSON.stringify(manifest))
    const dir = join(profileDir, 'node_modules', ...name.split('/')); mkdirSync(dir, {recursive: true})
    writeFileSync(join(dir, 'package.json'), JSON.stringify({name, version: '1.2.3', dsh: {bundle: {patch: './cordis.patch.yml'}}}))
    writeFileSync(join(dir, 'cordis.patch.yml'), `- insert:\n    - id: test-${name.replace(/[^a-z]/g, '')}\n      name: ${name}\n`)
  }
  add('example-plugin')
  const ctx = new Context(); const fiber = ctx.plugin(DesktopPluginsService, {profileName: 'desktop', homeDir, statePath, installAnchor: desktopInstallAnchor()}); await fiber
  disposers.push(() => fiber.dispose())
  const run = vi.fn(() => ({stdout: Readable.from([]), stderr: Readable.from([]), done: Promise.resolve({exitCode: 0, signal: null}), cancel: vi.fn()}))
  let now = Date.now()
  const manager = new DesktopPluginManagerController({profileName: 'desktop', profileDir, plugins: ctx.desktopPlugins, pnpm: () => ({runPlugin: run}) as unknown as DesktopPnpm,
    runtime: () => [{id: 'core', moduleName: 'dsh-ppt', state: 'running'}], now: () => now})
  disposers.push(() => manager.dispose())
  return {manager, add, path, original, profileDir, homeDir, statePath, run, advance: () => {now += 300_001}}
}
describe('desktop plugin manager', () => {
  it.each(['abc@1.2.3', '@example/tool@1.2.3-beta.1'])('accepts exact third-party npm spec %s', spec => {
    expect(desktopInstallTarget(spec)).toBe(spec.slice(0, spec.lastIndexOf('@')))
  })
  it.each(['abc', 'abc@latest', 'abc@^1.0.0', 'https://example.test/plugin.tgz', 'file:C:/plugin', '--version', 'abc@1.0.0 && calc', '@deepseek-ai/dsh-web-app@1.0.0', 'dsh-ppt@1.0.0', 'dshmarket@1.0.0', 'dsh-plugin-desktop-beta@1.0.0'])('refuses unsafe or core spec %s', spec => {
    expect(() => desktopInstallTarget(spec)).toThrow()
  })
  it('shows builtins, user bundles and actual runtime without any paths', async () => {
    const s = await fixture(), result = s.manager.snapshot()
    expect(result.bundles).toContainEqual(expect.objectContaining({packageName: 'example-plugin', mutable: true, enabled: true}))
    expect(result.bundles).toContainEqual(expect.objectContaining({packageName: '@deepseek-ai/dsh-web-app', mutable: false}))
    expect(result.runtime).toEqual([{id: 'core', moduleName: 'dsh-ppt', state: 'running'}])
    expect(JSON.stringify(result)).not.toContain(s.profileDir)
  })
  it('confirmation only persists enablement, is single-use, and retains the manifest', async () => {
    const s = await fixture(), before = readFileSync(s.path, 'utf8'), bundle = s.manager.snapshot().bundles.find(item => item.packageName === 'example-plugin')!
    const preview = s.manager.preview(bundle.bundleId, false)
    expect(s.manager.snapshot().bundles.find(item => item.bundleId === bundle.bundleId)?.enabled).toBe(true)
    await s.manager.confirm(preview.previewId)
    expect(s.manager.snapshot()).toMatchObject({restartRequired: true})
    expect(s.manager.snapshot().bundles.find(item => item.bundleId === bundle.bundleId)?.enabled).toBe(false)
    expect(readFileSync(s.path, 'utf8')).toBe(before)
    expect(() => s.manager.confirm(preview.previewId)).toThrow('确认已过期')
    const enable = s.manager.preview(bundle.bundleId, true); await s.manager.confirm(enable.previewId)
    expect(s.manager.snapshot().bundles.find(item => item.bundleId === bundle.bundleId)?.enabled).toBe(true)
  })
  it('protects shipped bundles and dedicated preference packages on the server', async () => {
    const s = await fixture()
    for (const name of ['dsh-ppt', 'dshmarket', '@agents-anywhere/dsh-bridge-next']) s.add(name)
    for (const bundle of s.manager.snapshot().bundles.filter(item => !item.mutable)) expect(() => s.manager.preview(bundle.bundleId, false)).toThrow()
    expect(() => s.manager.preview('forged', false)).toThrow()
  })
  it('expires confirmations and never reuses one across accounts/generations', async () => {
    const a = await fixture(), b = await fixture(), bundle = a.manager.snapshot().bundles.find(item => item.mutable)!
    const preview = a.manager.preview(bundle.bundleId, false)
    expect(() => b.manager.confirm(preview.previewId)).toThrow()
    a.advance(); expect(() => a.manager.confirm(preview.previewId)).toThrow()
  })
  it.each(['disabled', 'dsh-market', 'community-market'] as const)('honors user disable markers with %s', async market => {
    const s = await fixture(), bundle = s.manager.snapshot().bundles.find(item => item.packageName === 'example-plugin')!
    await s.manager.confirm(s.manager.preview(bundle.bundleId, false).previewId)
    const prepared = prepareDesktopProfile(undefined, s.homeDir, 'win32', 'desktop', s.statePath, {requested: market, effective: market, legacyDefaulted: false})
    expect(composeEntries([prepared.patches]).some(row => row.name === 'example-plugin')).toBe(false)
  })
  it('installs only after confirmation, backs up the profile, and never loads code live', async () => {
    const s = await fixture(), before = readFileSync(s.path, 'utf8')
    s.run.mockImplementation(() => {
      s.add('new-plugin')
      return {stdout: Readable.from([]), stderr: Readable.from([]), done: Promise.resolve({exitCode: 0, signal: null}), cancel: vi.fn()}
    })
    const preview = s.manager.inspectInstall('new-plugin@1.2.3'); expect(s.run).not.toHaveBeenCalled()
    const result = await s.manager.confirm(preview.previewId)
    expect(s.run).toHaveBeenCalledWith(['add', 'new-plugin@1.2.3'], s.profileDir, expect.any(AbortSignal))
    expect(result.restartRequired).toBe(true)
    const backups = join(s.profileDir, '.desktop-plugin-backups'), dirs = readdirSync(backups)
    expect(readFileSync(join(backups, dirs[0]!, 'package.json'), 'utf8')).toBe(before)
    expect(existsSync(join(s.profileDir, 'node_modules', 'example-plugin', 'package.json'))).toBe(true)
  })
  it('rejects replacing existing dependencies', async () => {
    const s = await fixture(); expect(() => s.manager.inspectInstall('example-plugin@2.0.0')).toThrow('已经存在'); expect(s.run).not.toHaveBeenCalled()
  })
  it('failed package installs do not expose raw logs and retain backups', async () => {
    const s = await fixture()
    s.run.mockImplementation(() => ({stdout: Readable.from(['secret']), stderr: Readable.from(['secret']), done: Promise.resolve({exitCode: 1, signal: null}), cancel: vi.fn()}))
    await expect(s.manager.confirm(s.manager.inspectInstall('new-plugin@1.0.0').previewId)).rejects.toThrow('安装未完成')
    expect(s.manager.snapshot().restartRequired).toBe(true)
    expect(existsSync(join(s.profileDir, '.desktop-plugin-backups'))).toBe(true)
  })
  it('cancels and waits for active work when the account Host closes', async () => {
    const s = await fixture(); let release!: () => void
    const cancel = vi.fn(() => release())
    s.run.mockImplementation(() => ({stdout: Readable.from([]), stderr: Readable.from([]), done: new Promise(resolve => {release = () => resolve({exitCode: 1, signal: null})}), cancel}))
    const result = s.manager.confirm(s.manager.inspectInstall('new-plugin@1.0.0').previewId)
    void result.catch(() => {})
    await expect.poll(() => s.run.mock.calls.length).toBe(1)
    expect(() => s.manager.inspectInstall('second@1.0.0')).toThrow('正在进行')
    await s.manager.dispose(); expect(cancel).toHaveBeenCalled()
    await expect(result).rejects.toThrow('已经关闭')
  })
})
