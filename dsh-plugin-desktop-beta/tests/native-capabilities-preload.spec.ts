// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest'
import {installNativeCapabilitiesPreload} from '../src/native-capabilities-preload.ts'
import {NATIVE_ORIGIN_ARGUMENT} from '../src/native-capabilities-contract.ts'
const bridge = vi.hoisted(() => ({exports: new Map<string, any>(), invoke: vi.fn(), events: new Map<string, any>(), path: vi.fn(() => 'C:/工作区/清单.docx')}))
vi.mock('electron', () => ({contextBridge: {exposeInMainWorld: (name: string, api: any) => bridge.exports.set(name, api)},
  ipcRenderer: {invoke: bridge.invoke, on: (name: string, fn: any) => bridge.events.set(name, fn), removeListener: vi.fn()},
  webUtils: {getPathForFile: bridge.path}}))
function environment(origin = location.origin, mainFrame = true) {
  const nativeProcess = process
  vi.stubGlobal('process', new Proxy(nativeProcess, {get: (target, key) => key === 'argv' ? [NATIVE_ORIGIN_ARGUMENT + origin] : key === 'isMainFrame' ? mainFrame : Reflect.get(target, key)}))
}
afterEach(() => {vi.unstubAllGlobals(); bridge.exports.clear(); bridge.events.clear(); delete document.documentElement.dataset.platform})
describe('origin-scoped preload', () => {
  it('provides the new file path contract and restricted native APIs', () => {
    environment(); installNativeCapabilitiesPreload()
    expect(bridge.exports.get('__DSH_HOST_PATHS__').pathFor(new File(['x'], '清单.docx'))).toBe('C:/工作区/清单.docx')
    const api = bridge.exports.get('dshDesktop')
    expect(api.protocolVersion).toBe(1); expect(Object.keys(api).sort()).toEqual(['browser', 'keyboard', 'protocolVersion', 'shortcuts'])
    expect(document.documentElement.dataset.platform).toBe(process.platform)
  })
  it.each([['https://foreign.example', true], [location.origin, false]] as const)('does not expose to %s / main=%s', (origin, main) => {
    environment(origin, main); installNativeCapabilitiesPreload(); expect(bridge.exports.size).toBe(0)
  })
})
