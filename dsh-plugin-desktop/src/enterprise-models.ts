/** Desktop-owned adapter composition over the public upstream LLM seam. */
import type { Context } from '@deepseek-ai/cordis'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { PiAiAdapter, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import type { Model, Provider } from '@earendil-works/pi-ai'
import { LlmError, resolveRetryPolicy, resolveImageAttachmentAccess, type GenerateOptions, type LlmModelInfo, type LlmResolvedModelInfo, type PreparedAdapterCall, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { AvailableModel } from 'dsh-enterprise-contracts'
import type { PreparedDesktopProfile } from './profile.ts'
import type { EnterpriseModelConnection } from './enterprise-model-bridge.ts'

export const ENTERPRISE_MODEL_PROVIDER = 'lets-enterprise'
export function prepareEnterpriseModels(profile: PreparedDesktopProfile) {
  const current=composeEntries([profile.patches]).find(row=>row.id==='agent-default-model')?.config as {provider?:unknown;model?:unknown}|undefined
  // Override only the generation, not the user's Profile or settings document.
  for(const id of ['llm-deepseek','llm-deepseek-account','llm-pi-ai','ui-settings-models']) profile.patches.push({id,disabled:true})
  profile.patches.push({id:'agent-default-model',config:{provider:ENTERPRISE_MODEL_PROVIDER,model:current?.provider===ENTERPRISE_MODEL_PROVIDER && typeof current.model==='string'?current.model:'unassigned'}})
}

export async function installEnterpriseModels(ctx: Context, connection: EnterpriseModelConnection) {
  let catalog: AvailableModel[] = []
  let profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile> = new Map()
  async function reload(signal?: AbortSignal) {
    const response=await fetch(`${connection.baseUrl}/models`,{redirect:'error',headers:{Authorization:`Bearer ${connection.capability}`},signal:signal??AbortSignal.timeout(10000)})
    if(!response.ok)throw new LlmError('无法读取企业模型，请检查登录或联系管理员。','AUTH')
    const result:unknown=await response.json()
    if(!Array.isArray(result)||result.some(m=>!m||typeof m.id!=='string'||typeof m.name!=='string'||
      !(m.contextWindow===null||Number.isSafeInteger(m.contextWindow)&&m.contextWindow>=1024)||
      !(m.maxTokens===null||Number.isSafeInteger(m.maxTokens)&&m.maxTokens>0)||typeof m.supportsTools!=='boolean'||typeof m.supportsImages!=='boolean'))throw new LlmError('企业模型目录响应无效','INVALID_REQUEST')
    if (JSON.stringify(result) !== JSON.stringify(catalog) || profiles.size === 0) {
      catalog=result as AvailableModel[]
      const models: Model<'openai-completions'>[] = catalog.map(m => ({
        id:m.id,name:m.name,provider:ENTERPRISE_MODEL_PROVIDER,api:'openai-completions',baseUrl:connection.baseUrl,
        reasoning:false,input:m.supportsImages?['text','image']:['text'],
        cost:{input:0,output:0,cacheRead:0,cacheWrite:0},
        // Unknown capacities never pass allowed()/clean(); these placeholders
        // are internal catalog construction only, not advertised model facts.
        contextWindow:m.contextWindow??1,maxTokens:m.maxTokens??1,
        compat:{supportsStore:false,supportsDeveloperRole:false,supportsReasoningEffort:false,maxTokensField:'max_tokens'},
      }))
      const protocol=openAICompletionsApi()
      const piProvider:Provider={id:ENTERPRISE_MODEL_PROVIDER,name:'LETS 企业模型',baseUrl:connection.baseUrl,
        auth:{apiKey:{name:'LETS session',resolve:async ({credential})=>({auth:credential?.key?{apiKey:credential.key}:{},source:'LETS session'})}},
        getModels:()=>models,stream:(...args)=>protocol.stream(...args),
        // The generic simple helper invents an output cap from model.maxTokens.
        // Enterprise omission must leave the wire cap unset for the provider.
        streamSimple:(model,context,options)=>protocol.stream(model,context,options)}
      profiles=new Map([[ENTERPRISE_MODEL_PROVIDER,{
        provider:ENTERPRISE_MODEL_PROVIDER,displayName:'LETS 企业模型',api:'openai-completions',baseURL:connection.baseUrl,
        piProvider,streamIdleTimeoutMs:120000,maxRequestImageBytes:20*1024*1024,
        requestImagePixelBudget:20_000_000,requestImageMaxBytes:10*1024*1024,
        retryPolicy:resolveRetryPolicy({mode:'normal',maxRetries:2},'LETS enterprise retry policy'),modelErrors:new Map(),
        configuredMaxTokens:new Map(catalog.flatMap(m=>m.maxTokens===null?[]:[[m.id,m.maxTokens] as const])),
      }]])
    }
  }
  class EnterpriseAdapter extends PiAiAdapter {
    override providerInfo(provider:string){return {id:provider,name:'LETS 企业模型'}}
    override async listModels(provider:string):Promise<readonly LlmModelInfo[]>{await reload();return catalog.map(m=>({provider,id:m.id,name:m.name,inputModalities:m.supportsImages?['text','image']:['text'],...(m.contextWindow===null?{description:'上下文容量未知，请管理员读取或设置'}:{})}))}
    private async allowed(model:string,signal?:AbortSignal){await reload(signal);const found=catalog.find(m=>m.id===model);if(!found)throw new LlmError('模型尚未授权或已停用，请联系管理员。','AUTH');return found}
    private metadata(info:LlmResolvedModelInfo,model:AvailableModel){
      delete info.reasoning
      if(model.contextWindow===null)delete info.context
      else info.context={contextWindow:model.contextWindow}
      if(model.maxTokens===null)delete info.defaultMaxTokens
      else info.defaultMaxTokens=model.maxTokens
      info.inputModalities=model.supportsImages?['text','image']:['text']
      return info
    }
    private clean(options:GenerateOptions,model:AvailableModel){
      if(model.contextWindow===null)throw new LlmError('该模型上下文容量未知，请管理员读取提供商信息或手动设置后使用。','INVALID_REQUEST')
      const clean={...options};delete clean.reasoningEffort
      if(model.maxTokens===null)delete clean.maxTokens
      if(!model.supportsTools)delete clean.tools
      return clean
    }
    private async *guard(chunks:AsyncIterable<StreamChunk>,model:AvailableModel){
      for await(const chunk of chunks){
        if(!model.supportsTools&&(chunk.type==='tool-call-delta'||chunk.type==='block-start'&&chunk.blockType==='tool-call'))throw new LlmError('该模型未启用工具调用，已阻止执行。','INVALID_REQUEST')
        yield chunk
      }
    }
    override async resolveModel(provider:string,model:string,signal?:AbortSignal){
      const found=await this.allowed(model,signal)
      const info=await super.resolveModel(provider,model,signal)
      return this.metadata(info,found)
    }
    override async prepareCall(provider:string,model:string,signal?:AbortSignal):Promise<PreparedAdapterCall>{
      const found=await this.allowed(model,signal)
      const prepared=await super.prepareCall(provider,model,signal)
      return {model:this.metadata(prepared.model,found),stream:options=>this.guard(prepared.stream(this.clean(options,found)),found)}
    }
    override async *stream(options:GenerateOptions){const found=await this.allowed(options.model,options.signal);yield* this.guard(super.stream(this.clean(options,found)),found)}
  }
  const adapter=new EnterpriseAdapter({
    profiles:()=>profiles,
    resolveApiKey:async()=>connection.capability,
    // Enterprise calls may only use the short-lived loopback capability.
    // Never discover ambient provider keys or persist credentials in pi-ai.
    auth:{credentials:{read:async()=>undefined,list:async()=>[],modify:async()=>{throw new Error('Enterprise credentials are managed by the main process')},delete:async()=>{throw new Error('Enterprise credentials are managed by the main process')}},
      authContext:{env:async()=>undefined,fileExists:async()=>false}},
    resolveAttachments:()=>ctx.get('attachments'),
    resolveImageAccess:(attachments,ref)=>resolveImageAttachmentAccess(attachments,path=>ctx.get('fs')?.processPathFromHostPath(path),ref),
  })
  ctx.llm.registerAdapter([ENTERPRISE_MODEL_PROVIDER],adapter)
  // Even an extra user plugin cannot route a normal harness stream around enterprise authorization.
  ctx.on('llm/stream',async function*(options,next){
    if(options.provider!==ENTERPRISE_MODEL_PROVIDER)throw new LlmError('企业版仅允许使用管理员授权的企业模型。','AUTH')
    yield* next()
  }, {prepend:true})
  await reload()
  const selection=ctx.agentDefaultModel.currentSelection()
  if(selection.provider!==ENTERPRISE_MODEL_PROVIDER||!catalog.some(m=>m.id===selection.model)||selection.reasoningEffort!==undefined) {
    await ctx.agentDefaultModel.saveSelection({provider:ENTERPRISE_MODEL_PROVIDER,model:catalog[0]?.id??'unassigned'})
  }
  // Grants can be added after login. Recover the placeholder without replacing a valid user selection.
  let refreshing=false
  const timer=setInterval(()=>{
    if(refreshing)return;refreshing=true
    void reload().then(async()=>{
      const current=ctx.agentDefaultModel.currentSelection()
      if(catalog.length&&(current.provider!==ENTERPRISE_MODEL_PROVIDER||!catalog.some(m=>m.id===current.model)))await ctx.agentDefaultModel.saveSelection({provider:ENTERPRISE_MODEL_PROVIDER,model:catalog[0]!.id})
    }).catch(()=>{}).finally(()=>{refreshing=false})
  },15000)
  ctx.effect(()=>()=>clearInterval(timer),'enterprise model catalog refresh')
}
