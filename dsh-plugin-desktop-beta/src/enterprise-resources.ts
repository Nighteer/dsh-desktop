/** Account-local resources, immutable payload generations and live Harness adapters. */
import {randomUUID,createHash} from 'node:crypto'
import {readFile, mkdir, writeFile, lstat} from 'node:fs/promises'
import {join} from 'node:path'
import type {IncomingMessage, ServerResponse} from 'node:http'
import type {Context, Fiber} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-agent'
import type {ScopeKey} from '@deepseek-ai/dsh-scope'
import type {SkillCandidate, SkillDefinition} from '@deepseek-ai/dsh-skill'
import * as Mcp from '@deepseek-ai/dsh-mcp-client'
import {writeFileAtomic, withFileLock} from '@deepseek-ai/dsh-atomic-write'
import {mcpConfiguration, type AvailableResource, type LocalResource, type ResourceContent, type ResourceDelivery, type ResourceManagerView, type McpConfiguration} from 'dsh-enterprise-contracts'
import {resourceContent, resourceDigest, skillMetadata, skillZip} from 'dsh-enterprise-contracts/resource-node'
import type {EnterpriseModelConnection} from './enterprise-model-bridge.ts'
import {isSameOriginLoopbackRequest} from './desktop-settings-route.ts'

interface Saved extends LocalResource {payload: string}
const ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/u
export class ResourceOperationError extends Error {}
export class EnterpriseResources {
  private records: Saved[] = []
  private catalog: AvailableResource[] = []
  private catalogError = ''
  private localError = ''
  private discovered: LocalResource[] = []
  private closed = false
  private tail: Promise<unknown> = Promise.resolve()
  private invalidate = () => {}
  private readonly fibers = new Map<string,Fiber>()
  private readonly leases = new Map<string,number>()
  private readonly verified = new Map<string,number>()
  private readonly startedAt = Date.now()
  private readonly starts = new Set<Promise<void>>()
  private readonly starting = new Set<string>()
  private readonly generations = new Map<string,number>()
  private readonly abort = new AbortController()
  constructor(private readonly ctx: Context, private readonly root: string, private readonly bridge: EnterpriseModelConnection) {}
  private async request<T>(path: string, body?: unknown): Promise<T> {
    if(this.closed)throw new ResourceOperationError('当前账号工作区已关闭')
    const response=await fetch(`${this.bridge.baseUrl}/resources${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${this.bridge.capability}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(10000)])})
    if(!response.ok)throw new ResourceOperationError('企业资源未授权、已下架或服务不可达，请刷新或联系管理员')
    return response.json() as Promise<T>
  }
  async initialize(): Promise<void> {
    await mkdir(this.root,{recursive:true,mode:0o700})
    try {
      const raw=await readFile(join(this.root,'records.json'),'utf8')
      if(Buffer.byteLength(raw)>1024*1024)throw new Error('state too large')
      const parsed:unknown=JSON.parse(raw)
      if(!Array.isArray(parsed)||parsed.length>300||parsed.some(item=>!item||!ID.test(item.id)||!ID.test(item.payload)||!['skill','mcp'].includes(item.kind)||!['enterprise','personal'].includes(item.source)||typeof item.enabled!=='boolean'||typeof item.name!=='string'||typeof item.version!=='string'||item.source==='enterprise'&&(!ID.test(item.resourceId)||!ID.test(item.versionId))))throw new Error('invalid state')
      this.records=parsed as Saved[]
      for(const record of this.records){record.status=record.enabled?'connecting':'disabled';record.message='';record.tools=[]}
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new ResourceOperationError('技能管理状态不可用；原文件已保留，请检查后重试')}
    this.ctx.effect(()=>this.ctx.skills.registerProvider(control=>{
      this.invalidate=control.invalidate
      return {name:'lets-managed-resources',list:async()=>{
        const result:SkillCandidate[]=[]
        for(const record of this.records.filter(item=>item.kind==='skill'&&item.enabled))if(await this.allowed(record)){
          const content=await this.content(record),meta=skillMetadata(content.files!)
          result.push({name:meta.name,description:meta.description,provider:'lets-managed-resources',source:record.source==='enterprise'?'enterprise':'personal',rank:350,locator:{id:record.id,payload:record.payload},invocation:{modelInvocable:meta.modelInvocable,userInvocable:meta.userInvocable},resourceBase:{kind:'directory',path:join(this.root,record.payload,'files')}})
        }
        return result
      },get:async(candidate)=>{
        const locator=candidate.locator as {id:string;payload:string},record=this.records.find(item=>item.id===locator.id&&item.payload===locator.payload&&item.enabled)
        if(!record||!await this.allowed(record,true))return undefined
        const meta=skillMetadata((await this.content(record)).files!)
        return {...candidate,content:meta.content} as SkillDefinition
      }}
    }),'enterprise: managed skill provider')
    this.ctx.on('tools/pre-execute',async (exec,next)=>{
      const record=this.records.find(item=>exec.name.startsWith(`mcp__lets_${item.id.replaceAll('-','').slice(0,16)}__`))
      if(record&&(!record.enabled||!await this.allowed(record,true)))throw new ResourceOperationError('MCP 已停用或授权已失效')
      return next()
    },{prepend:true})
    this.ctx.tools.guard(exec=>{
      const record=this.records.find(item=>exec.name.startsWith(`mcp__lets_${item.id.replaceAll('-','').slice(0,16)}__`))
      return record&&(this.closed||!record.enabled||record.status==='revoked'||record.source==='enterprise'&&Date.now()-(this.verified.get(record.id)??this.startedAt)>55000)?'企业 MCP 授权已失效或资源已停用':undefined
    })
    this.ctx.on('tools/post-execute',async(exec,result,next)=>{
      const record=this.records.find(item=>exec.name.startsWith(`mcp__lets_${item.id.replaceAll('-','').slice(0,16)}__`))
      if(record&&record.enabled&&record.status!=='revoked'){
        record.status=result.isError?'failed':'ready';record.message=result.isError?'上次 MCP 调用失败，请检查服务、认证或个人参数后重新连接':''
      }
      return next()
    })
    await this.refresh()
    for(const record of this.records.filter(item=>item.enabled))this.launch(record)
    let checking=false
    const timer=setInterval(()=>{if(checking||this.closed)return;checking=true;void this.refresh().finally(()=>{checking=false})},15000)
    const deadline=setInterval(()=>{
      for(const record of this.records)if(record.enabled&&record.source==='enterprise'&&Date.now()-(this.verified.get(record.id)??this.startedAt)>55000&&record.status!=='revoked'){
        record.status='revoked';record.message='企业授权复核超时，已停止使用';this.leases.delete(record.id);this.invalidate();void this.stop(record.id).catch(()=>{})
      }
    },1000)
    this.ctx.effect(()=>()=>{clearInterval(timer);clearInterval(deadline)},'enterprise: resource authorization refresh')
    this.ctx.effect(()=>()=>this.dispose(),'enterprise: resource lifetime')
  }
  private async persist(): Promise<void> {
    await withFileLock(join(this.root,'records.json'),async()=>{
      if(this.closed)throw new ResourceOperationError('当前工作区已关闭')
      await writeFileAtomic(join(this.root,'records.json'),JSON.stringify(this.records),{mode:0o600})
    })
  }
  private serial<T>(work:()=>Promise<T>):Promise<T>{
    const next=this.tail.then(()=>{if(this.closed)throw new ResourceOperationError('当前工作区已关闭');return work()})
    this.tail=next.catch(()=>{});return next
  }
  private async content(record: Saved):Promise<ResourceContent>{
    const dir=join(this.root,record.payload),info=await lstat(dir)
    if(!info.isDirectory()||info.isSymbolicLink())throw new ResourceOperationError('资源目录无效')
    const raw=await readFile(join(dir,'content.json'),'utf8')
    if(Buffer.byteLength(raw)>10*1024*1024)throw new ResourceOperationError('资源文件过大')
    const data=JSON.parse(raw) as ResourceContent&{sealed?:string}
    if(data.kind==='mcp'){
      if(typeof data.sealed!=='string')throw new ResourceOperationError('MCP 私密配置无效')
      const decrypted=await this.request<{value:string}>('/decrypt',{value:data.sealed})
      return resourceContent({kind:'mcp',mcp:JSON.parse(decrypted.value)})
    }
    return resourceContent(data)
  }
  private async allowed(record: Saved, force=false):Promise<boolean>{
    if(this.closed||!record.enabled)return false
    if(record.source==='personal')return true
    if(!force&&(this.leases.get(record.id)??0)>Date.now())return true
    try{
      await this.request(`/${record.resourceId}/versions/${record.versionId}/access`)
      if(this.closed||!record.enabled||!this.records.includes(record))return false
      this.leases.set(record.id,Date.now()+20000)
      this.verified.set(record.id,Date.now())
      if(record.status==='revoked'){record.status='connecting';record.message='';this.launch(record)}
      return true
    }catch{
      if(this.closed||!record.enabled||!this.records.includes(record))return false
      record.status='revoked';record.message='企业授权失效或连接中断，已阻止后续使用'
      this.leases.delete(record.id);await this.stop(record.id);this.invalidate();return false
    }
  }
  async refresh():Promise<ResourceManagerView>{
    try{this.catalog=await this.request<AvailableResource[]>('/catalog');this.catalogError=''}catch{this.catalog=[];this.catalogError='企业资源暂不可达，请检查网络后刷新；已下载企业资源不会离线放行'}
    const pending=this.records.filter(item=>item.source==='enterprise'&&item.enabled)
    await Promise.all(Array.from({length:Math.min(8,pending.length)},async()=>{while(pending.length){const record=pending.shift();if(record)await this.allowed(record,true)}}))
    await this.discoverLocalSkills()
    this.invalidate();return this.view()
  }
  private async discoverLocalSkills():Promise<void>{
    // Use the same registry as slash commands; never copy or claim ownership of existing files.
    const found=new Map<string,LocalResource>();let failed=false
    const directories:(string|undefined)[]=[undefined,...new Set(this.ctx.get('workspaceRegistry')?.list().map(workspace=>workspace.path)??[])]
    const views:{registry:Context['skills'];scope?:ScopeKey}[]=[{registry:this.ctx.skills}],presets=this.ctx.get('agentPresets')
    let presetLease:({key:ScopeKey}&AsyncDisposable)|undefined
    // Slash menus read the standing preset or live agent scope, not just the host's global layer.
    if(presets){try{presetLease=await presets.acquireScope();views.push({registry:this.ctx.skills,scope:presetLease.key})}catch{failed=true}}
    for(const agent of this.ctx.get('agents')?.list()??[])views.push({registry:presets?.serviceFor(agent,'skills')??this.ctx.skills,scope:agent})
    const lookups=views.flatMap(view=>directories.map(cwd=>({...view,cwd})))
    try { await Promise.all(Array.from({length:Math.min(4,lookups.length)},async()=>{
      while(lookups.length){
        const lookup=lookups.shift()!
        try{
          for(const skill of await lookup.registry.list({cwd:lookup.cwd,scope:lookup.scope,signal:this.abort.signal})){
            if(skill.provider==='lets-managed-resources'||!skill.invocation.userInvocable&&!skill.invocation.modelInvocable)continue
            const identity=JSON.stringify([skill.provider,skill.resourceBase??('path' in skill?skill.path:undefined),skill.name])
            const id='local-'+createHash('sha256').update(identity).digest('hex')
            found.set(id,{id,source:'personal',kind:'skill',name:skill.name,description:skill.description,version:'',enabled:true,status:'ready',message:'已在本机可用，无需重复导入。',tools:[],updatedAt:'',managed:false})
          }
        }catch{failed=true}
      }
    })) } finally { await presetLease?.[Symbol.asyncDispose]() }
    if(this.closed)return
    this.discovered=[...found.values()].sort((a,b)=>a.name.localeCompare(b.name))
    this.localError=failed?'部分本机技能暂未读取成功，请刷新重试。':''
  }
  view():ResourceManagerView{
    return {catalog:this.catalog,catalogError:this.catalogError,localError:this.localError,installed:[...this.records.map(({payload:_,...record})=>{
      const prefix=`mcp__lets_${record.id.replaceAll('-','').slice(0,16)}__`
      const tools=this.closed?[]:this.ctx.tools.schemas().map(item=>item.name).filter(name=>name.startsWith(prefix))
      return {...record,tools,managed:true}
    }),...this.discovered]}
  }
  private async store(content:ResourceContent,name:string,version:string,enterprise?:ResourceDelivery):Promise<Saved>{
    const normalized=resourceContent(content)
    const old=enterprise?this.records.find(item=>item.resourceId===enterprise.resourceId):undefined
    if(!old&&this.records.length>=300)throw new ResourceOperationError('本地资源最多 300 项')
    if(old?.versionId===enterprise?.versionId&&old)throw new ResourceOperationError('该版本已经安装')
    if(normalized.kind==='skill'){
      const meta=skillMetadata(normalized.files!)
      const conflict=(await this.ctx.skills.list()).find(item=>item.name===meta.name)
      const oldName=old?.kind==='skill'?skillMetadata((await this.content(old)).files!).name:undefined
      if(conflict&&oldName!==meta.name)throw new ResourceOperationError('存在同名技能，不能静默覆盖，请修改技能 name 后导入')
    }
    const payload=randomUUID(),dir=join(this.root,payload)
    await mkdir(dir,{recursive:false,mode:0o700})
    let disk:object=normalized
    if(normalized.kind==='mcp')disk={kind:'mcp',sealed:(await this.request<{value:string}>('/encrypt',{value:JSON.stringify(normalized.mcp)})).value}
    await writeFile(join(dir,'content.json'),JSON.stringify(disk),{flag:'wx',mode:0o600})
    for(const file of normalized.files??[]){const path=join(dir,'files',...file.path.split('/'));await mkdir(join(path,'..'),{recursive:true,mode:0o700});await writeFile(path,Buffer.from(file.data,'base64'),{flag:'wx',mode:0o600})}
    const record:Saved={id:old?.id??randomUUID(),payload,source:enterprise?'enterprise':'personal',...(enterprise?{resourceId:enterprise.resourceId,versionId:enterprise.versionId}:{}),name,version,kind:normalized.kind,enabled:true,status:'connecting',message:'',tools:[],updatedAt:new Date().toISOString()}
    const before=this.records
    this.records=[...before.filter(item=>item.id!==record.id),record]
    try{await this.persist()}catch(error){this.records=before;throw error}
    if(old)await this.stop(old.id)
    this.leases.delete(record.id);this.invalidate();this.launch(record);return record
  }
  install(resourceId:string,versionId:string):Promise<ResourceManagerView>{return this.serial(async()=>{
    if(!ID.test(resourceId)||!ID.test(versionId))throw new ResourceOperationError('资源 ID 无效')
    const delivery=await this.request<ResourceDelivery>(`/${resourceId}/versions/${versionId}/download`)
    const content=resourceContent(delivery.content)
    if(delivery.resourceId!==resourceId||delivery.versionId!==versionId||resourceDigest(content)!==delivery.digest)throw new ResourceOperationError('资源完整性校验失败')
    try{await this.store(content,delivery.name,delivery.version,delivery)}catch(error){
      await this.request(`/${resourceId}/versions/${versionId}/receipt`,{outcome:'failed'}).catch(()=>{})
      throw error
    }
    await this.request(`/${resourceId}/versions/${versionId}/receipt`,{outcome:'installed'}).catch(()=>{})
    return this.view()
  })}
  add(input:Record<string,unknown>):Promise<ResourceManagerView>{return this.serial(async()=>{
    let content:ResourceContent
    if(typeof input.zip==='string'){if(input.zip.length>6*1024*1024)throw new ResourceOperationError('ZIP 文件过大');content=skillZip(Buffer.from(input.zip,'base64'))}
    else content=resourceContent(input.content)
    const name=content.kind==='skill'?skillMetadata(content.files!).name:String(input.name??'个人 MCP').slice(0,120)
    if(!name.trim())throw new ResourceOperationError('请填写资源名称')
    await this.store(content,name,'personal-'+Date.now());return this.view()
  })}
  toggle(id:string,enabled:boolean):Promise<ResourceManagerView>{return this.serial(async()=>{
    const record=this.records.find(item=>item.id===id)
    if(!record)throw new ResourceOperationError('本地资源不存在')
    const before=record.enabled;record.enabled=enabled
    try{await this.persist()}catch(error){record.enabled=before;throw error}
    this.leases.delete(id);await this.stop(id);record.status=enabled?'connecting':'disabled';record.message='';this.invalidate()
    if(enabled)this.launch(record);return this.view()
  })}
  configure(id:string,options:unknown):Promise<ResourceManagerView>{return this.serial(async()=>{
    const record=this.records.find(item=>item.id===id&&item.kind==='mcp')
    if(!record)throw new ResourceOperationError('MCP 不存在')
    const input=options as {env?:unknown;headers?:unknown}
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['env','headers'].includes(key)))throw new ResourceOperationError('仅允许填写 env 或 headers 参数')
    if(record.source==='enterprise'&&!await this.allowed(record,true))throw new ResourceOperationError('企业授权失效')
    const content=await this.content(record),base=content.mcp!
    if(record.source==='enterprise'&&base.transport==='streamable-http')throw new ResourceOperationError('企业远程 MCP 的密钥由管理员统一维护')
    const config=mcpConfiguration({...base,...input}),payload=randomUUID(),dir=join(this.root,payload)
    await mkdir(dir,{recursive:false,mode:0o700})
    const sealed=(await this.request<{value:string}>('/encrypt',{value:JSON.stringify(config)})).value
    await writeFile(join(dir,'content.json'),JSON.stringify({kind:'mcp',sealed}),{flag:'wx',mode:0o600})
    const previous=record.payload;record.payload=payload
    try{await this.persist()}catch(error){record.payload=previous;throw error}
    await this.stop(id);record.message='';record.status='connecting';if(record.enabled)this.launch(record)
    return this.view()
  })}
  private launch(record:Saved):void{
    if(this.closed||!record.enabled||this.fibers.has(record.id))return
    const generation=this.generations.get(record.id)??0,key=`${record.id}:${generation}`
    if(this.starting.has(key))return
    this.starting.add(key)
    const job=(async()=>{
      try{
        if(!await this.allowed(record))return
        if(record.kind==='skill'){await this.content(record);if(!this.closed&&record.enabled&&(this.generations.get(record.id)??0)===generation){record.status='ready';this.invalidate()}return}
        const content=await this.content(record);let config:McpConfiguration=content.mcp!
        if(record.source==='enterprise'&&config.transport==='streamable-http')config={transport:'streamable-http',url:`${this.bridge.baseUrl}/resources/${record.resourceId}/versions/${record.versionId}/mcp`,headers:{Authorization:`Bearer ${this.bridge.capability}`}}
        if(config.transport==='stdio'&&Object.values(config.env).some(value=>value===''))throw new ResourceOperationError('请先填写本地 MCP 所需的个人环境变量')
        if(this.closed||!record.enabled||(this.generations.get(record.id)??0)!==generation||this.records.find(item=>item.id===record.id)!==record)return
        const fiber=this.ctx.plugin(Mcp,Mcp.Config({...config,serverName:'lets_'+record.id.replaceAll('-','').slice(0,16),toolCallTimeoutMs:60000,failOnStartupError:true,reconnect:{enabled:false}}))
        this.fibers.set(record.id,fiber);await fiber
        if(fiber.state!==2)throw new ResourceOperationError('MCP 连接失败，请检查地址、运行程序、环境变量或认证配置')
        if(!this.closed&&record.enabled){record.status='ready';record.message=''}
      }catch(error){if(!this.closed&&record.enabled&&record.status!=='revoked'&&(this.generations.get(record.id)??0)===generation){record.status='failed';record.message=error instanceof ResourceOperationError?error.message:'MCP 或技能加载失败，请检查配置后重试';await this.stop(record.id)}}
    })()
    this.starts.add(job);void job.finally(()=>{this.starts.delete(job);this.starting.delete(key)}).catch(()=>{})
  }
  private async stop(id:string):Promise<void>{this.generations.set(id,(this.generations.get(id)??0)+1);const fiber=this.fibers.get(id);this.fibers.delete(id);if(fiber)await fiber.dispose()}
  async dispose():Promise<void>{this.closed=true;this.abort.abort();await Promise.all([...this.fibers.keys()].map(id=>this.stop(id)));await Promise.allSettled([...this.starts]);await this.tail;this.invalidate()}
}

export async function handleResourceRequest(req:IncomingMessage,res:ServerResponse,origin:string,manager:EnterpriseResources):Promise<void>{
  const send=(status:number,value:object)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))}
  if(!['GET','POST'].includes(req.method??''))return send(405,{error:'不支持该请求方式'})
  if(!isSameOriginLoopbackRequest(req,origin,req.method==='POST'))return send(403,{error:'拒绝跨站或非本机请求'})
  try{
    if(req.method==='GET')return send(200,await manager.refresh())
    if(req.headers['content-type']?.split(';')[0]?.trim()!=='application/json')return send(415,{error:'需要 JSON 请求'})
    const chunks:Buffer[]=[];let size=0
    for await(const chunk of req){size+=chunk.length;if(size>10*1024*1024)return send(413,{error:'资源上传过大'});chunks.push(chunk as Buffer)}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string,unknown>
    if(!value||typeof value!=='object'||Array.isArray(value))return send(400,{error:'请求无效'})
    if(value.confirmed!==true)return send(400,{error:'请先确认操作及第三方代码风险'})
    if(value.action==='install'&&typeof value.resourceId==='string'&&typeof value.versionId==='string')return send(200,await manager.install(value.resourceId,value.versionId))
    if(value.action==='add')return send(200,await manager.add(value))
    if(value.action==='toggle'&&typeof value.id==='string'&&typeof value.enabled==='boolean')return send(200,await manager.toggle(value.id,value.enabled))
    if(value.action==='configure'&&typeof value.id==='string')return send(200,await manager.configure(value.id,value.options))
    return send(400,{error:'资源操作参数无效'})
  }catch(error){return send(409,{error:error instanceof ResourceOperationError?error.message:'资源操作失败；请检查包格式、配置和连接后重试，原文件与旧版本均保留'})}
}
export async function installEnterpriseResources(ctx:Context,connection:EnterpriseModelConnection,home:string):Promise<EnterpriseResources>{
  const manager=new EnterpriseResources(ctx,join(home,'managed-resources'),connection)
  await manager.initialize()
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/api/desktop/resources',handler:(req,res)=>{
    const rejected=ctx.connection.requestRejection(req)
    if(rejected!==undefined){res.writeHead(rejected);res.end();return}
    return handleResourceRequest(req,res,`http://127.0.0.1:${ctx.webServer.port}`,manager)
  }}),'enterprise: resource management route')
  return manager
}
