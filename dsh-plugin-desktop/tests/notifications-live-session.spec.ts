import {Context} from '@deepseek-ai/cordis'
import {SessionStore,SessionId} from '@deepseek-ai/dsh-session'
import {expect,it,vi} from 'vitest'
import * as notifications from '../src/notifications.ts'

it('observes a real new-kernel SessionStore turn, not just a mocked event emitter',async()=>{
  const ctx=new Context(),notifyAttention=vi.fn()
  ctx.provide('desktopRuntime',{notifyAttention} as never)
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(notifications,notifications.DesktopNotificationSettingsSchema({} as never) as never)
    const session=ctx.sessions.create(SessionId('notification-live-fixture'))
    session.append('turn/start',{turn:1})
    session.append('step/start',{turn:1,step:1})
    session.append('user/message',{id:'message-fixture',role:'user',source:{kind:'user'},content:[{type:'text',text:'fixture'}]} as never,{surfaceOp:'append'})
    session.append('step/end',{turn:1,step:1})
    session.append('turn/end',{turn:1,reason:{kind:'completed'}})
    expect(notifyAttention).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({title:'LETS · 回复已完成'}))
  } finally {await ctx.fiber.dispose()}
})
