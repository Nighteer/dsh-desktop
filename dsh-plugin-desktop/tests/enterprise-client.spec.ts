import { describe, it, expect, vi, afterEach } from 'vitest'
import { join } from 'node:path'
import { EnterpriseClient, EnterpriseRequestError, enterpriseAccountPaths, enterpriseServiceUrl, monitorEnterpriseSession } from '../src/enterprise-client.ts'

const instance='11111111-1111-4111-8111-111111111111', user='22222222-2222-4222-8222-222222222222'
const identity={instanceId:instance,user:{id:user,username:'employee',name:'员工',departmentId:instance,departmentName:'总部',role:'employee' as const,enabled:true,mustChangePassword:false,createdAt:new Date().toISOString()}}
const session={...identity,accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),expiresAt:new Date(Date.now()+900000).toISOString()}
afterEach(()=>vi.useRealTimers())
describe('enterprise startup boundary',()=>{
  it('keeps Chromium storage below Windows MAX_PATH in an isolated acceptance root',()=>{
    const paths=enterpriseAccountPaths('D:/my/AI/dev-lets/.runtime-appdata/enterprise-lifecycle-1792199975828',instance,user)
    const database=join(paths.userData,'Partitions',paths.partition.slice('persist:'.length),'Local Storage','leveldb','000003.log')
    expect(database.length).toBeLessThan(260)
    expect(paths.partition).toMatch(/^persist:dsh-e-[a-f0-9]{32}$/u)
  })
  it('accepts HTTPS and loopback only, refusing credential-bearing endpoints',()=>{
    expect(enterpriseServiceUrl('http://127.0.0.1:4310')).toBe('http://127.0.0.1:4310')
    expect(enterpriseServiceUrl('https://enterprise.example')).toBe('https://enterprise.example')
    for(const url of ['http://192.168.1.1','https://user:pass@example.com','file:///tmp','https://example.com/?token=secret'])expect(()=>enterpriseServiceUrl(url)).toThrow()
  })
  it('uses immutable identity, release root and distinct browser partitions for isolation',()=>{
    const a=enterpriseAccountPaths('C:/dev/beta',instance,user),b=enterpriseAccountPaths('C:/dev/beta',instance,instance),stable=enterpriseAccountPaths('C:/dev/stable',instance,user)
    expect(a.home).not.toBe(b.home);expect(a.partition).not.toBe(b.partition);expect(a.home).not.toBe(stable.home)
    expect(()=>enterpriseAccountPaths('C:/dev','../outside',user)).toThrow()
  })
  it('sends credentials only in request bodies and Authorization, never URLs',async()=>{
    const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(session)))
    const client=new EnterpriseClient('http://127.0.0.1:4310',transport)
    await client.login('employee','private-password',true)
    const [url,options]=transport.mock.calls[0]!
    expect(String(url)).not.toContain('private-password');expect(options?.body).toContain('private-password');expect(options?.redirect).toBe('error')
  })
  it('does not accept a different identity during renewal',async()=>{
    const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({...identity,instanceId:user})))
    const client=new EnterpriseClient('http://127.0.0.1:4310',transport);client.session=session
    await expect(client.verify()).rejects.toThrow('身份或密码状态')
  })
  it('locks within 55 seconds even if a verification never resolves',async()=>{
    vi.useFakeTimers()
    const client=new EnterpriseClient('http://127.0.0.1:4310');client.session=session
    vi.spyOn(client,'verify').mockImplementation(()=>new Promise(()=>{}))
    const lock=vi.fn(),save=vi.fn();const stop=monitorEnterpriseSession(client,save,lock)
    await vi.advanceTimersByTimeAsync(55000);expect(lock).toHaveBeenCalledOnce();expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60000);expect(lock).toHaveBeenCalledOnce();stop()
  })
  it('cannot change the account identity through a refreshed session',async()=>{
    const switched={...session,user:{...session.user,id:instance}}
    const transport=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(switched)))
      .mockResolvedValueOnce(new Response(JSON.stringify({...identity,user:switched.user})))
    const client=new EnterpriseClient('http://127.0.0.1:4310',transport)
    client.session={...session,expiresAt:new Date(Date.now()+1000).toISOString()}
    await expect(client.verify()).rejects.toThrow('身份或密码状态')
    expect(client.session).toBeUndefined()
  })
  it('locks on revoked credentials at the next heartbeat',async()=>{
    vi.useFakeTimers();const client=new EnterpriseClient('http://127.0.0.1:4310')
    vi.spyOn(client,'verify').mockRejectedValue(new EnterpriseRequestError(401,'已停用'))
    const lock=vi.fn();const stop=monitorEnterpriseSession(client,vi.fn(),lock)
    await vi.advanceTimersByTimeAsync(30000);expect(lock).toHaveBeenCalledOnce();stop()
  })
  it('successful heartbeats extend the deadline; disposal stops all work',async()=>{
    vi.useFakeTimers();const client=new EnterpriseClient('http://127.0.0.1:4310')
    const verify=vi.spyOn(client,'verify').mockResolvedValue(identity),lock=vi.fn(),save=vi.fn()
    const stop=monitorEnterpriseSession(client,save,lock)
    await vi.advanceTimersByTimeAsync(120000);expect(lock).not.toHaveBeenCalled();expect(save).toHaveBeenCalledTimes(4)
    stop();await vi.advanceTimersByTimeAsync(60000);expect(verify).toHaveBeenCalledTimes(4)
  })
})
