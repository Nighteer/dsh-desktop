import {describe,it,expect,vi} from 'vitest'
import {EnterpriseDesktopUpdates} from '../src/enterprise-desktop-updates.ts'
import {DESKTOP_VERSION_ENDPOINT,DESKTOP_RELEASE_CHANNEL_HEADER,checkForDesktopUpdate} from '../src/update-checker.ts'
import {DESKTOP_DOWNLOAD_URLS,DESKTOP_TARGET_VERSION_HEADER} from '../src/update-download.ts'
import type {EnterpriseClient} from '../src/enterprise-client.ts'
const instanceId='00000000-0000-4000-8000-000000000002'
const release={id:'00000000-0000-4000-8000-000000000003',version:'1.0.1',channel:'stable',platform:'win32',arch:'x64',notes:'修复问题',state:'published',size:512,sha256:'a'.repeat(64)}
function setup(payload:unknown={instanceId,release}){
  const client={origin:'https://enterprise.internal',session:{instanceId,accessToken:'private-token',user:{id:'user'}},verify:vi.fn(async()=>({}))} as unknown as Pick<EnterpriseClient,'origin'|'session'|'verify'>
  const transport=vi.fn(async(_url:string,_init:RequestInit)=>Response.json(payload))
  return {client,transport,updates:new EnterpriseDesktopUpdates(client,'win32','x64','1.0.0',transport)}
}
describe('enterprise desktop updates',()=>{
  it('checks only the authenticated enterprise, then pins the exact release for download',async()=>{
    const {updates,transport}=setup()
    expect(await checkForDesktopUpdate({currentVersion:'1.0.0',channel:'stable',request:updates.request})).toMatchObject({status:'update-available',latestVersion:'1.0.1'})
    expect(transport).toHaveBeenLastCalledWith('https://enterprise.internal/api/v1/desktop-updates/check?channel=stable&platform=win32&arch=x64',expect.objectContaining({redirect:'error',headers:{Authorization:'Bearer private-token'}}))
    expect(updates.release('stable','1.0.1')?.sha256).toBe(release.sha256)
    await updates.request(DESKTOP_DOWNLOAD_URLS.win32,{headers:{[DESKTOP_RELEASE_CHANNEL_HEADER]:'stable',[DESKTOP_TARGET_VERSION_HEADER]:'1.0.1'}})
    expect(transport.mock.calls.at(-1)?.[0]).toContain(`/desktop-updates/${release.id}/download`)
  })
  it('reports no enterprise release without inventing an update or requesting the public internet',async()=>{
    const {updates}=setup({instanceId,release:null})
    expect(await checkForDesktopUpdate({currentVersion:'1.0.0',channel:'stable',request:updates.request})).toMatchObject({status:'up-to-date'})
    expect(updates.release('stable')).toBeNull()
    await expect(updates.request('https://www.dshdesktop.cn/api/desktop/version',{headers:{[DESKTOP_RELEASE_CHANNEL_HEADER]:'stable'}})).rejects.toThrow('非企业')
  })
  it.each([{...release,arch:'arm64'},{...release,sha256:'bad'},{...release,state:'draft'},{...release,version:'2.0.0-beta.1'}])('rejects invalid or mismatched release metadata',async invalid=>{
    const {updates}=setup({instanceId,release:invalid})
    expect(await checkForDesktopUpdate({currentVersion:'1.0.0',channel:'stable',request:updates.request})).toBeNull()
    expect(updates.release('stable')).toBeUndefined()
  })
  it('rejects enterprise identity changes and expired/changed accounts before transport',async()=>{
    const {client,updates,transport}=setup({instanceId:'other',release})
    await expect(updates.request(DESKTOP_VERSION_ENDPOINT,{headers:{[DESKTOP_RELEASE_CHANNEL_HEADER]:'stable'}})).rejects.toThrow('身份')
    transport.mockClear();client.session=undefined
    await expect(updates.request(DESKTOP_VERSION_ENDPOINT,{headers:{[DESKTOP_RELEASE_CHANNEL_HEADER]:'stable'}})).rejects.toThrow('账号')
    expect(transport).not.toHaveBeenCalled()
  })
})
