/** Real Loader/event waterfall with retained account-local artifacts, no model or company KB calls. */
import {describe,it,expect} from 'vitest'
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {randomUUID} from 'node:crypto'
import {boot} from '@deepseek-ai/dsh-app-boot'
import {agentEvents,type Agent} from '@deepseek-ai/dsh-agent'
import {createUserMessage} from '@deepseek-ai/dsh-llm'
import {SessionId} from '@deepseek-ai/dsh-session'
import type {Context} from '@deepseek-ai/cordis'
import {EnterpriseKnowledge} from '../src/enterprise-knowledge.ts'

describe('enterprise knowledge pre-step composition',()=>{
  it('injects only explicitly selected KB references, persists by account and rejects revoked/failed retrieval',async()=>{
    const parent=resolve(process.cwd(),'../.enterprise-local/knowledge-runtime-tests');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'case-')),kb=randomUUID()
    let allowed=true,fail=false,calls=0
    const remote=createServer(async(req,res)=>{
      expect(req.headers.authorization).toBe('Bearer fixture-capability')
      res.setHeader('Content-Type','application/json')
      if(req.url==='/knowledge/catalog'){res.end(JSON.stringify(allowed?[{id:kb,name:'test',description:'Fixture'}]:[]));return}
      expect(req.url).toBe('/knowledge/search');const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk as Buffer)
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));expect(body.knowledgeBaseIds).toEqual([kb]);expect(body.query).toBe('Fixture question');calls++
      if(fail){res.writeHead(503);res.end(JSON.stringify({error:{message:'Fixture unavailable'}}));return}
      res.end(JSON.stringify({sources:[{reference:'知识来源1',knowledgeBaseId:kb,knowledgeBaseName:'test',documentId:'doc',title:'Fixture document',chunkId:'chunk',content:'Untrusted text <script>bad()</script>',score:.9}]}))
    });remote.listen(0,'127.0.0.1');await once(remote,'listening');const addr=remote.address();if(!addr||typeof addr==='string')throw new Error('No port')
    const bridge={baseUrl:`http://127.0.0.1:${addr.port}`,capability:'fixture-capability'},config=join(dir,'cordis.yml');writeFileSync(config,'- id: knowledge\n  name: cordis:knowledge\n')
    const accountRoot=join(dir,'account-a');mkdirSync(accountRoot,{recursive:true})
    writeFileSync(join(accountRoot,'selections.json'),JSON.stringify([['new',[kb]],['saved-session',[kb]]]))
    let manager:EnterpriseKnowledge|undefined,context:Awaited<ReturnType<typeof boot>>|undefined
    try{
      context=await boot('knowledge-runtime-proof',config,[],async ctx=>{ctx.loader.internal=undefined;ctx.loader.builtins.knowledge={name:'knowledge-proof',async apply(owner:Context){owner.reflect.provide('sessionQuery',{observeSession:async(id:string)=>({header:{id},[Symbol.dispose](){}})});manager=new EnterpriseKnowledge(owner,accountRoot,bridge);await manager.initialize()}}})
      expect((await manager!.view('new')).selectedIds).toEqual([])
      await expect(manager!.select('new',[kb])).rejects.toThrow('请先选择工作区')
      const agent={id:SessionId('knowledge-session'),session:{deriveMessages:()=>[]}} as unknown as Agent
      // Publication has no scope resources to own in this focused seam fixture.
      const publication={agent,source:'startup' as const};context.emit('agent/created',publication)
      const message=createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Fixture question'}]})
      const enter=(messages=[message])=>agentEvents(context!,agent).waterfall('agent/pre-step',{messages,turn:1,step:1,signal:new AbortController().signal},async()=>({kind:'enter',messages}))
      const ordinary=await enter();expect(ordinary.kind==='enter'&&ordinary.messages).toEqual([message]);expect(calls).toBe(0)
      expect((await manager!.view(agent.id)).selectedIds).toEqual([])
      await manager!.select(agent.id,[kb])
      const decision=await enter();expect(decision.kind).toBe('enter')
      if(decision.kind==='reject')throw new Error('Rejected')
      expect(decision.messages).toHaveLength(2);expect(decision.messages[0]).toBe(message)
      const injected=decision.messages[1]!;expect(injected.source.kind).toBe('lets-enterprise-knowledge');expect(JSON.stringify(injected)).toContain('知识来源1');expect(JSON.stringify(injected)).toContain('不可信数据');expect(JSON.stringify(injected)).not.toContain('fixture-capability')
      await enter([]);expect(calls).toBe(1)
      const other={id:SessionId('other-session'),session:{deriveMessages:()=>[message]}} as unknown as Agent;const resumed={agent:other,source:'resume' as const};context.emit('agent/created',resumed)
      const existing=await agentEvents(context,other).waterfall('agent/pre-step',{messages:[message],turn:1,step:1,signal:new AbortController().signal},async()=>({kind:'enter',messages:[message]}));expect(existing.kind).toBe('enter');expect(calls).toBe(1)
      const fresh={id:SessionId('fresh-session'),session:{deriveMessages:()=>[]}} as unknown as Agent;const freshPublication={agent:fresh,source:'startup' as const};context.emit('agent/created',freshPublication)
      expect((await manager!.view(fresh.id)).selectedIds).toEqual([])
      const savedAgent={id:SessionId('saved-session'),session:{deriveMessages:()=>[message]}} as unknown as Agent;const savedPublication={agent:savedAgent,source:'resume' as const};context.emit('agent/created',savedPublication)
      expect((await manager!.view(savedAgent.id)).selectedIds).toEqual([kb])
      allowed=false;await expect(enter()).rejects.toThrow('授权失效');expect(calls).toBe(1)
      allowed=true;fail=true;await expect(enter()).rejects.toThrow('Fixture unavailable')
      const b=new EnterpriseKnowledge(context,join(dir,'account-b'),bridge);await b.initialize();expect((await b.view('new')).selectedIds).toEqual([]);await b.select(agent.id,[])
      const reloaded=new EnterpriseKnowledge(context,accountRoot,bridge);await reloaded.initialize();expect((await reloaded.view('new')).selectedIds).toEqual([]);expect((await reloaded.view(agent.id)).selectedIds).toEqual([kb]);expect((await reloaded.view(fresh.id)).selectedIds).toEqual([])
      await context.fiber.dispose();context=undefined
      const saved=readFileSync(join(dir,'account-a/selections.json'),'utf8');expect(saved).toContain(kb);expect(saved).not.toContain('fixture-capability')
      expect(JSON.parse(saved)).toContainEqual(['new',[kb]]) // Retain the old file record, but never apply it.
      expect(readFileSync(join(dir,'account-b/selections.json'),'utf8')).toBeDefined()
    }finally{await context?.fiber.dispose();remote.closeAllConnections();await new Promise<void>(done=>remote.close(()=>done()))}
  })
})
