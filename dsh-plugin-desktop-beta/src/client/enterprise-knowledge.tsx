import {useEffect,useId,useRef,useState} from 'react'
import {BookOpen,ChevronDown,RefreshCw,Search,X} from 'lucide-react'
import {Popover} from '@base-ui/react/popover'
import type {Context} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {PropsRuntime} from '@deepseek-ai/dsh-client-ui-slots'
import type {KnowledgeSelectionView} from 'dsh-enterprise-contracts'
import type {EnterpriseApplicationsBridge} from '../enterprise-applications-contract.ts'
import {enterpriseKnowledgeStyles} from './enterprise-knowledge-styles.ts'
import {installKnowledgeAnswers} from './enterprise-knowledge-answers.tsx'

// The desktop-owned PPT patch exposes this cross-version seat at runtime; pinned upstream typings predate it.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {'conversation.hero.modeActions':{kind:'list';scope:'session-maybe'}}
}

export async function knowledgeApi(session:string,selectedIds?:string[]):Promise<KnowledgeSelectionView>{
  const response=await fetch(`/api/desktop/knowledge?session=${encodeURIComponent(session)}`,{credentials:'same-origin',cache:'no-store',method:selectedIds===undefined?'GET':'POST',headers:selectedIds===undefined?{}:{'Content-Type':'application/json'},...(selectedIds===undefined?{}:{body:JSON.stringify({selectedIds})}),signal:AbortSignal.timeout(45000)})
  if(!response.ok)throw new Error('知识库服务或授权不可用，请检查连接后重试。')
  return response.json() as Promise<KnowledgeSelectionView>
}
export function KnowledgePicker({sessionId='new',expanded=false}:{sessionId?:string;expanded?:boolean}){
  const [view,setView]=useState<KnowledgeSelectionView|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [search,setSearch]=useState(''),[refreshing,setRefreshing]=useState(false)
  const id=useId(),searchInput=useRef<HTMLInputElement>(null)
  const alive=useRef(true),generation=useRef(0),mutating=useRef(false)
  async function refresh(foreground=false){if(mutating.current)return;const stamp=++generation.current;if(foreground)setRefreshing(true);try{const data=await knowledgeApi(sessionId);if(alive.current&&stamp===generation.current){setView(data);setError('')}}catch(e){if(alive.current&&stamp===generation.current)setError(e instanceof Error?e.message:'读取失败')}finally{if(alive.current&&(stamp===generation.current||foreground))setRefreshing(false)}}
  useEffect(()=>{alive.current=true;setView(null);setError('');setSearch('');void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!mutating.current)void refresh()},15000);return()=>{alive.current=false;generation.current++;clearInterval(timer)}},[sessionId])
  async function choose(ids:string[]){if(mutating.current)return;mutating.current=true;const previous=view,stamp=++generation.current;setView(current=>current?{...current,selectedIds:ids}:current);setBusy(true);setError('');try{const data=await knowledgeApi(sessionId,ids);if(alive.current&&stamp===generation.current)setView(data)}catch(e){if(alive.current&&stamp===generation.current){setView(previous);setError(e instanceof Error?e.message:'保存失败')}}finally{mutating.current=false;if(alive.current)setBusy(false)}}
  const count=view?.selectedIds.length??0,shown=view?.catalog.filter(k=>`${k.name} ${k.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))??[]
  const selectedNames=view?.selectedIds.map(key=>view.catalog.find(k=>k.id===key)?.name??'已失效知识库').join('、')??''
  const controls=<>
    {error&&<div role="alert" className="lets-kb-error"><p>{error}</p><button type="button" className="lets-kb-text-button" disabled={busy||refreshing} onClick={()=>void refresh(true)}>重试</button></div>}
    {sessionId==='new'&&<p className="lets-kb-caption">请先选择工作区，再为本会话选择知识库。</p>}
    <div role="group" id={`${id}-content`} aria-label="选择知识库">
        <label className="lets-kb-search"><Search size={14} aria-hidden="true"/><input ref={searchInput} type="search" aria-label="搜索知识库" placeholder="搜索知识库" value={search} onChange={e=>setSearch(e.target.value)}/></label>
        <div className="lets-kb-list">{shown.map(k=>{const checked=view!.selectedIds.includes(k.id),disabled=sessionId==='new'||busy||count>=3&&!checked;return <label className="lets-kb-choice" data-selected={checked} data-disabled={disabled} key={k.id}>
          <span className="lets-kb-book"><BookOpen size={18} aria-hidden="true"/></span><span className="lets-kb-choice-label"><strong>{k.name}</strong>{k.description&&<small title={k.description}>{k.description}</small>}</span>
          <input type="checkbox" aria-label={k.name} checked={checked} disabled={disabled} onChange={e=>void choose(e.target.checked?[...view!.selectedIds,k.id]:view!.selectedIds.filter(key=>key!==k.id))}/>
        </label>})}{!shown.length&&<div className="lets-kb-empty"><BookOpen size={24} aria-hidden="true"/><p>{!view&&!error?'正在读取知识库…':search?'没有匹配的知识库':'暂无获准使用的知识库'}</p>{search?<button type="button" className="lets-kb-text-button" onClick={()=>setSearch('')}>清空搜索</button>:view&&!view.catalog.length&&<p>请联系管理员绑定并授权。</p>}</div>}</div>
        {view?.selectedIds.some(key=>!view.catalog.some(k=>k.id===key))&&<div role="alert" className="lets-kb-error"><p>部分已选知识库已失去授权。</p><button type="button" className="lets-kb-text-button" disabled={busy} onClick={()=>void choose(view.selectedIds.filter(key=>view.catalog.some(k=>k.id===key)))}>移除失效选择</button></div>}
    </div>
    <footer className="lets-kb-footer"><span role="status" aria-live="polite">{busy?'正在保存选择…':refreshing?'正在刷新…':count?`已选 ${count}/3 · 用于后续提问`:'未选择 · 普通对话'}</span>{count>0&&<button type="button" className="lets-kb-text-button" disabled={busy||refreshing} onClick={()=>void choose([])}>清空选择</button>}</footer>
  </>
  const refreshButton=<button type="button" className="lets-kb-icon-button" aria-label="刷新知识库" title="刷新知识库" disabled={busy||refreshing} onClick={()=>void refresh(true)}><RefreshCw size={14} aria-hidden="true"/></button>
  if(expanded)return <section className="lets-kb-surface lets-kb-page" aria-label="本会话知识库选择"><header className="lets-kb-page-header"><span><BookOpen size={22} aria-hidden="true"/></span><div><h1>企业知识库</h1><p>为本会话选择参考资料，让回答有据可查。</p></div></header><div className="lets-kb-page-card"><header className="lets-kb-heading"><h2>选择知识库</h2>{refreshButton}</header><p className="lets-kb-caption">每个新会话开始时不选择任何库，由你自行选择，最多 3 个。</p>{controls}</div></section>
  return <section className="lets-kb-surface lets-kb-inline" aria-label="本会话知识库"><Popover.Root onOpenChange={open=>{if(open&&!mutating.current)void refresh()}}>
    <Popover.Trigger className="lets-kb-trigger" data-selected={count>0} title={error?'知识库暂不可用，点击重试':count?`已选择：${selectedNames}`:'选择知识库，为回答添加参考资料'} aria-label={`知识库${count?`，已选 ${count} 个`:''}`}>
      <BookOpen size={15} aria-hidden="true"/><span>知识库</span>{count>0&&<span className="lets-kb-count">{count}</span>}{error&&<span className="lets-kb-alert-dot" aria-hidden="true"/>}<ChevronDown className="lets-kb-chevron" size={12} aria-hidden="true"/>
    </Popover.Trigger>
    <Popover.Portal><Popover.Positioner className="lets-kb-positioner" side="bottom" align="start" sideOffset={8} collisionPadding={12}><Popover.Popup className="lets-kb-surface lets-kb-popup" initialFocus={searchInput}>
      <header className="lets-kb-heading"><Popover.Title>知识库</Popover.Title>{refreshButton}<Popover.Close className="lets-kb-icon-button" aria-label="关闭知识库选择"><X size={15} aria-hidden="true"/></Popover.Close></header>
      <Popover.Description className="lets-kb-caption">选择参考资料，提问时自动检索。最多选 3 个。</Popover.Description>{controls}
    </Popover.Popup></Popover.Positioner></Popover.Portal>
  </Popover.Root></section>
}
export function HeroKnowledgeAction({sessionId}:Pick<PropsRuntime<'conversation.hero.modeActions'>,'sessionId'>){return <KnowledgePicker key={sessionId??'new'} sessionId={sessionId??'new'}/>}
export function ActiveKnowledgeAction({sessionId,useSession}:Pick<PropsRuntime<'conversation.input.left'>,'sessionId'|'useSession'>){const blank=useSession(session=>session.blank);return blank?null:<KnowledgePicker key={sessionId} sessionId={sessionId}/>}
export function applyEnterpriseKnowledge(ctx:Context):void{
  const bridge=(window as Window&{letsEnterpriseApplications?:EnterpriseApplicationsBridge}).letsEnterpriseApplications
  if(!bridge)return
  ctx.inject(['layout'],ctx=>{ctx.effect(()=>{let alive=true;void bridge.invoke({action:'capabilities'}).then(reply=>{
    if(!alive||!reply.ok||!reply.enabled)return
    ctx.effect(()=>{const node=document.createElement('style');node.textContent=enterpriseKnowledgeStyles;document.head.append(node);return()=>node.remove()},'enterprise: knowledge styles')
    installKnowledgeAnswers(ctx)
    ctx.slots.inject('conversation.hero.modeActions',()=>ctx.slots.register({name:'conversation.hero.modeActions',id:'lets-knowledge',order:30,inject:()=>({})},HeroKnowledgeAction))
    ctx.slots.inject('conversation.input.left',()=>ctx.slots.register({name:'conversation.input.left',id:'lets-knowledge',order:30,inject:()=>({})},ActiveKnowledgeAction))
  }).catch(()=>{});return()=>{alive=false}},'enterprise: knowledge picker')})
}
