// @vitest-environment jsdom
import {createElement, act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import type {Context} from '@deepseek-ai/cordis'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {applyDesktopPluginManager, DesktopPluginManagerPage, type DesktopPluginManagerApi} from '../src/client/desktop-plugin-manager.tsx'
import type {DesktopPluginSnapshot} from '../src/desktop-plugin-manager-contract.ts'
let root: Root, container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
  HTMLDialogElement.prototype.showModal = function () {this.setAttribute('open', '')}
  HTMLDialogElement.prototype.close = function () {this.removeAttribute('open')}
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals()})
function fixture() {
  const snapshot: DesktopPluginSnapshot = {profileName: 'desktop', bundles: [
    {bundleId: 'core', packageName: '@deepseek-ai/dsh-web-app', mutable: false, enabled: true},
    {bundleId: 'custom', packageName: 'example-plugin', mutable: true, enabled: true},
  ], runtime: [{id: 'ppt', moduleName: 'dsh-ppt', state: 'running'}], restartRequired: false, installing: false}
  const api = {read: vi.fn(async () => snapshot), preview: vi.fn(async () => ({action: 'disable' as const, previewId: 'token', target: 'example-plugin', expiresAt: new Date(Date.now() + 10000).toISOString()})),
    confirm: vi.fn(async () => ({...snapshot, restartRequired: true})), restart: vi.fn(async () => {})}
  return {api, snapshot}
}
async function render(api: DesktopPluginManagerApi) {await act(async () => root.render(createElement(DesktopPluginManagerPage, {api})))}
async function click(name: string) {
  const target = [...container.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') || button.textContent) === name)
  expect(target, name).toBeDefined(); await act(async () => target!.click())
}
describe('desktop plugin manager UI', () => {
  it('displays bundles and runtime instead of the upstream unavailable state', async () => {
    const {api} = fixture(); await render(api)
    expect(container.textContent).toContain('example-plugin'); expect(container.textContent).toContain('@deepseek-ai/dsh-web-app')
    expect(container.textContent).toContain('dsh-ppt'); expect(container.textContent).toContain('运行中')
    expect(container.textContent).not.toContain('本部署没有可管理的 profile')
    expect(container.querySelector('[aria-label="停用 @deepseek-ai/dsh-web-app"]')).toBeNull()
    expect(container.querySelector('button')?.textContent).toBe('刷新列表')
  })
  it('does not mutate until a separate confirmation, then offers an explicit restart', async () => {
    const {api} = fixture(); await render(api)
    await click('停用 example-plugin'); expect(api.confirm).not.toHaveBeenCalled()
    expect(container.querySelector('dialog[open]')).not.toBeNull()
    expect(container.textContent).toContain('不删除插件文件或历史数据')
    await click('确认变更'); expect(api.confirm).toHaveBeenCalledWith('token'); expect(api.restart).not.toHaveBeenCalled()
    expect(container.textContent).toContain('重启后生效'); await click('重启桌面'); expect(api.restart).toHaveBeenCalledOnce()
  })
  it('cancel leaves configuration untouched', async () => {
    const {api} = fixture(); await render(api); await click('停用 example-plugin'); await click('取消')
    expect(api.confirm).not.toHaveBeenCalled(); expect(container.querySelector('dialog')).toBeNull()
  })
  it('refreshes state and discards spent confirmations after a failed mutation', async () => {
    const {api} = fixture(); api.confirm.mockRejectedValueOnce(new Error('安装未完成，请重新操作。'))
    await render(api); await click('停用 example-plugin'); await click('确认变更')
    expect(container.querySelector('dialog')).toBeNull(); expect(container.querySelector('[role="alert"]')?.textContent).toContain('重新操作')
    expect(api.read).toHaveBeenCalledTimes(2)
    await click('停用 example-plugin'); expect(api.preview).toHaveBeenCalledTimes(2)
  })
  it('shows actionable errors and supports refreshing a failed read', async () => {
    const {api} = fixture(); api.read.mockRejectedValueOnce(new Error('private diagnostic'))
    await render(api); expect(container.querySelector('[role="alert"]')?.textContent).toContain('刷新重试')
    expect(container.textContent).not.toContain('private diagnostic'); await click('刷新列表'); expect(container.textContent).toContain('example-plugin')
  })
  it('explains trusted code and version requirements before installation', async () => {
    const {api} = fixture(); await render(api); await click('添加插件')
    expect(container.querySelector('dialog')?.textContent).toContain('精确版本')
    expect(container.querySelector('input[placeholder="example-dsh-plugin@1.2.3"]')).not.toBeNull()
    expect(api.confirm).not.toHaveBeenCalled(); await click('取消')
  })
  it('replaces only the documented main/plugins cell and matching sidebar entry', () => {
    const registrations: Record<string, unknown>[] = [], disposers: (() => void)[] = []
    const ctx = {effect: (fn: () => (() => void)) => {disposers.push(fn())}, slots: {inject: (_name: string, fn: () => void) => fn(), register: (options: Record<string, unknown>) => {registrations.push(options); return () => {}}}} as unknown as Context
    applyDesktopPluginManager(ctx, {platform: 'win32', mode: 'advanced', material: 'off', micaSupported: false, version: 'test'})
    expect(registrations).toContainEqual(expect.objectContaining({name: 'main', key: 'plugins', priority: -100}))
    expect(registrations).toContainEqual(expect.objectContaining({name: 'sidebar.panellist', id: 'plugins', priority: -100, order: 0}))
    expect(registrations.some(options => options.name === 'root' || options.name === 'sidebar')).toBe(false)
    for (const dispose of disposers.reverse()) dispose()
  })
  it('leaves compatibility presentation untouched', () => {
    const effect = vi.fn(), inject = vi.fn()
    applyDesktopPluginManager({effect, slots: {inject}} as unknown as Context, {platform: 'win32', mode: 'compatibility', material: 'off', micaSupported: false, version: 'test'})
    expect(effect).not.toHaveBeenCalled(); expect(inject).not.toHaveBeenCalled()
  })
})
