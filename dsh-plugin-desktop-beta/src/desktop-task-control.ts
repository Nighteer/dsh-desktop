/** LETS host adapter for the official 0.2 task inspection/admission contract. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-schedule'

export interface DesktopTaskInspection { activeTasks: boolean; scheduledTasks: boolean }
export interface DesktopTaskControl {
  inspectQuit(): Promise<DesktopTaskInspection>
  updateTasks(action: 'inspect' | 'lock' | 'unlock'): Promise<boolean>
}

const controls = new WeakMap<Context, DesktopTaskControl>()

/** Count running agents, queued messages, approvals and live background jobs. */
export function hasDesktopActiveTasks(agents: ReturnType<Context['agents']['list']>, jobs: Context['jobs']): boolean {
  return agents.some(agent => agent.status === 'running' || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0)
    || [undefined, ...agents].some(agent => jobs.list(agent?.id).some(job => job.status === 'running' || job.status === 'stopping'))
}

export function installDesktopTaskControl(ctx: Context): DesktopTaskControl {
  const existing = controls.get(ctx)
  if (existing !== undefined) return existing
  let stopped = false
  let locked = false
  let generation = 0
  const pending = new Set<Promise<void>>()
  ctx.effect(() => () => { stopped = true; generation++ })
  ctx.on('connection/request', async (_request, response, next) => {
    if (locked) { response.writeHead(503); response.end(); return }
    const finished = Promise.withResolvers<void>()
    pending.add(finished.promise)
    try { await next() } finally { pending.delete(finished.promise); finished.resolve() }
  })
  const services = () => {
    if (stopped) throw new Error('LETS Host is stopping')
    const agents = ctx.get('agents'), jobs = ctx.get('jobs')
    if (agents === undefined || jobs === undefined) throw new Error('LETS task services are unavailable')
    return { agents: agents.list(), jobs }
  }
  const control: DesktopTaskControl = {
    async updateTasks(action) {
      if (action === 'unlock') { locked = false; generation++ }
      if (action === 'lock') {
        locked = true
        const current = ++generation
        await Promise.all(pending)
        if (stopped || current !== generation) throw new Error('LETS admission lock was superseded')
      }
      const { agents, jobs } = services()
      return hasDesktopActiveTasks(agents, jobs)
    },
    async inspectQuit() {
      const { agents, jobs } = services()
      const activeTasks = hasDesktopActiveTasks(agents, jobs)
      for (const agent of agents) {
        const activity = await ctx.waterfall('workspace/session-activity', { sessionId: agent.id }, () => Promise.resolve([]))
        if (activity.some(entry => entry.kind === 'schedule')) return { activeTasks, scheduledTasks: true }
      }
      return { activeTasks, scheduledTasks: false }
    },
  }
  controls.set(ctx, control)
  return control
}
