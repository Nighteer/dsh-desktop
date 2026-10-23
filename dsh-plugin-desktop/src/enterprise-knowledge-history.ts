/** Read-only reconstruction from the account's durable transcript, including forked history. */
import type {SessionEvent} from '@deepseek-ai/dsh-session'
import type {KnowledgeAnswerSources,KnowledgeSearchResult,KnowledgeSource} from 'dsh-enterprise-contracts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'lets-enterprise-knowledge': {kind:'lets-enterprise-knowledge';form:'recall'}
    /** Read-only support for transcripts written by the previous Desktop runtime. */
    plugin: {kind:'plugin';plugin:string;form?:'recall'}
  }
}

export const KNOWLEDGE_CONTEXT_PREFIX='LETS_KNOWLEDGE_SOURCES_V1\n'
export function storedKnowledgeContext(result:KnowledgeSearchResult):string{
  return KNOWLEDGE_CONTEXT_PREFIX+JSON.stringify({version:1,sources:result.sources})
}
function source(value:unknown):value is KnowledgeSource{
  if(!value||typeof value!=='object')return false
  const s=value as Record<string,unknown>
  return ['reference','knowledgeBaseId','knowledgeBaseName','documentId','title','chunkId','content'].every(k=>typeof s[k]==='string'&&(s[k] as string).length<=12000)
    &&typeof s.reference==='string'&&/^知识来源[1-8]$/u.test(s.reference)&&(s.score===null||typeof s.score==='number'&&Number.isFinite(s.score))
}
function readContext(text:string):{sources:KnowledgeSource[];legacy:boolean}|undefined{
  try{
    const marker=text.indexOf(KNOWLEDGE_CONTEXT_PREFIX)
    if(marker>=0){
      const parsed=JSON.parse(text.slice(marker+KNOWLEDGE_CONTEXT_PREFIX.length)) as {version?:unknown;sources?:unknown}
      if(parsed.version!==1||!Array.isArray(parsed.sources)||parsed.sources.length>8||!parsed.sources.every(source))return
      if(new Set(parsed.sources.map(s=>s.reference)).size!==parsed.sources.length)return
      return {sources:parsed.sources,legacy:false}
    }
    // Earlier releases saved the actual passages but not document/KB identities.
    const start=text.indexOf('\n[');if(start<0)return
    const parsed:unknown=JSON.parse(text.slice(start+1));if(!Array.isArray(parsed)||parsed.length>8)return
    const sources:KnowledgeSource[]=[]
    for(const [index,item] of parsed.entries()){
      if(!item||typeof item!=='object')return
      const s=item as Record<string,unknown>
      if(!['reference','knowledgeBase','title','chunk','content'].every(k=>typeof s[k]==='string'&&(s[k] as string).length<=12000)||!/^知识来源[1-8]$/u.test(s.reference as string))return
      // Never merge old passages solely because document titles happen to match.
      sources.push({reference:s.reference as string,knowledgeBaseId:'legacy',knowledgeBaseName:s.knowledgeBase as string,documentId:`legacy-${index}`,title:s.title as string,chunkId:s.chunk as string,content:s.content as string,score:null})
    }
    return {sources,legacy:true}
  }catch{return}
}
export function answerKnowledgeSources(events:readonly SessionEvent[],turn:number,seq:number):KnowledgeAnswerSources{
  const empty:KnowledgeAnswerSources={sources:[],citedReferences:[],legacy:false}
  const answer=events.find(e=>e.seq===seq)
  if(answer?.type!=='assistant/message'||answer.data.turn!==turn||answer.surfaceOp!=='append')return empty
  let current:number|undefined,evidence:ReturnType<typeof readContext>
  for(const event of events){
    if(event.seq>seq)break
    if(event.type==='turn/start'){current=event.data.turn;evidence=undefined}
    if(current!==turn||event.type!=='user/message'||event.surfaceOp!=='append')continue
    if(event.data.source.kind!=='lets-enterprise-knowledge'&&(event.data.source.kind!=='plugin'||event.data.source.plugin!=='lets-enterprise-knowledge'))continue
    const text=event.data.content.filter(b=>b.type==='text').map(b=>b.text).join('\n')
    evidence=readContext(text)
  }
  if(current!==turn||!evidence)return empty
  const text=answer.data.message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n')
  const citedReferences=evidence.sources.filter(s=>text.includes(`[${s.reference}]`)).map(s=>s.reference)
  return {...evidence,citedReferences}
}
