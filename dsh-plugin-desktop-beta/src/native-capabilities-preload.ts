/** Origin-scoped public Harness bridges; no raw IPC or Electron objects escape. */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopShortcutInput, DesktopKeyboardApi, DesktopShortcutsApi, ShortcutConfigSnapshot } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type { DesktopBrowserBridge, DesktopBrowserLeaseId } from '@deepseek-ai/dsh-client-ui-sidebar-browser/types'
import { NATIVE_IPC, NATIVE_ORIGIN_ARGUMENT, isNativeProductOrigin } from './native-capabilities-contract.ts'

export function installNativeCapabilitiesPreload(): void {
  const origin = process.argv.find(arg => arg.startsWith(NATIVE_ORIGIN_ARGUMENT))?.slice(NATIVE_ORIGIN_ARGUMENT.length)
  if (!process.isMainFrame || origin === undefined || !isNativeProductOrigin(location.href, origin)) return
  const keyboard: DesktopKeyboardApi = {
    closeWindow: revision => ipcRenderer.invoke(NATIVE_IPC.shortcutsCloseWindow, revision),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, input: DesktopShortcutInput): void => {
        if (input.kind === 'iframe' || input.kind === 'webview') {
          const active = document.activeElement
          if (active === null || !active.isConnected || input.frameName === ''
            || !active.matches(input.kind === 'iframe'
              ? 'iframe[data-sidebar-browser-frame], iframe[data-html-preview]'
              : 'webview[data-sidebar-browser-frame]') || active.getAttribute('name') !== input.frameName) return
        }
        listener(input)
      }
      ipcRenderer.on(NATIVE_IPC.shortcutsInput, receive)
      return () => { ipcRenderer.removeListener(NATIVE_IPC.shortcutsInput, receive) }
    },
  }
  const shortcuts: DesktopShortcutsApi = {
    get: definitions => ipcRenderer.invoke(NATIVE_IPC.shortcutsGet, definitions),
    edit: (edit, revision) => ipcRenderer.invoke(NATIVE_IPC.shortcutsEdit, edit, revision),
    recording: active => ipcRenderer.invoke(NATIVE_IPC.shortcutsRecording, active),
    subscribe(listener) {
      const receive = (_event: Electron.IpcRendererEvent, snapshot: ShortcutConfigSnapshot): void => { listener(snapshot) }
      ipcRenderer.on(NATIVE_IPC.shortcutsChanged, receive)
      return () => { ipcRenderer.removeListener(NATIVE_IPC.shortcutsChanged, receive) }
    },
  }
  const listeners = new Map<DesktopBrowserLeaseId, Set<(url: string) => void>>()
  ipcRenderer.on(NATIVE_IPC.browserOpenRequested, (_event, value: unknown) => {
    if (!value || typeof value !== 'object' || !('lease' in value) || !('url' in value)
      || typeof value.lease !== 'string' || typeof value.url !== 'string') return
    for (const listener of listeners.get(value.lease as DesktopBrowserLeaseId) ?? []) {
      try { listener(value.url) } catch (error) { console.error('LETS browser listener failed', error) }
    }
  })
  const browser: DesktopBrowserBridge = {
    acquire: workspace => ipcRenderer.invoke(NATIVE_IPC.browserAcquire, workspace),
    release: lease => ipcRenderer.invoke(NATIVE_IPC.browserRelease, lease),
    onOpenRequested(lease, listener) {
      let set = listeners.get(lease)
      if (set === undefined) { set = new Set(); listeners.set(lease, set) }
      set.add(listener)
      return () => { set.delete(listener); if (set.size === 0) listeners.delete(lease) }
    },
  }
  contextBridge.exposeInMainWorld('__DSH_HOST_PATHS__', { pathFor: (file: File) => webUtils.getPathForFile(file) })
  contextBridge.exposeInMainWorld('dshDesktop', { protocolVersion: 1, keyboard, shortcuts, browser })
  const mark = (): void => { document.documentElement.dataset.platform = process.platform }
  if (document.documentElement === null) window.addEventListener('DOMContentLoaded', mark, { once: true })
  else mark()
}
