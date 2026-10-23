import {dialog,session,WebContentsView,Menu,app,type BrowserWindow,type WebContents,type DownloadItem} from 'electron'
import {enterpriseAccountMenu,enterpriseAccountSummary,enterpriseAccountMenuPoint} from './enterprise-account-menu.ts'
import type {ApplicationLaunch} from 'dsh-enterprise-contracts'
import type {EnterpriseClient} from './enterprise-client.ts'
import {EnterpriseApplicationsClient,monitorEmbeddedApplication} from './enterprise-applications-client.ts'
import {applicationBounds,applicationPartition,allowedApplicationNavigation,applicationNetworkOrigin} from './enterprise-application-policy.ts'
import {ENTERPRISE_APPLICATIONS_CHANNEL,ENTERPRISE_APPLICATIONS_EVENT,type EnterpriseApplicationViewport,type EnterpriseApplicationViewState,type EnterpriseApplicationsReply} from './enterprise-applications-contract.ts'

/** Enterprise main-process service; remote pages never receive a preload or this bridge. */
export class DesktopEnterpriseApplications{
  private readonly surfaces=new Set<EmbeddedApplicationSurface>()
  constructor(private readonly client:EnterpriseClient,private readonly active:()=>boolean,private readonly logout?:()=>Promise<void>,private readonly changeService?:()=>Promise<void>){}
  attach(window:BrowserWindow,renderer:WebContents,base:()=>EnterpriseApplicationViewport,origin:string){
    const surface=new EmbeddedApplicationSurface(window,renderer,base,this.client,this.active,origin,this.logout,this.changeService)
    this.surfaces.add(surface)
    return()=>{surface.dispose();this.surfaces.delete(surface)}
  }
  close(){for(const surface of this.surfaces)surface.closeRemote()}
  async show(){for(const surface of this.surfaces){surface.select();break}}
}

