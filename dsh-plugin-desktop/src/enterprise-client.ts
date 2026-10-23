/** Main-process-only enterprise session client. No credentials enter the Host environment. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { enterpriseOrigin, explicitHttpOrigins, type DesktopSession, type Identity } from 'dsh-enterprise-contracts'

let packagedHttpOrigins: readonly string[] = []
export function configureEnterpriseHttpOrigins(origins: readonly string[]): void {
  packagedHttpOrigins = explicitHttpOrigins(origins.join(','))
}

export function enterpriseServiceUrl(value: string): string {
  return enterpriseOrigin(value, [...packagedHttpOrigins, ...explicitHttpOrigins(process.env.DSH_ENTERPRISE_HTTP_ORIGINS)])
}
export function enterpriseAccountPaths(root: string, instance: string, user: string) {
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
  if (!valid.test(instance) || !valid.test(user)) throw new Error('企业身份响应无效')
  const key = createHash('sha256').update(`${instance}:${user}`).digest('hex')
  const userData = join(root, 'enterprise-accounts', key)
  // The full account directory already carries the 256-bit identity. Keep
  // the nested Chromium partition short enough for Windows without long paths.
  return { userData, home: join(userData, 'harness'), partition: `persist:dsh-e-${key.slice(0, 32)}` }
}
export class EnterpriseRequestError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
export class EnterpriseClient {
  readonly origin: string
  session: DesktopSession | undefined
  private refreshing: Promise<void> | undefined
  constructor(origin: string, private readonly transport: typeof fetch = fetch, private readonly expectedInstance?: string) { this.origin = enterpriseServiceUrl(origin) }
  async request<T>(path: string, body?: unknown): Promise<T> {
    let response: Response
    try {
      response = await this.transport(`${this.origin}/api/v1${path}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(this.session ? { Authorization: `Bearer ${this.session.accessToken}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch { throw new EnterpriseRequestError(0, '无法连接企业服务，请检查网络后重试。') }
    const data = await response.json().catch(() => null) as T & { error?: { message?: string } }
    if (!response.ok) throw new EnterpriseRequestError(response.status, data?.error?.message ?? '企业服务暂时不可用')
    return data
  }
  async login(username: string, password: string, remember: boolean): Promise<void> {
    this.session = await this.request<DesktopSession>('/auth/login', { username, password, remember, channel: 'desktop' })
    this.validate()
  }
  private validate() {
    const session = this.session
    if (!session || !/^[A-Za-z0-9_-]{43}$/u.test(session.accessToken) || !/^[A-Za-z0-9_-]{43}$/u.test(session.refreshToken) || !Number.isFinite(Date.parse(session.expiresAt))) {
      this.session = undefined; throw new Error('企业登录响应无效')
    }
    enterpriseAccountPaths('', session.instanceId, session.user.id)
    if (this.expectedInstance && session.instanceId !== this.expectedInstance) {
      this.session = undefined; throw new Error('企业服务身份已变化，请更换企业服务并重新确认。')
    }
  }
  async restore(refreshToken: string): Promise<void> {
    this.session = await this.request<DesktopSession>('/auth/refresh', { refreshToken })
    this.validate()
  }
  async verify(): Promise<Identity> {
    if (!this.session) throw new EnterpriseRequestError(401, '请重新登录')
    const expectedInstance = this.session.instanceId, expectedUser = this.session.user.id
    if (Date.parse(this.session.expiresAt) - Date.now() < 60000) {
      this.refreshing ??= this.restore(this.session.refreshToken).finally(() => { this.refreshing = undefined })
      await this.refreshing
    }
    const identity = await this.request<Identity>('/auth/me')
    if ((this.expectedInstance && identity.instanceId !== this.expectedInstance) || this.session.instanceId !== expectedInstance || this.session.user.id !== expectedUser ||
      identity.instanceId !== expectedInstance || identity.user.id !== expectedUser || identity.user.mustChangePassword) {
      this.session = undefined
      throw new EnterpriseRequestError(401, '身份或密码状态已变化，请重新登录')
    }
    this.session = { ...this.session, ...identity }
    return identity
  }
}

/** A hard deadline is independent of slow/in-flight network requests. */
export function monitorEnterpriseSession(client: EnterpriseClient, onVerified: () => void, onLock: () => void) {
  let stopped = false, checking = false, lastVerified = Date.now()
  const lock = () => { if (stopped) return; stop(); onLock() }
  const deadline = setInterval(() => { if (Date.now() - lastVerified >= 55000) lock() }, 1000)
  const heartbeat = setInterval(() => {
    if (checking || stopped) return
    checking = true
    void client.verify().then(() => { if (!stopped) { lastVerified = Date.now(); onVerified() } }).catch((error: unknown) => {
      if (error instanceof EnterpriseRequestError && [401,403].includes(error.status)) lock()
    }).finally(() => { checking = false })
  }, 30000)
  function stop() { stopped = true; clearInterval(deadline); clearInterval(heartbeat) }
  return stop
}
