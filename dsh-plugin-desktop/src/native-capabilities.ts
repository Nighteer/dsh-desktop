/** One generation owns native keyboard IPC and isolated Sidebar browser guests. */
import { app, type BrowserWindow, type IpcMainInvokeEvent, type WebContents, type MenuItemConstructorOptions } from 'electron'
import { nativeMenuLocale } from './native-menu.ts'
import { installDesktopShortcuts } from './keyboard.ts'
import { DesktopBrowserGuests } from './browser-guests.ts'
import { NATIVE_IPC, isNativeProductOrigin } from './native-capabilities-contract.ts'

export function bindNativeCapabilities(window: BrowserWindow, renderer: WebContents, url: string,
  setFileMenu?: (menu: MenuItemConstructorOptions | undefined) => void): () => Promise<void> {
  const origin = new URL(url).origin
  let disposed = false
  const trusted = (event: IpcMainInvokeEvent): void => {
    if (disposed || window.isDestroyed() || event.sender !== renderer || event.senderFrame !== renderer.mainFrame
      || !isNativeProductOrigin(event.senderFrame?.url ?? '', origin)) throw new Error('LETS native bridge: rejected sender')
  }
  let shortcuts: ReturnType<typeof installDesktopShortcuts> | undefined
  const updateMenu = (): void => {
    if (setFileMenu === undefined) return
    const english = nativeMenuLocale(app.getPreferredSystemLanguages()) === 'en'
    setFileMenu(shortcuts?.fileMenu({fileMenu: english ? 'File' : '文件', closePage: english ? 'Close Page' : '关闭页面'}))
  }
  shortcuts = installDesktopShortcuts(() => disposed || window.isDestroyed() ? undefined : window,
    app.getPath('userData'), process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
    updateMenu, () => ({ revision: 0, blocked: !window.isEnabled() }), () => renderer, origin)
  const keyboard = shortcuts
  updateMenu()
  const guests = new DesktopBrowserGuests(() => url)
  guests.bind(window, (guest, name) => keyboard.attachGuest(window, guest, name), renderer)
  keyboard.attach(window)
  renderer.ipc.handle(NATIVE_IPC.browserAcquire, (event, workspace: unknown) => { trusted(event); return guests.acquire(renderer, workspace) })
  renderer.ipc.handle(NATIVE_IPC.browserRelease, (event, lease: unknown) => { trusted(event); return guests.release(renderer, lease) })
  return async () => {
    if (disposed) return
    disposed = true
    keyboard.dispose()
    setFileMenu?.(undefined)
    if (!renderer.isDestroyed()) {
      renderer.ipc.removeHandler(NATIVE_IPC.browserAcquire)
      renderer.ipc.removeHandler(NATIVE_IPC.browserRelease)
    }
    await guests.dispose()
  }
}
