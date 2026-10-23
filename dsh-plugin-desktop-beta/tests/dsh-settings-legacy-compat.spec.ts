import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { desktopConfigScope, readConfigForm, watchConfigForms } from '../src/config-forms.ts'

describe('profile-native settings compatibility', () => {
  it('reads only the requested native entry without opening legacy files', () => {
    const ctx={get:()=>({describe:()=>[{ns:'desktop-shell',value:{mode:'advanced'}}]})} as unknown as Context
    expect(readConfigForm(ctx,'desktop-shell')).toEqual({mode:'advanced'})
    expect(readConfigForm(ctx,'unknown')).toBeUndefined()
  })
  it('delegates validated updates to the native profile form', async () => {
    const update=vi.fn(async()=>{})
    const settings={describe:()=>[{ns:'desktop-shell',value:{port:0}}],update}
    const ctx={get:()=>settings,settings} as unknown as Context
    const scope=desktopConfigScope(ctx,'desktop-shell',{port:0},value=>{if(value.port<0)throw Error('invalid port')})
    await scope.update({port:43120})
    expect(update).toHaveBeenCalledWith('desktop-shell',{port:43120})
    await expect(scope.update({port:-1})).rejects.toThrow('invalid port')
    expect(update).toHaveBeenCalledOnce()
  })
  it('coalesces document events and stops queued observers when disposed', async () => {
    let listener:(ns:string)=>void=()=>{}
    const stop=vi.fn()
    const ctx={get:()=>({describe:()=>[{ns:'probe',value:{enabled:true}}]}),on:(_event:string,callback:typeof listener)=>{listener=callback;return stop},effect:vi.fn()} as unknown as Context
    const observer=vi.fn()
    const dispose=watchConfigForms(ctx,observer)
    listener('probe');listener('probe');await Promise.resolve()
    expect(observer).toHaveBeenCalledOnce()
    listener('probe');dispose();await Promise.resolve()
    expect(observer).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
  })
  it('loads the upgraded market without removed settings helper imports', async () => {
    const require=createRequire(import.meta.url)
    const loaded=await import(pathToFileURL(join(dirname(require.resolve('dshmarket/package.json')),'lib','settings.js')).href)
    expect(loaded.MARKET_SETTINGS_NS).toBe('dsh-market')
    expect(loaded.installMarketSettings).toBeTypeOf('function')
  })
})
