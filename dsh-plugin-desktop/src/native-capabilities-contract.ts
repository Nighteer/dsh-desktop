/** Private LETS adapters for the public Harness 0.2 desktop capabilities. */
export const NATIVE_ORIGIN_ARGUMENT = '--lets-desktop-origin='
export const NATIVE_IPC = {
  shortcutsInput: 'lets:native:shortcuts-input',
  shortcutsGet: 'lets:native:shortcuts-get',
  shortcutsEdit: 'lets:native:shortcuts-edit',
  shortcutsRecording: 'lets:native:shortcuts-recording',
  shortcutsCloseWindow: 'lets:native:shortcuts-close-window',
  shortcutsChanged: 'lets:native:shortcuts-changed',
  browserAcquire: 'lets:native:browser-acquire',
  browserRelease: 'lets:native:browser-release',
  browserOpenRequested: 'lets:native:browser-open-requested',
} as const

/** Match the main-process-selected origin, never renderer-supplied IPC origins. */
export function isNativeProductOrigin(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === origin
      && parsed.username === '' && parsed.password === ''
  } catch { return false }
}
