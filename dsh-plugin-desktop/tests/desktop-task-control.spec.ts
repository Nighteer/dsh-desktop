import { describe, it, expect, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installDesktopTaskControl } from '../src/desktop-task-control.ts'

function fixture() {
  const agents: any[] = []
  const jobs: any[] = []
  const effects: (() => void)[] = []
  let request: (...args: any[]) => Promise<void>
  const activity = vi.fn(async () => [] as {kind: string}[])
  const ctx = { get: (key: string) => key === 'agents' ? {list: () => agents} : key === 'jobs' ? {list: () => jobs} : undefined,
    effect: (fn: () => () => void) => effects.push(fn()),
    on: (_name: string, fn: typeof request) => {request = fn}, waterfall: activity } as unknown as Context
  const control = installDesktopTaskControl(ctx)
  return {ctx, control, agents, jobs, activity, stop: () => effects.forEach(fn => fn()),
    request: (...args: any[]) => request(...args)}
}
const agent = (status = 'idle') => ({id: 'session-a', status, inbox: {nextTurn: [] as unknown[], nextStep: [] as unknown[]}})

describe('Host task admission', () => {
  it('is idempotent and an idle Host is safe', async () => {
    const f = fixture()
    expect(installDesktopTaskControl(f.ctx)).toBe(f.control)
    expect(await f.control.inspectQuit()).toEqual({activeTasks: false, scheduledTasks: false})
  })
  it.each(['running', 'queued-turn', 'queued-step', 'background', 'stopping'])('counts %s work', async kind => {
    const f = fixture(), a = agent(kind === 'running' ? 'running' : 'idle')
    f.agents.push(a)
    if(kind === 'queued-turn') a.inbox.nextTurn.push({})
    if(kind === 'queued-step') a.inbox.nextStep.push({})
    if(kind === 'background' || kind === 'stopping') f.jobs.push({status: kind === 'background' ? 'running' : 'stopping'})
    expect((await f.control.inspectQuit()).activeTasks).toBe(true)
  })
  it('counts armed reminders separately', async () => {
    const f = fixture(); f.agents.push(agent()); f.activity.mockResolvedValue([{kind: 'schedule'}])
    expect(await f.control.inspectQuit()).toEqual({activeTasks: false, scheduledTasks: true})
  })
  it('drains admitted requests, rejects new ones, and reopens after cancellation', async () => {
    const f = fixture(), finished = Promise.withResolvers<void>()
    const response = {writeHead: vi.fn(), end: vi.fn()}
    const first = f.request({}, response, () => finished.promise)
    const drained = vi.fn()
    const locking = f.control.updateTasks('lock').then(drained)
    await Promise.resolve(); expect(drained).not.toHaveBeenCalled()
    const next = vi.fn()
    await f.request({}, response, next)
    expect(response.writeHead).toHaveBeenCalledWith(503); expect(next).not.toHaveBeenCalled()
    finished.resolve(); await first; await locking
    await f.control.updateTasks('unlock')
    await f.request({}, response, next); expect(next).toHaveBeenCalledOnce()
  })
  it('a timed-out lock cannot become active again after unlock', async () => {
    const f = fixture(), finished = Promise.withResolvers<void>()
    const first = f.request({}, {}, () => finished.promise)
    const locking = f.control.updateTasks('lock')
    const rejection = expect(locking).rejects.toThrow('superseded')
    await f.control.updateTasks('unlock'); finished.resolve(); await first; await rejection
  })
  it('rejects inspection after disposal', async () => {
    const f = fixture(); f.stop()
    await expect(f.control.inspectQuit()).rejects.toThrow('stopping')
  })
})
