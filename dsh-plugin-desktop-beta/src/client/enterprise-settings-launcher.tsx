/** Enterprise identity is launcher-owned; upstream account/feedback menus do not apply. */
import {Settings} from 'lucide-react'
import type {Context} from '@deepseek-ai/cordis'
import type {SettingsLauncherOwnerProps} from '@deepseek-ai/dsh-client-ui-settings/client'

export function EnterpriseSettingsLauncher({wide,openSettings,english=false}:SettingsLauncherOwnerProps&{english?:boolean}){
  const label=english?'Settings':'设置'
  return <button type="button" className="lets-account-button" style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',border:0,borderRadius:8,background:'transparent',color:'inherit',cursor:'pointer',maxWidth:'none',justifyContent:wide?'flex-start':'center'}} aria-label={label} title={label} onClick={openSettings}><Settings size={16} aria-hidden="true"/>{wide&&<span>{label}</span>}</button>
}
export function applyEnterpriseSettingsLauncher(ctx:Context):void{
  if(!(window as Window&{letsEnterpriseApplications?:unknown}).letsEnterpriseApplications)return
  ctx.slots.inject('settings.launcher',()=>ctx.slots.register({name:'settings.launcher',priority:-100,inject:()=>({english:ctx.locale.getLocale().active==='en'})},EnterpriseSettingsLauncher))
}
