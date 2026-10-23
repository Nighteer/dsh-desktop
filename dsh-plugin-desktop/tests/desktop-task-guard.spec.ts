import { describe, it, expect, vi } from 'vitest'
import { DesktopTaskGuard } from '../src/desktop-task-guard.ts'
import type { DesktopTaskControl, DesktopTaskInspection } from '../src/desktop-task-control.ts'

function fixture(state: DesktopTaskInspection = {activeTasks: false, scheduledTasks: false}) {
  const control = {inspectQuit: vi.fn(async () => state), updateTasks: vi.fn(async (_action: 'inspect' | 'lock' | 'unlock') => state.activeTasks)}
  const show = vi.fn(async (_options: any) => ({response: 1}))
  const options = {control: (): DesktopTaskControl | undefined => control, locale: () => 'zh' as const, show, log: vi.fn(), timeoutMs: 10}
  return {control, show, options, guard: new DesktopTaskGuard(options), run: vi.fn(async () => {})}
}

describe('user task transition guard', () => {
  it('quits idle Host without a dialog and takes the admission lock', async () => {
    const f = fixture(); expect(await f.guard.run('quit', f.run)).toBe(true)
    expect(f.show).not.toHaveBeenCalled(); expect(f.control.updateTasks).toHaveBeenCalledWith('lock'); expect(f.run).toHaveBeenCalledOnce()
  })
  it('does not inspect or prompt before a Host exists', async () => {
    const f = fixture(); f.options.control = () => undefined
    expect(await f.guard.run('quit', f.run)).toBe(true); expect(f.control.inspectQuit).not.toHaveBeenCalled()
  })
  it.each(['quit', 'restart'] as const)('warns about running and scheduled tasks before %s, defaults to cancel', async action => {
    const f = fixture({activeTasks: true, scheduledTasks: true})
    expect(await f.guard.run(action, f.run)).toBe(true)
    const options = f.show.mock.calls[0]![0]
    expect(options.title).toBe('LETS'); expect(options.defaultId).toBe(options.cancelId)
    expect(options.detail).toContain('后台作业'); expect(options.detail).toContain('定时任务')
  })
  it('cancelling leaves Host admission and task execution unchanged', async () => {
    const f = fixture({activeTasks: true, scheduledTasks: false}); f.show.mockResolvedValue({response: 0})
    expect(await f.guard.run('quit', f.run)).toBe(false)
    expect(f.run).not.toHaveBeenCalled(); expect(f.control.updateTasks).not.toHaveBeenCalled()
  })
  it('rechecks racing tasks after lock and unlocks when the second warning is cancelled', async () => {
    const f = fixture(); f.control.updateTasks.mockResolvedValue(true); f.show.mockResolvedValue({response: 0})
    expect(await f.guard.run('restart', f.run)).toBe(false)
    expect(f.control.updateTasks.mock.calls.map(([action]) => action)).toEqual(['lock', 'unlock']); expect(f.run).not.toHaveBeenCalled()
  })
  it('merges repeated quit/restart requests into one decision', async () => {
    const f = fixture({activeTasks: true, scheduledTasks: false}), answer = Promise.withResolvers<{response: number}>()
    f.show.mockReturnValue(answer.promise)
    const other = vi.fn(async () => {})
    const first = f.guard.run('quit', f.run), second = f.guard.run('restart', other)
    expect(first).toBe(second); answer.resolve({response: 1}); await first
    expect(f.show).toHaveBeenCalledOnce(); expect(f.run).toHaveBeenCalledOnce(); expect(other).not.toHaveBeenCalled()
  })
  it('inspection timeout warns; a failed lock cancels and unlocks instead of exiting', async () => {
    const f = fixture(); f.control.inspectQuit.mockImplementation(() => new Promise(() => {}))
    f.control.updateTasks.mockRejectedValue(new Error('Host unavailable'))
    expect(await f.guard.run('quit', f.run)).toBe(false)
    expect(f.show.mock.calls[0]![0].detail).toContain('无法读取'); expect(f.run).not.toHaveBeenCalled()
    expect(f.control.updateTasks).toHaveBeenCalledWith('unlock')
  })
  it('security/OS bypass invalidates an open decision', async () => {
    const f = fixture({activeTasks: true, scheduledTasks: false}), answer = Promise.withResolvers<{response: number}>()
    f.show.mockReturnValue(answer.promise)
    const first = f.guard.run('quit', f.run)
    await vi.waitFor(() => expect(f.show).toHaveBeenCalled())
    f.guard.dispose(); answer.resolve({response: 1}); expect(await first).toBe(false); expect(f.run).not.toHaveBeenCalled()
  })
})
