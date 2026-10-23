import {useState,type ReactElement} from 'react'
import {PanelLeft} from 'lucide-react'
import type {Context} from '@deepseek-ai/cordis'
import {createPortal} from 'react-dom'
import {desktopRendererActionsBridge} from './desktop-settings-api.ts'
import type {DesktopClientEnvironment} from './environment.ts'

export function CompactToolbar({toggleSidebar,english=false}:{toggleSidebar:()=>void;english?:boolean}):ReactElement{
  const [error,setError]=useState('')
  const open=()=>{
    const bridge=desktopRendererActionsBridge()
    if(!bridge){setError(english?'Native menu is unavailable.':'原生菜单不可用，请重试。');return}
    setError('');void bridge.invoke('application-menu').catch(()=>setError(english?'Could not open the menu.':'暂时无法打开菜单，请重试。'))
  }
  return createPortal(<nav className="lets-compact-toolbar" aria-label={english?'Application menu':'应用菜单'}>
    <button type="button" aria-label={english?'Toggle sidebar':'切换侧边栏'} onClick={toggleSidebar}><PanelLeft size={18} aria-hidden="true"/></button>
    <button type="button" aria-haspopup="menu" onClick={open}>{english?'Application':'应用'}</button>
    {error&&<span role="alert">{error}</span>}
  </nav>,document.body)
}

export function applyCompactToolbar(ctx:Context,environment:DesktopClientEnvironment){
  if(environment.platform!=='win32'||environment.mode!=='advanced')return
  // This consumer must never make its layout-providing parent wait for layout.
  ctx.inject(['layout'],child=>child.slots.inject('shell.overlay',()=>child.slots.register({
    name:'shell.overlay',id:'lets-compact-toolbar',order:0,
    inject:()=>({toggleSidebar:()=>child.layout.toggleSidebar(),english:child.locale.getLocale().active==='en'}),
  },CompactToolbar)))
  ctx.effect(()=>{
    const style=document.createElement('style')
    style.textContent=`.lets-compact-toolbar{position:fixed;z-index:1002;top:0;left:0;display:flex;align-items:center;height:32px;gap:4px;padding:0 8px;max-width:calc(100% - 138px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);-webkit-app-region:no-drag}.lets-compact-toolbar button{display:flex;align-items:center;justify-content:center;min-width:32px;height:28px;padding:0 10px;border:0;border-radius:5px;background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer}.lets-compact-toolbar button:hover{background:var(--dsw-alias-bg-layer-2)}.lets-compact-toolbar button:focus-visible{outline:2px solid currentColor;outline-offset:-2px}.lets-compact-toolbar [role=alert]{position:absolute;top:34px;left:8px;min-width:200px;padding:8px;background:var(--dsw-alias-bg-base);border:1px solid currentColor;border-radius:6px}body[data-dsh-desktop-mode=advanced][data-dsh-desktop-platform=win32] .dshDesktopUpstreamSidebar{padding-top:32px}`
    document.head.append(style);return()=>style.remove()
  },'desktop: compact application toolbar')
}
