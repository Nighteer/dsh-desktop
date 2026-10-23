import { app, BrowserWindow, dialog, Menu, MenuItem, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { EnterpriseClient, enterpriseAccountPaths, monitorEnterpriseSession, configureEnterpriseHttpOrigins } from './enterprise-client.ts'
import { ENTERPRISE_LOGIN_CHANNEL, type EnterpriseLoginReply, type EnterpriseLoginState } from './enterprise-login-contract.ts'
import { setDesktopEnterprisePartition } from './window-options.ts'
import { DesktopEnterpriseApplications } from './enterprise-applications.ts'
import { EnterpriseServiceConnection } from './enterprise-service.ts'

export function enterpriseConfiguration(): { origin?: string } | undefined {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dshEnterprise?: boolean; dshEnterpriseServer?: string; dshEnterpriseHttpOrigins?: string[] }
  const required = manifest.dshEnterprise === true || (!app.isPackaged && process.env.DSH_ENTERPRISE_MODE === '1')
  if (!required) return undefined
  configureEnterpriseHttpOrigins(manifest.dshEnterpriseHttpOrigins ?? [])
  // Package metadata is only a first-run suggestion, never a locked endpoint.
  const origin = manifest.dshEnterpriseServer ?? (!app.isPackaged ? process.env.DSH_ENTERPRISE_SERVER_URL : undefined)
  return origin ? { origin } : {}
}

