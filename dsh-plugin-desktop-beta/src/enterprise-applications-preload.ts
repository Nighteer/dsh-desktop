import {contextBridge,ipcRenderer} from 'electron'
import {ENTERPRISE_APPLICATIONS_CHANNEL,type EnterpriseApplicationsBridge} from './enterprise-applications-contract.ts'
const bridge:EnterpriseApplicationsBridge={invoke:action=>ipcRenderer.invoke(ENTERPRISE_APPLICATIONS_CHANNEL,action)}
contextBridge.exposeInMainWorld('letsEnterpriseApplications',bridge)
