import {describe,it,expect,vi} from 'vitest'
import {mkdtempSync,readFileSync,writeFileSync,readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {EnterpriseServiceConnection,inspectEnterpriseService} from '../src/enterprise-service.ts'
import {EnterpriseClient,enterpriseAccountPaths} from '../src/enterprise-client.ts'

const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222'
const info=(id=first)=>Response.json({product:'lets-enterprise',desktopApiVersion:1,instanceId:id})
const fixture=()=>mkdtempSync(join(tmpdir(),'lets-enterprise-service-')) // Retained; no filesystem cleanup.
describe('generic enterprise client connection',()=>{
  it('allows selecting HTTPS after an HTTP policy is revoked without discarding saved identities',async()=>{
    const previous=process.env.DSH_ENTERPRISE_HTTP_ORIGINS
    const root=fixture(),transport=vi.fn<typeof fetch>().mockImplementation(async()=>info())
    try{
      process.env.DSH_ENTERPRISE_HTTP_ORIGINS='http://10.10.0.5'
      const firstConnection=new EnterpriseServiceConnection(root,undefined,transport)
      expect(await firstConnection.connect('http://10.10.0.5')).toBe(true)
      delete process.env.DSH_ENTERPRISE_HTTP_ORIGINS
      transport.mockClear()
      const reopened=new EnterpriseServiceConnection(root,undefined,transport)
      await expect(reopened.resume()).rejects.toThrow()
      expect(transport).not.toHaveBeenCalled()
      expect(await reopened.connect('https://enterprise.example')).toBe(true)
      const saved=JSON.parse(readFileSync(reopened.settingsPath,'utf8'))
      expect(saved.instances['http://10.10.0.5']).toBe(first)
      expect(saved.selectedOrigin).toBe('https://enterprise.example')
    }finally{if(previous===undefined)delete process.env.DSH_ENTERPRISE_HTTP_ORIGINS;else process.env.DSH_ENTERPRISE_HTTP_ORIGINS=previous}
  })
  it('starts without an endpoint and treats the package address only as an editable suggestion',async()=>{
    const transport=vi.fn<typeof fetch>(),root=fixture(),empty=new EnterpriseServiceConnection(root,undefined,transport)
    expect(empty.origin).toBe('');expect(await empty.resume()).toBe(false);expect(empty.client).toBeUndefined()
    const preset=new EnterpriseServiceConnection(root,'https://first.example',transport)
    expect(preset.origin).toBe('https://first.example');expect(await preset.resume()).toBe(false);expect(transport).not.toHaveBeenCalled()
  })
  it('checks compatibility without credentials, remembers the selection and prefers it over a package preset',async()=>{
    const root=fixture(),transport=vi.fn<typeof fetch>().mockImplementation(async()=>info()),connection=new EnterpriseServiceConnection(root,'https://first.example',transport)
    expect(await connection.connect(' https://second.example/ ')).toBe(true)
    expect(transport.mock.calls[0]![0]).toBe('https://second.example/api/v1/desktop-info')
    const init=transport.mock.calls[0]![1]!
    expect(init.redirect).toBe('error');expect(init.body).toBeUndefined();expect(init.headers).toEqual({Accept:'application/json'})
    expect(readFileSync(connection.settingsPath,'utf8')).not.toMatch(/password|refresh|accessToken/u)
    const reopened=new EnterpriseServiceConnection(root,'https://first.example',transport)
    expect(reopened.origin).toBe('https://second.example');expect(await reopened.resume()).toBe(true)
    expect(reopened.client?.session).toBeUndefined()
  })
  it('requires an explicit second check when the same address changes enterprise identity',async()=>{
    const root=fixture(),transport=vi.fn<typeof fetch>().mockResolvedValueOnce(info()).mockResolvedValueOnce(info(second)).mockResolvedValueOnce(info(second))
    const connection=new EnterpriseServiceConnection(root,undefined,transport);await connection.connect('https://first.example')
    const before=readFileSync(connection.settingsPath,'utf8')
    const reopened=new EnterpriseServiceConnection(root,undefined,transport)
    expect(await reopened.resume()).toBe(false);expect(reopened.client).toBeUndefined();expect(reopened.pending?.previousInstanceId).toBe(first)
    expect(readFileSync(connection.settingsPath,'utf8')).toBe(before)
    await reopened.confirmChange();expect(reopened.instanceId).toBe(second);expect(reopened.client?.session).toBeUndefined()
    for(const [,init] of transport.mock.calls)expect(init?.headers).toEqual({Accept:'application/json'})
    expect(enterpriseAccountPaths(root,first,first).home).not.toBe(enterpriseAccountPaths(root,second,first).home)
  })
  it('does not accept an identity changing again during confirmation or a stale cancelled confirmation',async()=>{
    const root=fixture(),transport=vi.fn<typeof fetch>().mockResolvedValueOnce(info()).mockResolvedValueOnce(info(second)).mockResolvedValueOnce(info())
    const connection=new EnterpriseServiceConnection(root,undefined,transport);await connection.connect('https://first.example');await connection.connect('https://first.example')
    await expect(connection.confirmChange()).rejects.toThrow('再次变化');expect(connection.client).toBeUndefined()
    connection.selectAgain();await expect(connection.confirmChange()).rejects.toThrow('没有待确认')
  })
  it('can return to configuration after a safe relaunch without removing old files or identities',async()=>{
    const root=fixture(),transport=vi.fn<typeof fetch>().mockImplementation(async()=>info()),connection=new EnterpriseServiceConnection(root,undefined,transport)
    await connection.connect('https://first.example');writeFileSync(join(root,'old-user-data.txt'),'untouched')
    connection.requestSelectionOnRestart();transport.mockClear()
    const reopened=new EnterpriseServiceConnection(root,undefined,transport)
    expect(await reopened.resume()).toBe(false);expect(transport).not.toHaveBeenCalled()
    await reopened.connect('https://second.example');expect(Object.keys(JSON.parse(readFileSync(reopened.settingsPath,'utf8')).instances)).toHaveLength(2)
    expect(readFileSync(join(root,'old-user-data.txt'),'utf8')).toBe('untouched');expect(readdirSync(root)).toContain('old-user-data.txt')
  })
  it('rejects insecure/non-root/credential URLs before contacting them',async()=>{
    const transport=vi.fn<typeof fetch>()
    for(const url of ['http://192.168.1.1:4310','https://user:password@example.com','https://example.com/api/v1','https://example.com/?key=secret','file:///a','https://example.com/#token','https://example.com/\\evil'])await expect(inspectEnterpriseService(url,transport)).rejects.toThrow('HTTPS')
    expect(transport).not.toHaveBeenCalled()
    transport.mockResolvedValue(info());await inspectEnterpriseService('http://127.0.0.1:4310',transport)
  })
  it('reports network, old server, wrong product/version/identity and oversized responses safely',async()=>{
    const transport=vi.fn<typeof fetch>()
    transport.mockRejectedValueOnce(new Error('private internals'));await expect(inspectEnterpriseService('https://first.example',transport)).rejects.toThrow('网络及 HTTPS 证书')
    transport.mockResolvedValueOnce(new Response('',{status:404}));await expect(inspectEnterpriseService('https://first.example',transport)).rejects.toThrow('升级')
    for(const response of [new Response('<html>proxy</html>'),Response.json({product:'other'}),Response.json({product:'lets-enterprise',desktopApiVersion:2,instanceId:first}),Response.json({product:'lets-enterprise',desktopApiVersion:1,instanceId:'../outside'}),Response.json(null),Response.json({text:'x'.repeat(9000)})]){
      transport.mockResolvedValueOnce(response);await expect(inspectEnterpriseService('https://first.example',transport)).rejects.toThrow()
    }
  })
  it('preserves damaged settings rather than overwriting their identity pins',async()=>{
    const root=fixture(),file=join(root,'enterprise-service.json'),raw='broken old configuration';writeFileSync(file,raw)
    const connection=new EnterpriseServiceConnection(root,undefined,vi.fn<typeof fetch>().mockResolvedValue(info()))
    expect(connection.message).toContain('保留原文件');await expect(connection.connect('https://first.example')).rejects.toThrow('不能覆盖')
    expect(readFileSync(file,'utf8')).toBe(raw);expect(connection.client).toBeUndefined()
  })
  it('rejects authenticated responses from a different instance before any workspace activation',async()=>{
    const session={instanceId:second,user:{id:first},accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),expiresAt:new Date(Date.now()+900000).toISOString()}
    const transport=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json(session)),client=new EnterpriseClient('https://first.example',transport,first)
    await expect(client.login('employee','not-a-real-password',true)).rejects.toThrow('身份已变化');expect(client.session).toBeUndefined()
    await expect(client.restore('not-a-real-refresh')).rejects.toThrow('身份已变化');expect(client.session).toBeUndefined()
  })
})
