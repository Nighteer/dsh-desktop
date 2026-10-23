import {describe,it,expect,vi,afterEach} from 'vitest'
import {EnterpriseClient} from '../src/enterprise-client.ts'
import {EnterpriseApplicationsClient,monitorEmbeddedApplication} from '../src/enterprise-applications-client.ts'
import {applicationBounds,applicationPartition,allowedApplicationNavigation,applicationNetworkOrigin} from '../src/enterprise-application-policy.ts'
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222'
const user={id,username:'employee',name:'员工',departmentId:id,departmentName:'总部',role:'employee' as const,enabled:true,mustChangePassword:false,createdAt:new Date().toISOString()}
const identity={instanceId:id,user}
const session={...identity,accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),expiresAt:new Date(Date.now()+900000).toISOString()}
const application={id,name:'合同审查',description:'授权应用',icon:'contract',sortOrder:0}
const launch={url:'https://contracts.invalid/#/review',openMode:'embedded',allowedOrigins:['https://contracts.invalid'],revision:1}
function setup(){
  const transport=vi.fn<typeof fetch>(),client=new EnterpriseClient('http://127.0.0.1:4310',transport)
  client.session={...session};const verify=vi.spyOn(client,'verify').mockResolvedValue(identity)
  let active=true
  return{client,transport,verify,applications:new EnterpriseApplicationsClient(client,()=>active),lock:()=>{active=false}}
}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status})
afterEach(()=>vi.useRealTimers())
describe('enterprise embedded application boundary',()=>{
  it('verifies identity and returns metadata only, with no URLs or credentials',async()=>{
    const s=setup();s.transport.mockResolvedValue(json([{...application,url:'https://private.invalid'}]))
    expect(await s.applications.list()).toEqual([application]);expect(s.verify).toHaveBeenCalledOnce()
    expect(s.transport.mock.calls[0]![0]).toBe('http://127.0.0.1:4310/api/v1/available-applications')
  })
  it('authorizes only a fresh server-owned URL and sends an application ID rather than a URL',async()=>{
    const s=setup();s.transport.mockResolvedValue(json(launch))
    expect(await s.applications.authorize(id,true)).toEqual(launch)
    expect(s.transport.mock.calls[0]![0]).toContain('/open');expect(s.transport.mock.calls[0]![1]?.body).toBe('{}')
    expect(s.verify).toHaveBeenCalledOnce()
  })
  it('checks active pages through an audit-free access route',async()=>{
    const s=setup();s.transport.mockResolvedValue(json(launch));await s.applications.authorize(id)
    expect(s.transport.mock.calls[0]![0]).toContain('/access');expect(s.transport.mock.calls[0]![1]?.method).toBe('GET')
  })
  it('denies executable schemes, credentials and malformed IDs',async()=>{
    const s=setup()
    for(const url of ['javascript:alert(1)','file:///C:/test','https://user:pass@evil.invalid']){
      s.transport.mockResolvedValue(json({...launch,url}));await expect(s.applications.authorize(id)).rejects.toThrow()
    }
    await expect(s.applications.authorize('https://evil.invalid')).rejects.toThrow('标识')
  })
  it('blocks revoked, disconnected and failed identity checks',async()=>{
    const s=setup();s.transport.mockResolvedValue(json({error:{message:'未授权'}},403))
    await expect(s.applications.authorize(id)).rejects.toThrow('未授权')
    s.transport.mockRejectedValue(new Error('offline'));await expect(s.applications.authorize(id)).rejects.toThrow('无法连接')
    s.verify.mockRejectedValue(new Error('登录失效'));await expect(s.applications.authorize(id)).rejects.toThrow('登录失效')
  })
  it('cancels an in-flight launch if logout locks the UI',async()=>{
    const s=setup();s.transport.mockImplementation(async()=>{s.lock();return json(launch)})
    await expect(s.applications.authorize(id)).rejects.toThrow('已取消')
  })
  it('rejects old-user responses after an account switch',async()=>{
    const s=setup();s.transport.mockImplementation(async()=>{s.client.session={...session,user:{...user,id:other}};return json([application])})
    await expect(s.applications.list()).rejects.toThrow('账号已切换')
  })
  it('rejects invalid lists, legacy browser mode and absent/inconsistent policy metadata',async()=>{
    const s=setup();s.transport.mockResolvedValue(json([{...application,icon:'executable'}]));await expect(s.applications.list()).rejects.toThrow('格式无效')
    for(const patch of [{openMode:'browser'},{revision:0},{allowedOrigins:[]},{allowedOrigins:['https://contracts.invalid/path']}]) {
      s.transport.mockResolvedValue(json({...launch,...patch}));await expect(s.applications.authorize(id)).rejects.toThrow()
    }
  })
  it('isolates storage by immutable enterprise, employee and application IDs with short Windows paths',()=>{
    const key=applicationPartition(id,id,id)
    expect(key).toMatch(/^persist:dsh-a-[a-f0-9]{32}$/)
    expect(key).not.toBe(applicationPartition(other,id,id));expect(key).not.toBe(applicationPartition(id,other,id));expect(key).not.toBe(applicationPartition(id,id,other))
    expect(()=>applicationPartition('../outside',id,id)).toThrow()
  })
  it('allows exact configured origins only, excluding Host/API and executable protocols',()=>{
    const origins=['https://contracts.invalid','https://login.invalid']
    expect(allowedApplicationNavigation('https://login.invalid/authorize?state=abc',origins,[])).toBe(true)
    for(const url of ['https://contracts.invalid.evil.com','https://contracts.invalid:8443','http://contracts.invalid','javascript:alert(1)','file:///C:/test'])expect(allowedApplicationNavigation(url,origins,[])).toBe(false)
    expect(allowedApplicationNavigation('https://contracts.invalid',origins,['https://contracts.invalid'])).toBe(false)
    expect(applicationNetworkOrigin('ws://127.0.0.1:4310/socket')).toBe('http://127.0.0.1:4310')
    expect(applicationNetworkOrigin('wss://host.invalid/socket')).toBe('https://host.invalid')
  })
  it('converts zoomed CSS geometry to the content view and never covers outside its bounds',()=>{
    expect(applicationBounds({x:200,y:80,width:600,height:400},{x:0,y:36,width:1200,height:900},1.25)).toEqual({x:250,y:136,width:750,height:500})
    expect(applicationBounds({x:-10,y:800,width:2000,height:2000},{x:0,y:36,width:1000,height:900},1)).toEqual({x:0,y:836,width:1000,height:100})
    expect(()=>applicationBounds({x:NaN,y:0,width:1,height:1},{x:0,y:0,width:1,height:1},1)).toThrow()
  })
  it('closes hidden pages at the next failed authorization check',async()=>{
    vi.useFakeTimers();const revoke=vi.fn(),check=vi.fn<()=>Promise<void>>().mockRejectedValue(new Error('revoked'))
    const stop=monitorEmbeddedApplication(check,revoke);await vi.advanceTimersByTimeAsync(10000);expect(revoke).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(60000);expect(revoke).toHaveBeenCalledOnce();stop()
  })
  it('has a 55-second hard deadline even when the access check hangs',async()=>{
    vi.useFakeTimers();const revoke=vi.fn(),stop=monitorEmbeddedApplication(()=>new Promise(()=>{}),revoke)
    await vi.advanceTimersByTimeAsync(55000);expect(revoke).toHaveBeenCalledOnce();stop()
  })
  it('successful checks extend the deadline and disposing stops all checks',async()=>{
    vi.useFakeTimers();const revoke=vi.fn(),check=vi.fn<()=>Promise<void>>().mockResolvedValue()
    const stop=monitorEmbeddedApplication(check,revoke);await vi.advanceTimersByTimeAsync(120000);expect(revoke).not.toHaveBeenCalled();expect(check).toHaveBeenCalledTimes(12)
    stop();await vi.advanceTimersByTimeAsync(60000);expect(check).toHaveBeenCalledTimes(12)
  })
})