export class DesktopEnterpriseLogin {
  readonly connection: EnterpriseServiceConnection
  get client(): EnterpriseClient {
    if (!this.connection.client) throw new Error('请先连接并确认企业服务。')
    return this.connection.client
  }
  get credentialPath(): string {
    if (!this.connection.instanceId) throw new Error('企业服务身份尚未确认。')
    return join(this.root, `enterprise-login-${createHash('sha256').update(`${this.client.origin}:${this.connection.instanceId}`).digest('hex')}.json`)
  }
  private remember = false
  private message = ''
  private stopMonitor: (() => void) | undefined
  private lockAction: (() => Promise<void>) | undefined
  private locking = false
  private accountApplications: DesktopEnterpriseApplications | undefined
  get applications(): DesktopEnterpriseApplications {
    return this.accountApplications ??= new DesktopEnterpriseApplications(this.client, () => !this.locking && Boolean(this.client.session),()=>this.lock(true),()=>this.lock(true,true))
  }
  constructor(readonly root: string, origin?: string) {
    this.connection = new EnterpriseServiceConnection(root, origin)
  }
  private canRemember(): boolean {
    return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
  }
  private persist() {
    mkdirSync(this.root, { recursive: true })
    const refresh = this.remember && this.client.session && this.canRemember()
      ? safeStorage.encryptString(this.client.session.refreshToken).toString('base64') : null
    writeFileSync(this.credentialPath, JSON.stringify({ instanceId: this.connection.instanceId, refresh, message: this.message }), { mode: 0o600 })
  }
  async authenticate(): Promise<boolean> {
    await app.whenReady()
    try {
      if (await this.connection.resume() && existsSync(this.credentialPath)) {
        const saved = JSON.parse(readFileSync(this.credentialPath, 'utf8')) as { instanceId?: unknown; refresh?: unknown; message?: unknown }
        if (typeof saved.message === 'string') this.message = saved.message
        if (saved.instanceId === this.connection.instanceId && typeof saved.refresh === 'string' && this.canRemember()) {
          this.remember = true
          await this.client.restore(safeStorage.decryptString(Buffer.from(saved.refresh, 'base64')))
          if (!this.client.session?.user.mustChangePassword) { await this.client.verify(); this.persist(); return true }
        }
      }
    } catch (error) {
      this.message = this.connection.client ? '上次登录无法恢复，请重新登录。' : error instanceof Error ? error.message : '无法连接企业服务，请重试。'
      if (this.connection.client) { this.client.session = undefined; this.remember = false; this.persist() }
    }
    const document = fileURLToPath(new URL('./native-ui/enterprise-login.html', import.meta.url))
    const window = new BrowserWindow({ width: 540, height: 720, minWidth: 440, minHeight: 600, useContentSize: true, title: 'LETS · 企业登录', autoHideMenuBar: true,
      icon: fileURLToPath(new URL('../build/app-icon.png', import.meta.url)), backgroundColor: '#f3f8fe',
      webPreferences: { preload: fileURLToPath(new URL('./enterprise-preload.cjs', import.meta.url)), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, partition: 'dsh-enterprise-login' } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    let complete = false, busy = false
    const state = (): EnterpriseLoginState => ({
      mustChangePassword: this.connection.client?.session?.user.mustChangePassword ?? false,
      allowRemember: this.canRemember(), message: this.message || this.connection.message || (this.connection.origin.startsWith('http:') ? '当前使用 HTTP 连接，传输未加密，仅限管理员批准的内网。' : ''),
      phase: this.connection.client ? 'login' : 'connection', origin: this.connection.origin,
      ...(this.connection.instanceId ? {instanceId:this.connection.instanceId} : {}),
      ...(this.connection.pending ? {instanceChange:{previous:this.connection.pending.previousInstanceId,next:this.connection.pending.instanceId}} : {}),
    })
    const outcome = new Promise<boolean>(resolve => { window.once('closed', () => resolve(complete)) })
    window.webContents.ipc.handle(ENTERPRISE_LOGIN_CHANNEL, async (event, value: unknown): Promise<EnterpriseLoginReply> => {
      if (event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== pathToFileURL(document).href) return { ok: false, error: '不受信任的登录窗口' }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: '请求无效' }
      const action = value as Record<string, unknown>
      if (action.action === 'state') return { ok: true, state: state() }
      if (busy || complete) return { ok: false, error: '请求正在处理中' }
      const text = (key: string, min: number, max: number) => {
        const input = action[key]
        if (typeof input !== 'string' || input.length < min || input.length > max) throw new Error('输入内容长度不正确')
        return input
      }
      busy = true
      try {
        if (action.action === 'connect' || action.action === 'confirm-service' || action.action === 'cancel-service-change' || action.action === 'change-service') {
          if (action.action === 'change-service') {
            // This IPC exists only in the pre-Host window; workspaces use lock + relaunch.
            if (this.connection.client?.session) {
              this.remember = false; this.message = ''; this.persist()
              try { await this.client.request('/auth/logout', {}) } catch { /* Local access is revoked regardless of network state. */ }
              this.client.session = undefined
            }
            this.accountApplications?.close(); this.accountApplications = undefined
            this.connection.selectAgain()
          } else if (action.action === 'cancel-service-change') this.connection.selectAgain()
          else if (action.action === 'confirm-service') await this.connection.confirmChange()
          else {
            if (this.connection.client?.session) throw new Error('请先退出当前账号，再更换企业服务。')
            await this.connection.connect(text('origin', 1, 2000))
          }
          this.remember = false; this.message = ''
          return { ok: true, state: state() }
        }
        if (!this.connection.client) throw new Error('请先连接并确认企业服务。')
        if (action.action === 'login') {
          if (typeof action.remember !== 'boolean') throw new Error('记住登录选项无效')
          this.remember = action.remember && this.canRemember()
          await this.client.login(text('username', 1, 64), text('password', 1, 128), this.remember)
        } else if (action.action === 'password' && this.client.session?.user.mustChangePassword) {
          const identity = await this.client.request<import('dsh-enterprise-contracts').Identity>('/auth/password', { currentPassword: text('currentPassword', 1, 128), password: text('password', 12, 128) })
          this.client.session = { ...this.client.session, ...identity }
        } else throw new Error('登录操作无效')
        if (!this.client.session?.user.mustChangePassword) {
          await this.client.verify(); this.message = ''; this.persist(); complete = true
          setTimeout(() => { if (!window.isDestroyed()) window.close() }, 150)
        }
        return { ok: true, state: state() }
      } catch (error) { return { ok: false, state: state(), error: error instanceof Error ? error.message : '登录失败' } }
      finally { busy = false }
    })
    await window.loadFile(document)
    return outcome
  }
  get paths() {
    const identity = this.client.session
    if (!identity) throw new Error('企业身份尚未确认')
    return enterpriseAccountPaths(this.root, identity.instanceId, identity.user.id)
  }
  activateAccount() {
    const paths = this.paths
    mkdirSync(paths.userData, { recursive: true }); mkdirSync(paths.home, { recursive: true })
    app.setPath('userData', paths.userData)
    setDesktopEnterprisePartition(paths.partition)
    // Only a path is inherited; authentication credentials remain inside this main-process object.
    process.env.DSH_HOME = paths.home
  }
  bindLock(action: () => Promise<void>) {
    this.lockAction = action
    this.stopMonitor = monitorEnterpriseSession(this.client, () => this.persist(), () => { void this.lock(false) })
    app.once('will-quit', () => this.stopMonitor?.())
  }
  async lock(logout: boolean, changeService = false) {
    if (this.locking) return
    if (changeService) this.connection.requestSelectionOnRestart()
    this.locking = true; this.stopMonitor?.()
    this.applications.close()
    // Hide and freeze all old UI immediately; teardown owns cancellation/persistence of Host work.
    const freeze = (window: BrowserWindow) => { window.hide(); window.setIgnoreMouseEvents(true); window.webContents.stop() }
    for (const window of BrowserWindow.getAllWindows()) freeze(window)
    app.on('browser-window-created', (_event, window) => freeze(window))
    this.remember = false
    this.message = logout ? '已退出登录，请选择账号登录。' : '登录状态已失效或连接中断，请重新登录。'
    try {
      this.persist()
      if (logout) { try { await this.client.request('/auth/logout', {}) } catch { /* Local credentials are already invalidated. Server sessions expire independently. */ } }
    } finally {
      this.client.session = undefined
      await this.lockAction?.()
    }
  }
  installAccountMenu() {
    const user = this.client.session?.user
    if (!user || this.locking) return
    const menu = Menu.getApplicationMenu() ?? new Menu()
    menu.append(new MenuItem({ label: '企业应用', submenu: [
      { label: '打开企业应用', accelerator: 'CommandOrControl+Shift+A', click: () => { void this.applications.show().catch(() => dialog.showErrorBox('企业应用', '无法打开应用窗口，请重试。')) } },
    ] }))
    menu.append(new MenuItem({ label: `${user.name} · ${user.departmentName}`, submenu: [
      { label: '退出登录 / 切换账号', accelerator: 'CommandOrControl+Shift+L', click: () => { void this.lock(true) } },
      { label: '更换企业服务（退出当前账号）', click: () => { void this.lock(true,true).catch(() => dialog.showErrorBox('企业服务', '无法更换服务，请重试。')) } },
    ] }))
    Menu.setApplicationMenu(menu)
    for (const window of BrowserWindow.getAllWindows()) {
      // Keep native accelerators and account actions, but avoid a second menu
      // row beside the enhanced shell's compact Application toolbar.
      window.setMenuBarVisibility(process.platform!=='win32')
      window.setAutoHideMenuBar(process.platform==='win32')
    }
  }
}
