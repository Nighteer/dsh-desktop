/** Connection-authenticated by the caller, plus strict same-origin loopback checks here. */
import type {IncomingMessage, ServerResponse} from 'node:http'
import {DesktopPluginManagerError, type DesktopPluginManagerController} from './desktop-plugin-manager.ts'
import {isSameOriginLoopbackRequest} from './desktop-settings-route.ts'

export async function handleDesktopPluginManagerRequest(req: IncomingMessage, res: ServerResponse, origin: string, controller: DesktopPluginManagerController): Promise<void> {
  const send = (status: number, value: object) => {
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'})
    res.end(JSON.stringify(value))
  }
  if (req.method !== 'GET' && req.method !== 'POST') {res.setHeader('allow', 'GET, POST'); return send(405, {error: '请求方式不支持。'})}
  if (!isSameOriginLoopbackRequest(req, origin, req.method === 'POST')) return send(403, {error: '拒绝跨站或非本机请求。'})
  if (req.method === 'GET') {
    try {return send(200, controller.snapshot())} catch {return send(503, {error: '插件清单暂不可用，请刷新重试。'})}
  }
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return send(415, {error: '需要 JSON 请求。'})
  let value: Record<string, unknown>
  try {
    let size = 0
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
      size += bytes.length
      if (size > 4096) return send(413, {error: '请求过大。'})
      chunks.push(bytes)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    value = parsed as Record<string, unknown>
  } catch {return send(400, {error: '请求格式无效。'})}
  const exact = (...keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
  try {
    if (value.action === 'preview' && exact('action', 'bundleId', 'enabled') && typeof value.bundleId === 'string' && typeof value.enabled === 'boolean') return send(200, controller.preview(value.bundleId, value.enabled))
    if (value.action === 'inspect-install' && exact('action', 'spec') && typeof value.spec === 'string') return send(200, controller.inspectInstall(value.spec))
    if (value.action === 'confirm' && exact('action', 'previewId') && typeof value.previewId === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value.previewId)) return send(200, await controller.confirm(value.previewId))
    return send(400, {error: '插件操作参数无效。'})
  } catch (error) {
    // Storage and subprocess diagnostics may contain paths or credentials. Only
    // explicit Desktop-authored validation errors may cross this boundary.
    return send(409, {error: error instanceof DesktopPluginManagerError ? error.message : '插件操作未完成，请刷新重试；没有自动卸载插件。'})
  }
}
