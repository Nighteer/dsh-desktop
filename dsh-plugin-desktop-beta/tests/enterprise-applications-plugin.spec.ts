// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest'
import {readFileSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {inject as desktopInject} from '../src/client/index.ts'
import {applyAdvancedShell} from '../src/client/advanced-shell.ts'
import {applyExtendedShell} from '../src/client/extended-shell.ts'
import {applyEnterpriseApplications,ENTERPRISE_APPLICATIONS_PANEL} from '../src/client/enterprise-applications.tsx'
import type {EnterpriseApplicationsBridge,EnterpriseApplicationsEvent} from '../src/enterprise-applications-contract.ts'

const dispose:(()=>void)[]=[]
afterEach(()=>{for(const effect of dispose.splice(0).reverse())effect();delete (window as unknown as Record<string,unknown>).letsEnterpriseApplications})
function bench(bridge:EnterpriseApplicationsBridge|undefined){
  if(bridge)(window as unknown as {letsEnterpriseApplications:EnterpriseApplicationsBridge}).letsEnterpriseApplications=bridge
  const registrations:Record<string,unknown>[]=[],select=vi.fn()
  const ctx={inject:(_services:string[],execute:(ctx:unknown)=>unknown)=>execute(ctx),effect:(execute:()=>unknown)=>{const result=execute();if(typeof result==='function')dispose.push(result as ()=>void)},slots:{inject:(_name:string,execute:()=>unknown)=>execute(),register:(options:Record<string,unknown>)=>{registrations.push(options);return()=>{}}},layout:{selectPanel:select}}
  return{ctx:ctx as unknown as Parameters<typeof applyEnterpriseApplications>[0],registrations,select}
}
describe('enterprise application desktop plugin',()=>{
  it('has no enterprise entry in a normal browser without the native bridge',()=>{
    const s=bench(undefined);applyEnterpriseApplications(s.ctx);expect(s.registrations).toEqual([])
  })
  it('uses the supported sidebar seat immediately after plugins and a matching main panel',async()=>{
    const bridge={invoke:vi.fn().mockResolvedValue({ok:true,enabled:true})},s=bench(bridge)
    applyEnterpriseApplications(s.ctx);await Promise.resolve()
    expect(s.registrations).toContainEqual(expect.objectContaining({name:'sidebar.panellist',id:ENTERPRISE_APPLICATIONS_PANEL,order:1,label:'企业应用'}))
    expect(s.registrations).toContainEqual(expect.objectContaining({name:'main',key:ENTERPRISE_APPLICATIONS_PANEL}))
    expect(s.registrations.some(item=>item.name==='sidebar')).toBe(false)
  })
  it('does not enable enterprise UI when capabilities are absent or rejected',async()=>{
    for(const result of [{ok:true,enabled:false},{ok:false,error:'unavailable'}]){
      const s=bench({invoke:vi.fn().mockResolvedValue(result)});applyEnterpriseApplications(s.ctx);await Promise.resolve();expect(s.registrations).toEqual([])
    }
  })
  it('does not register late UI after its plugin lifetime has ended',async()=>{
    let resolve!:(value:{ok:true;enabled:true})=>void
    const s=bench({invoke:vi.fn().mockReturnValue(new Promise(r=>{resolve=r}))});applyEnterpriseApplications(s.ctx)
    dispose.pop()!();resolve({ok:true,enabled:true});await Promise.resolve();expect(s.registrations).toEqual([])
  })
  it('native menu selection selects the same in-window panel rather than a separate window',async()=>{
    let receive!:(event:EnterpriseApplicationsEvent)=>void
    const bridge={invoke:vi.fn().mockResolvedValue({ok:true,enabled:true}),subscribe:(listener:typeof receive)=>{receive=listener;return()=>{}}},s=bench(bridge)
    applyEnterpriseApplications(s.ctx);await Promise.resolve();receive({type:'select'});expect(s.select).toHaveBeenCalledWith(ENTERPRISE_APPLICATIONS_PANEL)
  })
  it('does not make the layout provider wait for its own service',()=>{
    const source=readFileSync(resolve(process.cwd(),'src/client/index.ts'),'utf8')
    expect(desktopInject).not.toContain('layout');expect(source).toContain('applyEnterpriseApplications(ctx)')
  })
  it.each(['advanced','extended'] as const)('starts the %s layout provider before its enterprise consumer',async mode=>{
    const ctx=new Context(),s=bench({invoke:vi.fn().mockResolvedValue({ok:true,enabled:true})})
    const root=document.createElement('div');root.id='root';document.body.append(root)
    const slots={...s.ctx.slots,entries:()=>[],provideRoot:()=>()=>{},subscribe:()=>()=>{}}
    for(const service of desktopInject)ctx.reflect.provide(service,service==='slots'?slots:service==='theme'?{getTheme:()=>({active:{colorScheme:'light',tokens:{}}})}:{})
    const select=vi.fn()
    try{
      const fiber=ctx.plugin({inject:desktopInject,apply(parent){
        applyEnterpriseApplications(parent)
        expect(s.registrations).toEqual([])
        const environment={mode,platform:'win32' as const,material:'off' as const,micaSupported:false,version:'test'}
        if(mode==='advanced')applyAdvancedShell(parent,environment)
        else applyExtendedShell(parent,environment)
      }})
      await expect.poll(()=>fiber.state).toBe(2)
      await expect.poll(()=>s.registrations.some(item=>item.id===ENTERPRISE_APPLICATIONS_PANEL)).toBe(true)
      const layout=ctx.reflect.get('layout',false) as {selectPanel:(id:unknown)=>void}
      expect(layout).toBeDefined()
      const main=s.registrations.find(item=>item.key===ENTERPRISE_APPLICATIONS_PANEL)!
      layout.selectPanel=select
      ;(main.inject as ()=>{backToChat:()=>void})().backToChat()
      expect(select).toHaveBeenCalledWith(null)
      await fiber.dispose()
      expect(ctx.reflect.get('layout',false)).toBeUndefined()
    }finally{await ctx.fiber.dispose();root.remove();delete document.body.dataset.dshDesktopMode}
  })
  it('builds sandboxed preloads separately with no sibling-chunk require',()=>{
    const config=readFileSync(resolve(process.cwd(),'tsdown.config.ts'),'utf8')
    expect(config).toMatch(/map\(entry\s*=>/u);expect(config).toContain('codeSplitting: false')
    for(const entry of ['preload','compatibility-preload','enterprise-preload','enterprise-applications-preload']){
      const path=resolve(process.cwd(),`lib/${entry}.cjs`)
      if(existsSync(path))expect(readFileSync(path,'utf8')).not.toMatch(/require\(["']\.{1,2}\//u)
    }
  })
})
