import type {MenuItemConstructorOptions} from 'electron'
import type {DesktopRendererAction} from './renderer-actions-contract.ts'

export interface ApplicationMenuActions {
  run(action:DesktopRendererAction):void
  remoteControl?:()=>void
  about():void
}

/** Keep the top level stable: product actions, not account or plugin menus. */
export function desktopApplicationMenu(english:boolean,actions:ApplicationMenuActions):MenuItemConstructorOptions[]{
  const command=(action:DesktopRendererAction,zh:string,en:string):MenuItemConstructorOptions=>({label:english?en:zh,click:()=>actions.run(action)})
  return [
    {label:english?'View':'视图',submenu:[command('reload','重新加载界面','Reload interface'),command('developer','开发者工具','Developer tools')]},
    {label:english?'Tools':'工具',submenu:[
      command('terminal','打开终端','Open terminal'),
      {type:'separator'},command('restart','重启','Restart'),command('restart-recovery','恢复模式','Recovery mode'),command('diagnostics','导出诊断信息','Export diagnostics'),
    ]},
    {type:'separator'},command('check-for-updates','检查更新','Check for updates'),
    {label:english?'About LETS':'关于 LETS',click:actions.about},
    {type:'separator'},{role:'quit',label:english?'Exit application':'退出应用'},
  ]
}
