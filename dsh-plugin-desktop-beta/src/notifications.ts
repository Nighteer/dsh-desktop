/** Privacy-safe desktop attention for completed direct-user replies, never internal jobs. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import type { DesktopNotification } from './runtime.ts'
import { desktopConfigScope } from './config-forms.ts'

export const name = 'desktop-notifications'
export const inject = ['desktopRuntime']

export const DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE = 'desktop-notifications'

export interface DesktopNotificationSettings {
  enabled: boolean
  notifyOnTurnCompletion: boolean
  notifyOnTurnFailure: boolean
  notifyOnJobCompletion: boolean
  notifyOnJobFailure: boolean
}

export const DesktopNotificationSettingsSchema: z<DesktopNotificationSettings> = z.object({
  enabled: z.boolean().default(true),
  notifyOnTurnCompletion: z.boolean().default(true),
  notifyOnTurnFailure: z.boolean().default(true),
  notifyOnJobCompletion: z.boolean().default(true),
  notifyOnJobFailure: z.boolean().default(true),
})

const DEFAULT_SETTINGS = DesktopNotificationSettingsSchema({} as DesktopNotificationSettings)
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  notifyOnTurnCompletion: z.boolean().default(true).volatile(),
  notifyOnTurnFailure: z.boolean().default(true).volatile(),
  notifyOnJobCompletion: z.boolean().default(true).volatile(),
  notifyOnJobFailure: z.boolean().default(true).volatile(),
})

const NOTIFICATION_COPY: Record<'turn-completed' | 'turn-failed', DesktopNotification> = {
  'turn-completed': { title: 'LETS · 回复已完成', body: '本轮回复已结束，请打开 LETS 查看结果。文件是否可用请以对话中的交付结果为准。' },
  'turn-failed': { title: 'LETS · 本轮处理未完成', body: '本轮处理遇到问题，请打开 LETS 查看详情后重试。' },
}

interface OpenTurn {
  readonly turn: number
  userInitiated: boolean
}

function trackTurn(
  runtime: Context['desktopRuntime'],
  settings: DesktopNotificationSettings,
  openTurns: Map<string, OpenTurn>,
  session: Session,
  event: SessionEvent,
): void {
  if (!settings.enabled) return
  if (session.header.origin === 'subagent') return
  const sessionId = String(session.header.id)

  if (event.type === 'turn/start') {
    openTurns.set(sessionId, { turn: event.data.turn, userInitiated: false })
    return
  }
  if (event.type === 'user/message') {
    const openTurn = openTurns.get(sessionId)
    if (openTurn !== undefined && event.data.source.kind === 'user') openTurn.userInitiated = true
    return
  }
  if (event.type !== 'turn/end') return

  const openTurn = openTurns.get(sessionId)
  if (openTurn === undefined || openTurn.turn !== event.data.turn) return
  openTurns.delete(sessionId)
  if (!openTurn.userInitiated) return

  const reason = event.data.reason.kind
  if (reason === 'completed' && settings.notifyOnTurnCompletion) {
    runtime.notifyAttention(NOTIFICATION_COPY['turn-completed'])
  } else if ((reason === 'error' || reason === 'max-tokens') && settings.notifyOnTurnFailure) {
    runtime.notifyAttention(NOTIFICATION_COPY['turn-failed'])
  }
}

/** Register optional settings and live-session observers. */
export function apply(ctx: Context, config: { [K in keyof DesktopNotificationSettings]: Volatile<boolean> }): void {
  let settings = Object.fromEntries(Object.entries(config).map(([key, value]) => [key, value.get()])) as unknown as DesktopNotificationSettings

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => {
      const scope = desktopConfigScope(settingsCtx, DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE, settings)
      settings = scope.get()
      const stopWatching = scope.watch((next) => { settings = next })
      return () => {
        stopWatching()
        settings = DEFAULT_SETTINGS
      }
    }, 'dsh-plugin-desktop: native notification settings')
  })

  // Legacy job settings remain readable for backward compatibility, but an
  // internal command's exit is not completion of the user's requested work.

  ctx.inject(['sessions'], (sessionsCtx) => {
    sessionsCtx.effect(() => {
      const openTurns = new Map<string, OpenTurn>()
      const stopEvents = sessionsCtx.on('session/event', (session, event) => {
        trackTurn(sessionsCtx.desktopRuntime, settings, openTurns, session, event)
      })
      const stopDisposed = sessionsCtx.on('session/disposed', (session) => {
        openTurns.delete(String(session.header.id))
      })
      return () => {
        stopDisposed()
        stopEvents()
      }
    }, 'dsh-plugin-desktop: direct user turn attention')
  })
}
