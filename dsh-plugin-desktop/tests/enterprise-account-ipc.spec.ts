import {describe,it,expect,vi,afterEach} from 'vitest'
import {Menu} from 'electron'
import {DesktopEnterpriseApplications} from '../src/enterprise-applications.ts'
import {EnterpriseClient} from '../src/enterprise-client.ts'
import {ENTERPRISE_APPLICATIONS_CHANNEL} from '../src/enterprise-applications-contract.ts'

vi.mock('electron',()=>({
  app:{getLocale:()=> 'zh-CN'},dialog:{showErrorBox:vi.fn()},session:{},WebContentsView:vi.fn(),
  Menu:{buildFromTemplate:vi.fn(()=>({popup:(options:{callback:()=>void})=>options.callback()}))},
}))
afterEach(()=>vi.clearAllMocks())
function fixture(){
  const handlers=new Map<string,(event:unknown,value:unknown)=>Promise<unknown>>()
  const frame={url:'http://127.0.0.1:45678/'},renderer={mainFrame:frame,ipc:{handle:(key:string,handler:never)=>handlers.set(key,handler),removeHandler:vi.fn()},on:vi.fn(),off:vi.fn(),isDestroyed:()=>false,send:vi.fn(),getZoomFactor:()=>1}
  const window={on:vi.fn(),off:vi.fn(),isDestroyed:()=>false}
  const client=new EnterpriseClient('http://127.0.0.1:4310')
  client.session={instanceId:'11111111-1111-4111-8111-111111111111',accessToken:'private-access',refreshToken:'private-refresh',expiresAt:new Date(Date.now()+900000).toISOString(),user:{id:'22222222-2222-4222-8222-222222222222',name:'张三',username:'employee',departmentName:'总部',departmentId:'33333333-3333-4333-8333-333333333333',role:'employee',enabled:true,mustChangePassword:false,createdAt:new Date().toISOString()}}
  let active=true;const logout=vi.fn(async()=>{})
  const service=new DesktopEnterpriseApplications(client,()=>active,logout)
  const dispose=service.attach(window as never,renderer as never,()=>({x:0,y:0,width:1280,height:900}),'http://127.0.0.1:45678')
  const event={sender:renderer,senderFrame:frame},invoke=handlers.get(ENTERPRISE_APPLICATIONS_CHANNEL)!
  return{invoke,event,dispose,logout,frame,renderer,lock:()=>{active=false}}
}
describe('enterprise account IPC sender boundary',()=>{
  it('returns only public identity and rejects non-main-frame, foreign-origin and expired callers',async()=>{
    const s=fixture()
    try{
      expect(await s.invoke(s.event,{action:'account'})).toEqual({ok:true,account:{name:'张三',username:'employee',departmentName:'总部'}})
      for(const event of [{sender:{},senderFrame:s.frame},{sender:s.renderer,senderFrame:{url:s.frame.url}},{sender:s.renderer,senderFrame:null}])expect(await s.invoke(event,{action:'account'})).toMatchObject({ok:false})
      s.frame.url='https://remote.invalid/';expect(await s.invoke(s.event,{action:'account-menu',x:20,y:700})).toMatchObject({ok:false})
      s.frame.url='http://127.0.0.1:45678/';s.lock();expect(await s.invoke(s.event,{action:'account'})).toMatchObject({ok:false})
      expect(Menu.buildFromTemplate).not.toHaveBeenCalled()
    }finally{s.dispose()}
  })
  it('uses the same safe exit callback and rejects invalid menu coordinates',async()=>{
    const s=fixture()
    try{
      expect(await s.invoke(s.event,{action:'account-menu',x:-1,y:0})).toMatchObject({ok:false})
      expect(await s.invoke(s.event,{action:'account-menu',x:180,y:800})).toEqual({ok:true})
      const menu=vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)![0]
      const item=menu.find(item=>item.label==='切换账号')!
      item.click!({} as never,{} as never,{} as never)
      expect(s.logout).not.toHaveBeenCalled()
      await new Promise(resolve=>setImmediate(resolve));expect(s.logout).toHaveBeenCalledOnce()
    }finally{s.dispose()}
  })
})
