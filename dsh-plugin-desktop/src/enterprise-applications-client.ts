import {enterpriseApplicationUrl,enterpriseApplicationOrigin,type ApplicationLaunch,type AvailableApplication} from 'dsh-enterprise-contracts'
import type {EnterpriseClient} from './enterprise-client.ts'

const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
export class EnterpriseApplicationsClient{
  constructor(private readonly client:Pick<EnterpriseClient,'session'|'verify'|'request'>,private readonly active=()=>true){}
  private async verified(){
    const expected=this.client.session
    if(!expected||!this.active())throw new Error('登录已失效，请重新登录')
    await this.client.verify()
    const valid=()=>this.active()&&this.client.session?.instanceId===expected.instanceId&&this.client.session?.user.id===expected.user.id
    if(!valid())throw new Error('账号已切换，请重新打开企业应用')
    return valid
  }
  async list():Promise<AvailableApplication[]>{
    const valid=await this.verified(),data=await this.client.request<AvailableApplication[]>('/available-applications')
    if(!valid())throw new Error('账号已切换，请重新打开企业应用')
    if(!Array.isArray(data)||data.some(item=>!item||!idPattern.test(item.id)||typeof item.name!=='string'||typeof item.description!=='string'||!['globe','contract','knowledge','tool'].includes(item.icon)||!Number.isSafeInteger(item.sortOrder)))throw new Error('企业应用列表格式无效')
    return data.map(({id,name,description,icon,sortOrder})=>({id,name,description,icon,sortOrder}))
  }
  async authorize(id:string,opening=false):Promise<ApplicationLaunch>{
    if(!idPattern.test(id))throw new Error('应用标识无效')
    const valid=await this.verified()
    const result=await this.client.request<ApplicationLaunch>(`/applications/${id}/${opening?'open':'access'}`,opening?{}:undefined)
    if(!valid())throw new Error('登录状态已变化，已取消打开')
    if(result?.openMode!=='embedded'||typeof result.url!=='string'||!Number.isSafeInteger(result.revision)||result.revision<1||!Array.isArray(result.allowedOrigins)||result.allowedOrigins.length>21)throw new Error('企业应用地址无效')
    const url=enterpriseApplicationUrl(result.url)
    const allowedOrigins=result.allowedOrigins.map(enterpriseApplicationOrigin)
    if(!allowedOrigins.includes(new URL(url).origin))throw new Error('企业应用站点配置无效')
    return{url,allowedOrigins,revision:result.revision,openMode:'embedded'}
  }
}

/** Independent deadline also covers an unexpectedly stalled check. Hidden pages remain checked. */
export function monitorEmbeddedApplication(check:()=>Promise<void>,revoke:()=>void){
  let stopped=false,checking=false,lastVerified=Date.now()
  function stop(){stopped=true;clearInterval(heartbeat);clearInterval(deadline)}
  function lock(){if(!stopped){stop();revoke()}}
  const heartbeat=setInterval(()=>{if(stopped||checking)return;checking=true;void check().then(()=>{if(!stopped)lastVerified=Date.now()}).catch(lock).finally(()=>{checking=false})},10000)
  const deadline=setInterval(()=>{if(Date.now()-lastVerified>=55000)lock()},1000)
  return stop
}
