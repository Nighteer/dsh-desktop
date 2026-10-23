/** Native notifications and diagnostics emitted around one Desktop startup. */

import type { DesktopLogger } from './desktop-logger.ts'
import type { ElectronDesktopRuntime } from './electron-runtime.ts'
import { desktopNativeCopy } from './native-dialog-copy.ts'
import { DESKTOP_PACKAGE_NAME } from './product-identity.ts'
import type { SkippedOptionalEntry } from './profile.ts'
import { desktopRecoveryCopy } from './recovery-copy.ts'
import type { SessionProjectionCacheRecoveryResult } from './session-projcache-recovery.ts'
import {
  formatWindowsVolumeConcern,
  type WindowsVolumeConcern,
} from './windows-volume-diagnostics.ts'

/** Report optional user UI plugins skipped to keep startup recoverable. */
export function notifySkippedOptionalEntries(
  runtime: ElectronDesktopRuntime,
  logger: DesktopLogger,
  entries: readonly SkippedOptionalEntry[],
): void {
  if (entries.length === 0) return
  const copy = desktopNativeCopy(runtime.locale)
  const names = entries.map(entry => entry.name)
  try {
    runtime.updates.notify({
      title: copy.skippedPluginTitle,
      body: copy.skippedPluginBody(names[0]!, names.length - 1),
    })
  } catch (cause) {
    logger.error(`${DESKTOP_PACKAGE_NAME}: failed to show skipped plugin notification: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Surface path/volume risks that otherwise become obscure sandbox or pnpm failures later. */
export function warnWindowsVolumeConcerns(
  logger: DesktopLogger,
  concerns: readonly WindowsVolumeConcern[],
): void {
  for (const concern of concerns) {
    logger.error(`${DESKTOP_PACKAGE_NAME}: Windows volume warning: ${formatWindowsVolumeConcern(concern)}`)
  }
}

/** Notify once after the UI is ready; stderr carries the exact paths. */
export function notifyWindowsVolumeConcerns(
  runtime: ElectronDesktopRuntime,
  logger: DesktopLogger,
  concerns: readonly WindowsVolumeConcern[],
): void {
  if (concerns.length === 0) return
  const copy = desktopNativeCopy(runtime.locale)
  const concernLabel = concerns[0]?.label
  const label = runtime.locale === 'zh'
    ? concernLabel === 'application install' ? '应用安装目录'
      : concernLabel === 'desktop user data' ? '桌面用户数据'
        : concernLabel === 'DSH home' ? 'DSH 主目录'
          : '某个配置路径'
    : concernLabel ?? 'A configured path'
  try {
    runtime.updates.notify({
      title: copy.unsupportedStorageTitle,
      body: copy.unsupportedStorageBody(label),
    })
  } catch (cause) {
    logger.error(`${DESKTOP_PACKAGE_NAME}: failed to show Windows volume warning: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Explain that an oversized projection cache was quarantined and will be rebuilt. */
export function notifySessionProjectionCacheRecovery(
  runtime: ElectronDesktopRuntime,
  logger: DesktopLogger,
  _recovery: Extract<SessionProjectionCacheRecoveryResult, { status: 'quarantined' }>,
): void {
  try {
    runtime.updates.notify({
      title: 'Recovered Session Cache',
      body: 'An oversized session projection cache was moved aside and will be rebuilt from session history.',
    })
  } catch (cause) {
    logger.error(`${DESKTOP_PACKAGE_NAME}: failed to show session projection cache recovery notification: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** Explain the disposable environment after the Safe Mode renderer is healthy. */
export function notifyDesktopSafeModeActive(
  runtime: ElectronDesktopRuntime,
  logger: DesktopLogger,
): void {
  const copy = desktopRecoveryCopy(runtime.locale)
  try {
    runtime.updates.notify({
      title: copy.safeModeNotificationTitle,
      body: copy.safeModeNotificationBody,
    })
  } catch (cause) {
    logger.error(`${DESKTOP_PACKAGE_NAME}: failed to show Safe Mode notification: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}
