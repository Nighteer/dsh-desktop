/** Shared, desktop-owned resource-center presentation. No service or permission logic. */
import {useId} from 'react'
import type {ReactNode} from 'react'
import {Search,X,FolderOpen} from 'lucide-react'

export function ModuleHeader({title,description,icon,actions,eyebrow='LETS WORKSPACE'}:{title:string;description:string;icon:ReactNode;actions?:ReactNode;eyebrow?:string}){
  return <header className="lets-module-header"><div className="lets-module-heading"><span className="lets-module-mark" aria-hidden="true">{icon}</span><div><span className="lets-module-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div></div>{actions&&<div className="lets-module-actions">{actions}</div>}</header>
}
export function ModuleSearch({label,value,onChange,placeholder}:{label:string;value:string;onChange:(value:string)=>void;placeholder?:string}){
  const id=useId()
  return <div className="lets-module-search"><label className="lets-module-sr-only" htmlFor={id}>{label}</label><Search size={17} aria-hidden="true"/><input id={id} aria-label={label} type="search" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder??label}/>{value&&<button type="button" className="lets-module-clear" aria-label={`清空${label}`} onClick={()=>onChange('')}><X size={14} aria-hidden="true"/></button>}</div>
}
export function ModuleEmpty({title,description,icon,action}:{title:string;description:string;icon?:ReactNode;action?:ReactNode}){
  return <div className="lets-module-empty"><span className="lets-module-empty-icon" aria-hidden="true">{icon??<FolderOpen size={28}/>}</span><h3>{title}</h3><p>{description}</p>{action}</div>
}
export function ModuleLoading({label}:{label:string}){
  return <div className="lets-module-loading" role="status"><span className="lets-module-sr-only">{label}</span><div className="lets-module-grid" aria-hidden="true">{[1,2,3].map(n=><div className="lets-module-skeleton" key={n}><i/><b/><span/><span/></div>)}</div></div>
}
export function ModuleBadge({children,tone='neutral'}:{children:ReactNode;tone?:'neutral'|'blue'|'green'|'amber'|'red'}){
  return <span className="lets-module-badge" data-tone={tone}><i aria-hidden="true"/>{children}</span>
}
