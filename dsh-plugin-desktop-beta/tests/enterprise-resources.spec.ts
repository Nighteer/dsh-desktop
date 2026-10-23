/** Loader composition, real Skill registry and real MCP protocol. Artifacts are retained. */
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,readdirSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto'
import {boot} from '@deepseek-ai/dsh-app-boot'
import type {Context} from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {ToolCallId} from '@deepseek-ai/dsh-llm'
import {describe,it,expect} from 'vitest'
import {resourceDigest,resourceContent} from 'dsh-enterprise-contracts/resource-node'
import {EnterpriseResources} from '../src/enterprise-resources.ts'

describe('enterprise and personal resource runtime',()=>{
  it('loads actual Skills, uses actual stdio/HTTP MCP tools, revokes access and preserves files',async()=>{
    const parent=resolve(process.cwd(),'../.enterprise-local/resource-runtime-tests');mkdirSync(parent,{recursive:true})
    const dir=mkdtempSync(join(parent,'case-')),resourceId=randomUUID(),versionId=randomUUID(),secret=randomBytes(32)
    const skill=resourceContent({kind:'skill',files:[{path:'SKILL.md',data:Buffer.from('---\nname: managed-proof\ndescription: Managed proof skill\n---\nRead references/proof.txt and say MANAGED_SKILL_PROOF.').toString('base64')},{path:'references/proof.txt',data:Buffer.from('Retained proof file').toString('base64')}]})
    let authorized=true,calls=0
    const remote=createServer(async(req,res)=>{
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk as Buffer)
      const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):undefined
      const send=(value:object)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value))}
      if(req.url==='/remote'){
        expect(req.headers.authorization).toBe('Bearer personal-fixture-key')
        if(body?.id===undefined){res.writeHead(202);res.end();return}
        const result=body.method==='initialize'?{protocolVersion:body.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:body.method==='tools/list'?{tools:[{name:'proof',description:'Fixture proof',inputSchema:{type:'object',properties:{}}}]}:{content:[{type:'text',text:'HTTP_MCP_PROOF'}]}
        if(body.method==='tools/call')calls++
        send({jsonrpc:'2.0',id:body.id,result});return
      }
      if(req.headers.authorization!=='Bearer fixture-capability'){res.writeHead(403);res.end();return}
      if(req.url==='/resources/encrypt'){
        const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv),bytes=Buffer.concat([cipher.update(body.value),cipher.final()]);send({value:Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64')});return
      }
      if(req.url==='/resources/decrypt'){
        const value=Buffer.from(body.value,'base64'),decipher=createDecipheriv('aes-256-gcm',secret,value.subarray(0,12));decipher.setAuthTag(value.subarray(12,28));send({value:Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString()});return
      }
      if(req.url==='/resources/catalog'){send(authorized?([{id:resourceId,name:'Company proof',kind:'skill',description:'Test',latestVersion:versionId,versions:[{id:versionId,version:'1.0.0',published:true,enabled:true,digest:resourceDigest(skill),notes:'',createdAt:new Date().toISOString()}]}] as unknown as object):[]);return}
      if(!authorized){res.writeHead(403);res.end('{}');return}
      if(req.url?.endsWith('/download')){send({resourceId,versionId,name:'Company proof',version:'1.0.0',digest:resourceDigest(skill),content:skill});return}
      send({allowed:true})
    })
    remote.listen(0,'127.0.0.1');await once(remote,'listening');const address=remote.address();if(!address||typeof address==='string')throw new Error('No port')
    const baseUrl=`http://127.0.0.1:${address.port}`
    const script=join(dir,'fixture.mjs')
    writeFileSync(script,`let buffer='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\\n')){const at=buffer.indexOf('\\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line)continue;const q=JSON.parse(line);if(q.id===undefined)continue;const result=q.method==='initialize'?{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'local-proof',version:'1'}}:q.method==='tools/list'?{tools:[{name:'proof',description:'Local fixture',inputSchema:{type:'object',properties:{}}}]}:{content:[{type:'text',text:process.env.FIXTURE_SECRET==='local-fixture-key'?'STDIO_MCP_PROOF':'NO_SECRET'}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n')}});`)
    const config=join(dir,'cordis.yml');writeFileSync(config,'- id: prompt\n  name: cordis:prompt\n- id: tools\n  name: cordis:tools\n- id: skills\n  name: cordis:skills\n- id: resources\n  name: cordis:resources\n')
    let manager:EnterpriseResources|undefined,context:Awaited<ReturnType<typeof boot>>|undefined
    try{
      context=await boot('resource-runtime-test',config,[],async ctx=>{
        ctx.loader.internal=undefined;ctx.loader.builtins.prompt=SystemPrompt;ctx.loader.builtins.tools=ToolRuntime;ctx.loader.builtins.skills=SkillRegistry
        ctx.loader.builtins.resources={name:'resource-test-owner',inject:['skills','tools'],async apply(owner:Context){manager=new EnterpriseResources(owner,join(dir,'account-resources'),{baseUrl,capability:'fixture-capability'});await manager.initialize()}}
      })
      expect(manager).toBeDefined()
      await manager!.install(resourceId,versionId)
      const catalog=await context.skills.list();expect(catalog.some(item=>item.name==='managed-proof')).toBe(true)
      const loaded=await context.skills.get('managed-proof');expect(loaded?.content).toContain('MANAGED_SKILL_PROOF')
      expect(loaded?.resourceBase?.kind).toBe('directory')
      const record=manager!.view().installed[0]!
      // Existing skills use the real registry too, without adopting files into managed state.
      const externalPath=join(dir,'existing-skill.md');writeFileSync(externalPath,'Existing skill file: do not modify')
      context.skills.registerProvider(()=>({name:'existing-local-skills',list:async options=>[
        {name:'already-installed',description:'Existing personal skill',provider:'existing-local-skills',source:'user-agents',path:externalPath,rank:100,locator:{},invocation:{modelInvocable:true,userInvocable:true}},
        ...(options.cwd?[{name:'workspace-only',description:'Workspace skill',provider:'existing-local-skills',source:'project-agents',path:join(options.cwd,'SKILL.md'),rank:100,locator:{},invocation:{modelInvocable:true,userInvocable:true}}]:[])
      ],get:async()=>undefined}))
      await manager!.refresh()
      expect(manager!.view().installed.find(item=>item.name==='already-installed')).toMatchObject({source:'personal',managed:false,status:'ready'})
      expect(manager!.view().installed.filter(item=>item.id===record.id)).toHaveLength(1)
      expect(manager!.view().installed.filter(item=>item.managed===false)).toHaveLength(1)
      const registry=context.skills,modeScope={},readerContext={
        skills:{list:async(options:{cwd?:string;scope?:object})=>[...await registry.list({cwd:options.cwd}),...(options.scope===modeScope?[{name:'default-mode-only',provider:'mode-fixture',source:'user-agents',description:'Visible in slash mode',invocation:{userInvocable:true,modelInvocable:true}}]:[])]},
        get:(key:string)=>key==='workspaceRegistry'?{list:()=>[{path:join(dir,'workspace')},{path:join(dir,'workspace')}]}:key==='agentPresets'?{acquireScope:async()=>({key:modeScope,async [Symbol.asyncDispose](){}})}:undefined
      }
      const reader=new EnterpriseResources(readerContext as unknown as Context,join(dir,'unused-reader'),{baseUrl,capability:'fixture-capability'})
      const discovered=await reader.refresh()
      expect(discovered.installed.filter(item=>item.name==='already-installed')).toHaveLength(1)
      expect(discovered.installed.find(item=>item.name==='workspace-only')).toMatchObject({source:'personal',managed:false})
      expect(discovered.installed.find(item=>item.name==='default-mode-only')).toMatchObject({source:'personal',managed:false})
      expect(readFileSync(externalPath,'utf8')).toBe('Existing skill file: do not modify')
      await expect(manager!.toggle(discovered.installed.find(item=>item.name==='already-installed')!.id,false)).rejects.toThrow('不存在')
      const stateFile=join(dir,'account-resources','records.json'),original=JSON.parse(readFileSync(stateFile,'utf8'))[0]
      expect(JSON.parse(readFileSync(stateFile,'utf8'))).toHaveLength(1)
      expect(readFileSync(join(dir,'account-resources',original.payload,'files/references/proof.txt'),'utf8')).toBe('Retained proof file')
      await expect(manager!.add({content:skill})).rejects.toThrow('同名')
      await manager!.toggle(record.id,false);expect(await context.skills.get('managed-proof')).toBeUndefined()
      await manager!.toggle(record.id,true);expect(await context.skills.get('managed-proof')).toBeDefined()
      authorized=false;await manager!.refresh();expect(await context.skills.get('managed-proof')).toBeUndefined();expect(manager!.view().installed[0]?.status).toBe('revoked')
      expect(readFileSync(join(dir,'account-resources',original.payload,'files/references/proof.txt'),'utf8')).toBe('Retained proof file')
      // Personal resources do not inherit enterprise resource grants.
      const personal=resourceContent({kind:'skill',files:[{path:'SKILL.md',data:Buffer.from('---\nname: personal-proof\ndescription: Personal\n---\nPERSONAL_PROOF').toString('base64')}]})
      await manager!.add({content:personal});expect((await context.skills.get('personal-proof'))?.content).toContain('PERSONAL_PROOF')
      await manager!.add({name:'Personal HTTP',content:{kind:'mcp',mcp:{url:baseUrl+'/remote',headers:{Authorization:'Bearer personal-fixture-key'}}}})
      await expect.poll(()=>manager!.view().installed.find(item=>item.name==='Personal HTTP')?.status,{timeout:10000}).toBe('ready')
      const http=manager!.view().installed.find(item=>item.name==='Personal HTTP')!,httpTool=http.tools[0]!
      expect(httpTool).toContain('__proof')
      const result=await context.tools.execute({name:httpTool,arguments:{},callId:ToolCallId('resource-http'),signal:new AbortController().signal})
      expect(result.isError).toBe(false);expect(result.content).toContainEqual({type:'text',text:'HTTP_MCP_PROOF'});expect(calls).toBe(1)
      await manager!.toggle(http.id,false);expect(context.tools.get(httpTool)).toBeUndefined()
      await manager!.add({name:'Personal stdio',content:{kind:'mcp',mcp:{command:process.execPath,args:[script],env:{FIXTURE_SECRET:'local-fixture-key'},cwd:dir}}})
      await expect.poll(()=>manager!.view().installed.find(item=>item.name==='Personal stdio')?.status,{timeout:15000}).toBe('ready')
      const stdio=manager!.view().installed.find(item=>item.name==='Personal stdio')!,stdioTool=stdio.tools[0]!
      const local=await context.tools.execute({name:stdioTool,arguments:{},callId:ToolCallId('resource-stdio'),signal:new AbortController().signal})
      expect(local.isError).toBe(false);expect(local.content).toContainEqual({type:'text',text:'STDIO_MCP_PROOF'})
      for(const entry of readdirSync(join(dir,'account-resources'),{withFileTypes:true}))if(entry.isDirectory()){
        const text=readFileSync(join(dir,'account-resources',entry.name,'content.json'),'utf8');expect(text).not.toContain('personal-fixture-key');expect(text).not.toContain('local-fixture-key')
      }
      await context.fiber.dispose();context=undefined
      expect(manager!.view().installed.some(item=>item.tools.includes(stdioTool))).toBe(false)
    }finally{if(context)await context.fiber.dispose();remote.closeAllConnections();await new Promise<void>(resolve=>remote.close(()=>resolve()))}
  },30000)
})
