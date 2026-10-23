/** Public Desktop plugin records. No account roots, credentials or subprocess output. */
export const DESKTOP_PLUGIN_MANAGER_PATH = '/api/desktop/plugins'
export interface DesktopPluginRow {
  id: string
  moduleName: string
  state: 'running' | 'disabled' | 'pending' | 'failed'
}
export interface DesktopManagedBundle {
  bundleId: string
  packageName: string
  enabled: boolean
  mutable: boolean
}
export interface DesktopPluginSnapshot {
  profileName: string
  bundles: DesktopManagedBundle[]
  runtime: DesktopPluginRow[]
  restartRequired: boolean
  installing: boolean
}
export interface DesktopPluginConfirmation {
  previewId: string
  action: 'enable' | 'disable' | 'install'
  target: string
  expiresAt: string
}
export type DesktopPluginRequest =
  | {action: 'preview'; bundleId: string; enabled: boolean}
  | {action: 'inspect-install'; spec: string}
  | {action: 'confirm'; previewId: string}

