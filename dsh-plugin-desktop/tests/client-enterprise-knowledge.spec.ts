// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest'
import {KnowledgePicker,knowledgeApi} from '../src/client/enterprise-knowledge.tsx'
import type {KnowledgeSelectionView} from 'dsh-enterprise-contracts'
let container:HTMLDivElement,root:Root
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container)})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks()})
function fixture():KnowledgeSelectionView{return{catalog:[{id:'fixture-kb',name:'test',description:'Fixture'}],selectedIds:[],sources:[],status:''}}
async function click(selector:string){const button=document.querySelector<HTMLElement>(selector);expect(button).not.toBeNull();await act(async()=>button!.click())}
describe('desktop knowledge selector',()=>{
  it('does not select KBs implicitly and sends only local IDs after an explicit click',async()=>{
    const view=fixture(),fetcher=vi.fn(async(_url:unknown,options?:RequestInit)=>{if(options?.method==='POST')view.selectedIds=JSON.parse(options.body as string).selectedIds;return new Response(JSON.stringify(view))});vi.stubGlobal('fetch',fetcher)
    await act(async()=>root.render(createElement(KnowledgePicker,{sessionId:'session-a'})))
    expect(container.querySelector('input')).toBeNull();expect(container.textContent).toBe('知识库');expect(fetcher).toHaveBeenCalledTimes(1)
    await click('.lets-kb-trigger');expect(document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false)
    await click('input[type=checkbox]')
    const post=fetcher.mock.calls.find(call=>call[1]?.method==='POST')!
    expect(post[0]).toContain('session=session-a');expect(post[1]?.body).toBe('{"selectedIds":["fixture-kb"]}')
    expect(container.querySelector('.lets-kb-trigger')?.getAttribute('aria-label')).toContain('已选 1')
  })
  it('keeps answer sources out of the future-question selector and gives a recovery path on failures',async()=>{
    const view=fixture();view.sources=[{reference:'知识来源1',knowledgeBaseId:'kb',knowledgeBaseName:'test',documentId:'doc',title:'<img onerror=bad()>',chunkId:'chunk',content:'<script>bad()</script>',score:1}]
    const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(view))).mockResolvedValue(new Response('{}',{status:503}));vi.stubGlobal('fetch',fetcher)
    await act(async()=>root.render(createElement(KnowledgePicker,{expanded:true})))
    expect(container.querySelector('script')).toBeNull();expect(container.querySelector('img')).toBeNull();expect(container.textContent).not.toContain('<script>bad()</script>');expect(container.querySelector('[role=tab]')).toBeNull()
    await click('[aria-label="刷新知识库"]');expect(container.querySelector('[role=alert]')?.textContent).toContain('重试')
  })
  it('keeps periodic reads quiet without replacing an expanded selector',async()=>{
    vi.useFakeTimers();vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');const view=fixture(),fetcher=vi.fn(async()=>new Response(JSON.stringify(view)));vi.stubGlobal('fetch',fetcher)
    await act(async()=>root.render(createElement(KnowledgePicker,{sessionId:'session-a',expanded:true})));const panel=container.querySelector('[role=group]')!,checkbox=container.querySelector<HTMLInputElement>('input[type=checkbox]')!;checkbox.focus()
    await act(async()=>vi.advanceTimersByTimeAsync(15000));expect(fetcher).toHaveBeenCalledTimes(2);expect(container.querySelector('[role=group]')).toBe(panel);expect(document.activeElement).toBe(checkbox)
  })
  it('acknowledges checkbox clicks immediately but rolls back a failed save',async()=>{
    let settle!:(value:Response)=>void
    const deferred=new Promise<Response>(resolve=>{settle=resolve}),fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(fixture()))).mockReturnValueOnce(deferred);vi.stubGlobal('fetch',fetcher)
    await act(async()=>root.render(createElement(KnowledgePicker,{sessionId:'session-a',expanded:true})))
    await click('input[type=checkbox]')
    expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true);expect(container.textContent).toContain('正在保存选择')
    await act(async()=>settle(new Response('{}',{status:503})))
    expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);expect(container.querySelector('[role=alert]')?.textContent).toContain('重试')
  })
  it('closes the floating panel and restores focus to its compact trigger',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(fixture()))))
    await act(async()=>root.render(createElement(KnowledgePicker,{sessionId:'session-a'})))
    const trigger=container.querySelector<HTMLButtonElement>('.lets-kb-trigger')!;trigger.focus();await click('.lets-kb-trigger')
    expect(trigger.getAttribute('aria-expanded')).toBe('true');expect(document.querySelector('[role=dialog]')).not.toBeNull()
    await click('[aria-label="关闭知识库选择"]')
    expect(trigger.getAttribute('aria-expanded')).toBe('false');expect(document.querySelector('[role=dialog]')).toBeNull()
  })
  it('has no defaults action and preserves an existing conversation’s explicit selection',async()=>{
    const view=fixture();view.selectedIds=['fixture-kb'];const fetcher=vi.fn(async(_url:unknown)=>new Response(JSON.stringify(view)));vi.stubGlobal('fetch',fetcher)
    await act(async()=>root.render(createElement(KnowledgePicker,{sessionId:'session-a',expanded:true})))
    expect(container.textContent).not.toContain('设为新会话默认');expect(fetcher.mock.calls.every(call=>!String(call[0]).includes('session=new'))).toBe(true);expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true)
  })
  it('requires a real conversation before accepting selections instead of staging defaults',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify(fixture())));vi.stubGlobal('fetch',fetcher)
    await act(async()=>root.render(createElement(KnowledgePicker,{expanded:true})))
    expect(container.textContent).toContain('请先选择工作区');expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.disabled).toBe(true);expect(container.textContent).not.toContain('设为新会话默认')
  })
  it('uses a same-origin authenticated POST without credentials in URLs',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify(fixture())));vi.stubGlobal('fetch',fetcher);await knowledgeApi('session/a',['kb'])
    expect(fetcher.mock.calls[0]).toMatchObject(['/api/desktop/knowledge?session=session%2Fa',{method:'POST',credentials:'same-origin'}])
  })
  it('keeps selected knowledge bases when filtering and disables a fourth selection',async()=>{
    const view=fixture();view.catalog=[...view.catalog,...['two','three','four'].map(id=>({id,name:id,description:''}))];view.selectedIds=['fixture-kb','two','three']
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(view))))
    await act(async()=>root.render(createElement(KnowledgePicker,{sessionId:'session-a',expanded:true})))
    expect(container.querySelector<HTMLInputElement>('input[aria-label=four]')!.disabled).toBe(true)
    const search=container.querySelector<HTMLInputElement>('input[type=search]')!
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(search,'test');search.dispatchEvent(new Event('input',{bubbles:true}))})
    expect(container.querySelectorAll('input[type=checkbox]')).toHaveLength(1);expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true);expect(container.textContent).toContain('已选 3/3')
  })
})
