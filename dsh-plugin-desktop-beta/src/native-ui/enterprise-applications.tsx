import {useEffect,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import type {AvailableApplication,ApplicationIcon} from 'dsh-enterprise-contracts'
import type {EnterpriseApplicationsBridge} from '../enterprise-applications-contract.ts'
import 'dsh-enterprise-admin/style'
import 'dsh-enterprise-admin/admin-style'
import './enterprise-applications.css'
declare global{interface Window{letsEnterpriseApplications:EnterpriseApplicationsBridge}}

function Icon({kind}:{kind:ApplicationIcon}){
  const paths:Record<ApplicationIcon,string>={globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c4 5 4 13 0 18-4-5-4-13 0-18Z',contract:'M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6M9 16h6',knowledge:'M3 4h6l3 2 3-2h6v15h-6l-3 2-3-2H3V4Zm9 2v15',tool:'m14 3 7 7-4 4-3-3-8 9-3-3 9-8-3-3 5-3Z'}
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><path d={paths[kind]}/></svg>
}
function App(){
  const [items,setItems]=useState<AvailableApplication[]>([]),[loading,setLoading]=useState(true),[opening,setOpening]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[search,setSearch]=useState('')
  const inFlight=useRef(false)
  async function refresh(){
    if(inFlight.current)return
    inFlight.current=true
    setLoading(true);setError('')
    try{const result=await window.letsEnterpriseApplications.invoke({action:'list'});if(!result.ok)throw new Error(result.error);setItems(result.applications??[])}catch(e){setItems([]);setError(e instanceof Error?e.message:'加载失败，请重试')}finally{setLoading(false);inFlight.current=false}
  }
  useEffect(()=>{void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh()},30000);return()=>clearInterval(timer)},[])
  async function open(item:AvailableApplication){
    if(inFlight.current)return
    inFlight.current=true
    setOpening(item.id);setError('');setNotice('')
    try{const result=await window.letsEnterpriseApplications.invoke({action:'open',id:item.id});if(!result.ok)throw new Error(result.error);setNotice(`已在系统浏览器打开「${item.name}」。`)}catch(e){setError(e instanceof Error?e.message:'打开失败，请重试')}finally{setOpening('');inFlight.current=false}
  }
  const shown=items.filter(item=>`${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase()))
  return <main className="enterprise-applications"><header className="page-header"><div><p className="eyebrow">LETS / WORKSPACE</p><h1>企业应用</h1></div><button disabled={loading||Boolean(opening)} onClick={()=>void refresh()}>刷新应用</button></header>
    <p className="muted">这里仅显示你获准使用的应用。网页在系统浏览器打开，可能需要登录目标系统。</p>
    <label>搜索应用<input type="search" value={search} placeholder="应用名称或说明" onChange={e=>setSearch(e.target.value)}/></label>
    {error&&<p className="error" role="alert">{error} <button disabled={loading||Boolean(opening)} onClick={()=>void refresh()}>重试</button></p>}{notice&&<p className="notice" role="status">{notice}</p>}
    {loading&&<p role="status">正在核验应用权限…</p>}
    <div className="enterprise-application-grid">{shown.map(item=><article className="enterprise-application-card" key={item.id}><div className="enterprise-application-icon"><Icon kind={item.icon}/></div><h2>{item.name}</h2><p className="muted">{item.description||'企业授权网页应用'}</p><button className="primary" disabled={loading||Boolean(opening)} onClick={()=>void open(item)}>{opening===item.id?'正在检查权限…':'在浏览器中打开'}</button></article>)}</div>
    {!loading&&!error&&!shown.length&&<section className="empty"><h2>{items.length?'没有匹配的应用':'暂无获准使用的应用'}</h2><p>{items.length?'请尝试其他搜索词。':'请联系管理员登记应用并分配权限，然后点击刷新。'}</p></section>}
    <p className="enterprise-applications-foot muted">每次打开前重新检查授权。退出桌面或撤回入口权限，不会自动退出浏览器中目标系统的账号。</p>
  </main>
}
createRoot(document.getElementById('root')!).render(<App/>)
