/** Turn-owned evidence uses the public Chat tail and right Sidebar extension seats. */
import {useEffect,useRef,useState} from 'react'
import {BookOpen,ChevronRight,FileText,RefreshCw} from 'lucide-react'
import type {Context} from '@deepseek-ai/cordis'
import type {ChatFileMentions} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {MarkdownFileMentions} from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {PropsRuntime} from '@deepseek-ai/dsh-client-ui-slots'
import type {KnowledgeAnswerSources,KnowledgeSource} from 'dsh-enterprise-contracts'

const KIND='lets-knowledge-sources'
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightResourceParamsMap {'lets-knowledge-sources':{reference?:string}}
}
export interface AnswerCoordinates {sessionId:string;turn:number;seq:number}
export function knowledgeAnswerAddress({sessionId,turn,seq}:AnswerCoordinates):string{
  return `dsh-resource://lets-knowledge/session/${encodeURIComponent(sessionId)}/turn/${turn}/answer/${seq}`
}
export function parseKnowledgeAnswerAddress(address:string):AnswerCoordinates|undefined{
  const match=/^dsh-resource:\/\/lets-knowledge\/session\/([^/]+)\/turn\/(\d+)\/answer\/(\d+)$/u.exec(address)
  if(!match)return
  try{const sessionId=decodeURIComponent(match[1]!),turn=Number(match[2]),seq=Number(match[3]);if(!sessionId||sessionId.length>200||!Number.isSafeInteger(turn)||!Number.isSafeInteger(seq))return;return {sessionId,turn,seq}}catch{return}
}
export async function knowledgeAnswerApi({sessionId,turn,seq}:AnswerCoordinates,signal?:AbortSignal):Promise<KnowledgeAnswerSources>{
  const response=await fetch(`/api/desktop/knowledge?session=${encodeURIComponent(sessionId)}&turn=${turn}&seq=${seq}`,{credentials:'same-origin',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)})
  if(!response.ok)throw new Error('暂时无法读取这条回答的来源，请重试。')
  return response.json() as Promise<KnowledgeAnswerSources>
}
function useAnswerSources(coordinates:AnswerCoordinates,enabled=true){
  const {sessionId,turn,seq}=coordinates,key=JSON.stringify([sessionId,turn,seq])
  const [state,setState]=useState<{key:string;data:KnowledgeAnswerSources|null;error:string}>({key,data:null,error:''}),[revision,reload]=useState(0)
  useEffect(()=>{const controller=new AbortController();setState({key,data:null,error:''});if(!enabled)return()=>controller.abort();void knowledgeAnswerApi({sessionId,turn,seq},controller.signal).then(data=>{if(!controller.signal.aborted)setState({key,data,error:''})}).catch(e=>{if(!controller.signal.aborted)setState({key,data:null,error:e instanceof Error?e.message:'读取失败'})});return()=>controller.abort()},[key,sessionId,turn,seq,revision,enabled])
  return {...(state.key===key?state:{key,data:null,error:''}),retry:()=>reload(n=>n+1)}
}
export interface SourceDocument {key:string;title:string;knowledgeBaseName:string;sources:KnowledgeSource[];cited:boolean}
export function groupKnowledgeSources(data:KnowledgeAnswerSources):SourceDocument[]{
  const documents=new Map<string,SourceDocument>()
  for(const s of data.sources){const key=JSON.stringify([s.knowledgeBaseId,s.documentId]);let doc=documents.get(key);if(!doc){doc={key,title:s.title,knowledgeBaseName:s.knowledgeBaseName,sources:[],cited:false};documents.set(key,doc)}doc.sources.push(s);doc.cited ||= data.citedReferences.includes(s.reference)}
  return [...documents.values()].sort((a,b)=>Number(b.cited)-Number(a.cited))
}
/** Use the Markdown renderer's explicit opener vocabulary, never rewrite stored text or HTML. */
export function knowledgeCitationMentions(data:KnowledgeAnswerSources|null,open:(reference:string)=>void,fallback?:MarkdownFileMentions):MarkdownFileMentions{
  return {resolve(value){const match=/^\[(知识来源[1-8])\]$/u.exec(value),s=match?data?.sources.find(s=>s.reference===match[1]):undefined;return s?{label:`查看${s.reference}：${s.title}`,title:`${s.knowledgeBaseName} · ${s.title}`,open:()=>open(s.reference)}:fallback?.resolve(value)}}
}
/** Compose the public opener service; never shadow a renderer that owns child Slots. */
export function decorateKnowledgeFileMentions(provider:ChatFileMentions,openSources:(coordinates:AnswerCoordinates,reference?:string)=>void):()=>void{
  const original=provider.forClosing
  const wrapped:ChatFileMentions['forClosing']=function(owner,sessionId){
    const fallback=original.call(provider,owner,sessionId)
    const coordinates={sessionId,turn:owner.turn.turn,seq:owner.seq}
    return {resolve(value){
      const match=/^\[(知识来源[1-8])\]$/u.exec(value)
      // Citation text never supplies a URL or file path. Opening uses only the
      // authenticated answer coordinates; the source pane verifies saved evidence.
      return match?{label:`查看${match[1]}`,title:`查看本轮回答的${match[1]}`,open:()=>openSources(coordinates,match[1])}:fallback?.resolve(value)
    }}
  }
  provider.forClosing=wrapped
  return()=>{if(provider.forClosing===wrapped)provider.forClosing=original}
}
interface TailProps extends Pick<PropsRuntime<'conversation.chat.turnTail'>,'sessionId'|'turn'|'seq'> {
  openSources:(coordinates:AnswerCoordinates,reference?:string)=>void
}
export function KnowledgeAnswerTail({sessionId,turn,seq,openSources}:TailProps){
  const coordinates={sessionId,turn:turn.turn,seq},{data,error,retry}=useAnswerSources(coordinates)
  if(error)return <div className="lets-kb-surface lets-kb-answer"><span>{error}</span><button type="button" className="lets-kb-text-button" onClick={retry}>重试来源</button></div>
  if(!data?.sources.length)return null
  const docs=groupKnowledgeSources(data)
  return <section className="lets-kb-surface lets-kb-answer" aria-label={`第 ${turn.turn} 轮回答的检索来源`}>
    <header><BookOpen size={15} aria-hidden="true"/><span>检索资料</span><small>{data.legacy?`${data.sources.length} 处历史片段`:`${docs.length} 份文档 · ${data.sources.length} 处片段`}</small><button type="button" className="lets-kb-text-button" onClick={()=>openSources(coordinates)}>查看来源<ChevronRight size={13} aria-hidden="true"/></button></header>
    <div className="lets-kb-answer-documents">{docs.slice(0,3).map(doc=><button type="button" key={doc.key} title={`${doc.knowledgeBaseName} · ${doc.title}`} onClick={()=>openSources(coordinates,doc.sources.find(s=>data.citedReferences.includes(s.reference))?.reference??doc.sources[0]!.reference)}><FileText size={14} aria-hidden="true"/><span>{doc.title}</span>{doc.cited&&<small>回答已标注</small>}</button>)}</div>
    {data.citedReferences.length>0?<div className="lets-kb-answer-citations"><span>回答标注</span>{data.citedReferences.map(reference=><button type="button" key={reference} onClick={()=>openSources(coordinates,reference)}>[{reference}]</button>)}</div>:<p>以上为本轮检索结果，回答未标注具体来源。</p>}
  </section>
}
export function KnowledgeSourceDetails({coordinates,reference='',onClose}:{coordinates:AnswerCoordinates;reference?:string;onClose?:()=>void}){
  const {data,error,retry}=useAnswerSources(coordinates),content=useRef<HTMLDivElement>(null)
  useEffect(()=>{if(!data||!reference)return;const target=[...content.current?.querySelectorAll<HTMLElement>('[data-reference]')??[]].find(node=>node.dataset.reference===reference);if(target){for(let parent=target.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement)parent.open=true;target.scrollIntoView?.({block:'nearest'});target.focus({preventScroll:true})}},[data,reference])
  const docs=data?groupKnowledgeSources(data):[]
  return <section className="lets-kb-surface lets-kb-evidence" aria-label="回答来源详情" ref={content}>
    <header className="lets-kb-evidence-heading"><BookOpen size={18} aria-hidden="true"/><div><h2>回答来源</h2><p>第 {coordinates.turn} 轮 · {data?`${docs.length} 个文档分组 · ${data.sources.length} 处片段`:'正在读取…'}</p></div>{onClose&&<button type="button" className="lets-kb-text-button" onClick={onClose}>关闭</button>}</header>
    {error?<div role="alert" className="lets-kb-error"><p>{error}</p><button type="button" className="lets-kb-text-button" onClick={retry}><RefreshCw size={13} aria-hidden="true"/> 重试</button></div>:data?<>
      <p className="lets-kb-caption">“回答已标注”只表示回答包含对应来源标记，不代表资料内容已经人工核实。</p>
      {data.legacy&&<p className="lets-kb-caption">历史记录未保存文档标识，片段独立展示，不按同名文档合并。</p>}
      {!docs.length&&<p className="lets-kb-empty">这条回答没有可用的知识库来源。</p>}
      {!!reference&&data.sources.length>0&&!data.sources.some(s=>s.reference===reference)&&<p role="status" className="lets-kb-caption">这条回答未保存该来源，以下仅展示本轮实际检索到的资料。</p>}
      {docs.map(doc=><details className="lets-kb-document" key={doc.key} open={doc.cited||!!reference&&doc.sources.some(s=>s.reference===reference)}>
        <summary><FileText size={17} aria-hidden="true"/><span><strong>{doc.title}</strong><small>{doc.knowledgeBaseName} · {doc.sources.length} 处片段</small></span><em>{doc.cited?'回答已标注':'其他检索资料'}</em></summary>
        {doc.sources.map(s=><article className="lets-kb-passage" key={`${s.reference}-${s.chunkId}`} data-reference={s.reference} data-highlighted={s.reference===reference} tabIndex={-1}><header><strong>[{s.reference}]</strong><span>{data.citedReferences.includes(s.reference)?'回答已标注':'未标注'}</span></header><p>{s.content}</p></article>)}
      </details>)}
    </>:<p className="lets-kb-empty" role="status">正在读取这条回答的来源…</p>}
  </section>
}
function KnowledgeSourcesTab({sessionId,useTabInfo}:Pick<PropsRuntime<'sidebar.right.pane.tab'>,'sessionId'|'useTabInfo'>){
  const info=useTabInfo(),coordinates=parseKnowledgeAnswerAddress(info.tab.contentId),params=info.tab.navigation.params as {reference?:unknown}|undefined
  if(!coordinates||coordinates.sessionId!==sessionId)return <p role="alert">来源不属于当前会话。</p>
  return <KnowledgeSourceDetails key={info.tab.contentId} coordinates={coordinates} reference={typeof params?.reference==='string'?params.reference:''} onClose={()=>info.tab.actions.close()}/>
}
export function installKnowledgeAnswers(ctx:Context):void{
  ctx.inject(['sidebarRight','sidebarRightTabs','chatFileMentions'],ctx=>{
    const openSources=(coordinates:AnswerCoordinates,reference?:string)=>ctx.sidebarRight.openResource(knowledgeAnswerAddress(coordinates),{params:reference?{reference}:{}})
    ctx.effect(()=>ctx.sidebarRightTabs.register({id:KIND,kind:KIND,patterns:['dsh-resource://lets-knowledge/**'],canOpen:address=>parseKnowledgeAnswerAddress(address)!==undefined,title:address=>`来源 · 第 ${parseKnowledgeAnswerAddress(address)?.turn??''} 轮`}), 'enterprise: knowledge source tab type')
    ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:KIND},KnowledgeSourcesTab))
    ctx.effect(()=>decorateKnowledgeFileMentions(ctx.chatFileMentions,openSources),'enterprise: answer citation openers')
    ctx.slots.inject('conversation.chat.turnTail',()=>ctx.slots.register({name:'conversation.chat.turnTail',id:KIND,order:20,inject:()=>({openSources})},KnowledgeAnswerTail))
  })
}
