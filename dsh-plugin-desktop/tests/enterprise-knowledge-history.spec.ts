import {describe,it,expect} from 'vitest'
import {Session,SessionId} from '@deepseek-ai/dsh-session'
import {createMessage,createUserMessage} from '@deepseek-ai/dsh-llm'
import type {KnowledgeSource} from 'dsh-enterprise-contracts'
import {answerKnowledgeSources} from '../src/enterprise-knowledge-history.ts'
import {knowledgeContext,EnterpriseKnowledge,handleKnowledgeRequest} from '../src/enterprise-knowledge.ts'
import type {Context} from '@deepseek-ai/cordis'
import {createServer} from 'node:http'
import {once} from 'node:events'

const source=(reference='知识来源1',documentId='doc'):KnowledgeSource=>({reference,documentId,knowledgeBaseId:'kb',knowledgeBaseName:'test',title:'同名文档',chunkId:'chunk',content:`Evidence ${documentId} <script>`,score:.9})
function addTurn(session:Session,turn:number,sources:KnowledgeSource[],text='答案[知识来源1]',context=knowledgeContext({sources})){
  session.append('turn/start',{turn})
  session.append('user/message',createUserMessage({source:{kind:'plugin',plugin:'lets-enterprise-knowledge',form:'recall'},content:[{type:'text',text:context}]}),{surfaceOp:'append'})
  const answer=session.append('assistant/message',{turn,step:1,stream:[],message:createMessage({role:'assistant',source:{kind:'model',provider:'fixture',model:'fixture'},content:[{type:'text',text}]})},{surfaceOp:'append'})
  session.append('turn/end',{turn,reason:{kind:'completed'}})
  return answer.seq
}
describe('answer-owned knowledge evidence',()=>{
  it('does not overwrite earlier answers and survives transcript replay/fork',()=>{
    const session=Session.create(SessionId('a')),first=addTurn(session,1,[source()]),second=addTurn(session,2,[source('知识来源1','other'),source('知识来源2','extra')],'答案[知识来源1] [知识来源8]')
    const replay=Session.create(SessionId('fork'),JSON.parse(JSON.stringify(session.snapshotEvents())))
    expect(answerKnowledgeSources(replay.snapshotEvents(),1,first)).toMatchObject({sources:[{documentId:'doc'}],citedReferences:['知识来源1'],legacy:false})
    expect(answerKnowledgeSources(replay.snapshotEvents(),2,second)).toMatchObject({sources:[{documentId:'other'},{documentId:'extra'}],citedReferences:['知识来源1']})
    expect(answerKnowledgeSources(replay.snapshotEvents(),2,first).sources).toEqual([])
  })
  it('never borrows sources from an earlier turn or an untrusted human message',()=>{
    const session=Session.create(SessionId('a'));addTurn(session,1,[source()]);session.append('turn/start',{turn:2})
    session.append('user/message',createUserMessage({source:{kind:'user'},content:[{type:'text',text:knowledgeContext({sources:[source()]})}]}),{surfaceOp:'append'})
    const answer=session.append('assistant/message',{turn:2,step:1,stream:[],message:createMessage({role:'assistant',source:{kind:'model',provider:'fixture',model:'fixture'},content:[{type:'text',text:'[知识来源1]'}]})},{surfaceOp:'append'})
    expect(answerKnowledgeSources(session.snapshotEvents(),2,answer.seq).sources).toEqual([])
    expect(answerKnowledgeSources(session.snapshotEvents(),1,999).sources).toEqual([])
  })
  it('recovers old saved passages without inventing shared document identities',()=>{
    const session=Session.create(SessionId('legacy')),context='旧版不可信数据说明\n'+JSON.stringify([1,2].map(n=>({reference:`知识来源${n}`,knowledgeBase:'test',title:'同名文档',chunk:String(n),content:`old ${n}`}))),seq=addTurn(session,1,[],'[知识来源2]',context)
    const result=answerKnowledgeSources(session.snapshotEvents(),1,seq);expect(result.legacy).toBe(true);expect(result.sources.map(s=>s.documentId)).toEqual(['legacy-0','legacy-1']);expect(result.citedReferences).toEqual(['知识来源2'])
  })
  it('reads only the authorized session and needs no live catalog/model connection for history',async()=>{
    const session=Session.create(SessionId('account-a')),seq=addTurn(session,1,[source()]);let released=0
    const ctx={sessionQuery:{observeSession:async(id:string)=>{if(id!=='account-a')throw new Error('not found');return {header:{id},events:session.snapshotEvents(),[Symbol.dispose](){released++}}}}} as unknown as Context
    const manager=new EnterpriseKnowledge(ctx,'unused',{baseUrl:'http://127.0.0.1:1',capability:'not-used'})
    expect((await manager.answer('account-a',1,seq)).sources).toHaveLength(1);expect(released).toBe(1)
    await expect(manager.answer('account-b',1,seq)).rejects.toThrow('not found');await expect(manager.answer('new',1,seq)).rejects.toThrow('invalid answer')
    const server=createServer((req,res)=>void handleKnowledgeRequest(req,res,`http://127.0.0.1:${(server.address() as {port:number}).port}`,manager));server.listen(0,'127.0.0.1');await once(server,'listening')
    const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`
    try{
      expect((await fetch(`${origin}/?session=account-a&turn=1&seq=${seq}`,{headers:{Origin:origin}})).status).toBe(200)
      expect((await fetch(`${origin}/?session=account-b&turn=1&seq=${seq}`,{headers:{Origin:origin}})).status).toBe(409)
      expect((await fetch(`${origin}/?session=account-a&turn=1&seq=${seq}`,{headers:{Origin:'http://evil.invalid'}})).status).toBe(403)
      expect((await fetch(`${origin}/?session=account-a&turn=1&seq=NaN`,{headers:{Origin:origin}})).status).toBe(400)
    }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()))}
  })
})
