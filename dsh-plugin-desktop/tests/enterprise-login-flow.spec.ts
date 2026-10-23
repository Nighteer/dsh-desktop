import {afterEach,describe,expect,it,vi} from 'vitest'
import {mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {EnterpriseLoginReply} from '../src/enterprise-login-contract.ts'
const harness=vi.hoisted(()=>({scenario:undefined as ((window:unknown)=>Promise<void>)|undefined,windows:[] as unknown[],order:[] as string[]}))
vi.mock('electron',async()=>{
  const {EventEmitter}=await import('node:events')
  class Window extends EventEmitter{
    handler:((event:unknown,value:unknown)=>Promise<EnterpriseLoginReply>)|undefined
    frame={url:''};closed=false
    webContents={mainFrame:this.frame,setWindowOpenHandler:vi.fn(),on:vi.fn(),stop:()=>harness.order.push('freeze'),ipc:{handle:(_channel:string,handler:typeof this.handler)=>{this.handler=handler}}}
    constructor(){super();harness.windows.push(this)}
    async loadFile(path:string){const {pathToFileURL}=await import('node:url');this.frame.url=pathToFileURL(path).href;await harness.scenario?.(this);this.close()}
    close(){if(!this.closed){this.closed=true;this.emit('closed')}}
    isDestroyed(){return this.closed}
    hide(){}setIgnoreMouseEvents(){}
    static getAllWindows(){return harness.windows}
  }
  return{app:{isPackaged:false,whenReady:async()=>{},on:vi.fn(),once:vi.fn(),setPath:vi.fn()},BrowserWindow:Window,dialog:{},Menu:{},MenuItem:class{},safeStorage:{isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=> 'gnome_libsecret',encryptString:(s:string)=>Buffer.from('encrypted:'+s),decryptString:(b:Buffer)=>b.toString().slice(10)},session:{},WebContentsView:class{}}
})
import {DesktopEnterpriseLogin} from '../src/enterprise-login.ts'
const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222'
const user={id:second,username:'employee',name:'员工',departmentId:first,departmentName:'总部',role:'employee' as const,enabled:true,mustChangePassword:false,createdAt:new Date().toISOString()}
const identity={instanceId:first,user},session={...identity,accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),expiresAt:new Date(Date.now()+900000).toISOString()}
type WindowFixture={frame:{url:string};handler:(event:unknown,value:unknown)=>Promise<EnterpriseLoginReply>}
function setup(){
  const root=mkdtempSync(join(tmpdir(),'lets-login-flow-')),transport=vi.fn<typeof fetch>().mockImplementation(async(url)=>{
    if(String(url).endsWith('/desktop-info'))return Response.json({product:'lets-enterprise',desktopApiVersion:1,instanceId:first})
    if(String(url).endsWith('/auth/login')||String(url).endsWith('/auth/refresh'))return Response.json(session)
    if(String(url).endsWith('/auth/logout')){harness.order.push('logout');return Response.json({ok:true})}
    return Response.json(identity)
  })
  vi.stubGlobal('fetch',transport)
  return{root,transport}
}
afterEach(()=>{harness.scenario=undefined;harness.windows=[];harness.order=[];vi.unstubAllGlobals()})
describe('pre-Host enterprise connection flow',()=>{
  it('restores an instance-bound remembered login only after a fresh successful handshake',async()=>{
    const s=setup(),prepared=new DesktopEnterpriseLogin(s.root)
    await prepared.connection.connect('https://first.example')
    const path=prepared.credentialPath
    writeFileSync(path,JSON.stringify({instanceId:first,refresh:Buffer.from('encrypted:'+session.refreshToken).toString('base64'),message:''}))
    s.transport.mockClear()
    const restored=new DesktopEnterpriseLogin(s.root)
    expect(await restored.authenticate()).toBe(true);expect(harness.windows).toHaveLength(0)
    expect(s.transport.mock.calls.map(([url])=>new URL(String(url)).pathname)).toEqual(['/api/v1/desktop-info','/api/v1/auth/refresh','/api/v1/auth/me'])
    expect(restored.paths.home).toContain('enterprise-accounts');expect(readFileSync(path,'utf8')).not.toContain(session.refreshToken)
  })
  it('blocks credentials until the handshake, validates IPC senders and only finishes after authenticated identity verification',async()=>{
    const s=setup(),login=new DesktopEnterpriseLogin(s.root)
    harness.scenario=async value=>{
      const w=value as WindowFixture,event={senderFrame:w.frame},invoke=(payload:unknown)=>w.handler(event,payload)
      expect((await invoke({action:'state'})).state?.phase).toBe('connection')
      expect((await invoke({action:'login',username:'employee',password:'private-password',remember:true})).ok).toBe(false);expect(s.transport).not.toHaveBeenCalled()
      expect((await w.handler({senderFrame:{url:w.frame.url}},{action:'connect',origin:'https://first.example'})).ok).toBe(false)
      expect((await invoke({action:'connect',origin:'https://first.example'})).state?.phase).toBe('login')
      expect(s.transport).toHaveBeenCalledOnce()
      expect((await invoke({action:'login',username:'employee',password:'private-password',remember:true})).ok).toBe(true)
    }
    expect(await login.authenticate()).toBe(true)
    const saved=readFileSync(login.credentialPath,'utf8')
    expect(JSON.parse(saved).instanceId).toBe(first);expect(saved).not.toContain(session.refreshToken);expect(saved).not.toContain('private-password')
    expect(readdirSync(s.root)).toContain('enterprise-service.json')
  })
  it('never sends saved credentials to a changed enterprise instance during automatic recovery',async()=>{
    const s=setup(),login=new DesktopEnterpriseLogin(s.root)
    await login.connection.connect('https://first.example')
    login.client.session=session
    const credentialPath=login.credentialPath,saved=JSON.stringify({instanceId:first,refresh:Buffer.from('encrypted:'+session.refreshToken).toString('base64'),message:''})
    writeFileSync(credentialPath,saved)
    const changed=new DesktopEnterpriseLogin(s.root)
    s.transport.mockClear();s.transport.mockImplementation(async()=>Response.json({product:'lets-enterprise',desktopApiVersion:1,instanceId:second}))
    harness.scenario=async value=>{
      const w=value as WindowFixture,result=await w.handler({senderFrame:w.frame},{action:'state'})
      expect(result.state?.phase).toBe('connection');expect(result.state?.instanceChange).toEqual({previous:first,next:second})
    }
    expect(await changed.authenticate()).toBe(false)
    expect(s.transport).toHaveBeenCalledOnce();expect(String(s.transport.mock.calls[0]![0])).toContain('/desktop-info')
    expect(s.transport.mock.calls[0]![1]?.headers).toEqual({Accept:'application/json'})
    expect(readFileSync(credentialPath,'utf8')).toBe(saved)
    expect(()=>changed.credentialPath).toThrow('尚未确认')
  })
  it('freezes the workspace, revokes local/remote access and awaits Host teardown before service selection on restart',async()=>{
    const s=setup(),login=new DesktopEnterpriseLogin(s.root)
    await login.connection.connect('https://first.example');login.client.session=session
    harness.windows=[{hide(){},setIgnoreMouseEvents(){},webContents:{stop:()=>harness.order.push('freeze')}}]
    login.bindLock(async()=>{expect(login.client.session).toBeUndefined();harness.order.push('teardown')})
    const path=login.credentialPath;await login.lock(true,true)
    expect(harness.order).toEqual(['freeze','logout','teardown']);expect(JSON.parse(readFileSync(path,'utf8')).refresh).toBeNull()
    expect(JSON.parse(readFileSync(login.connection.settingsPath,'utf8')).selectOnNextLaunch).toBe(true)
    harness.windows=[];harness.scenario=async()=>{}
    s.transport.mockClear();expect(await new DesktopEnterpriseLogin(s.root).authenticate()).toBe(false)
    expect(s.transport).not.toHaveBeenCalled()
  })
  it('keeps one in-flight connection and rejects attempts to send a password while it is pending',async()=>{
    const s=setup(),login=new DesktopEnterpriseLogin(s.root)
    let resolve!:(value:Response)=>void
    s.transport.mockImplementationOnce(()=>new Promise(done=>{resolve=done}))
    harness.scenario=async value=>{
      const w=value as WindowFixture,invoke=(payload:unknown)=>w.handler({senderFrame:w.frame},payload)
      const connecting=invoke({action:'connect',origin:'https://first.example'})
      expect((await invoke({action:'login',username:'employee',password:'secret',remember:false})).error).toContain('正在处理')
      resolve(Response.json({product:'lets-enterprise',desktopApiVersion:1,instanceId:first}));expect((await connecting).ok).toBe(true)
    }
    expect(await login.authenticate()).toBe(false);expect(s.transport).toHaveBeenCalledOnce()
  })
})