class EmbeddedApplicationSurface{
  private readonly applications:EnterpriseApplicationsClient
  private readonly origin:string
  private view:WebContentsView|undefined
  private receipt:ApplicationLaunch|undefined
  private viewport:EnterpriseApplicationViewport|null=null
  private disposed=false
  private operation=0
  private networkActive=false
  private stopMonitor:(()=>void)|undefined
  private removeDownloadHandler:(()=>void)|undefined
  private readonly downloads=new Set<DownloadItem>()
  private readonly state:EnterpriseApplicationViewState={id:null,name:'',loading:false,canGoBack:false,canGoForward:false,error:'',notice:''}
  constructor(private readonly window:BrowserWindow,private readonly renderer:WebContents,private readonly base:()=>EnterpriseApplicationViewport,private readonly client:EnterpriseClient,private readonly active:()=>boolean,origin:string,logout:(()=>Promise<void>)|undefined,changeService?:()=>Promise<void>){
    this.origin=new URL(origin).origin
    this.applications=new EnterpriseApplicationsClient(client,()=>!this.disposed&&active())
    let busy=false
    renderer.ipc.handle(ENTERPRISE_APPLICATIONS_CHANNEL,async(event,value:unknown):Promise<EnterpriseApplicationsReply>=>{
      if(this.disposed||!active()||event.sender!==renderer||event.senderFrame!==renderer.mainFrame||!this.trusted(event.senderFrame?.url))return{ok:false,error:'不受信任的应用界面或登录已失效'}
      if(!value||typeof value!=='object'||Array.isArray(value))return{ok:false,error:'请求无效'}
      const action=value as Record<string,unknown>
      if(action.action==='account')return{ok:true,account:enterpriseAccountSummary(this.client.session!.user)}
      if(action.action==='account-menu'){
        if(!logout)return{ok:false,error:'账号操作暂不可用'}
        try{
          const point=enterpriseAccountMenuPoint(action.x,action.y,renderer.getZoomFactor(),this.base())
          const menu=enterpriseAccountMenu(enterpriseAccountSummary(this.client.session!.user),app.getLocale().startsWith('en'),()=>{
            // Let the popup close and its IPC finish before tearing down this renderer.
            setImmediate(()=>{void logout().catch(()=>dialog.showErrorBox('账号','退出失败，请重试。'))})
          },changeService ? ()=>{setImmediate(()=>{void changeService().catch(()=>dialog.showErrorBox('企业服务','无法更换服务，请重试。'))})} : undefined)
          await new Promise<void>(resolve=>Menu.buildFromTemplate(menu).popup({window,...point,callback:resolve}))
          return{ok:true}
        }catch{return{ok:false,error:'无法打开账号菜单，请重试'}}
      }
      if(action.action==='capabilities')return{ok:true,enabled:true}
      if(action.action==='state')return{ok:true,state:{...this.state}}
      if(action.action==='viewport'){
        const bounds=action.bounds
        if(bounds!==null&&(!bounds||typeof bounds!=='object'||!['x','y','width','height'].every(key=>typeof (bounds as Record<string,unknown>)[key]==='number'&&Number.isFinite((bounds as Record<string,unknown>)[key]))))return{ok:false,error:'显示区域无效'}
        this.viewport=bounds as EnterpriseApplicationViewport|null;this.resize();return{ok:true}
      }
      if(busy)return{ok:false,error:'请求正在处理中，请稍后再试'}
      busy=true
      try{
        if(action.action==='list')return{ok:true,applications:await this.applications.list()}
        if(action.action==='open'&&typeof action.id==='string'){await this.open(action.id);return{ok:true,state:{...this.state}}}
        if(action.action==='control'&&['back','forward','reload','close'].includes(String(action.command))){await this.control(action.command as 'back'|'forward'|'reload'|'close');return{ok:true,state:{...this.state}}}
        return{ok:false,error:'应用操作无效'}
      }catch(e){return{ok:false,error:e instanceof Error?e.message:'应用操作失败，请重试'}}finally{busy=false}
    })
    window.on('resize',this.resize);window.on('closed',this.dispose)
    renderer.on('did-start-loading',this.rendererReload);renderer.on('destroyed',this.dispose)
  }
  private trusted(value:string|undefined){try{return value!==undefined&&new URL(value).origin===this.origin}catch{return false}}
  select(){if(!this.renderer.isDestroyed()&&this.active())this.renderer.send(ENTERPRISE_APPLICATIONS_EVENT,{type:'select'})}
  private emit(){
    const contents=this.view?.webContents
    if(contents&&!contents.isDestroyed()){this.state.loading=contents.isLoadingMainFrame();this.state.canGoBack=contents.navigationHistory.canGoBack();this.state.canGoForward=contents.navigationHistory.canGoForward()}
    if(!this.disposed&&!this.renderer.isDestroyed())this.renderer.send(ENTERPRISE_APPLICATIONS_EVENT,{type:'state',state:{...this.state}})
    this.resize()
  }
  readonly resize=()=>{
    const view=this.view;if(!view||this.window.isDestroyed())return
    if(!this.viewport||this.state.error||!this.active()||this.disposed){view.setVisible(false);return}
    const bounds=applicationBounds(this.viewport,this.base(),this.renderer.getZoomFactor())
    view.setBounds(bounds);view.setVisible(bounds.width>0&&bounds.height>0)
  }
  private allowed(value:string){return Boolean(this.receipt&&allowedApplicationNavigation(value,this.receipt.allowedOrigins,[this.client.origin,this.origin]))}
  private async confirmClose(){
    if(!this.view)return true
    const response=await dialog.showMessageBox(this.window,{type:'question',title:'关闭企业应用',message:'关闭当前应用页面？',detail:'请先在网页内保存未提交的内容。关闭页面不会删除本地账号数据。',buttons:['关闭页面','取消'],defaultId:1,cancelId:1,noLink:true})
    return response.response===0&&!this.disposed&&this.active()
  }
  private async open(id:string){
    if(this.state.id===id&&this.view){await this.recheck();this.emit();return}
    if(!await this.confirmClose())return
    this.closeRemote();const operation=++this.operation
    const catalog=await this.applications.list(),item=catalog.find(item=>item.id===id)
    if(!item)throw new Error('应用未授权或已停用，请刷新应用列表')
    const receipt=await this.applications.authorize(id,true)
    if(this.disposed||operation!==this.operation||!this.active())throw new Error('登录状态已变化，已取消打开')
    this.receipt=receipt
    if(!this.allowed(receipt.url)){this.receipt=undefined;throw new Error('不允许把企业服务或桌面内部地址作为业务网页打开')}
    const identity=this.client.session!
    const partition=session.fromPartition(applicationPartition(identity.instanceId,identity.user.id,id))
    const view=new WebContentsView({webPreferences:{partition:applicationPartition(identity.instanceId,identity.user.id,id),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false}})
    this.view=view;this.networkActive=true
    Object.assign(this.state,{id,name:item.name,loading:true,error:'',notice:''})
    // Includes service-worker requests: a closed/revoked partition cannot start more network work.
    partition.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{
      let denied=!this.networkActive||this.view!==view||!this.active()||this.disposed
      try{
        const url=new URL(details.url)
        if([this.client.origin,this.origin].includes(applicationNetworkOrigin(details.url))||!['https:','http:','wss:','ws:','data:','blob:'].includes(url.protocol))denied=true
        if(details.resourceType==='mainFrame'&&details.webContentsId===view.webContents.id&&!this.allowed(details.url))denied=true
      }catch{denied=true}
      callback({cancel:denied})
    })
    partition.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false))
    partition.setPermissionCheckHandler(()=>false)
    partition.setDevicePermissionHandler(()=>false)
    const download=(_event:Electron.Event,item:DownloadItem,contents:WebContents)=>{
      if(!this.networkActive||this.view!==view||contents!==view.webContents||!this.active()){item.cancel();return}
      // No setSavePath: Electron asks the operator where to save, including overwrite confirmation.
      item.setSaveDialogOptions({title:'保存企业应用文件',buttonLabel:'保存',properties:['showOverwriteConfirmation']})
      this.downloads.add(item);item.once('done',()=>this.downloads.delete(item))
    }
    partition.on('will-download',download);this.removeDownloadHandler=()=>partition.off('will-download',download)
    const contents=view.webContents
    contents.on('will-navigate',(event,url)=>{if(!this.allowed(url)){event.preventDefault();this.state.notice='已阻止未获允许的站点跳转，请联系管理员配置允许站点。';this.emit()}})
    contents.on('will-redirect',(event,url)=>{if(!this.allowed(url)){event.preventDefault();this.state.error='登录或页面跳转被阻止，请管理员配置允许跳转的站点。';this.emit()}})
    contents.on('will-attach-webview',event=>event.preventDefault())
    contents.setWindowOpenHandler(({url})=>{
      if(this.allowed(url)){void this.recheck().then(()=>{if(this.view===view&&this.active())return contents.loadURL(url)}).catch(()=>{this.closeRemote('应用权限检查失败，请重新打开')})}
      else{this.state.notice='已阻止新窗口跳转；请管理员配置允许站点。';this.emit()}
      return{action:'deny'}
    })
    contents.on('did-start-loading',()=>{this.state.error='';this.emit()})
    contents.on('did-stop-loading',()=>this.emit())
    contents.on('did-navigate-in-page',()=>this.emit())
    contents.on('did-fail-load',(_event,code,_description,_url,main)=>{if(main&&code!==-3){this.state.error='网页加载失败，请检查地址、网络或证书后重试。';this.emit()}})
    contents.on('render-process-gone',()=>this.closeRemote('应用页面已停止，请重新打开'))
    this.window.contentView.addChildView(view);this.resize();this.emit()
    this.stopMonitor=monitorEmbeddedApplication(()=>this.recheck(),()=>this.closeRemote('应用授权已失效、配置已更新或服务连接中断，请重新验证后打开'))
    void contents.loadURL(receipt.url).catch(()=>{if(this.view===view){this.state.error='网页加载失败，请检查地址、网络或证书后重试。';this.emit()}})
  }
  private async recheck(){
    const id=this.state.id,receipt=this.receipt;if(!id||!receipt)throw new Error('应用尚未打开')
    const next=await this.applications.authorize(id)
    if(next.revision!==receipt.revision||next.url!==receipt.url||JSON.stringify(next.allowedOrigins)!==JSON.stringify(receipt.allowedOrigins))throw new Error('应用配置或授权已更新')
  }
  private async control(command:'back'|'forward'|'reload'|'close'){
    if(command==='close'){if(await this.confirmClose())this.closeRemote();return}
    await this.recheck();const contents=this.view?.webContents;if(!contents)return
    this.state.error='';this.state.notice=''
    if(command==='reload')contents.reload()
    else{
      const history=contents.navigationHistory,offset=command==='back'?-1:1
      if(offset===-1&&!history.canGoBack()||offset===1&&!history.canGoForward())return
      const entry=history.getEntryAtIndex(history.getActiveIndex()+offset)
      if(entry&&this.allowed(entry.url))history.goToOffset(offset)
    }
    this.emit()
  }
  closeRemote(message=''){
    this.operation++;this.networkActive=false;this.stopMonitor?.();this.stopMonitor=undefined
    this.removeDownloadHandler?.();this.removeDownloadHandler=undefined
    for(const item of this.downloads)item.cancel();this.downloads.clear()
    const view=this.view;this.view=undefined;this.receipt=undefined
    if(view){
      view.setVisible(false)
      if(!this.window.isDestroyed())this.window.contentView.removeChildView(view)
      if(!view.webContents.isDestroyed()){const partition=view.webContents.session;view.webContents.stop();view.webContents.close({waitForBeforeUnload:false});void partition.closeAllConnections().catch(()=>{})}
    }
    Object.assign(this.state,{id:null,name:'',loading:false,canGoBack:false,canGoForward:false,error:message,notice:''});this.emit()
  }
  private readonly rendererReload=()=>{this.viewport=null;this.closeRemote()}
  readonly dispose=()=>{
    if(this.disposed)return;this.disposed=true;this.closeRemote()
    this.window.off('resize',this.resize);this.window.off('closed',this.dispose)
    if(!this.renderer.isDestroyed()){this.renderer.ipc.removeHandler(ENTERPRISE_APPLICATIONS_CHANNEL);this.renderer.off('did-start-loading',this.rendererReload);this.renderer.off('destroyed',this.dispose)}
  }
}
