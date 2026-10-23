import {createServer} from 'node:http'
import type {AddressInfo} from 'node:net'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {handleDesktopPluginManagerRequest} from '../src/desktop-plugin-manager-route.ts'
import type {DesktopPluginManagerController} from '../src/desktop-plugin-manager.ts'
const closers: (() => Promise<void>)[] = []
afterEach(async () => {for (const close of closers.splice(0)) await close()})
async function fixture() {
  const controller = {snapshot: vi.fn(() => ({bundles: [], runtime: []})), preview: vi.fn(() => ({previewId: 'a'.repeat(43)})), inspectInstall: vi.fn(), confirm: vi.fn(async () => ({}))}
  let origin = ''
  const server = createServer((req, res) => {void handleDesktopPluginManagerRequest(req, res, origin, controller as unknown as DesktopPluginManagerController)})
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  closers.push(() => new Promise<void>(resolve => {server.closeAllConnections(); server.close(() => resolve())}))
  return {origin, controller, request: (body: object | string, headers: Record<string, string> = {}) => fetch(origin, {method: 'POST', headers: {'content-type': 'application/json', origin, ...headers}, body: typeof body === 'string' ? body : JSON.stringify(body)})}
}
describe('private plugin manager route', () => {
  it('requires same-origin loopback reads and blocks cross-site mutations', async () => {
    const s = await fixture()
    expect((await fetch(s.origin)).status).toBe(403)
    expect((await fetch(s.origin, {headers: {'sec-fetch-site': 'same-origin', referer: s.origin + '/'}})).status).toBe(200)
    expect((await s.request({action: 'confirm', previewId: 'a'.repeat(43)}, {origin: 'https://attacker.test'})).status).toBe(403)
    expect(s.controller.confirm).not.toHaveBeenCalled()
  })
  it('validates exact bodies, content type, size and method', async () => {
    const s = await fixture()
    expect((await s.request({action: 'preview', bundleId: 'x', enabled: false, profileDir: 'elsewhere'})).status).toBe(400)
    expect((await s.request({action: 'confirm', previewId: '../another-account'})).status).toBe(400)
    expect((await s.request('not-json')).status).toBe(400)
    expect((await s.request('x'.repeat(5000))).status).toBe(413)
    expect((await s.request({}, {'content-type': 'text/plain'})).status).toBe(415)
    expect((await fetch(s.origin, {method: 'DELETE'})).status).toBe(405)
    expect(s.controller.confirm).not.toHaveBeenCalled()
  })
  it('dispatches validated opaque identities, not file paths', async () => {
    const s = await fixture()
    expect((await s.request({action: 'preview', bundleId: 'bundle-id', enabled: false})).status).toBe(200)
    expect(s.controller.preview).toHaveBeenCalledWith('bundle-id', false)
    expect((await s.request({action: 'confirm', previewId: 'a'.repeat(43)})).status).toBe(200)
    expect(s.controller.confirm).toHaveBeenCalledWith('a'.repeat(43))
  })
  it('never returns filesystem diagnostics or credentials to the renderer', async () => {
    const s = await fixture(); s.controller.preview.mockImplementation(() => {throw new Error('C:/private/password=secret')})
    const response = await s.request({action: 'preview', bundleId: 'x', enabled: false})
    expect(response.status).toBe(409); expect(await response.text()).not.toContain('secret')
    s.controller.preview.mockImplementation(() => {throw new Error('插件状态 C:/private/password=secret')})
    expect(await (await s.request({action: 'preview', bundleId: 'x', enabled: false})).text()).not.toContain('secret')
  })
})
