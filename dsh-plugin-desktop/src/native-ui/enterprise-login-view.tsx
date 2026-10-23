import {useEffect,useState} from 'react'
import {AdminLogin as LoginView} from 'dsh-enterprise-ui/admin-login'
import {EnterpriseConnection} from 'dsh-enterprise-ui/enterprise-connection'
import type {EnterpriseLoginAction,EnterpriseLoginBridge,EnterpriseLoginState} from '../enterprise-login-contract.ts'

export function EnterpriseLoginApp({bridge}:{bridge:EnterpriseLoginBridge}){
  const [state,setState]=useState<EnterpriseLoginState>({mustChangePassword:false,allowRemember:false,message:'',phase:'connection',origin:''})
  const [ready,setReady]=useState(false),[initialError,setInitialError]=useState('')
  async function invoke(action:EnterpriseLoginAction){
    const result=await bridge.invoke(action)
    if(result.state)setState(result.state)
    if(!result.ok)throw new Error(result.error??'请求失败')
  }
  async function initialize(){
    setInitialError('')
    try{await invoke({action:'state'});setReady(true)}catch{setInitialError('登录窗口初始化失败，请重试或重新启动应用。')}
  }
  useEffect(()=>{void initialize()},[])
  if(!ready)return <main className="login-shell"><section className="login-card login-body"><p role={initialError?'alert':'status'}>{initialError||'正在准备企业连接…'}</p>{initialError&&<button onClick={()=>void initialize()}>重试</button>}</section></main>
  if(state.phase==='connection')return <EnterpriseConnection origin={state.origin??''} message={state.message}
    addressHint="支持 HTTP 或 HTTPS 根地址，不需要 /api/ 或 /api/v1。"
    {...(state.instanceChange?{instanceChange:state.instanceChange}:{})}
    connect={origin=>invoke({action:'connect',origin})} confirm={()=>invoke({action:'confirm-service'})} cancel={()=>invoke({action:'cancel-service-change'})}/>
  return <LoginView key={`${state.origin}:${state.instanceId}`} {...state} serviceOrigin={state.origin??''}
    changeService={()=>invoke({action:'change-service'})}
    login={(username,password,remember)=>invoke({action:'login',username,password,remember})}
    changePassword={(currentPassword,password)=>invoke({action:'password',currentPassword,password})}/>
}
