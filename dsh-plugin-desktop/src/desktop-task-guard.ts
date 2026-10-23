/** Serialize user exits/restarts, inspect actual Host work, and drain API admission. */
import type { DesktopTaskControl, DesktopTaskInspection } from './desktop-task-control.ts'
import type { DesktopDialogOptions, DesktopDialogResult } from './desktop-dialog-window.ts'

type Action = 'quit' | 'restart'
interface Options {
  control(): DesktopTaskControl | undefined
  locale(): 'en' | 'zh'
  show(options: DesktopDialogOptions): Promise<DesktopDialogResult>
  log(message: string): void
  timeoutMs?: number
}

export class DesktopTaskGuard {
  private pending: Promise<boolean> | undefined
  private disposed = false
  constructor(private readonly options: Options) {}

  /** Concurrent requests share the first decision and never execute another transition. */
  run(action: Action, operation: () => Promise<void>): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    if (this.pending !== undefined) return this.pending
    const pending = Promise.resolve().then(() => this.decide(action, operation))
      .finally(() => { if (this.pending === pending) this.pending = undefined })
    this.pending = pending
    return pending
  }
  /** Security lock, OS shutdown and fatal recovery bypass normal user confirmation. */
  dispose(): void { this.disposed = true }

  private async bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('LETS task inspection timed out')), this.options.timeoutMs ?? 2000)
      })])
    } finally { clearTimeout(timer) }
  }

  private async confirm(action: Action, state: DesktopTaskInspection | 'unknown'): Promise<boolean> {
    if (state !== 'unknown' && !state.activeTasks && !state.scheduledTasks) return true
    const en = this.options.locale() === 'en'
    const verb = action === 'quit' ? (en ? 'Quit' : '退出') : (en ? 'Restart' : '重启')
    const detail = state === 'unknown'
      ? (en ? 'Task status could not be read. Running work may be interrupted.' : '暂时无法读取任务状态，继续可能中断正在进行的任务。')
      : [state.activeTasks ? (en ? 'Running tasks, queued messages or background work will be interrupted.' : '正在运行的任务、排队消息或后台作业将被中断。') : '',
        state.scheduledTasks ? (en ? 'Scheduled reminders cannot run while LETS is closed.' : 'LETS 关闭期间，已设置的定时任务不会运行。') : ''].filter(Boolean).join('\n')
    const result = await this.options.show({ type: 'warning', title: 'LETS', message: en ? `${verb} LETS?` : `确认${verb} LETS？`,
      detail, buttons: [en ? 'Cancel' : '取消', verb], defaultId: 0, cancelId: 0 })
    return !this.disposed && result.response === 1
  }

  private async decide(action: Action, operation: () => Promise<void>): Promise<boolean> {
    const control = this.options.control()
    if (control === undefined) { if (this.disposed) return false; await operation(); return true }
    let initial: DesktopTaskInspection | 'unknown'
    try { initial = await this.bounded(control.inspectQuit()) }
    catch (error) { this.options.log(String(error)); initial = 'unknown' }
    if (this.disposed || !await this.confirm(action, initial)) return false
    let committed = false
    try {
      // Stop new API work, then wait for already-admitted requests before rechecking.
      const active = await this.bounded(control.updateTasks('lock'))
      const current = await this.bounded(control.inspectQuit())
      const newlyActive = (active || current.activeTasks) && initial !== 'unknown' && !initial.activeTasks
      const newlyScheduled = current.scheduledTasks && initial !== 'unknown' && !initial.scheduledTasks
      if (this.disposed || ((newlyActive || newlyScheduled) && !await this.confirm(action, { ...current, activeTasks: active || current.activeTasks }))) return false
      await operation()
      committed = true
      return true
    } catch (error) {
      this.options.log(String(error))
      if (!this.disposed) {
        const en = this.options.locale() === 'en'
        await this.options.show({ type: 'warning', title: 'LETS',
          message: en ? 'Could not safely stop the workspace' : '暂时无法安全停止工作区',
          detail: en ? 'The action was cancelled. Please try again or use recovery if the Host is unresponsive.' : '本次操作已取消，请稍后重试。若宿主无响应，可使用恢复模式。',
          buttons: [en ? 'OK' : '知道了'], defaultId: 0, cancelId: 0 })
      }
      return false
    } finally {
      if (!committed) {
        try { await this.bounded(control.updateTasks('unlock')) } catch (error) { this.options.log(String(error)) }
      }
    }
  }
}
