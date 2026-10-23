// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,describe,it,expect,vi} from 'vitest'
import {EnterpriseAccount,applyEnterpriseAccount} from '../src/client/enterprise-account.tsx'
import type {EnterpriseApplicationsBridge} from '../src/enterprise-applications-contract.ts'

const account={name:'这是一个用于验证省略显示的较长员工姓名',username:'employee',departmentName:'研发部'}
let root:Root|undefined,fixture:HTMLElement|undefined
afterEach(async()=>{if(root)await act(async()=>root!.unmount());fixture?.remove();root=undefined;fixture=undefined;vi.unstubAllGlobals();vi.useRealTimers()})
async function setup(wide=true,invoke=vi.fn(async()=>({ok:true as const,account}))){
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  fixture=document.createElement('div');fixture.innerHTML='<div id="foot"><div id="actions"></div><div id="settings"><span data-slot="sidebar.settings"><button>设置</button></span></div></div>'
  document.body.append(fixture);root=createRoot(fixture.querySelector('#actions')!)
  const bridge={invoke} as EnterpriseApplicationsBridge
  const render=async(nextWide=wide)=>{await act(async()=>root!.render(createElement(EnterpriseAccount,{bridge,initialAccount:account,wide:nextWide})))}
  await render();return{invoke,render,button:()=>fixture!.querySelector<HTMLButtonElement>('.lets-account-button')!}
}
describe('enterprise account beside Settings',()=>{
  it('keeps Settings and the named account in the same row without modifying the settings button',async()=>{
    const s=await setup(),row=fixture!.querySelector('#settings')!
    expect(row.getAttribute('data-lets-account-row')).toBe('wide')
    expect(s.button().parentElement).toBe(row)
    expect(row.querySelector('button')?.textContent).toBe('设置')
    expect(s.button().textContent).toContain(account.name)
    expect(s.button().title).toContain(account.departmentName)
    await act(async()=>s.button().click())
    expect(s.invoke).toHaveBeenCalledWith({action:'account-menu',x:0,y:0})
    expect(s.button().getAttribute('aria-expanded')).toBe('false')
  })
  it('keeps an accessible icon in the collapsed rail and restores the full name on expand',async()=>{
    const s=await setup(false)
    expect(s.button().textContent).toBe('')
    expect(s.button().getAttribute('aria-label')).toContain(account.name)
    await s.render(true);expect(s.button().textContent).toContain(account.name)
    await act(async()=>root!.unmount());root=undefined
    expect(fixture!.querySelector('#settings')?.hasAttribute('data-lets-account-row')).toBe(false)
  })
  it('reports a retryable native menu failure without showing raw errors',async()=>{
    const invoke=vi.fn(async()=>{throw new Error('private detail')})
    const s=await setup(true,invoke);await act(async()=>s.button().click())
    expect(fixture!.querySelector('[role=alert]')?.textContent).toContain('请重试')
    expect(fixture!.textContent).not.toContain('private detail')
  })
  it('refreshes public identity and clears stale names when the session becomes unavailable',async()=>{
    vi.useFakeTimers();const s=await setup()
    s.invoke.mockResolvedValueOnce({ok:true,account:{...account,name:'新姓名'}})
    await act(async()=>{await vi.advanceTimersByTimeAsync(30000)})
    expect(s.button().textContent).toContain('新姓名')
    s.invoke.mockRejectedValueOnce(new Error('locked'))
    await act(async()=>{await vi.advanceTimersByTimeAsync(30000)})
    expect(s.button().textContent).not.toContain('新姓名')
    expect(fixture!.querySelector('[role=alert]')?.textContent).toContain('账号信息暂不可用')
  })
  it('does not register an enterprise account for ordinary development mode',async()=>{
    const effect=vi.fn();applyEnterpriseAccount({effect} as never);expect(effect).not.toHaveBeenCalled()
  })
})
