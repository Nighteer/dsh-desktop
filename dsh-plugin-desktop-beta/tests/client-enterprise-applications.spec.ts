// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {EnterpriseApplicationsPanel} from '../src/client/enterprise-applications.tsx'
import type {EnterpriseApplicationsBridge,EnterpriseApplicationsReply,EnterpriseApplicationViewState} from '../src/enterprise-applications-contract.ts'
let container:HTMLDivElement,root:Root
const idle:EnterpriseApplicationViewState={id:null,name:'',loading:false,canGoBack:false,canGoForward:false,error:'',notice:''}
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})
function fixture(){
  const applications=[{id:'contract',name:'合同审查',description:'检查合同风险',icon:'contract' as const,sortOrder:0},{id:'knowledge',name:'企业知识服务',description:'查找技术资料',icon:'knowledge' as const,sortOrder:1}]
  const invoke=vi.fn<EnterpriseApplicationsBridge['invoke']>(async action=>{
    if(action.action==='list')return {ok:true,applications}
    if(action.action==='open')return {ok:true,state:{...idle,id:action.id,name:'合同审查'}}
    if(action.action==='control'&&action.command==='reload')return {ok:true,state:{...idle,id:'contract',name:'合同审查'}}
    return {ok:true,state:idle}
  })
  return {bridge:{invoke},invoke}
}
async function render(bridge:EnterpriseApplicationsBridge){await act(async()=>root.render(createElement(EnterpriseApplicationsPanel,{bridge,backToChat:vi.fn()})))}
async function click(name:string){const button=[...container.querySelectorAll('button')].find(item=>(item.getAttribute('aria-label')||item.textContent)===name);expect(button).toBeDefined();await act(async()=>button!.click())}
describe('enterprise application catalog UI',()=>{
  it('filters authorized applications by category, with an explicit reset',async()=>{
    const {bridge}=fixture();await render(bridge);expect(container.querySelectorAll('article')).toHaveLength(2)
    await click('合同应用');expect(container.querySelectorAll('article')).toHaveLength(1);expect(container.querySelector('article')?.textContent).toContain('合同审查')
    expect(container.querySelector('[aria-pressed=true]')?.textContent).toBe('合同应用')
    await click('效率工具');expect(container.textContent).toContain('没有匹配的应用')
    await click('清空筛选');expect(container.querySelectorAll('article')).toHaveLength(2)
  })
  it('opens inside the application viewport and keeps navigation controls',async()=>{
    const {bridge,invoke}=fixture();await render(bridge);await click('打开应用')
    expect(invoke).toHaveBeenCalledWith({action:'open',id:'contract'})
    expect(container.querySelector('[data-enterprise-viewport]')).not.toBeNull()
    await click('刷新网页');expect(invoke).toHaveBeenCalledWith({action:'control',command:'reload'})
    await click('返回应用列表');expect(container.querySelectorAll('article')).toHaveLength(2)
  })
  it('keeps loaded cards visible if a background refresh fails and offers retry',async()=>{
    vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')
    const {bridge,invoke}=fixture();await render(bridge)
    invoke.mockImplementationOnce(async()=>{throw new Error('企业连接暂不可用')})
    await act(async()=>vi.advanceTimersByTimeAsync(30000))
    expect(container.querySelectorAll('article')).toHaveLength(2);expect(container.querySelector('[role=alert]')?.textContent).toContain('企业连接暂不可用')
    expect(container.textContent).not.toContain('正在核验应用权限')
    await click('重试');expect(container.querySelector('[role=alert]')).toBeNull()
  })
  it('does not swallow an open click while a quiet catalog read is pending',async()=>{
    vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')
    const {bridge,invoke}=fixture();await render(bridge)
    let finish!:(reply:EnterpriseApplicationsReply)=>void
    invoke.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    await act(async()=>vi.advanceTimersByTimeAsync(30000));await click('打开应用')
    expect(invoke).toHaveBeenCalledWith({action:'open',id:'contract'})
    await act(async()=>finish({ok:true,applications:[]}))
  })
  it('renders a permission-aware empty state instead of unusable links',async()=>{
    const bridge:EnterpriseApplicationsBridge={invoke:async():Promise<EnterpriseApplicationsReply>=>({ok:true,applications:[],state:idle})}
    await render(bridge);expect(container.textContent).toContain('管理员发布并授权后');expect(container.querySelectorAll('article')).toHaveLength(0)
  })
})
