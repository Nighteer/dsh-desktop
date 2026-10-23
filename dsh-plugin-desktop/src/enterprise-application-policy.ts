import {createHash} from 'node:crypto'
import {enterpriseApplicationUrl} from 'dsh-enterprise-contracts'
import type {EnterpriseApplicationViewport} from './enterprise-applications-contract.ts'

export function applicationPartition(instance:string,user:string,application:string){
  if(![instance,user,application].every(value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)))throw new Error('企业应用身份无效')
  return`persist:dsh-a-${createHash('sha256').update(`${instance}:${user}:${application}`).digest('hex').slice(0,32)}`
}
export function allowedApplicationNavigation(value:string,origins:readonly string[],blocked:readonly string[]){
  try{const url=new URL(enterpriseApplicationUrl(value));return origins.includes(url.origin)&&!blocked.includes(url.origin)}catch{return false}
}
export function applicationNetworkOrigin(value:string){
  const url=new URL(value)
  return url.protocol==='ws:'?`http://${url.host}`:url.protocol==='wss:'?`https://${url.host}`:url.origin
}
export function applicationBounds(bounds:EnterpriseApplicationViewport,base:EnterpriseApplicationViewport,zoom:number):EnterpriseApplicationViewport{
  if(![bounds.x,bounds.y,bounds.width,bounds.height,base.x,base.y,base.width,base.height,zoom].every(Number.isFinite)||zoom<=0)throw new Error('应用显示区域无效')
  const x=Math.max(0,Math.min(base.width,Math.round(bounds.x*zoom))),y=Math.max(0,Math.min(base.height,Math.round(bounds.y*zoom)))
  return{x:base.x+x,y:base.y+y,width:Math.max(0,Math.min(base.width-x,Math.round(bounds.width*zoom))),height:Math.max(0,Math.min(base.height-y,Math.round(bounds.height*zoom)))}
}
