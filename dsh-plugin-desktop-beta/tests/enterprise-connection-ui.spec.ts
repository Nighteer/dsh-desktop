// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {EnterpriseLoginApp} from '../src/native-ui/enterprise-login-view.tsx'
import type {EnterpriseLoginBridge,EnterpriseLoginState} from '../src/enterprise-login-contract.ts'
let root:Root|undefined,container:HTMLDivElement
afterEach(async()=>{if(root)await act(async()=>root!.unmount());container?.remove();vi.unstubAllGlobals()})
const initial:EnterpriseLoginState={mustChangePassword:false,allowRemember:true,message:'',phase:'connection',origin:''}
async function mount(invoke:EnterpriseLoginBridge['invoke']){
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);container=document.createElement('div');document.body.append(container);root=createRoot(container)
  await act(async()=>root!.render(createElement(EnterpriseLoginApp,{bridge:{invoke}})))
}
async function click(label:string){await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent===label)!.click())}
async function fill(value:string){await act(async()=>{const input=container.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})}
async function submit(){await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))}
describe('enterprise connection and login UI',()=>{
  it('does not show password fields before a compatible service is selected and clears them when changing service',async()=>{
    const invoke=vi.fn<EnterpriseLoginBridge['invoke']>().mockResolvedValueOnce({ok:true,state:initial}).mockResolvedValueOnce({ok:true,state:{...initial,phase:'login',origin:'https://first.example',instanceId:'first'}}).mockResolvedValueOnce({ok:true,state:{...initial,origin:'https://first.example'}})
    await mount(invoke);expect(container.querySelector('input[type=password]')).toBeNull();expect(container.querySelector('img')?.alt).toBe('LETS')
    await fill('https://first.example');await submit();expect(invoke).toHaveBeenLastCalledWith({action:'connect',origin:'https://first.example'})
    expect(container.querySelector('input[type=password]')).not.toBeNull();expect(container.querySelector('.login-service')?.textContent).toContain('https://first.example')
    await click('更换');expect(invoke).toHaveBeenLastCalledWith({action:'change-service'});expect(container.querySelector('input[type=password]')).toBeNull()
  })
  it('retains the typed address, announces connection errors and retries without ever sending a password',async()=>{
    const invoke=vi.fn<EnterpriseLoginBridge['invoke']>().mockResolvedValueOnce({ok:true,state:initial}).mockResolvedValueOnce({ok:false,state:initial,error:'无法连接，请检查网络后重试。'}).mockResolvedValueOnce({ok:true,state:{...initial,phase:'login',origin:'https://first.example'}})
    await mount(invoke);await fill('https://first.example');await submit()
    expect(container.querySelector('[role=alert]')?.textContent).toContain('检查网络');expect(container.querySelector('input')?.value).toBe('https://first.example')
    await submit();expect(invoke.mock.calls.filter(([value])=>value.action==='connect')).toHaveLength(2)
  })
  it('requires a visible confirmation for changed enterprise identity and supports cancelling it',async()=>{
    const invoke=vi.fn<EnterpriseLoginBridge['invoke']>().mockResolvedValueOnce({ok:true,state:{...initial,origin:'https://first.example',instanceChange:{previous:'old-company',next:'new-company'}}}).mockResolvedValueOnce({ok:true,state:initial})
    await mount(invoke);expect(container.textContent).toContain('不会自动恢复旧企业凭证');expect(container.textContent).toContain('old-company');expect(container.querySelector('input[type=password]')).toBeNull()
    await click('取消，重新填写地址');expect(invoke).toHaveBeenLastCalledWith({action:'cancel-service-change'});expect(container.textContent).not.toContain('old-company')
  })
  it('has explicit loading feedback and disables duplicate connection submissions',async()=>{
    let resolve!:(result:{ok:boolean;state:EnterpriseLoginState})=>void
    const invoke=vi.fn<EnterpriseLoginBridge['invoke']>().mockResolvedValueOnce({ok:true,state:initial}).mockImplementationOnce(()=>new Promise(done=>{resolve=done}))
    await mount(invoke);await fill('https://first.example');await submit()
    expect(container.querySelector('button')?.disabled).toBe(true);expect(container.textContent).toContain('正在检查连接')
    await act(async()=>resolve({ok:true,state:{...initial,phase:'login'}}))
  })
})
