import { contextBridge, ipcRenderer } from 'electron'
import { ENTERPRISE_LOGIN_CHANNEL, type EnterpriseLoginBridge } from './enterprise-login-contract.ts'
const bridge: EnterpriseLoginBridge = { invoke: action => ipcRenderer.invoke(ENTERPRISE_LOGIN_CHANNEL, action) }
contextBridge.exposeInMainWorld('letsEnterpriseLogin', bridge)
