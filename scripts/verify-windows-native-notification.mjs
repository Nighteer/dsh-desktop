/** Explicit opt-in Windows toast check. No accounts, business Host or model calls. */
import {app,Notification} from 'electron'
import {mkdirSync,mkdtempSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {DESKTOP_APP_ID} from '../dsh-plugin-desktop-beta/src/product-identity.ts'
import {desktopNotificationOptions,registerDesktopNotificationBranding} from '../dsh-plugin-desktop-beta/src/desktop-notification-branding.ts'

if(process.platform!=='win32'||!process.argv.includes('--show')){
  console.error('Run with Electron on Windows and --show to explicitly display one test notification.')
  app.exit(2)
}else{
  const artifacts=resolve(import.meta.dirname,'../.artifacts')
  mkdirSync(artifacts,{recursive:true})
  const directory=mkdtempSync(join(artifacts,'native-notification-check-'))
  app.setName('LETS')
  app.setPath('userData',directory)
  app.setAppUserModelId(DESKTOP_APP_ID)
  registerDesktopNotificationBranding()
  app.on('window-all-closed',()=>{})
  // Do not top-level-await app readiness: Electron waits for ESM evaluation
  // before announcing ready, so a top-level await would deadlock this check.
  void app.whenReady().then(()=>{
  if(!Notification.isSupported()){
    console.log(JSON.stringify({supported:false,directory}));app.exit(1)
  }else{
    const notification=new Notification(desktopNotificationOptions({
      title:'LETS · 测试通知',body:'这是一条通知通道验证消息，不代表真实任务完成。',
    }))
    const timeout=setTimeout(()=>{console.log(JSON.stringify({accepted:false,reason:'timeout',directory}));app.exit(1)},10000)
    notification.once('failed',(_event,error)=>{
      clearTimeout(timeout);console.log(JSON.stringify({accepted:false,error,directory}));app.exit(1)
    })
    notification.once('show',()=>{
      clearTimeout(timeout);console.log(JSON.stringify({accepted:true,directory}))
      // The API accepting a toast does not certify the OS has enabled banners.
      setTimeout(()=>app.exit(0),2000)
    })
    notification.show()
  }
  }).catch(error=>{console.error(String(error));app.exit(1)})
}
