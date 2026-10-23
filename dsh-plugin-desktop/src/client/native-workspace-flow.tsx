import {useEffect,useRef} from 'react'
import type {Context} from '@deepseek-ai/cordis'
import type {DirectoryFlowOwnerProps} from '@deepseek-ai/dsh-client-ui-workspace/client'
import {requestDesktopDirectory,requestDesktopDirectoryValidation} from './directory-picker.ts'

export interface DesktopWorkspaceFlowProps extends DirectoryFlowOwnerProps {
  pick():Promise<string|null>
  validate(path:string):Promise<boolean>
}

/** One native chooser per open edge, including cancellation and stale results. */
export function DesktopWorkspaceFlow(props:DesktopWorkspaceFlowProps){
  const current=useRef(props),armed=useRef(false),sequence=useRef(0),alive=useRef(true)
  current.current=props
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>{
    if(!props.open){armed.current=false;sequence.current++;return}
    if(armed.current)return
    armed.current=true
    const generation=++sequence.current
    const active=()=>alive.current&&generation===sequence.current&&current.current.open
    void Promise.resolve().then(()=>props.pick()).then(async path=>{
      if(!active())return
      if(path===null){current.current.onCancel();return}
      if(!await props.validate(path))throw new Error('该目录未通过工作区安全校验，请重新选择。')
      if(active())current.current.onPicked(path)
    }).catch((reason:unknown)=>{if(active())current.current.onError(reason instanceof Error?reason.message:String(reason))})
  },[props.open,props.pick,props.validate])
  return null
}

/** Replace only the desktop's two documented directory-flow seats. */
export function applyNativeWorkspaceFlow(ctx:Context){
  const inject=()=>({pick:()=>requestDesktopDirectory(),validate:(path:string)=>requestDesktopDirectoryValidation(path)})
  for(const name of ['conversation.hero.workspace.directoryFlow','sidebar.workspaces.directoryFlow'] as const){
    ctx.slots.inject(name,()=>ctx.slots.register({name,priority:-100,inject},DesktopWorkspaceFlow))
  }
}
