import {useEffect,useLayoutEffect,useRef,useState,type ReactElement} from 'react'
import {createPortal} from 'react-dom'
import {UserRound,ChevronDown} from 'lucide-react'
import type {Context} from '@deepseek-ai/cordis'
import type {SidebarFooterActionOwnerProps} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {EnterpriseAccountSummary,EnterpriseApplicationsBridge} from '../enterprise-applications-contract.ts'

interface Props extends SidebarFooterActionOwnerProps {
  bridge:EnterpriseApplicationsBridge
  initialAccount:EnterpriseAccountSummary
  english?:boolean
}

const styles=`
[data-lets-account-row]{display:flex;align-items:center;gap:8px;min-width:0;position:relative}
[data-lets-account-row=wide] [data-slot="sidebar.settings"]{display:contents}
[data-lets-account-row=wide] [data-slot="sidebar.settings"]>*{flex:1 1 0;min-width:0;width:auto}
[data-lets-account-row=rail]{flex-direction:column;gap:6px}
.lets-account-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;flex:0 1 auto;max-width:58%;min-width:32px;min-height:36px;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}
.lets-account-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.lets-account-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.lets-account-button svg{flex:none}.lets-account-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.lets-account-button[aria-busy=true]{opacity:.65}
[data-lets-account-row=rail] .lets-account-button{max-width:none;width:36px;padding:6px}
.lets-account-error{position:absolute;bottom:100%;right:0;max-width:240px;margin:0 0 6px;padding:8px;border:1px solid var(--dsw-alias-border-l2-darkmode-thin);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px;z-index:1003}
`

/** Native popup stays above embedded web views; only public identity fields enter React. */
export function EnterpriseAccount({bridge,initialAccount,wide,english=false}:Props):ReactElement|null{
  const [account,setAccount]=useState<EnterpriseAccountSummary|null>(initialAccount)
  const [target,setTarget]=useState<HTMLElement|null>(null)
  const [error,setError]=useState(''),[opening,setOpening]=useState(false)
  const alive=useRef(true),busy=useRef(false)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useLayoutEffect(()=>{
    // Locate the documented Settings seat, not an upstream hashed CSS class.
    const find=()=>{const next=document.querySelector('[data-slot="sidebar.settings"]')?.parentElement??null;setTarget(previous=>previous===next?previous:next)}
    find();const observer=new MutationObserver(find);observer.observe(document.body,{childList:true,subtree:true})
    return()=>observer.disconnect()
  },[])
  useLayoutEffect(()=>{
    if(!target)return
    target.dataset.letsAccountRow=wide?'wide':'rail'
    return()=>{delete target.dataset.letsAccountRow}
  },[target,wide])
  async function refresh(){
    try{
      const reply=await bridge.invoke({action:'account'})
      if(!alive.current)return
      if(!reply.ok||!reply.account)throw new Error('account unavailable')
      setAccount(reply.account);setError('')
    }catch{if(alive.current){setAccount(null);setError(english?'Account unavailable. Click to retry.':'账号信息暂不可用，点击重试。')}}
  }
  useEffect(()=>{const timer=setInterval(()=>{void refresh()},30000);return()=>clearInterval(timer)},[bridge])
  async function open(button:HTMLButtonElement){
    if(busy.current)return
    if(!account){await refresh();return}
    busy.current=true;setOpening(true);setError('')
    try{
      const rect=button.getBoundingClientRect()
      const reply=await bridge.invoke({action:'account-menu',x:Math.max(0,rect.left),y:Math.max(0,rect.top)})
      if(!reply.ok)throw new Error('menu unavailable')
    }catch{if(alive.current)setError(english?'Could not open account menu. Please retry.':'无法打开账号菜单，请重试。')}
    finally{busy.current=false;if(alive.current)setOpening(false)}
  }
  if(!target)return null
  const name=account?.name||(english?'Account':'账号')
  return createPortal(<><style>{styles}</style><button className="lets-account-button" type="button"
    title={account?`${name} · ${account.departmentName}`:name}
    aria-label={`${english?'Current user':'当前登录用户'}：${name}`} aria-haspopup="menu" aria-expanded={opening} aria-busy={opening}
    onClick={event=>void open(event.currentTarget)}><UserRound size={16} aria-hidden="true"/>{wide&&<><span className="lets-account-name">{name}</span><ChevronDown size={12} aria-hidden="true"/></>}</button>
    {error&&<p className="lets-account-error" role="alert">{error}</p>}</>,target)
}

export function applyEnterpriseAccount(ctx:Context){
  const bridge=(window as unknown as {letsEnterpriseApplications?:EnterpriseApplicationsBridge}).letsEnterpriseApplications
  if(!bridge)return
  ctx.effect(()=>{
    let alive=true
    void bridge.invoke({action:'account'}).then(reply=>{
      if(!alive||!reply.ok||!reply.account)return
      const initialAccount=reply.account
      ctx.slots.inject('sidebar.footer.action',()=>ctx.slots.register({name:'sidebar.footer.action',id:'lets-enterprise-account',order:100,
        inject:()=>({bridge,initialAccount,english:ctx.locale.getLocale().active==='en'}),
      },EnterpriseAccount))
    }).catch(()=>{/* Ordinary desktop mode has no authenticated enterprise identity. */})
    return()=>{alive=false}
  },'enterprise-account: public identity at Settings seat')
}
