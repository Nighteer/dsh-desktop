/** Desktop-owned, restart-only plugin management; never reconciles the live Host graph. */
import {randomBytes} from 'node:crypto'
import {readFile, mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {readProfileManifest} from '@deepseek-ai/dsh-app-boot'
import {writeFileAtomic} from '@deepseek-ai/dsh-atomic-write'
import type {DesktopPlugins} from './desktop-plugins.ts'
import type {DesktopPnpm, DesktopPnpmHandle} from './pnpm.ts'
import {DESKTOP_PACKAGE_NAMES} from './product-identity.ts'
import type {DesktopPluginConfirmation, DesktopPluginRow, DesktopPluginSnapshot} from './desktop-plugin-manager-contract.ts'

// These have dedicated launcher preferences or own enterprise/desktop infrastructure.
const protectedPackages = new Set([...DESKTOP_PACKAGE_NAMES, 'dsh-ppt', 'dsh-community-market',
  '@deepseek-ai/dsh-desktop-app', 'dshmarket', '@agents-anywhere/dsh-bridge-next', '@xmanrui/dsh-im'])
const EXACT_SPEC = /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/u
/** Only explicit, desktop-authored messages are safe to return to a renderer. */
export class DesktopPluginManagerError extends Error {}
export function desktopInstallTarget(spec: string): string {
  const match = spec.length <= 300 ? EXACT_SPEC.exec(spec) : null
  if (!match?.[1] || protectedPackages.has(match[1]) || match[1].startsWith('@deepseek-ai/')) {
    throw new DesktopPluginManagerError('请填写第三方插件的完整 npm 包名和精确版本，例如 example-dsh-plugin@1.2.3；内置组件不可替换。')
  }
  return match[1]
}
export interface DesktopPluginManagerOptions {
  profileName: string
  profileDir: string
  plugins: DesktopPlugins
  pnpm(): DesktopPnpm | undefined
  runtime(): DesktopPluginRow[]
  now?: () => number
}
interface Confirmation extends DesktopPluginConfirmation {execute(): Promise<unknown>}
export class DesktopPluginManagerController {
  private readonly previews = new Map<string, Confirmation>()
  private readonly abort = new AbortController()
  private closed = false
  private busy = false
  private changed = false
  private active: DesktopPnpmHandle | undefined
  private operation: Promise<unknown> | undefined
  private readonly now: () => number
  constructor(private readonly options: DesktopPluginManagerOptions) {this.now = options.now ?? Date.now}
  snapshot(): DesktopPluginSnapshot {
    this.assertActive()
    return {profileName: this.options.profileName, bundles: this.options.plugins.list().map(bundle => ({
      bundleId: bundle.bundleId, packageName: bundle.packageName, enabled: bundle.status === 'active',
      mutable: bundle.mutable && !protectedPackages.has(bundle.packageName),
    })), runtime: this.options.runtime(), restartRequired: this.changed, installing: this.busy}
  }
  preview(bundleId: string, enabled: boolean): DesktopPluginConfirmation {
    this.assertIdle()
    const bundle = this.snapshot().bundles.find(item => item.bundleId === bundleId)
    if (!bundle?.mutable) throw new DesktopPluginManagerError('这个组件由桌面端或专用设置管理，不能在这里启停。')
    const preview = enabled ? this.options.plugins.previewEnable(bundleId) : this.options.plugins.previewDisable(bundleId)
    return this.mint(enabled ? 'enable' : 'disable', bundle.packageName, async () => {
      const current = this.snapshot().bundles.find(item => item.bundleId === bundleId)
      if (!current?.mutable) throw new DesktopPluginManagerError('插件状态已改变，请刷新后重试。')
      if (enabled) await this.options.plugins.executeEnable(preview.previewId)
      else await this.options.plugins.executeDisable(preview.previewId)
      this.changed = true
    })
  }
  inspectInstall(spec: string): DesktopPluginConfirmation {
    this.assertIdle()
    const target = desktopInstallTarget(spec)
    this.assertNewPackage(target)
    if (!this.options.pnpm()) throw new DesktopPluginManagerError('插件安装服务尚未就绪，请稍后刷新。')
    return this.mint('install', spec, () => this.install(spec, target))
  }
  confirm(previewId: string): Promise<DesktopPluginSnapshot> {
    this.assertIdle()
    const preview = this.previews.get(previewId)
    this.previews.delete(previewId)
    if (!preview || Date.parse(preview.expiresAt) <= this.now()) throw new DesktopPluginManagerError('确认已过期或已使用，请重新操作。')
    this.busy = true
    const operation = (async () => {
      try {await preview.execute(); this.assertActive()}
      finally {this.busy = false}
      return this.snapshot()
    })()
    this.operation = operation
    void operation.then(() => {this.operation = undefined}, () => {this.operation = undefined})
    return operation
  }
  async dispose(): Promise<void> {
    this.closed = true
    this.previews.clear()
    this.abort.abort()
    this.active?.cancel()
    await this.operation?.catch(() => {})
  }
  private mint(action: DesktopPluginConfirmation['action'], target: string, execute: Confirmation['execute']): DesktopPluginConfirmation {
    for (const [id, preview] of this.previews) if (Date.parse(preview.expiresAt) <= this.now()) this.previews.delete(id)
    if (this.previews.size >= 64) throw new DesktopPluginManagerError('待确认操作过多，请稍后重试。')
    const result = {action, target, previewId: randomBytes(32).toString('base64url'), expiresAt: new Date(this.now() + 300_000).toISOString()}
    this.previews.set(result.previewId, {...result, execute})
    return result
  }
  private assertNewPackage(target: string): void {
    const manifest = readProfileManifest('desktop', this.options.profileDir)
    if (Object.hasOwn(manifest.dependencies ?? {}, target) || manifest.dsh?.profile?.bundles?.includes(target)
      || this.snapshot().runtime.some(row => row.moduleName === target || row.moduleName.startsWith(target + '/'))) {
      throw new DesktopPluginManagerError('该插件已经存在，不能通过添加插件覆盖或升级，请先查看当前列表。')
    }
  }
  private async install(spec: string, target: string): Promise<void> {
    this.assertActive()
    this.assertNewPackage(target)
    const pnpm = this.options.pnpm()
    if (!pnpm) throw new DesktopPluginManagerError('插件安装服务尚未就绪。')
    // Retain an exclusive, account-local pre-operation copy. Never delete files or roll
    // another writer's edits back; the existing CLI owns package/manifest locking.
    const backup = join(this.options.profileDir, '.desktop-plugin-backups', `${this.now()}-${randomBytes(8).toString('hex')}`)
    await mkdir(backup, {recursive: true, mode: 0o700})
    for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml']) {
      try {await writeFileAtomic(join(backup, name), await readFile(join(this.options.profileDir, name), 'utf8'), {mode: 0o600})}
      catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error}
    }
    this.assertActive()
    const handle = pnpm.runPlugin(['add', spec], this.options.profileDir, this.abort.signal)
    this.active = handle
    // Drain output without returning arbitrary package messages, paths or credentials.
    handle.stdout.resume(); handle.stderr.resume()
    const timeout = setTimeout(() => handle.cancel(), 120_000)
    timeout.unref()
    try {
      const result = await handle.done
      this.assertActive()
      // Even a failed package manager may have written dependencies; be explicit.
      this.changed = true
      if (result.exitCode !== 0) throw new DesktopPluginManagerError('安装未完成。配置备份已保留在当前账号目录；请检查网络或插件兼容性后重试，未自动重启或执行卸载。')
      if (!this.options.plugins.list().some(bundle => bundle.packageName === target)) {
        throw new DesktopPluginManagerError('已下载的包未提供可用的 DSH 插件包声明，未激活。依赖及配置备份已保留，没有执行卸载。')
      }
    } finally {clearTimeout(timeout); this.active = undefined}
  }
  private assertActive(): void {if (this.closed) throw new DesktopPluginManagerError('当前工作区已经关闭，请重新登录。')}
  private assertIdle(): void {this.assertActive(); if (this.busy) throw new DesktopPluginManagerError('另一个插件操作正在进行，请稍后重试。')}
}
declare module '@deepseek-ai/cordis' {interface Context {desktopPluginManager: DesktopPluginManagerController}}

