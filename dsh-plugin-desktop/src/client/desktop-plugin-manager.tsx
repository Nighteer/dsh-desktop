import {useEffect, useRef, useState} from 'react'
import type {Context} from '@deepseek-ai/cordis'
import type {MainPanelId} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {DesktopClientEnvironment} from './environment.ts'
import {createDesktopSettingsApi} from './desktop-settings-api.ts'
import {DESKTOP_PLUGIN_MANAGER_PATH, type DesktopPluginConfirmation, type DesktopPluginRequest, type DesktopPluginSnapshot} from '../desktop-plugin-manager-contract.ts'
import {Puzzle,RefreshCw,Plus,LockKeyhole,Boxes,Info,Search,CheckCircle2} from 'lucide-react'
import {ModuleHeader,ModuleSearch,ModuleEmpty,ModuleLoading,ModuleBadge} from './module-ui.tsx'
import {moduleUiStyles} from './module-ui-styles.ts'

export const DESKTOP_PLUGINS_PANEL = 'plugins' as MainPanelId
async function request<T>(body?: DesktopPluginRequest): Promise<T> {
  const response = await fetch(DESKTOP_PLUGIN_MANAGER_PATH, {method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    ...(body ? {headers: {'content-type': 'application/json'}, body: JSON.stringify(body)} : {})})
  const value = await response.json() as {error?: string}
  if (!response.ok) throw new Error(value.error || '插件服务暂不可用，请刷新重试。')
  return value as T
}
export interface DesktopPluginManagerApi {
  read(): Promise<DesktopPluginSnapshot>
  preview(body: Extract<DesktopPluginRequest, {action: 'preview' | 'inspect-install'}>): Promise<DesktopPluginConfirmation>
  confirm(previewId: string): Promise<DesktopPluginSnapshot>
  restart(): Promise<void>
}
export function createDesktopPluginManagerApi(): DesktopPluginManagerApi {
  return {read: () => request(), preview: body => request(body), confirm: previewId => request({action: 'confirm', previewId}),
    restart: () => createDesktopSettingsApi().restart()}
}
export const desktopPluginManagerStyles = moduleUiStyles+`
.lets-plugin-content{max-width:1160px;margin:auto}.lets-plugin-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:13px 0;border-bottom:1px solid var(--hub-border)}.lets-plugin-row:last-child{border-bottom:0}.lets-plugin-name{min-width:0;overflow-wrap:anywhere;font-size:12px}.lets-plugin-name strong{font-weight:500}.lets-plugin-card h3{font-size:14px}.lets-plugin-card .lets-module-description{font-size:12px}.lets-plugin-dialog code{overflow-wrap:anywhere;white-space:normal}.lets-plugin-runtime{font-size:12px}.lets-plugin-error{color:var(--hub-red)}
`
function PluginIcon({size = 20}: {size?: number}) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 3v4H4v5h4v4h5v-4h4V7h-4V3H8ZM8 16v5h5v-5M17 7h4v5h-4"/></svg>
}
function PluginDialog({title, children, busy, close}: {title: string; children: React.ReactNode; busy: boolean; close(): void}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {ref.current?.showModal(); return () => {ref.current?.close()}}, [])
  return <dialog ref={ref} className="lets-plugin-dialog lets-module-dialog" aria-label={title} onCancel={event => {event.preventDefault(); if (!busy) close()}}>
    <h2>{title}</h2>{children}
  </dialog>
}
export function DesktopPluginManagerPage({api}: {api: DesktopPluginManagerApi}) {
  const [snapshot, setSnapshot] = useState<DesktopPluginSnapshot>(), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [search, setSearch] = useState(''), [adding, setAdding] = useState(false), [spec, setSpec] = useState('')
  const [confirmation, setConfirmation] = useState<DesktopPluginConfirmation>(), [dialogError, setDialogError] = useState('')
  const inFlight = useRef(false), alive = useRef(true)
  async function refresh() {
    if (inFlight.current) return
    inFlight.current = true; setLoading(true); setError('')
    try {const value = await api.read(); if (alive.current) setSnapshot(value)}
    catch {if (alive.current) setError('插件清单加载失败，请检查连接后刷新重试。')}
    finally {inFlight.current = false; if (alive.current) setLoading(false)}
  }
  useEffect(() => {alive.current = true; void refresh(); return () => {alive.current = false}}, [api])
  async function act(task: () => Promise<void>, modal = false) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setDialogError('')
    try {await task()}
    catch (error) {if (alive.current) (modal ? setDialogError : setError)(error instanceof Error ? error.message : '操作失败，请刷新重试。')}
    finally {inFlight.current = false; if (alive.current) setBusy(false)}
  }
  const filtered = snapshot?.bundles.filter(bundle => bundle.packageName.toLowerCase().includes(search.toLowerCase())) ?? []
  const custom = filtered.filter(bundle => bundle.mutable), builtins = filtered.filter(bundle => !bundle.mutable)
  const runtime = snapshot?.runtime.filter(row => row.moduleName.toLowerCase().includes(search.toLowerCase())) ?? []
  const disabled = busy || loading || snapshot?.installing === true
  const stateName = {running: '运行中', disabled: '未启用', failed: '加载失败', pending: '等待依赖'}
  function rows(items: typeof filtered) {return items.map(bundle => <article className="lets-module-card lets-plugin-card" key={bundle.bundleId}>
    <div className="lets-module-card-top"><span className="lets-module-icon">{bundle.mutable?<Puzzle size={23} aria-hidden="true"/>:<LockKeyhole size={21} aria-hidden="true"/>}</span><ModuleBadge tone={!bundle.mutable?'neutral':bundle.enabled?'green':'amber'}>{!bundle.mutable?'受保护':bundle.enabled?'已启用':'已停用'}</ModuleBadge></div>
    <h3>{bundle.packageName}</h3><p className="lets-module-description">{bundle.mutable?'用户安装的扩展，启停配置将在重启后生效。':'随桌面提供的基础能力，由内置或专用设置管理。'}</p>
    <div className="lets-module-card-footer"><span className="lets-module-meta">{bundle.mutable?'当前账号 · 用户插件':'内置组件'}</span>{bundle.mutable ? <button disabled={disabled} aria-label={`${bundle.enabled ? '停用' : '启用'} ${bundle.packageName}`} onClick={() => void act(async () => {
      const preview = await api.preview({action: 'preview', bundleId: bundle.bundleId, enabled: !bundle.enabled}); if (alive.current) setConfirmation(preview)
    })}>{bundle.enabled ? '停用' : '启用'}</button> : <LockKeyhole size={15} aria-label="内置组件不可在此停用"/>}</div>
  </article>)}
  return <section className="lets-plugin-page lets-module" aria-label="桌面插件管理"><div className="lets-plugin-content">
    <ModuleHeader title="插件" description="为桌面扩展能力，让常用工具在同一个工作区协作。" icon={<Puzzle size={29}/>} actions={<><button disabled={disabled} onClick={() => void refresh()}><RefreshCw size={15} aria-hidden="true"/>刷新列表</button><button className="lets-module-primary" disabled={disabled || !snapshot} onClick={() => {setAdding(true); setSpec(''); setDialogError('')}}><Plus size={16} aria-hidden="true"/>添加插件</button></>}/>
    {loading && !snapshot && <ModuleLoading label="正在加载插件清单…"/>}
    {error && <div role="alert" className="lets-module-alert">{error}</div>}
    {notice && <div role="status" className="lets-module-notice"><CheckCircle2 size={16} aria-hidden="true"/>{notice}</div>}
    {snapshot && <><div className="lets-module-overview"><span><Boxes size={16} aria-hidden="true"/>当前 Profile：<strong>{snapshot.profileName}</strong></span><span><strong>{snapshot.bundles.length}</strong> 个插件包</span><span><strong>{snapshot.runtime.filter(row=>row.state==='running').length}</strong> 个运行中组件</span><span className="lets-module-overview-note"><LockKeyhole size={13} aria-hidden="true"/>不删除文件与历史数据</span></div>
      {snapshot.restartRequired && <div className="lets-module-info" role="status"><Info size={16} aria-hidden="true"/><span>插件配置已保存，重启后生效。请先保存当前工作。</span><button disabled={disabled} onClick={() => void act(async () => {await api.restart()})}>重启桌面</button></div>}
      <div className="lets-module-toolbar"><ModuleSearch label="搜索插件" value={search} onChange={setSearch} placeholder="搜索插件包或运行组件"/><span className="lets-module-result-count">{loading?'正在刷新…':`找到 ${filtered.length} 个插件包`}</span></div>
      <section className="lets-module-section"><div className="lets-module-section-heading"><h2>用户插件（{custom.length}）</h2><small>仅管理当前账号安装的扩展</small></div><div className="lets-module-grid">{rows(custom)}</div>{!custom.length && <ModuleEmpty icon={search?<Search size={28}/>:<Puzzle size={28}/>} title={search?'没有匹配的用户插件':'从一个扩展开始'} description={search?'请更换搜索词，或清空搜索查看全部插件。':'通过右上角「添加插件」安装可信的 DSH 扩展。企业网页入口位于「企业应用」。'} action={search?<button onClick={()=>setSearch('')}>清空搜索</button>:undefined}/>}</section>
      <details className="lets-module-disclosure"><summary><LockKeyhole size={17} aria-hidden="true"/>内置与受保护插件包（{builtins.length}）</summary><p>桌面所需的基础能力，展开查看；不能通过此页面直接停用。</p><div className="lets-module-grid">{rows(builtins)}</div></details>
      <details className="lets-module-disclosure"><summary><Boxes size={17} aria-hidden="true"/>运行时组件（{runtime.length}）</summary><p>以下是当前进程的实际状态，与下一次启动的配置分开展示。核心组件不能在这里直接停用。</p><div className="lets-plugin-runtime">{runtime.map(row => <div key={row.id} className="lets-plugin-row"><span className="lets-plugin-name">{row.moduleName}</span><ModuleBadge tone={row.state==='running'?'green':row.state==='failed'?'red':row.state==='pending'?'amber':'neutral'}>{stateName[row.state]}</ModuleBadge></div>)}</div></details>
    </>}
    {(adding || confirmation) && <PluginDialog title={confirmation ? (confirmation.action === 'install' ? '确认安装插件' : '确认插件配置变更') : '添加插件'} busy={busy} close={() => {setAdding(false); setConfirmation(undefined)}}>
      {confirmation ? <><p>目标：<code>{confirmation.target}</code></p><p>{confirmation.action === 'install' ? '第三方插件可执行本机代码，请只安装可信来源。安装将修改当前账号 Profile 的依赖；操作前保留配置备份，不替换已有插件或内置组件。当前支持 npm 精确版本。' : `${confirmation.action === 'enable' ? '启用' : '停用'}此插件仅修改当前 Profile 的启动配置，不删除插件文件或历史数据。`}</p><p>本次变更不会直接卸载当前进程中的代码，需重启桌面后生效。</p></> : <><p>请输入支持 DSH 插件包规范的 npm 包及精确版本。不支持通过此入口覆盖内置组件、运行任意命令或安装普通 npm 库。</p><label>插件包与版本<input autoFocus value={spec} onChange={event => setSpec(event.target.value)} placeholder="example-dsh-plugin@1.2.3" disabled={busy}/></label></>}
      {confirmation?.action === 'install' && <p>包管理器可能重建当前 Profile 的依赖目录并替换其中的生成文件；这不是整份依赖目录的备份。此页不会执行插件卸载或删除聊天记录。</p>}
      {dialogError && <p role="alert" className="lets-plugin-error">{dialogError}</p>}{busy && <p role="status">{confirmation?.action === 'install' ? '正在安装，请稍候（最长约两分钟）…' : '正在处理…'}</p>}
      <div className="lets-module-dialog-actions"><button disabled={busy} onClick={() => {setAdding(false); setConfirmation(undefined)}}>取消</button><button className="lets-module-primary" data-primary disabled={busy || (!confirmation && !spec.trim())} onClick={() => void act(async () => {
        if (!confirmation) {const preview = await api.preview({action: 'inspect-install', spec: spec.trim()}); if (alive.current) setConfirmation(preview); return}
        let result: DesktopPluginSnapshot
        try {result = await api.confirm(confirmation.previewId)}
        catch (error) {
          // Confirmation is single-use, including failed operations. Return to the
          // list with fresh state rather than letting the user retry a spent token.
          const fresh = await api.read().catch(() => undefined)
          if (alive.current) {setConfirmation(undefined); setAdding(false); if (fresh) setSnapshot(fresh); setError(error instanceof Error ? error.message : '操作未完成，请刷新重试。')}
          return
        }
        if (alive.current) {setSnapshot(result); setConfirmation(undefined); setAdding(false); setNotice('插件配置已保存，请在方便时重启桌面。')}
      }, true)}>{confirmation ? (confirmation.action === 'install' ? '确认安装' : '确认变更') : '下一步'}</button></div>
    </PluginDialog>}
  </div></section>
}
/** Shadow only the documented plugin panel; do not replace the sidebar or upstream files. */
export function applyDesktopPluginManager(ctx: Context, environment: DesktopClientEnvironment): void {
  if (environment.mode === 'compatibility') return
  const api = createDesktopPluginManagerApi()
  ctx.effect(() => {const node = document.createElement('style'); node.textContent = desktopPluginManagerStyles; document.head.append(node); return () => node.remove()}, 'desktop: plugin manager styles')
  ctx.slots.inject('main', () => ctx.slots.register({name: 'main', key: DESKTOP_PLUGINS_PANEL, priority: -100, inject: () => ({api})}, DesktopPluginManagerPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({name: 'sidebar.panellist', id: DESKTOP_PLUGINS_PANEL, priority: -100, order: 0, label: '插件'}, PluginIcon))
}
