/** Main-process-only connection settings. This file never contains login tokens. */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { enterpriseOrigin, type EnterpriseDesktopInfo } from 'dsh-enterprise-contracts'
import { EnterpriseClient, enterpriseServiceUrl } from './enterprise-client.ts'

interface ServiceSettings {
  version: 1
  selectedOrigin: string | null
  selectOnNextLaunch: boolean
  instances: Record<string, string>
}
export interface ChangedEnterpriseService { origin: string; instanceId: string; previousInstanceId: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export async function inspectEnterpriseService(value: string, transport: typeof fetch = fetch): Promise<{ origin: string; info: EnterpriseDesktopInfo }> {
  let origin: string
  try { origin = enterpriseServiceUrl(value.trim()) }
  catch { throw new Error('请填写完整的 HTTPS 根地址；内网 HTTP 地址需由管理员明确允许，不能包含账号密码、路径或参数。') }
  let response: Response
  try {
    response = await transport(`${origin}/api/v1/desktop-info`, { method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } })
  } catch { throw new Error('无法连接企业服务，请检查地址、网络及 HTTPS 证书后重试。') }
  if (!response.ok) throw new Error(response.status === 404 ? '该服务尚不支持客户端连接配置，请管理员升级企业服务。' : '企业服务暂时不可用，请稍后重试。')
  if (!response.headers.get('content-type')?.includes('application/json') || !response.body) throw new Error('地址不是兼容的 LETS 企业服务，请检查地址。')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let bytes = 0, body = ''
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > 8192) throw new Error('企业服务响应过大，请联系管理员。')
      body += decoder.decode(next.value, { stream: true })
    }
    body += decoder.decode()
  } catch { throw new Error('无法读取企业服务信息，请检查网络后重试。') }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  let info: EnterpriseDesktopInfo
  try { info = JSON.parse(body) as EnterpriseDesktopInfo } catch { throw new Error('企业服务信息无效，请联系管理员。') }
  if (!info || info.product !== 'lets-enterprise' || info.desktopApiVersion !== 1 || typeof info.instanceId !== 'string' || !uuid.test(info.instanceId)) throw new Error('企业服务版本或身份信息不兼容，请联系管理员。')
  return { origin, info: { product: info.product, desktopApiVersion: 1, instanceId: info.instanceId } }
}

export class EnterpriseServiceConnection {
  readonly settingsPath: string
  origin = ''
  client: EnterpriseClient | undefined
  pending: ChangedEnterpriseService | undefined
  message = ''
  private settings: ServiceSettings = { version: 1, selectedOrigin: null, selectOnNextLaunch: false, instances: {} }
  private invalidSettings = false
  constructor(private readonly root: string, preset?: string, private readonly transport: typeof fetch = fetch) {
    this.settingsPath = join(root, 'enterprise-service.json')
    try {
      if (existsSync(this.settingsPath)) {
        const raw = readFileSync(this.settingsPath, 'utf8')
        if (raw.length > 65536) throw new Error('oversized settings')
        const saved = JSON.parse(raw) as ServiceSettings
        if (saved.version !== 1 || typeof saved.selectOnNextLaunch !== 'boolean' || !saved.instances || Array.isArray(saved.instances) || typeof saved.instances !== 'object') throw new Error('invalid settings')
        const entries = Object.entries(saved.instances)
        // Saved identities are data, not permission to connect. A revoked HTTP
        // policy must block requests without making the settings file corrupt.
        if (entries.length > 256 || entries.some(([origin, id]) => enterpriseOrigin(origin, [origin]) !== origin || typeof id !== 'string' || !uuid.test(id))) throw new Error('invalid identity pins')
        if (saved.selectedOrigin !== null && (typeof saved.selectedOrigin !== 'string' || !Object.hasOwn(saved.instances, saved.selectedOrigin))) throw new Error('invalid selection')
        this.settings = { version: 1, selectedOrigin: saved.selectedOrigin, selectOnNextLaunch: saved.selectOnNextLaunch, instances: Object.fromEntries(entries) }
      }
    } catch { this.invalidSettings = true; this.message = '企业连接配置无法读取，已保留原文件，请联系管理员检查 enterprise-service.json。' }
    if (!this.invalidSettings) {
      if (this.settings.selectedOrigin) this.origin = this.settings.selectedOrigin
      else if (preset) {
        try { this.origin = enterpriseServiceUrl(preset) } catch { this.message = '预置企业地址无效，请重新填写。' }
      }
    }
  }
  private save(settings: ServiceSettings) {
    if (this.invalidSettings) throw new Error('连接配置文件损坏，不能覆盖原文件，请联系管理员处理。')
    mkdirSync(this.root, { recursive: true })
    const temporary = `${this.settingsPath}.${randomUUID()}.tmp`
    // Failed temporary files are retained, never removed as a side effect.
    writeFileSync(temporary, JSON.stringify(settings), { mode: 0o600, flag: 'wx' })
    renameSync(temporary, this.settingsPath)
    this.settings = settings
  }
  async resume(): Promise<boolean> {
    if (!this.settings.selectedOrigin || this.settings.selectOnNextLaunch || this.invalidSettings) return false
    return this.connect(this.settings.selectedOrigin)
  }
  async connect(value: string): Promise<boolean> {
    this.client = undefined; this.pending = undefined
    const { origin, info } = await inspectEnterpriseService(value, this.transport)
    this.origin = origin
    const previousInstanceId = this.settings.instances[origin]
    if (previousInstanceId && previousInstanceId !== info.instanceId) {
      this.pending = { origin, instanceId: info.instanceId, previousInstanceId }
      return false
    }
    this.accept(origin, info.instanceId)
    return true
  }
  async confirmChange(): Promise<void> {
    const pending = this.pending
    if (!pending) throw new Error('没有待确认的企业服务变更。')
    const { origin, info } = await inspectEnterpriseService(pending.origin, this.transport)
    if (info.instanceId !== pending.instanceId) { this.pending = undefined; throw new Error('企业服务身份再次变化，请重新连接确认。') }
    this.accept(origin, info.instanceId)
  }
  private accept(origin: string, instanceId: string) {
    if (!Object.hasOwn(this.settings.instances, origin) && Object.keys(this.settings.instances).length >= 256) throw new Error('已保存的企业服务过多，请联系管理员。')
    this.save({ version: 1, selectedOrigin: origin, selectOnNextLaunch: false, instances: { ...this.settings.instances, [origin]: instanceId } })
    this.client = new EnterpriseClient(origin, this.transport, instanceId)
    this.pending = undefined; this.message = ''
  }
  selectAgain() { this.client = undefined; this.pending = undefined }
  requestSelectionOnRestart() { this.save({ ...this.settings, selectOnNextLaunch: true }) }
  get instanceId(): string | undefined { return this.client ? this.settings.instances[this.client.origin] : undefined }
}
