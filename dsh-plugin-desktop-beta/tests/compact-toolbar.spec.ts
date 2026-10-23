// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest'
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {CompactToolbar,applyCompactToolbar} from '../src/client/compact-toolbar.tsx'
import type {DesktopClientEnvironment} from '../src/client/environment.ts'

let root:Root|undefined,container:HTMLDivElement|undefined
afterEach(async()=>{if(root)await act(async()=>root!.unmount());container?.remove();root=undefined;container=undefined;vi.unstubAllGlobals()})
async function render(english=false){
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
  const toggle=vi.fn()
  await act(async()=>root!.render(createElement(CompactToolbar,{toggleSidebar:toggle,english})))
  return toggle
}
async function click(label:string){
  const button=[...document.querySelectorAll('button')].find(item=>item.textContent===label||item.getAttribute('aria-label')===label)
  expect(button).toBeDefined()
  await act(async()=>button!.click())
}
describe('compact native toolbar',()=>{
  it('keeps labelled native actions and the sidebar toggle keyboard accessible',async()=>{
    const invoke=vi.fn(async()=>{});vi.stubGlobal('dshDesktopActions',{invoke})
    const toggle=await render()
    await click('切换侧边栏');await click('应用')
    expect(toggle).toHaveBeenCalledOnce()
    expect(invoke.mock.calls).toEqual([['application-menu']])
    expect(document.querySelector('nav')?.textContent).not.toContain('编辑')
    expect(document.querySelector('nav')?.getAttribute('aria-label')).toBe('应用菜单')
    expect([...document.querySelectorAll('button')].every(button=>button.type==='button')).toBe(true)
  })
  it('shows a retryable error without exposing native APIs in ordinary browsers',async()=>{
    await render();await click('应用')
    expect(document.querySelector('[role=alert]')?.textContent).toContain('原生菜单不可用')
    const invoke=vi.fn(async()=>{});vi.stubGlobal('dshDesktopActions',{invoke})
    await click('应用');expect(document.querySelector('[role=alert]')).toBeNull()
    expect(invoke).toHaveBeenCalledOnce()
  })
  it('localizes failure text and catches native menu errors',async()=>{
    vi.stubGlobal('dshDesktopActions',{invoke:async()=>{throw new Error('private native details')}})
    await render(true);await click('Application')
    expect(document.querySelector('[role=alert]')?.textContent).toBe('Could not open the menu.')
    expect(document.body.textContent).not.toContain('private native details')
  })
  it('injects layout only in a child and only for enhanced Windows',()=>{
    const inject=vi.fn(),effect=vi.fn(),ctx={inject,effect}
    const base:DesktopClientEnvironment={platform:'win32',mode:'advanced',material:'off',micaSupported:false,version:'2.0.0'}
    applyCompactToolbar(ctx as never,{...base,mode:'compatibility'})
    applyCompactToolbar(ctx as never,{...base,mode:'extended'})
    applyCompactToolbar(ctx as never,{...base,platform:'darwin'})
    expect(inject).not.toHaveBeenCalled()
    applyCompactToolbar(ctx as never,base)
    expect(inject).toHaveBeenCalledOnce();expect(inject.mock.calls[0]![0]).toEqual(['layout'])
  })
})
