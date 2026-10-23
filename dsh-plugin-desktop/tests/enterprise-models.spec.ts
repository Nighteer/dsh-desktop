import { describe, it, expect, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import {AttachmentId,ImageVariantId} from '@deepseek-ai/dsh-attachment'
import { LlmRuntime, MessageId } from '@deepseek-ai/dsh-llm'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { EnterpriseClient } from '../src/enterprise-client.ts'
import { startEnterpriseModelBridge } from '../src/enterprise-model-bridge.ts'
import { ENTERPRISE_MODEL_PROVIDER, installEnterpriseModels, prepareEnterpriseModels } from '../src/enterprise-models.ts'
import type { PreparedDesktopProfile } from '../src/profile.ts'

vi.mock('@deepseek-ai/dsh-anonymous-user-id',()=>({getOrCreateAnonymousUserId:()=> 'model-test-anonymous-id'}))

// Config persistence is exercised by profile-config-editor integration tests.
// A bare adapter unit context deliberately has no profile or writable settings.
const MemorySettings = {apply(){}}
const model={id:'11111111-1111-4111-8111-111111111111',name:'企业测试模型',contextWindow:65536,maxTokens:1024,supportsTools:true,supportsImages:false,contextSource:'manual'}
function client() {
  const value=new EnterpriseClient('http://127.0.0.1:4310')
  const identity={instanceId:model.id,user:{id:model.id,username:'employee',name:'员工',departmentId:model.id,departmentName:'总部',role:'employee' as const,enabled:true,mustChangePassword:false,createdAt:new Date().toISOString()}}
  value.session={...identity,accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),expiresAt:new Date(Date.now()+900000).toISOString()}
  vi.spyOn(value,'verify').mockResolvedValue(identity)
  vi.spyOn(value,'request').mockResolvedValue([model])
  return value
}
describe('enterprise model boundary',()=>{
  it('overrides generation adapters without changing Profile files',()=>{
    const profile={patches:[]} as unknown as PreparedDesktopProfile
    prepareEnterpriseModels(profile)
    expect(profile.patches).toContainEqual({id:'llm-pi-ai',disabled:true})
    expect(profile.patches).toContainEqual({id:'llm-deepseek',disabled:true})
    expect(profile.patches).toContainEqual({id:'ui-settings-models',disabled:true})
    expect(profile.patches).toContainEqual({id:'agent-default-model',config:{provider:ENTERPRISE_MODEL_PROVIDER,model:'unassigned'}})
  })
  it('requires in-memory capability, rejects browser origins and never returns login credentials',async()=>{
    const value=client(),bridge=await startEnterpriseModelBridge(value)
    try {
      expect((await fetch(`${bridge.connection.baseUrl}/models`)).status).toBe(403)
      const headers={Authorization:`Bearer ${bridge.connection.capability}`}
      expect((await fetch(`${bridge.connection.baseUrl}/models`,{headers:{...headers,Origin:'http://attacker.invalid'}})).status).toBe(403)
      const response=await fetch(`${bridge.connection.baseUrl}/models`,{headers})
      expect(response.status).toBe(200);expect(await response.json()).toEqual([model])
      expect(JSON.stringify(bridge.connection)).not.toContain(value.session!.accessToken)
      expect(JSON.stringify(bridge.connection)).not.toContain(value.session!.refreshToken)
      value.session=undefined;vi.mocked(value.verify).mockRejectedValue(new Error('revoked'))
      expect((await fetch(`${bridge.connection.baseUrl}/models`,{headers})).status).toBe(503)
    }finally{bridge.stop()}
    await expect(fetch(`${bridge.connection.baseUrl}/models`)).rejects.toThrow()
  })
  it('uses the real upstream adapter catalog, resolves caps, and denies ungranted models',async()=>{
    const ctx=new Context(),value=client(),bridge=await startEnterpriseModelBridge(value)
    try {
      await ctx.plugin(MemorySettings)
      await ctx.plugin(LlmRuntime)
      await ctx.plugin(AgentDefaultModelConfig,{provider:ENTERPRISE_MODEL_PROVIDER,model:model.id})
      await installEnterpriseModels(ctx,bridge.connection)
      expect(ctx.agentDefaultModel.currentSelection()).toEqual({provider:ENTERPRISE_MODEL_PROVIDER,model:model.id})
      expect(ctx.llm.listProviders()).toEqual([{id:ENTERPRISE_MODEL_PROVIDER,name:'LETS 企业模型'}])
      expect((await ctx.llm.listModels(ENTERPRISE_MODEL_PROVIDER))[0]!.name).toBe(model.name)
      const resolved=await ctx.llm.resolveModelInfo(ENTERPRISE_MODEL_PROVIDER,model.id)
      expect(resolved.context?.contextWindow).toBe(model.contextWindow)
      expect(resolved.defaultMaxTokens).toBe(model.maxTokens)
      expect(resolved.reasoning).toBeUndefined()
      const prepared=await ctx.llm.prepareCall({provider:ENTERPRISE_MODEL_PROVIDER,model:model.id})
      expect(prepared.config.reasoningEffort).toBeUndefined()
      await expect(ctx.llm.resolveModelInfo(ENTERPRISE_MODEL_PROVIDER,'ungranted')).rejects.toThrow('未授权')
      vi.mocked(value.request).mockResolvedValue([])
      await expect(ctx.llm.resolveModelInfo(ENTERPRISE_MODEL_PROVIDER,model.id)).rejects.toThrow('未授权')
      const chunks=[]
      for await(const chunk of ctx.llm.stream({provider:ENTERPRISE_MODEL_PROVIDER,model:model.id,messages:[{id:MessageId('test-message'),role:'user',source:{kind:'user'},content:[{type:'text',text:'hello'}]}]}))chunks.push(chunk)
      expect(chunks.at(-1)?.type).toBe('finish')
    }finally{await ctx.fiber.dispose();bridge.stop()}
  })
  it('streams text, reasoning, tool-call arguments and usage through the main-only bridge',async()=>{
    let allowTools=true
    const gateway=createServer(async(req,res)=>{
      expect(req.headers.authorization).toBe(`Bearer ${'a'.repeat(43)}`)
      const parts:Buffer[]=[];for await(const chunk of req)parts.push(chunk as Buffer)
      const body=JSON.parse(Buffer.concat(parts).toString())
      expect(body.model).toBe(model.id);expect(body.reasoning_effort).toBeUndefined()
      if(allowTools)expect(body.tools).toHaveLength(1)
      else expect(body.tools).toBeUndefined()
      expect(JSON.stringify(body.messages)).toContain('data:image/png;base64,AQID')
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      const events=[
        {choices:[{delta:{reasoning_content:'分析中'},finish_reason:null}]},
        {choices:[{delta:{content:'完成'},finish_reason:null}]},
        {choices:[{delta:{tool_calls:[{index:0,id:'tool-1',type:'function',function:{name:'test_tool',arguments:'{"x":'}}]},finish_reason:null}]},
        {choices:[{delta:{tool_calls:[{index:0,function:{arguments:'1}'}}]},finish_reason:null}]},
        {choices:[{delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}},
      ]
      for(const event of events)res.write(`data: ${JSON.stringify(event)}\n\n`)
      res.end('data: [DONE]\n\n')
    })
    gateway.listen(0,'127.0.0.1');await once(gateway,'listening')
    const address=gateway.address();if(!address||typeof address==='string')throw new Error('listen')
    const value=client()
    const real=new EnterpriseClient(`http://127.0.0.1:${address.port}`)
    real.session=value.session
    vi.spyOn(real,'verify').mockImplementation(()=>value.verify())
    vi.spyOn(real,'request').mockResolvedValue([{...model,supportsImages:true}])
    const bridge=await startEnterpriseModelBridge(real),ctx=new Context()
    try{
      await ctx.plugin(MemorySettings);await ctx.plugin(LlmRuntime)
      const ref={attachmentId:AttachmentId(`sha256:${'a'.repeat(64)}`),mediaType:'image/png' as const,bytes:3,width:1,height:1}
      ctx.provide('attachments',{
        readImageRequest:async()=>({variantId:ImageVariantId(`sha256:${'b'.repeat(64)}`),attachment:ref,data:Uint8Array.of(1,2,3),mediaType:'image/png',bytes:3,width:1,height:1,depth:'uchar',space:'srgb',hasAlpha:true}),
        imageHostPath:()=>undefined,
      })
      await ctx.plugin(AgentDefaultModelConfig,{provider:ENTERPRISE_MODEL_PROVIDER,model:model.id})
      await installEnterpriseModels(ctx,bridge.connection)
      const chunks=[]
      for await(const chunk of ctx.llm.stream({provider:ENTERPRISE_MODEL_PROVIDER,model:model.id,messages:[{id:MessageId('test'),role:'user',source:{kind:'user'},content:[{type:'text',text:'hello'},{type:'image',attachment:ref}]}],tools:[{name:'test_tool',description:'test',parameters:{type:'object'}}]}))chunks.push(chunk)
      expect(chunks).toContainEqual({type:'text-delta',index:1,text:'完成'})
      expect(chunks).toContainEqual({type:'reasoning-delta',index:0,text:'分析中'})
      expect(chunks).toContainEqual({type:'block-end',index:2,block:{type:'tool-call',id:'tool-1',name:'test_tool',arguments:'{"x":1}'}})
      expect(chunks.some(chunk=>chunk.type==='usage')).toBe(true)
      expect(chunks.at(-1)).toMatchObject({type:'finish',reason:{kind:'tool-calls'}})
      allowTools=false
      vi.mocked(real.request).mockResolvedValue([{...model,supportsImages:true,supportsTools:false}])
      const denied=[]
      for await(const chunk of ctx.llm.stream({provider:ENTERPRISE_MODEL_PROVIDER,model:model.id,messages:[{id:MessageId('disabled-tools'),role:'user',source:{kind:'user'},content:[{type:'image',attachment:ref}]}],tools:[{name:'test_tool',description:'test',parameters:{type:'object'}}]}))denied.push(chunk)
      expect(denied.some(chunk=>chunk.type==='tool-call-delta')).toBe(false)
      expect(denied.at(-1)).toMatchObject({type:'finish',reason:{kind:'error'}})
    }finally{await ctx.fiber.dispose();bridge.stop();gateway.closeAllConnections();gateway.close()}
  })
  it('omits output caps on the actual wire when only provider defaults are configured',async()=>{
    let sent:Record<string,unknown>|undefined
    const gateway=createServer(async(req,res)=>{
      const parts:Buffer[]=[];for await(const part of req)parts.push(part as Buffer)
      sent=JSON.parse(Buffer.concat(parts).toString()) as Record<string,unknown>
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      res.end('data: {"id":"defaults","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    })
    gateway.listen(0,'127.0.0.1');await once(gateway,'listening')
    const address=gateway.address();if(!address||typeof address==='string')throw Error('listen')
    const real=new EnterpriseClient(`http://127.0.0.1:${address.port}`),fake=client(),ctx=new Context()
    real.session=fake.session;vi.spyOn(real,'verify').mockImplementation(()=>fake.verify())
    vi.spyOn(real,'request').mockResolvedValue([{...model,maxTokens:null}])
    const bridge=await startEnterpriseModelBridge(real)
    try{
      await ctx.plugin(LlmRuntime);await ctx.plugin(AgentDefaultModelConfig,{provider:ENTERPRISE_MODEL_PROVIDER,model:model.id})
      await installEnterpriseModels(ctx,bridge.connection)
      const prepared=await ctx.llm.prepareCall({provider:ENTERPRISE_MODEL_PROVIDER,model:model.id})
      const chunks=[]
      for await(const chunk of prepared.stream({provider:ENTERPRISE_MODEL_PROVIDER,model:model.id,messages:[{id:MessageId('provider-default'),role:'user',source:{kind:'user'},content:[{type:'text',text:'hello'}]}]}))chunks.push(chunk)
      expect(sent?.model).toBe(model.id)
      expect(sent).not.toHaveProperty('max_tokens')
      expect(sent).not.toHaveProperty('max_completion_tokens')
      expect(chunks.at(-1)).toMatchObject({type:'finish',reason:{kind:'stop'}})
    }finally{await ctx.fiber.dispose();bridge.stop();gateway.closeAllConnections();gateway.close()}
  })
  it('stopping the bridge cancels an active upstream request',async()=>{
    let disconnected=false
    const gateway=createServer(async(req,res)=>{
      for await(const _chunk of req){/* consume request */}
      res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: {}\n\n')
      const timer=setInterval(()=>res.write(': ping\n\n'),20)
      res.once('close',()=>{clearInterval(timer);disconnected=true})
    })
    gateway.listen(0,'127.0.0.1');await once(gateway,'listening')
    const address=gateway.address();if(!address||typeof address==='string')throw new Error('listen')
    const real=new EnterpriseClient(`http://127.0.0.1:${address.port}`),fake=client()
    real.session=fake.session;vi.spyOn(real,'verify').mockImplementation(()=>fake.verify())
    const bridge=await startEnterpriseModelBridge(real)
    try{
      const response=await fetch(`${bridge.connection.baseUrl}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${bridge.connection.capability}`,'Content-Type':'application/json'},body:JSON.stringify({model:model.id,messages:[],stream:true})})
      const reader=response.body!.getReader();expect((await reader.read()).done).toBe(false)
      bridge.stop()
      await expect((async()=>{while(!(await reader.read()).done){/* drain */}})()).rejects.toThrow()
      await vi.waitFor(()=>expect(disconnected).toBe(true))
    }finally{bridge.stop();gateway.closeAllConnections();gateway.close()}
  })
  it('preserves unknown capacities and provider output defaults instead of inventing metadata',async()=>{
    const ctx=new Context(),value=client(),bridge=await startEnterpriseModelBridge(value)
    vi.mocked(value.request).mockResolvedValue([{...model,contextWindow:null,maxTokens:null,contextSource:'unknown'}])
    try{
      await ctx.plugin(MemorySettings);await ctx.plugin(LlmRuntime);await ctx.plugin(AgentDefaultModelConfig,{provider:ENTERPRISE_MODEL_PROVIDER,model:model.id})
      await installEnterpriseModels(ctx,bridge.connection)
      const info=await ctx.llm.resolveModelInfo(ENTERPRISE_MODEL_PROVIDER,model.id)
      expect(info.context).toBeUndefined();expect(info.defaultMaxTokens).toBeUndefined()
      const prepared=await ctx.llm.prepareCall({provider:ENTERPRISE_MODEL_PROVIDER,model:model.id})
      expect(prepared.config.maxTokens).toBeUndefined()
      const chunks=[]
      for await(const chunk of prepared.stream({provider:ENTERPRISE_MODEL_PROVIDER,model:model.id,messages:[{id:MessageId('unknown'),role:'user',source:{kind:'user'},content:[{type:'text',text:'hello'}]}]}))chunks.push(chunk)
      expect(chunks.at(-1)).toMatchObject({type:'finish',reason:{kind:'error'}})
    }finally{await ctx.fiber.dispose();bridge.stop()}
  })
})
