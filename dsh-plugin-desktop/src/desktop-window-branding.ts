/** Windows chrome and taskbar branding, including development Electron windows. */
import type { BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { win32 } from 'node:path'
import { DESKTOP_APP_ID } from './product-identity.ts'

const ENTERPRISE_ARGUMENT = '--lets-taskbar-enterprise'
const DATA_ARGUMENT = '--lets-taskbar-user-data='

/** Consume only our explicit development relaunch markers, never credentials. */
export function consumeDesktopTaskbarLaunch(argv: string[], environment: NodeJS.ProcessEnv): string[] {
  return argv.filter((argument, index) => {
    if (index === 0) return true
    if (argument === ENTERPRISE_ARGUMENT) { environment.DSH_ENTERPRISE_MODE = '1'; return false }
    if (!argument.startsWith(DATA_ARGUMENT)) return true
    const directory = argument.slice(DATA_ARGUMENT.length)
    if (!win32.isAbsolute(directory) || /[\0\r\n]/u.test(directory)) throw new Error('Invalid LETS taskbar data directory')
    environment.DSH_DESKTOP_USER_DATA_DIR = directory
    return false
  })
}

/** Native Windows argv quoting, not a cmd.exe or PowerShell command. */
function quoteWindowsArgument(value: string): string {
  if (/[\0\r\n]/u.test(value)) throw new Error('Invalid LETS taskbar argument')
  return '"' + value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1') + '"'
}

/** Preserve enterprise mode/account storage when a development taskbar item relaunches. */
export function desktopTaskbarRelaunchCommand(executable: string, args: readonly string[], options: {
  development: boolean; enterprise: boolean; userDataDir?: string
}): string {
  const launch = [executable, ...args]
  if (options.development) {
    if (options.userDataDir !== undefined && !win32.isAbsolute(options.userDataDir)) throw new Error('Invalid LETS taskbar data directory')
    if (options.enterprise) launch.push(ENTERPRISE_ARGUMENT)
    if (options.userDataDir !== undefined) launch.push(DATA_ARGUMENT + options.userDataDir)
  }
  return launch.map(quoteWindowsArgument).join(' ')
}

/** Keep the native window icon and its Windows taskbar resource in sync. */
export function configureDesktopWindowBranding(
  window: Pick<BrowserWindow, 'setIcon' | 'setAppDetails'>,
  platform: NodeJS.Platform = process.platform,
  relaunchCommand?: string,
): void {
  if (platform !== 'win32') return
  const iconPath = fileURLToPath(new URL('../build/app-icon.ico', import.meta.url))
  window.setIcon(iconPath)
  window.setAppDetails({ appId: DESKTOP_APP_ID, appIconPath: iconPath, appIconIndex: 0,
    ...(relaunchCommand ? { relaunchCommand, relaunchDisplayName: 'LETS' } : {}),
  })
}
