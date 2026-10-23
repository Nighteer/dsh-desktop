/** Main-process-only update transport, bound to one authenticated enterprise. */
import {MAX_DESKTOP_INSTALLER_BYTES,desktopReleaseVersion,type DesktopRelease} from 'dsh-enterprise-contracts'
import type {EnterpriseClient} from './enterprise-client.ts'
import {DESKTOP_VERSION_ENDPOINT,DESKTOP_RELEASE_CHANNEL_HEADER,type DesktopReleaseChannel,type UpdateRequest} from './update-checker.ts'
import {DESKTOP_DOWNLOAD_URLS,DESKTOP_TARGET_VERSION_HEADER} from './update-download.ts'

export class EnterpriseDesktopUpdates {
  private readonly releases=new Map<DesktopReleaseChannel,DesktopRelease|null>()
  private readonly instanceId:string
  private readonly userId:string
  constructor(private readonly client:Pick<EnterpriseClient,'origin'|'session'|'verify'>,
    private readonly platform:string,private readonly arch:string,private readonly currentVersion:string,
    private readonly transport:UpdateRequest){
    if(!client.session)throw new Error('请先登录企业服务')
    this.instanceId=client.session.instanceId;this.userId=client.session.user.id
  }
  get origin(){return this.client.origin}
  release(channel:DesktopReleaseChannel,version?:string):DesktopRelease|null|undefined {
    const release=this.releases.get(channel)
    return version===undefined||release?.version===version?release:undefined
  }
  readonly request:UpdateRequest=async(path,init)=>{
    const headers=new Headers(init.headers),channel=headers.get(DESKTOP_RELEASE_CHANNEL_HEADER)
    if(channel!=='stable'&&channel!=='beta')throw new Error('更新通道无效')
    if(path!==DESKTOP_VERSION_ENDPOINT&&path!==DESKTOP_DOWNLOAD_URLS[this.platform as 'win32'|'darwin'])throw new Error('禁止访问非企业更新地址')
    init.signal?.throwIfAborted()
    await this.client.verify()
    const session=this.client.session
    if(!session||session.instanceId!==this.instanceId||session.user.id!==this.userId)throw new Error('企业账号已变化，请重新检查更新')
    const checking=path===DESKTOP_VERSION_ENDPOINT
    if(checking)this.releases.delete(channel)
    const release=this.release(channel,headers.get(DESKTOP_TARGET_VERSION_HEADER)??undefined)
    if(!checking&&!release)throw new Error('请重新检查已发布的企业版本')
    const endpoint=checking?`/api/v1/desktop-updates/check?${new URLSearchParams({channel,platform:this.platform,arch:this.arch})}`:`/api/v1/desktop-updates/${release!.id}/download`
    init.signal?.throwIfAborted()
    const response=await this.transport(`${this.client.origin}${endpoint}`,{
      method:'GET',headers:{Authorization:`Bearer ${session.accessToken}`},cache:'no-store',redirect:'error',
      ...(init.signal?{signal:init.signal}:{}),
    })
    if(!response.ok)throw new Error('企业更新服务暂不可用，请联系管理员')
    if(!checking)return response
    const reader=response.body?.getReader();if(!reader)throw new Error('企业更新响应为空')
    const chunks:Uint8Array[]=[];let size=0
    try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>32768)throw new Error('企业更新响应过大');chunks.push(part.value)}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
    const payload=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {instanceId?:unknown;release?:unknown}
    if(payload.instanceId!==this.instanceId)throw new Error('企业更新服务身份不一致')
    if(payload.release===null){this.releases.set(channel,null);return Response.json({version:this.currentVersion,channel,available:false})}
    const value=payload.release as DesktopRelease|undefined
    if(!value||typeof value.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value.id)
      ||value.state!=='published'||value.channel!==channel||value.platform!==this.platform||value.arch!==this.arch
      ||typeof value.notes!=='string'||value.notes.length>4000||!Number.isSafeInteger(value.size)||value.size!<1||value.size!>MAX_DESKTOP_INSTALLER_BYTES
      ||typeof value.sha256!=='string'||!/^[0-9a-f]{64}$/u.test(value.sha256))throw new Error('企业版本或安装包信息无效')
    desktopReleaseVersion(value.version,channel)
    this.releases.set(channel,Object.freeze({...value}))
    return Response.json({version:value.version,channel})
  }
}
