import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, WebContents } from 'electron'
import { bindNativeCapabilities } from '../src/native-capabilities.ts'
import { NATIVE_IPC, isNativeProductOrigin } from '../src/native-capabilities-contract.ts'

const state = vi.hoisted(() => ({ sessions: new Map<string, any>(), raw: null as string | null }))
vi.mock('electron', () => ({ app: {isPackaged: true, getPath: () => '/virtual/lets-test'}, session: {
  fromPartition: (partition: string) => {
    if (!state.sessions.has(partition)) state.sessions.set(partition, Object.assign(new EventEmitter(), {
      setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(),
      setDisplayMediaRequestHandler: vi.fn(), webRequest: {onBeforeRequest: vi.fn()},
    }))
    return state.sessions.get(partition)
  },
} }))
vi.mock('../src/keybindings.ts', async () => {
  const {ShortcutPersistence} = await import('@deepseek-ai/dsh-client-shortcuts/protocol')
  return {desktopKeybindings: (_root: string, platform: any, publish: any) => new ShortcutPersistence({
    read: async () => state.raw, write: async raw => {state.raw = raw},
  }, 'desktop', platform, false, publish)}
})

function fixture() {
  const handlers = new Map<string, (...args: any[]) => any>()
  const renderer = Object.assign(new EventEmitter(), {
    mainFrame: {url: 'http://127.0.0.1:41414/'}, isDestroyed: () => false, setIgnoreMenuShortcuts: vi.fn(), send: vi.fn(),
    ipc: {handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn), removeHandler: (name: string) => handlers.delete(name)},
  })
  const window = Object.assign(new EventEmitter(), {webContents: renderer, isDestroyed: () => false, isEnabled: () => true, isFocused: () => true})
  const dispose = bindNativeCapabilities(window as unknown as BrowserWindow, renderer as unknown as WebContents, renderer.mainFrame.url)
  const event = {sender: renderer, senderFrame: renderer.mainFrame}
  return {renderer, window, handlers, event, dispose,
    call: (channel: string, ...args: unknown[]) => handlers.get(channel)!(event, ...args)}
}

beforeEach(() => {state.sessions.clear(); state.raw = null})
describe('public Harness native adapters', () => {
  it('accepts only the selected HTTP origin', () => {
    expect(isNativeProductOrigin('http://127.0.0.1:41414/path', 'http://127.0.0.1:41414')).toBe(true)
    for(const url of ['file:///etc/passwd', 'https://127.0.0.1:41414/', 'http://127.0.0.1:41415/', 'http://user:pass@127.0.0.1:41414/'])
      expect(isNativeProductOrigin(url, 'http://127.0.0.1:41414')).toBe(false)
  })
  it('rejects subframes, foreign windows and navigated documents for both capabilities', async () => {
    const f = fixture()
    for (const channel of [NATIVE_IPC.browserAcquire, NATIVE_IPC.shortcutsGet]) {
      for (const event of [{...f.event, sender: {}}, {...f.event, senderFrame: {url: f.renderer.mainFrame.url}}])
        await expect(Promise.resolve().then(() => f.handlers.get(channel)!(event, channel === NATIVE_IPC.shortcutsGet ? [] : 'workspace'))).rejects.toThrow('sender')
    }
    f.renderer.mainFrame.url = 'https://untrusted.example/'
    expect(() => f.call(NATIVE_IPC.browserAcquire, 'workspace')).toThrow('sender')
    await f.dispose()
  })
  it('reads shortcuts through the official persistence coordinator without writing on read', async () => {
    const f = fixture()
    const snapshot = await f.call(NATIVE_IPC.shortcutsGet, [])
    expect(snapshot.status).not.toBe('loading'); expect(state.raw).toBeNull()
    await f.dispose(); expect(f.handlers.size).toBe(0)
  })
  it('persists accepted shortcut edits through IPC and publishes the new revision', async () => {
    const f = fixture()
    const definitions = [{id: 'page.close', defaults: {
      'desktop:windows': {code: 'KeyW', modifiers: ['primary']},
      'desktop:macos': {code: 'KeyW', modifiers: ['primary']},
    }}]
    const first = await f.call(NATIVE_IPC.shortcutsGet, definitions)
    await f.call(NATIVE_IPC.shortcutsEdit, {type: 'set', id: 'page.close', binding: {code: 'KeyK', modifiers: ['primary', 'shift']}}, first.revision)
    expect(state.raw).toContain('KeyK')
    const next = await f.call(NATIVE_IPC.shortcutsGet, definitions)
    expect(next.revision).not.toBe(first.revision)
    expect(f.renderer.send).toHaveBeenCalledWith(NATIVE_IPC.shortcutsChanged, expect.objectContaining({revision: next.revision}))
    await f.dispose()
  })

  it('isolates workspaces and prevents unauthorized webview attachment', async () => {
    const f = fixture(), a = await f.call(NATIVE_IPC.browserAcquire, 'a'), a2 = await f.call(NATIVE_IPC.browserAcquire, 'a'), b = await f.call(NATIVE_IPC.browserAcquire, 'b')
    expect(a.partition).toBe(a2.partition); expect(a.partition).not.toBe(b.partition); expect(a.partition.startsWith('persist:')).toBe(false)
    const event = {preventDefault: vi.fn()}
    f.renderer.emit('will-attach-webview', event, {}, {src: 'https://example.org', partition: a.partition})
    expect(event.preventDefault).toHaveBeenCalledOnce()
    const prefs: Record<string, unknown> = {preload: 'evil.js', nodeIntegration: true}
    const approved = {preventDefault: vi.fn()}
    f.renderer.emit('will-attach-webview', approved, prefs, {src: 'about:blank#' + a.lease, partition: a.partition})
    expect(approved.preventDefault).not.toHaveBeenCalled(); expect(prefs.nodeIntegration).toBe(false); expect(prefs.preload).toBeUndefined()
    expect(prefs.sandbox).toBe(true); expect(prefs.contextIsolation).toBe(true)
    await f.dispose()
  })
  it('denies downloads, devices, files and access to the authenticated Host', async () => {
    const f = fixture(), a = await f.call(NATIVE_IPC.browserAcquire, 'a'), session = state.sessions.get(a.partition)
    expect(session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false)
    const download = {preventDefault: vi.fn()}; session.emit('will-download', download); expect(download.preventDefault).toHaveBeenCalledOnce()
    const check = session.webRequest.onBeforeRequest.mock.calls[0][0]
    for(const url of ['file:///C:/secrets', 'http://127.0.0.1:41414/api', 'ws://localhost:41414/', 'https://user:pass@example.org/']) {
      const callback = vi.fn(); check({url}, callback); expect(callback).toHaveBeenCalledWith({cancel: true})
    }
    const callback = vi.fn(); check({url: 'https://example.org/'}, callback); expect(callback).toHaveBeenCalledWith({cancel: false})
    await f.dispose()
  })
})
