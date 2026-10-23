import {useEffect,useRef,useState,type FormEvent} from 'react'
import type {Context} from '@deepseek-ai/cordis'
import type {MainPanelId} from '@deepseek-ai/dsh-client-ui-layout/client'
import {mcpConfiguration,type AvailableResource,type LocalResource,type ResourceManagerView} from 'dsh-enterprise-contracts'
import type {EnterpriseApplicationsBridge} from '../enterprise-applications-contract.ts'
import {enterpriseResourcesStyles} from './enterprise-resource-styles.ts'
import {Layers,BookOpen,PlugZap,RefreshCw,Plus,ShieldCheck,Info,Upload,CheckCircle2,Search,UserRound} from 'lucide-react'
import {ModuleHeader,ModuleSearch,ModuleEmpty,ModuleLoading,ModuleBadge} from './module-ui.tsx'
const PANEL='lets-resources' as MainPanelId
export async function resourceApi(body?:object):Promise<ResourceManagerView>{
  const response=await fetch('/api/desktop/resources',{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,confirmed:true})}:{})})
  const value=await response.json() as ResourceManagerView&{error?:string}
  if(!response.ok)throw new Error(value.error??'技能服务不可用，请刷新重试')
  return value
}
async function base64(file:File){if(file.size>6*1024*1024)throw new Error('单个文件不能超过 6 MB');const bytes=new Uint8Array(await file.arrayBuffer());let text='';for(let at=0;at<bytes.length;at+=16384)text+=String.fromCharCode(...bytes.subarray(at,at+16384));return btoa(text)}
function ResourceIcon({size=20}:{size?:number}){return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/></svg>}
const labels={ready:'已启用',connecting:'正在连接／加载',disabled:'已停用',failed:'需要处理',revoked:'企业授权不可用'}
const statusTones={ready:'green',connecting:'blue',disabled:'neutral',failed:'red',revoked:'amber'} as const
export function EnterpriseResourcesPage({api=resourceApi}:{api?:typeof resourceApi}){
  const [view,setView]=useState<ResourceManagerView>({catalog:[],installed:[],catalogError:''}),[tab,setTab]=useState<'catalog'|'installed'>('catalog'),[type,setType]=useState('all'),[search,setSearch]=useState('')
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[refreshError,setRefreshError]=useState(''),[notice,setNotice]=useState(''),[selected,setSelected]=useState<Record<string,string>>({})
  const [modal,setModal]=useState<'add'|LocalResource|null>(null),[kind,setKind]=useState('skill'),[name,setName]=useState(''),[json,setJson]=useState(''),[zip,setZip]=useState<File|null>(null),[trusted,setTrusted]=useState(false),[modalError,setModalError]=useState('')
  const dialog=useRef<HTMLDialogElement>(null),alive=useRef(true),inFlight=useRef(false)
  const revision=useRef(0),refreshFlight=useRef<{foreground:boolean;promise:Promise<void>}|null>(null)
  function publish(next:ResourceManagerView){setView(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next)}
  async function refresh(foreground=true){
    if(inFlight.current)return
    const existing=refreshFlight.current
    if(existing){if(foreground){existing.foreground=true;setLoading(true)}return existing.promise}
    const stamp=revision.current,flight={foreground,promise:Promise.resolve()}
    refreshFlight.current=flight
    if(foreground)setLoading(true)
    flight.promise=(async()=>{
      try{
        const next=await api()
        if(alive.current&&stamp===revision.current){publish(next);setRefreshError('');if(flight.foreground)setError('')}
      }catch{if(alive.current&&stamp===revision.current)setRefreshError('资源清单暂不可用，请检查企业连接后刷新')}
      finally{if(refreshFlight.current===flight){refreshFlight.current=null;if(alive.current&&flight.foreground)setLoading(false)}}
    })()
    return flight.promise
  }
  useEffect(()=>{alive.current=true;void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh(false)},15000);return()=>{alive.current=false;revision.current++;refreshFlight.current=null;clearInterval(timer)}},[api])
  const connecting=!refreshError&&view.installed.some(item=>item.status==='connecting')
  useEffect(()=>{if(!connecting)return;const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh(false)},1000);return()=>clearInterval(timer)},[api,connecting])
  useEffect(()=>{if(modal)dialog.current?.showModal()},[modal])
  function open(value:typeof modal){setModal(value);setKind('skill');setName('');setZip(null);setJson(value==='add'?'':JSON.stringify({env:{},headers:{}},null,2));setTrusted(false);setModalError('')}
  function beginMutation(){inFlight.current=true;revision.current++;refreshFlight.current=null;setLoading(false);setBusy(true)}
  async function mutate(body:object){const stamp=revision.current,next=await api(body);if(alive.current&&stamp===revision.current){publish(next);setRefreshError('');setNotice('操作已保存。Skill 会进入实际技能目录；MCP 连接状态请查看「我的安装」。')}}
  async function operation(body:object){if(inFlight.current)return;beginMutation();setError('');try{await mutate(body)}catch(e){if(alive.current)setError(e instanceof Error?e.message:'操作失败')}finally{inFlight.current=false;if(alive.current)setBusy(false)}}
  async function install(item:AvailableResource,versionId:string){if(!window.confirm(`安装／更新「${item.name}」到选定版本？Skill 可能包含可执行脚本，MCP 启用后可以访问本机或外部服务。只安装可信来源；旧版本和历史数据不会删除。`))return;await operation({action:'install',resourceId:item.id,versionId})}
  async function submit(event:FormEvent){
    event.preventDefault();if(!modal||inFlight.current)return
    beginMutation();setModalError('')
    try{
      if(modal!=='add')await mutate({action:'configure',id:modal.id,options:JSON.parse(json)})
      else {
        if(!trusted)throw new Error('请确认来源可信及代码执行风险')
        let body:object
        if(kind==='mcp')body={action:'add',name,content:{kind:'mcp',mcp:mcpConfiguration(JSON.parse(json))}}
        else{
          if(!zip)throw new Error('请选择 Skill ZIP 包')
          if(zip.size>4*1024*1024)throw new Error('ZIP 上限 4 MB')
          body={action:'add',zip:await base64(zip)}
        }
        await mutate(body)
      }
      if(alive.current){setModal(null);setJson('');setTab('installed')}
    }catch(e){if(alive.current)setModalError(e instanceof Error?e.message:'操作失败')}finally{inFlight.current=false;if(alive.current)setBusy(false)}
  }
  function chooseZip(file:File|undefined){setModalError('');if(file&&(!/\.zip$/iu.test(file.name)||file.size>4*1024*1024)){setZip(null);setModalError('请选择不超过 4 MB 的 ZIP 包');return}setZip(file??null)}
  const match=(item:{name:string;kind:string})=>(type==='all'||item.kind===type)&&item.name.toLowerCase().includes(search.toLowerCase())
  const catalogItems=view.catalog.filter(match),installedItems=view.installed.filter(match)
  return <section className="lets-enterprise-page lets-resources-page lets-module" aria-label="技能与 MCP 管理"><div className="lets-module-content"><ModuleHeader title="技能与 MCP" description="把专业技能和外部工具，装进你的日常工作流。" icon={<Layers size={29}/>} actions={<><button disabled={loading||busy} onClick={()=>void refresh()}><RefreshCw size={15} aria-hidden="true"/>刷新资源</button><button className="lets-module-primary" disabled={busy} onClick={()=>open('add')}><Plus size={16} aria-hidden="true"/>添加个人资源</button></>}/>
    <div className="lets-module-overview"><span><ShieldCheck size={16} aria-hidden="true"/><strong>{view.catalog.length}</strong> 项企业资源</span><span><UserRound size={15} aria-hidden="true"/><strong>{view.installed.length}</strong> 项本机安装</span><span className="lets-module-overview-note">企业按权选装 · 个人资源仅本机使用</span></div>
    <div className="lets-module-tabs" role="tablist" aria-label="资源来源" onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?'catalog':event.key==='End'?'installed':tab==='catalog'?'installed':'catalog';setTab(next);event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[next==='catalog'?0:1]?.focus()}}><button id="lets-resource-catalog-tab" role="tab" aria-controls="lets-resource-content" tabIndex={tab==='catalog'?0:-1} aria-selected={tab==='catalog'} onClick={()=>setTab('catalog')}>企业资源</button><button id="lets-resource-installed-tab" role="tab" aria-controls="lets-resource-content" tabIndex={tab==='installed'?0:-1} aria-selected={tab==='installed'} onClick={()=>setTab('installed')}>我的安装</button></div>
    <div className="lets-module-toolbar"><ModuleSearch label="搜索资源" value={search} onChange={setSearch} placeholder="查找技能或 MCP 工具"/><label className="lets-module-filter">类型<select value={type} onChange={e=>setType(e.target.value)}><option value="all">全部类型</option><option value="skill">Skill 技能</option><option value="mcp">MCP 工具</option></select></label><span className="lets-module-result-count">{tab==='catalog'?catalogItems.length:installedItems.length} 项资源</span></div>
    {(error||refreshError||view.catalogError||view.localError)&&<p role="alert" className="lets-module-alert">{error||refreshError||view.catalogError||view.localError}</p>}{notice&&<div role="status" className="lets-module-notice"><CheckCircle2 size={16} aria-hidden="true"/>{notice}</div>}{loading&&!view.catalog.length&&!view.installed.length&&<ModuleLoading label="正在核验资源与授权…"/>}
    {loading&&(view.catalog.length>0||view.installed.length>0)&&<p role="status" className="lets-module-info">正在核验资源与授权…</p>}
    <div className="lets-enterprise-catalog" id="lets-resource-content" role="tabpanel" aria-labelledby={tab==='catalog'?'lets-resource-catalog-tab':'lets-resource-installed-tab'}>{tab==='catalog'?<><div className="lets-module-info"><Info size={16} aria-hidden="true"/><span>仅显示已发布且获准使用的版本。更新需手动确认，不自动覆盖；个人导入不会上传企业后台。</span></div><div className="lets-enterprise-grid lets-module-grid">{catalogItems.map(item=>{
      const version=selected[item.id]??item.latestVersion??'',installed=view.installed.find(record=>record.resourceId===item.id),same=installed?.versionId===version
      return <article className="lets-enterprise-card lets-module-card lets-resource-card" key={item.id}><div className="lets-module-card-top"><span className="lets-module-icon" data-kind={item.kind}>{item.kind==='skill'?<BookOpen size={23} aria-hidden="true"/>:<PlugZap size={23} aria-hidden="true"/>}</span><ModuleBadge tone={installed?'green':'blue'}>{installed?'已安装':'企业发布'}</ModuleBadge></div><h2>{item.name}</h2><p className="lets-module-description">{item.description||'由企业管理员发布，按授权范围选装使用。'}</p><div className="lets-module-meta">{item.kind==='skill'?'Skill 技能':'MCP 工具'} · 企业发布{installed?' · 已安装 '+installed.version:''}</div><label className="lets-resource-version">版本<select value={version} onChange={e=>setSelected(previous=>({...previous,[item.id]:e.target.value}))}>{item.versions.map(v=><option key={v.id} value={v.id}>{v.version}{v.id===item.latestVersion?'（最新）':''}</option>)}</select></label>{item.versions.find(v=>v.id===version)?.notes&&<p className="lets-resource-notes">{item.versions.find(v=>v.id===version)?.notes}</p>}<div className="lets-module-card-footer"><button className={same?'':'lets-module-primary'} disabled={busy||!version||same} onClick={()=>void install(item,version)}>{same?<CheckCircle2 size={15} aria-hidden="true"/>:<Plus size={15} aria-hidden="true"/>}{same?'该版本已安装':installed?'确认更新版本':'安装到本地'}</button></div></article>
    })}</div>{!catalogItems.length&&!loading&&<ModuleEmpty icon={search?<Search size={28}/>:<Layers size={28}/>} title={search?'没有匹配的企业资源':'等待你的第一项企业资源'} description="暂无匹配的企业资源，请联系管理员发布并授权。" action={search?<button onClick={()=>{setSearch('');setType('all')}}>清空筛选</button>:undefined}/>}</>:<><div className="lets-module-info"><Info size={16} aria-hidden="true"/><span>企业发布和个人安装统一展示。本机已有技能可直接使用，无需重复导入；停用操作不会删除文件。</span></div><div className="lets-enterprise-grid lets-module-grid">{installedItems.map(item=><article className="lets-enterprise-card lets-module-card lets-resource-card" key={item.id}><div className="lets-module-card-top"><span className="lets-module-icon" data-kind={item.kind}>{item.kind==='skill'?<BookOpen size={23} aria-hidden="true"/>:<PlugZap size={23} aria-hidden="true"/>}</span><span role="status"><ModuleBadge tone={item.managed===false?'green':statusTones[item.status]}>{item.managed===false?'可使用':labels[item.status]}</ModuleBadge></span></div><h2>{item.name}</h2><div className="lets-module-meta">{item.source==='enterprise'?<ShieldCheck size={13} aria-hidden="true"/>:<UserRound size={13} aria-hidden="true"/>}{item.source==='enterprise'?'企业发布':'个人安装'} · {item.kind==='skill'?'Skill':'MCP'}{item.version?' · '+item.version:''}</div>{item.description&&<p className="lets-module-description">{item.description}</p>}{item.message&&<p className="lets-resource-message">{item.message}</p>}{item.kind==='mcp'&&<details className="lets-resource-tools"><summary>可用工具（{item.tools.length}）</summary><div>{item.tools.map(name=><code key={name}>{name}</code>)}</div></details>}{item.managed!==false&&<div className="lets-module-actions"><button disabled={busy} onClick={()=>{if(window.confirm(`${item.enabled?'停用':'启用'}「${item.name}」？不会删除本地文件。`))void operation({action:'toggle',id:item.id,enabled:!item.enabled})}}>{item.enabled?'停用':'启用'}</button>{item.kind==='mcp'&&<><button disabled={busy||!item.enabled} onClick={()=>void operation({action:'toggle',id:item.id,enabled:true})}>重新连接</button><button disabled={busy} onClick={()=>open(item)}>个人参数</button></>}</div>}</article>)}</div>{!installedItems.length&&!loading&&<ModuleEmpty icon={<BookOpen size={28}/>} title={search?'没有匹配的本机资源':'让好用的技能为你工作'} description="尚未安装匹配资源，可以从企业资源选装，或添加个人资源。" action={search?<button onClick={()=>{setSearch('');setType('all')}}>清空筛选</button>:<button onClick={()=>open('add')}>添加个人资源</button>}/>}</>}</div>
    {modal&&<dialog ref={dialog} className="lets-resource-dialog lets-module-dialog" aria-label={modal==='add'?'添加个人资源':'MCP 个人参数'} onCancel={e=>{if(busy)e.preventDefault();else{setModal(null);setJson('')}}}><h2><Layers size={22} aria-hidden="true"/>{modal==='add'?'添加个人资源':'MCP 个人参数'}</h2><form onSubmit={e=>void submit(e)}>{modal==='add'?<><label>资源类型<select value={kind} disabled={busy} onChange={e=>{setKind(e.target.value);setJson('');setZip(null);setModalError('')}}><option value="skill">Skill 技能</option><option value="mcp">MCP 工具</option></select></label>{kind==='skill'?<div className="lets-resource-upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)chooseZip(e.dataTransfer.files[0])}}><span><Upload size={23} aria-hidden="true"/>选择或拖入 Skill ZIP 包</span><label>Skill ZIP 包<input type="file" accept=".zip" required={!zip} disabled={busy} onChange={e=>chooseZip(e.target.files?.[0])}/></label>{zip&&<small>已选择：{zip.name}</small>}<small>ZIP 根目录包含 SKILL.md，支持配套文件。压缩包不超过 4 MB，解压合计不超过 6 MB。安装时不自动执行脚本。</small></div>:<><label>名称<input required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label><label>导入 MCP JSON<input type="file" accept=".json" onChange={e=>{const file=e.target.files?.[0];if(file&&file.size<=65536)void file.text().then(setJson);else setModalError('JSON 上限 64 KB')}}/></label><label>MCP JSON<textarea required rows={10} value={json} onChange={e=>setJson(e.target.value)} placeholder={'{"transport":"streamable-http","url":"https://example.com/mcp","headers":{}}'}/></label><p>支持 Streamable HTTP 和本机已有程序的 stdio。不自动下载运行环境或 MCP 软件。配置使用系统加密，不回显已保存的密钥。</p></>}<label className="lets-resource-trust"><input type="checkbox" checked={trusted} onChange={e=>setTrusted(e.target.checked)}/>我信任资源来源，了解脚本或 MCP 可能读取文件、访问网络或执行本机代码。</label></>:<><p>只填写需要替换的 env（本地程序）或 headers（个人远程服务）。这两个字段会分别整体替换，空对象表示清空。已保存的敏感值不回显；企业远程 MCP 的密钥由管理员维护。</p><label>个人参数 JSON<textarea rows={10} value={json} onChange={e=>setJson(e.target.value)}/></label></>}
      {modalError&&<p role="alert" className="lets-module-alert">{modalError}</p>}<div className="lets-module-dialog-actions"><button type="button" disabled={busy} onClick={()=>{setModal(null);setJson('')}}>取消</button><button className="lets-module-primary" disabled={busy||modal==='add'&&!trusted}>{busy?'正在保存…':'确认保存并启用'}</button></div>
    </form></dialog>}
  </div></section>
}
export function applyEnterpriseResources(ctx:Context):void{
  const bridge=(window as Window&{letsEnterpriseApplications?:EnterpriseApplicationsBridge}).letsEnterpriseApplications
  if(!bridge)return
  ctx.inject(['layout'],ctx=>{ctx.effect(()=>{
    let alive=true
    void bridge.invoke({action:'capabilities'}).then(reply=>{
      if(!alive||!reply.ok||!reply.enabled)return
      ctx.effect(()=>{const style=document.createElement('style');style.textContent=enterpriseResourcesStyles;document.head.append(style);return()=>style.remove()},'enterprise: resource styles')
      ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:PANEL,inject:()=>({})},EnterpriseResourcesPage))
      ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:PANEL,order:0.5,label:'技能与 MCP'},ResourceIcon))
    }).catch(()=>{})
    return()=>{alive=false}
  },'enterprise: resource panel')})
}
