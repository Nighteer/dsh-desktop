import {useEffect,useRef,useState} from 'react'
import type {Context as ClientContext} from '@deepseek-ai/cordis'
import type {MainPanelId} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {SidebarPanelIconOwnerProps} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {AvailableApplication,ApplicationIcon} from 'dsh-enterprise-contracts'
import type {EnterpriseApplicationsBridge,EnterpriseApplicationViewState} from '../enterprise-applications-contract.ts'
import {enterpriseApplicationsStyles} from './enterprise-applications-styles.ts'
import {ArrowLeft,ArrowRight,ArrowUpRight,RefreshCw,X,ShieldCheck,Info,Search,Globe2} from 'lucide-react'
import {ModuleHeader,ModuleSearch,ModuleEmpty,ModuleLoading,ModuleBadge} from './module-ui.tsx'

export const ENTERPRISE_APPLICATIONS_PANEL='lets-enterprise-applications' as MainPanelId
const empty:EnterpriseApplicationViewState={id:null,name:'',loading:false,canGoBack:false,canGoForward:false,error:'',notice:''}
type Scope=Window&{letsEnterpriseApplications?:EnterpriseApplicationsBridge}
export function EnterpriseApplicationIcon({size=20,kind='globe'}:{size?:number;kind?:ApplicationIcon}){
  const paths:Record<ApplicationIcon,string>={globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c4 5 4 13 0 18-4-5-4-13 0-18Z',contract:'M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6M9 16h6',knowledge:'M3 4h6l3 2 3-2h6v15h-6l-3 2-3-2H3V4Zm9 2v15',tool:'m14 3 7 7-4 4-3-3-8 9-3-3 9-8-3-3 5-3Z'}
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d={paths[kind]}/></svg>
}
function PanelIcon({size}:SidebarPanelIconOwnerProps){return <EnterpriseApplicationIcon size={size}/>}
interface PanelProps {bridge:EnterpriseApplicationsBridge;backToChat:()=>void}
export function EnterpriseApplicationsPanel({bridge,backToChat}:PanelProps){
  const [items,setItems]=useState<AvailableApplication[]>([]),[state,setState]=useState(empty),[catalog,setCatalog]=useState(true),[search,setSearch]=useState('')
  const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [category,setCategory]=useState<ApplicationIcon|'all'>('all')
  const viewport=useRef<HTMLDivElement>(null),currentId=useRef<string|null>(null),inFlight=useRef(false),reading=useRef(false)
  async function invoke(action:Parameters<EnterpriseApplicationsBridge['invoke']>[0]){const result=await bridge.invoke(action);if(!result.ok)throw new Error(result.error);return result}
  function accept(next:EnterpriseApplicationViewState){if(next.id!==currentId.current){setCatalog(!next.id);currentId.current=next.id}setState(next)}
  async function refresh(quiet=false){
    if(inFlight.current||reading.current)return;reading.current=true;if(!quiet)setLoading(true);setError('')
    try{const result=await invoke({action:'list'});setItems(result.applications??[])}catch(e){setError(e instanceof Error?e.message:'应用加载失败，请重试')}finally{if(!quiet)setLoading(false);reading.current=false}
  }
  useEffect(()=>{
    let alive=true
    void invoke({action:'state'}).then(result=>{if(alive&&result.state)accept(result.state)}).catch(e=>{if(alive)setError(e.message)})
    void refresh()
    const off=bridge.subscribe?.(event=>{if(event.type==='state'&&alive)accept(event.state)})
    const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh(true)},30000)
    return()=>{alive=false;clearInterval(timer);off?.();void bridge.invoke({action:'viewport',bounds:null}).catch(()=>{})}
  },[bridge])
  useEffect(()=>{
    const element=viewport.current
    if(!element||catalog||!state.id||state.error){void bridge.invoke({action:'viewport',bounds:null}).catch(()=>{});return}
    let frame=0,last=''
    const update=()=>{
      frame=0
      const obstructed=[...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"]')].some(node=>{const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0})
      const rect=element.getBoundingClientRect(),bounds=document.visibilityState==='visible'&&!obstructed?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null
      const key=JSON.stringify(bounds);if(key===last)return;last=key
      void bridge.invoke({action:'viewport',bounds}).catch(()=>{})
    }
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update)}
    const resize=new ResizeObserver(schedule);resize.observe(element)
    const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','open','hidden']})
    window.addEventListener('resize',schedule);document.addEventListener('visibilitychange',schedule);schedule()
    return()=>{resize.disconnect();observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);document.removeEventListener('visibilitychange',schedule);void bridge.invoke({action:'viewport',bounds:null}).catch(()=>{})}
  },[bridge,catalog,state.id,state.error])
  async function open(item:AvailableApplication){
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('')
    try{const result=await invoke({action:'open',id:item.id});if(result.state){accept(result.state);if(result.state.id===item.id)setCatalog(false)}}catch(e){setError(e instanceof Error?e.message:'打开失败，请重试')}finally{setBusy(false);inFlight.current=false}
  }
  async function control(command:'back'|'forward'|'reload'|'close'){
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('')
    try{const result=await invoke({action:'control',command});if(result.state)accept(result.state)}catch(e){setError(e instanceof Error?e.message:'操作失败，请重试')}finally{setBusy(false);inFlight.current=false}
  }
  const shown=items.filter(item=>(category==='all'||item.icon===category)&&`${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase()))
  const categories:{key:ApplicationIcon|'all';name:string}[]=[{key:'all',name:'全部应用'},{key:'contract',name:'合同应用'},{key:'knowledge',name:'知识服务'},{key:'tool',name:'效率工具'},{key:'globe',name:'网页应用'}]
  return <section className="lets-enterprise-page lets-applications-page lets-module" data-view={catalog?'catalog':'browser'} aria-label="企业应用工作区">
    <div className={catalog?'lets-module-content':undefined}><ModuleHeader title={catalog?'企业应用':state.name} description={catalog?'常用业务，一处直达。企业授权的应用直接在桌面内使用。':'企业应用 · 独立网页会话'} icon={<Globe2 size={29}/>} actions={<>{!catalog&&<button onClick={()=>setCatalog(true)}><ArrowLeft size={15} aria-hidden="true"/>返回应用列表</button>}<button className="lets-module-ghost" onClick={backToChat}>返回聊天<ArrowRight size={15} aria-hidden="true"/></button></>}/></div>
    {(error||state.error)&&<div className="lets-enterprise-error lets-module-alert" role="alert">{error||state.error} <button disabled={busy||loading} onClick={()=>state.id?void control('reload'):void refresh()}>重试</button></div>}
    {state.notice&&<p className="lets-enterprise-notice lets-module-info" role="status"><Info size={16} aria-hidden="true"/>{state.notice}</p>}
    {catalog?<div className="lets-enterprise-catalog lets-module-content"><div className="lets-module-overview"><span><ShieldCheck size={16} aria-hidden="true"/>企业授权，按需使用</span><span><strong>{items.length}</strong> 个可用应用</span><span className="lets-module-overview-note">在桌面内打开 · 账号隔离</span></div><div className="lets-module-toolbar"><ModuleSearch label="搜索应用" value={search} onChange={setSearch} placeholder="搜索应用名称或用途"/><span className="lets-module-result-count">{shown.length} 个匹配</span><button disabled={loading||busy} onClick={()=>void refresh()}><RefreshCw size={15} aria-hidden="true"/>刷新应用</button></div>
      <div className="lets-application-types" role="group" aria-label="应用分类">{categories.map(item=><button key={item.key} aria-pressed={category===item.key} onClick={()=>setCategory(item.key)}>{item.name}</button>)}</div>
      {state.id&&<div className="lets-module-info"><Info size={16} aria-hidden="true"/><span>上次打开的应用仍在当前工作区。</span><button disabled={busy} onClick={()=>{const item=items.find(item=>item.id===state.id);if(item)void open(item)}}>继续使用：{state.name}<ArrowRight size={14} aria-hidden="true"/></button></div>}
      {loading&&!items.length&&<ModuleLoading label="正在核验应用权限…"/>}
      <div className="lets-enterprise-grid lets-module-grid">{shown.map(item=><article className="lets-enterprise-card lets-module-card lets-application-card" key={item.id}><div className="lets-module-card-top"><span className="lets-module-icon" data-kind={item.icon}><EnterpriseApplicationIcon size={25} kind={item.icon}/></span><ModuleBadge tone="blue">企业授权</ModuleBadge></div><h2>{item.name}</h2><p className="lets-module-description">{item.description||'在桌面工作区内访问的企业网页应用。'}</p><div className="lets-module-meta"><ShieldCheck size={13} aria-hidden="true"/>独立网页会话 · 桌面内打开</div><div className="lets-module-card-footer"><button className="lets-module-primary" disabled={busy||loading} onClick={()=>void open(item)}>打开应用<ArrowUpRight size={15} aria-hidden="true"/></button></div></article>)}</div>
      {!shown.length&&!loading&&!error&&<ModuleEmpty icon={items.length?<Search size={28}/>:<Globe2 size={28}/>} title={items.length?'没有匹配的应用':'应用将在这里就绪'} description={items.length?'试试其他分类或关键词，查找你需要的应用。':'管理员发布并授权后，你可以在这里直接打开企业应用。'} action={items.length?<button onClick={()=>{setCategory('all');setSearch('')}}>清空筛选</button>:undefined}/>}
    </div>:<><div className="lets-enterprise-toolbar" aria-label="应用导航"><button disabled={busy||!state.canGoBack} onClick={()=>void control('back')}><ArrowLeft size={15} aria-hidden="true"/>后退</button><button disabled={busy||!state.canGoForward} onClick={()=>void control('forward')}>前进<ArrowRight size={15} aria-hidden="true"/></button><button disabled={busy} onClick={()=>void control('reload')}><RefreshCw size={15} aria-hidden="true"/>刷新网页</button><span role="status">{state.loading?'正在加载网页…':'网页运行在隔离环境中'}</span><button disabled={busy} onClick={()=>void control('close')}><X size={15} aria-hidden="true"/>关闭应用</button></div><div className="lets-enterprise-viewport" data-enterprise-viewport ref={viewport}/></>}
  </section>
}

/** Desktop-owned plugin surface, registered through the upstream's supported inner seats. */
export function applyEnterpriseApplications(ctx:ClientContext){
  const bridge=(window as Scope).letsEnterpriseApplications
  if(!bridge)return
  // Owned shell modes provide layout during their own apply walk. Only this
  // consumer may wait for it; making the parent wait would deadlock startup.
  ctx.inject(['layout'],ctx=>{
  ctx.effect(()=>{
    let alive=true
    void bridge.invoke({action:'capabilities'}).then(result=>{
      if(!alive||!result.ok||!result.enabled)return
      ctx.effect(()=>{const style=document.createElement('style');style.textContent=enterpriseApplicationsStyles;document.head.append(style);return()=>style.remove()},'enterprise-applications: styles')
      ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:ENTERPRISE_APPLICATIONS_PANEL,inject:()=>({bridge,backToChat:()=>ctx.layout.selectPanel(null)})},EnterpriseApplicationsPanel))
      ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:ENTERPRISE_APPLICATIONS_PANEL,order:1,label:'企业应用'},PanelIcon))
      ctx.effect(()=>bridge.subscribe?.(event=>{if(event.type==='select')ctx.layout.selectPanel(ENTERPRISE_APPLICATIONS_PANEL)})??(()=>{}),'enterprise-applications: native menu selection')
    }).catch(()=>{/* Not an enterprise Electron renderer: no enterprise entry. */})
    return()=>{alive=false}
  },'enterprise-applications: enterprise-only desktop extension')
  })
}
