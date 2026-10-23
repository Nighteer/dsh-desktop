import type {MenuItemConstructorOptions} from 'electron'
import type {EnterpriseAccountSummary,EnterpriseApplicationViewport} from './enterprise-applications-contract.ts'

/** Never spread an identity/session into renderer messages. */
export function enterpriseAccountSummary(user:EnterpriseAccountSummary):EnterpriseAccountSummary{
  return {name:user.name,username:user.username,departmentName:user.departmentName}
}
export function enterpriseAccountMenu(account:EnterpriseAccountSummary,english:boolean,logout:()=>void,changeService?:()=>void):MenuItemConstructorOptions[]{
  return [
    {label:account.name,enabled:false},
    {label:`${english?'Account':'账号'}：${account.username}`,enabled:false},
    {label:`${english?'Department':'部门'}：${account.departmentName}`,enabled:false},
    {type:'separator'},
    {label:english?'Switch account':'切换账号',click:logout},
    {label:english?'Log out':'退出登录',click:logout},
    ...(changeService ? [{type:'separator' as const},{label:english?'Change enterprise service (sign out)':'更换企业服务（退出当前账号）',click:changeService}] : []),
  ]
}
/** Point is relative to the trusted renderer, never arbitrary screen space. */
export function enterpriseAccountMenuPoint(x:unknown,y:unknown,zoom:number,base:EnterpriseApplicationViewport):{x:number;y:number}{
  if(typeof x!=='number'||typeof y!=='number'||!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x*zoom>base.width||y*zoom>base.height)throw new Error('账号菜单位置无效')
  return{x:Math.round(base.x+x*zoom),y:Math.round(base.y+y*zoom)}
}
