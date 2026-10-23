/** Register only this edition's notification identity; never touch Electron's shared key. */
import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {win32} from 'node:path'
import {fileURLToPath} from 'node:url'
import {DESKTOP_APP_ID} from './product-identity.ts'

export const DESKTOP_NOTIFICATION_NAME='LETS'
export function desktopNotificationIcon():string{
  return fileURLToPath(new URL('../build/app-icon.png',import.meta.url))
}
export function desktopNotificationOptions(notification:{title:string;body:string}){
  return {...notification,icon:desktopNotificationIcon()}
}
export function registerDesktopNotificationBranding(
  platform:NodeJS.Platform=process.platform,
  execute:typeof spawnSync=spawnSync,
):void{
  if(platform!=='win32')return
  const icon=desktopNotificationIcon()
  if(!existsSync(icon))throw new Error('LETS notification icon is unavailable')
  const registry=win32.join(process.env.SystemRoot??'C:\\Windows','System32','reg.exe')
  const key=`HKCU\\Software\\Classes\\AppUserModelId\\${DESKTOP_APP_ID}`
  for(const [name,value] of [['DisplayName',DESKTOP_NOTIFICATION_NAME],['IconUri',icon]]){
    const result=execute(registry,['add',key,'/v',name!,'/t','REG_SZ','/d',value!,'/f'],{
      windowsHide:true,shell:false,stdio:'ignore',timeout:3000,
    })
    if(result.error||result.status!==0)throw new Error('Could not register LETS notification branding')
  }
}
