// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {EnterpriseResourcesPage,resourceApi} from '../src/client/enterprise-resources.tsx'
import type {ResourceManagerView} from 'dsh-enterprise-contracts'
let container:HTMLDivElement,root:Root
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});HTMLDialogElement.prototype.showModal=function(){this.open=true};container=document.createElement('div');document.body.append(container);root=createRoot(container)})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})
function fixture(){
  const view:ResourceManagerView={catalog:[{id:'company',name:'Company skill',description:'Published instructions',kind:'skill',latestVersion:'v2',versions:[{id:'v1',version:'1.0.0',published:true,enabled:true,digest:'hash1',notes:'Old',createdAt:'2026-10-18'},{id:'v2',version:'2.0.0',published:true,enabled:true,digest:'hash2',notes:'New',createdAt:'2026-10-18'}]}],installed:[{id:'local',source:'enterprise',resourceId:'company',versionId:'v1',name:'Company skill',kind:'skill',version:'1.0.0',enabled:true,status:'ready',message:'',tools:[],updatedAt:'2026-10-18'}],catalogError:''}
  const api=vi.fn(async()=>view)
  return {view,api}
}
async function render(api:typeof resourceApi){await act(async()=>root.render(createElement(EnterpriseResourcesPage,{api})))}
async function button(name:string){const element=[...container.querySelectorAll('button')].find(item=>item.textContent===name);expect(element).toBeDefined();await act(async()=>element!.click())}
async function tick(ms:number){await act(async()=>vi.advanceTimersByTimeAsync(ms))}
function pending(){let resolve!:(value:ResourceManagerView)=>void;const promise=new Promise<ResourceManagerView>(done=>{resolve=done});return {promise,resolve}}
describe('enterprise resource desktop UI',()=>{
  it('accepts a dropped ZIP but retains trust consent, and rejects other files',async()=>{
    const {api}=fixture();await render(api);await button('添加个人资源')
    async function drop(file:File){const event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{files:[file]}});await act(async()=>container.querySelector('.lets-resource-upload')!.dispatchEvent(event))}
    await drop(new File(['content'],'SKILL.md'));expect(container.querySelector('dialog [role=alert]')?.textContent).toContain('ZIP 包')
    await drop(new File(['zip'],'report.zip'));expect(container.querySelector('dialog')?.textContent).toContain('已选择：report.zip')
    expect(container.querySelector('dialog input[type=file]')?.hasAttribute('required')).toBe(false)
    const save=[...container.querySelectorAll<HTMLButtonElement>('dialog button')].find(item=>item.textContent==='确认保存并启用')!
    expect(save.disabled).toBe(true);expect(api).toHaveBeenCalledTimes(1)
  })
  it('does not install a new published version without user action',async()=>{
    const {api}=fixture();await render(api);expect(container.textContent).toContain('已安装 1.0.0');expect(container.textContent).toContain('确认更新版本');expect(api).toHaveBeenCalledTimes(1)
    vi.spyOn(window,'confirm').mockReturnValue(false);await button('确认更新版本');expect(api).toHaveBeenCalledTimes(1)
    vi.spyOn(window,'confirm').mockReturnValue(true);await button('确认更新版本');expect(api).toHaveBeenLastCalledWith({action:'install',resourceId:'company',versionId:'v2'})
  })
  it('supports keyboard tabs and shows actual installed status',async()=>{
    const {api}=fixture();await render(api)
    await act(async()=>container.querySelector('[role=tab]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})))
    expect(container.querySelector('[aria-selected=true]')?.textContent).toBe('我的安装');expect(container.textContent).toContain('已启用')
    expect(container.querySelector('[role=tabpanel]')?.getAttribute('aria-labelledby')).toBe('lets-resource-installed-tab')
  })
  it('requires explicit trust consent before personal installation',async()=>{
    const {api}=fixture();await render(api);await button('添加个人资源')
    expect(container.querySelectorAll('dialog input[type=file]')).toHaveLength(1)
    expect(container.querySelector('dialog input[type=file]')?.getAttribute('accept')).toBe('.zip')
    expect(container.querySelector('dialog')?.textContent).not.toContain('导入单个 SKILL.md')
    expect(container.querySelector('dialog')?.textContent).not.toContain('导入技能目录')
    const save=[...container.querySelectorAll<HTMLButtonElement>('dialog button')].find(item=>item.textContent==='确认保存并启用')!
    expect(save.disabled).toBe(true);expect(container.querySelector('dialog')?.textContent).toContain('读取文件、访问网络或执行本机代码')
    await button('取消');expect(api).toHaveBeenCalledTimes(1)
  })
  it('shows existing local Skills as personal installations, without nonfunctional mutation buttons',async()=>{
    const {view,api}=fixture();view.installed.push({id:'external',name:'brandkit',description:'Already installed personal skill',source:'personal',kind:'skill',version:'',enabled:true,status:'ready',message:'已在本机可用，无需重复导入。',tools:[],updatedAt:'',managed:false})
    await render(api);await button('我的安装')
    const card=[...container.querySelectorAll('article')].find(item=>item.textContent?.includes('brandkit'))!
    expect(card.textContent).toContain('个人安装');expect(card.textContent).toContain('可使用');expect(card.querySelector('button')).toBeNull()
    expect(container.querySelectorAll('article')).toHaveLength(2)
  })
  it('renders failures and a retry path without claiming success',async()=>{
    const {api}=fixture();api.mockRejectedValueOnce(new Error('Internal diagnostic'))
    await render(api);expect(container.querySelector('[role=alert]')?.textContent).toContain('刷新');expect(container.textContent).not.toContain('Internal diagnostic')
    await button('刷新资源');expect(container.textContent).toContain('Company skill')
  })
  it('shows loading only for first load and manual refresh, not periodic checks',async()=>{
    vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')
    const {view,api}=fixture(),initial=pending();api.mockReturnValueOnce(initial.promise)
    await render(api);expect(container.textContent).toContain('正在核验资源与授权')
    await act(async()=>initial.resolve(view));expect(container.textContent).not.toContain('正在核验资源与授权')
    const automatic=pending();api.mockReturnValueOnce(automatic.promise);await tick(15000)
    expect(api).toHaveBeenCalledTimes(2);expect(container.textContent).not.toContain('正在核验资源与授权')
    const refresh=[...container.querySelectorAll('button')].find(item=>item.textContent==='刷新资源')!
    expect(refresh.disabled).toBe(false)
    // A manual click joins the ongoing read, with visible feedback and no duplicate request.
    await button('刷新资源');expect(api).toHaveBeenCalledTimes(2);expect(container.textContent).toContain('正在核验资源与授权')
    await act(async()=>automatic.resolve(structuredClone(view)));expect(container.textContent).not.toContain('正在核验资源与授权')
  })
  it('does not touch the DOM for unchanged polling data or reset search, scroll, focus and a dialog',async()=>{
    vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')
    const {view,api}=fixture();api.mockImplementation(async()=>structuredClone(view));await render(api)
    const search=container.querySelector<HTMLInputElement>('input[type=search]')!,panel=container.querySelector<HTMLElement>('[role=tabpanel]')!
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'Company');search.dispatchEvent(new Event('input',{bubbles:true}))})
    panel.scrollTop=180;await button('添加个人资源')
    const upload=container.querySelector<HTMLInputElement>('dialog input[type=file]')!;upload.focus()
    const changes:MutationRecord[]=[],observer=new MutationObserver(records=>changes.push(...records));observer.observe(container,{attributes:true,childList:true,characterData:true,subtree:true})
    await tick(30000);observer.disconnect()
    expect(api).toHaveBeenCalledTimes(3);expect(changes).toHaveLength(0)
    expect(search.value).toBe('Company');expect(panel.scrollTop).toBe(180);expect(document.activeElement).toBe(upload)
    expect(container.querySelector('dialog')).not.toBeNull();expect(container.querySelector('dialog input[type=file]')).toBe(upload)
  })
  it('keeps polling connecting resources even with identical responses, then stops fast checks on ready or failed',async()=>{
    vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')
    const {view,api}=fixture();view.installed[0]!.status='connecting';api.mockImplementation(async()=>structuredClone(view));await render(api)
    await tick(3000);expect(api).toHaveBeenCalledTimes(4)
    view.installed[0]!.status='ready';await tick(1000);expect(api).toHaveBeenCalledTimes(5)
    await tick(3000);expect(api).toHaveBeenCalledTimes(5)
    view.installed[0]!.status='connecting';await button('刷新资源');await tick(1000);expect(api).toHaveBeenCalledTimes(7)
    view.installed[0]!.status='failed';await tick(1000);expect(api).toHaveBeenCalledTimes(8)
    await tick(3000);expect(api).toHaveBeenCalledTimes(8)
  })
  it('allows mutations during a silent read and ignores the older response afterwards',async()=>{
    vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');vi.spyOn(window,'confirm').mockReturnValue(true)
    const {view}=fixture(),older=pending(),updated=structuredClone(view);updated.installed[0]!.enabled=false;updated.installed[0]!.status='disabled'
    let reads=0;const api=vi.fn(async(body?:object)=>body?updated:++reads===1?view:older.promise)
    await render(api);await button('我的安装');await tick(15000);await button('停用')
    expect(api).toHaveBeenLastCalledWith({action:'toggle',id:'local',enabled:false});expect(container.textContent).toContain('已停用')
    await act(async()=>older.resolve(view));expect(container.textContent).toContain('已停用')
  })
  it('retains the last list on background errors, recovers quietly and skips hidden-page polls',async()=>{
    vi.useFakeTimers();const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('visible')
    const {api}=fixture();await render(api);api.mockRejectedValueOnce(new Error('Internal diagnostic'));await tick(15000)
    expect(container.textContent).toContain('Company skill');expect(container.textContent).toContain('请检查企业连接后刷新');expect(container.textContent).not.toContain('正在核验资源与授权')
    await tick(15000);expect(container.querySelector('[role=alert]')).toBeNull()
    visibility.mockReturnValue('hidden');await tick(30000);expect(api).toHaveBeenCalledTimes(3)
  })
  it('uses same-origin authenticated JSON and explicit mutation confirmation',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify(fixture().view),{status:200,headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher)
    await resourceApi({action:'toggle',id:'local',enabled:false})
    const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit]
    expect(url).toBe('/api/desktop/resources');expect(options.credentials).toBe('same-origin');expect(JSON.parse(String(options.body))).toMatchObject({confirmed:true,action:'toggle',enabled:false})
  })
})
