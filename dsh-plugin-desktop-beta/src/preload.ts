/** Minimal context-isolated bridges for drag payloads and Desktop-owned actions. */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { installNativeCapabilitiesPreload } from './native-capabilities-preload.ts'
import {ENTERPRISE_APPLICATIONS_CHANNEL,ENTERPRISE_APPLICATIONS_EVENT,type EnterpriseApplicationsBridge,type EnterpriseApplicationsEvent} from './enterprise-applications-contract.ts'
import { DESKTOP_FILE_PATH_BRIDGE } from './file-path-bridge-contract.ts'
import {
  DESKTOP_RENDERER_ACTION_CHANNEL,
  DESKTOP_RENDERER_ACTIONS_BRIDGE,
  type DesktopRendererAction,
  type DesktopRendererActionsBridge,
} from './renderer-actions-contract.ts'

contextBridge.exposeInMainWorld(DESKTOP_FILE_PATH_BRIDGE, {
  /** Resolve only genuine disk-backed Web File objects selected by the operator. */
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },
})

const actions: DesktopRendererActionsBridge = {
  /** Reach the main process directly, independent of the Host generation. */
  invoke: (action: DesktopRendererAction) => ipcRenderer.invoke(DESKTOP_RENDERER_ACTION_CHANNEL, action),
}
contextBridge.exposeInMainWorld(DESKTOP_RENDERER_ACTIONS_BRIDGE, actions)
const enterpriseApplications:EnterpriseApplicationsBridge={
  invoke:action=>ipcRenderer.invoke(ENTERPRISE_APPLICATIONS_CHANNEL,action),
  subscribe:listener=>{const receive=(_event:Electron.IpcRendererEvent,value:EnterpriseApplicationsEvent)=>listener(value);ipcRenderer.on(ENTERPRISE_APPLICATIONS_EVENT,receive);return()=>{ipcRenderer.removeListener(ENTERPRISE_APPLICATIONS_EVENT,receive)}},
}
contextBridge.exposeInMainWorld('letsEnterpriseApplications',enterpriseApplications)
installNativeCapabilitiesPreload()
