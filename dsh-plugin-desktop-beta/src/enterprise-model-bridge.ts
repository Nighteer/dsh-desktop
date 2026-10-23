/** Main-process-only loopback bridge. Neither upstream keys nor login tokens leave this process. */
import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import type { EnterpriseClient } from './enterprise-client.ts'

export interface EnterpriseModelConnection { baseUrl: string; capability: string }
export async function startEnterpriseModelBridge(client: EnterpriseClient, secrets?: {encrypt(value:string):string; decrypt(value:string):string}) {
  const capability = randomBytes(32).toString('base64url'), active = new Set<AbortController>()
  let stopped = false, baseUrl = ''
  const server = createServer(async (request, response) => {
    const supplied = Buffer.from(request.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${capability}`)
    if (stopped || request.headers.origin || request.headers.host !== new URL(baseUrl).host || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      response.writeHead(403); response.end(); return
    }
    const controller = new AbortController(); active.add(controller)
    const close = () => controller.abort()
    response.once('close', close)
    try {
      if (request.url === '/knowledge/catalog' && request.method === 'GET' || request.url === '/knowledge/search' && request.method === 'POST') {
        await client.verify()
        if (!client.session) throw new Error('Session closed')
        const chunks:Buffer[]=[];let length=0
        for await(const chunk of request){length+=chunk.length;if(length>48*1024){response.writeHead(413);response.end();return}chunks.push(chunk as Buffer)}
        const upstream=await fetch(`${client.origin}/api/v1${request.url==='/knowledge/catalog'?'/available-knowledge-bases':'/knowledge/search'}`,{method:request.method,redirect:'error',headers:{Authorization:`Bearer ${client.session.accessToken}`,'Content-Type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)]),...(chunks.length?{body:Buffer.concat(chunks)}:{})})
        response.writeHead(upstream.status,{'Content-Type':'application/json','Cache-Control':'no-store'})
        response.end(await upstream.text());return
      }
      if (request.url?.startsWith('/resources')) {
        await client.verify()
        if (!client.session) throw new Error('Session closed')
        const url=request.url, buffers:Buffer[]=[];let length=0
        for await(const chunk of request){length+=chunk.length;if(length>10*1024*1024){response.writeHead(413);response.end();return}buffers.push(chunk as Buffer)}
        const body=Buffer.concat(buffers)
        if(request.method==='POST'&&(url==='/resources/encrypt'||url==='/resources/decrypt')){
          if(!secrets)throw new Error('System encryption unavailable')
          const value=JSON.parse(body.toString('utf8')) as {value:unknown}
          if(typeof value.value!=='string'||value.value.length>65536)throw new Error('Invalid secret')
          response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify({value:url.endsWith('/encrypt')?secrets.encrypt(value.value):secrets.decrypt(value.value)}));return
        }
        const match=/^\/resources\/([0-9a-f-]{36})\/versions\/([0-9a-f-]{36})\/(download|access|receipt|mcp)$/u.exec(url)
        if(!(url==='/resources/catalog'&&request.method==='GET')&&!(match&&(match[3]==='mcp'?['POST','GET','DELETE'].includes(request.method??''):request.method===(match[3]==='receipt'?'POST':'GET')))){response.writeHead(404);response.end();return}
        const path=url==='/resources/catalog'?'/available-resources':url
        const upstream=await fetch(`${client.origin}/api/v1${path}`,{method:request.method!,redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)]),headers:{Authorization:`Bearer ${client.session.accessToken}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(typeof request.headers['mcp-session-id']==='string'?{'MCP-Session-Id':request.headers['mcp-session-id']}:{}),...(typeof request.headers['mcp-protocol-version']==='string'?{'MCP-Protocol-Version':request.headers['mcp-protocol-version']}:{})},...(body.length?{body}: {})})
        response.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')??'application/json','Cache-Control':'no-store',...(upstream.headers.has('mcp-session-id')?{'MCP-Session-Id':upstream.headers.get('mcp-session-id')!}:{})})
        if(upstream.body){const reader=upstream.body.getReader();try{while(true){const next=await reader.read();if(next.done)break;if(!response.write(next.value))await once(response,'drain',{signal:controller.signal})}}finally{await reader.cancel().catch(()=>{})}}
        response.end();return
      }
      if (request.method === 'GET' && request.url === '/models') {
        await client.verify()
        const models = await client.request('/available-models')
        response.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'});response.end(JSON.stringify(models));return
      }
      if (request.method !== 'POST' || request.url !== '/chat/completions') { response.writeHead(404);response.end();return }
      const buffers: Buffer[] = [];let length=0
      for await (const chunk of request) {
        length += chunk.length
        if (length > 16*1024*1024) { response.writeHead(413);response.end();return }
        buffers.push(chunk as Buffer)
      }
      await client.verify()
      if (stopped || !client.session) throw new Error('会话已停止')
      const upstream = await fetch(`${client.origin}/api/v1/model-gateway/chat/completions`, {
        method:'POST',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(600000)]),
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${client.session.accessToken}`},body:Buffer.concat(buffers),
      })
      if (!upstream.ok) {
        const result = await upstream.json().catch(()=>null) as {error?:{message?:string}} | null
        response.writeHead(upstream.status,{'Content-Type':'application/json','Cache-Control':'no-store'})
        response.end(JSON.stringify({error:{message:result?.error?.message??'企业模型调用失败'}}));return
      }
      if (!upstream.body) throw new Error('模型响应为空')
      response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'})
      const reader=upstream.body.getReader()
      try {
        while(true){const next=await reader.read();if(next.done)break;if(!response.write(next.value))await once(response,'drain',{signal:controller.signal})}
        response.end()
      }finally{await reader.cancel().catch(()=>{})}
    } catch {
      if (response.headersSent) response.destroy()
      else {response.writeHead(503,{'Content-Type':'application/json'});response.end(JSON.stringify({error:{message:'企业服务连接中断或登录已失效，请重新登录后重试。'}}))}
    } finally {active.delete(controller);response.removeListener('close',close);controller.abort()}
  })
  server.requestTimeout=15000;server.headersTimeout=10000
  server.listen(0,'127.0.0.1');await once(server,'listening')
  const address=server.address()
  if(!address||typeof address==='string')throw new Error('企业模型本机通道启动失败')
  baseUrl=`http://127.0.0.1:${address.port}`
  return { connection:{baseUrl,capability}, stop(){if(stopped)return;stopped=true;for(const controller of active)controller.abort();server.closeAllConnections();server.close()} }
}
