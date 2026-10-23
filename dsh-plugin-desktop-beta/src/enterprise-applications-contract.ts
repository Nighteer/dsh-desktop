import type {AvailableApplication} from 'dsh-enterprise-contracts'
export const ENTERPRISE_APPLICATIONS_CHANNEL='lets-enterprise-applications'
export interface EnterpriseApplicationViewState { id:string|null; name:string; loading:boolean; canGoBack:boolean; canGoForward:boolean; error:string; notice:string }
export interface EnterpriseApplicationViewport { x:number; y:number; width:number; height:number }
export interface EnterpriseAccountSummary {name:string;username:string;departmentName:string}
export type EnterpriseApplicationsAction={action:'capabilities'|'list'|'state'|'account'}|{action:'account-menu';x:number;y:number}|{action:'open';id:string;name?:never}|{action:'viewport';bounds:EnterpriseApplicationViewport|null}|{action:'control';command:'back'|'forward'|'reload'|'close'}
export type EnterpriseApplicationsReply={ok:true;enabled?:boolean;account?:EnterpriseAccountSummary;applications?:AvailableApplication[];state?:EnterpriseApplicationViewState}|{ok:false;error:string}
export type EnterpriseApplicationsEvent={type:'state';state:EnterpriseApplicationViewState}|{type:'select'}
export const ENTERPRISE_APPLICATIONS_EVENT='lets-enterprise-applications:event'
export interface EnterpriseApplicationsBridge{invoke(action:EnterpriseApplicationsAction):Promise<EnterpriseApplicationsReply>;subscribe?(listener:(event:EnterpriseApplicationsEvent)=>void):()=>void}
