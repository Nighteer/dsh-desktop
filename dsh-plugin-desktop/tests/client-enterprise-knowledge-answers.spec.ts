// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {KnowledgeAnswerTail,KnowledgeSourceDetails,groupKnowledgeSources,knowledgeAnswerAddress,parseKnowledgeAnswerAddress,knowledgeCitationMentions,installKnowledgeAnswers,decorateKnowledgeFileMentions} from '../src/client/enterprise-knowledge-answers.tsx'
import type {Context} from '@deepseek-ai/cordis'
import type {ChatFileMentions} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {KnowledgeAnswerSources} from 'dsh-enterprise-contracts'
import type {TurnLocation} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {SessionId} from '@deepseek-ai/dsh-session'
let container:HTMLDivElement,root:Root
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container)})
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();vi.restoreAllMocks()})
const coordinates={sessionId:SessionId('account/session'),turn:1,seq:4}
function fixture():KnowledgeAnswerSources{return{legacy:false,citedReferences:['知识来源2'],sources:[1,2,3].map(n=>({reference:`知识来源${n}`,documentId:n===3?'another-doc':'doc',knowledgeBaseId:'kb',knowledgeBaseName:'test',title:'同名文档 <img>',chunkId:String(n),content:`Evidence ${n} <script>`,score:1}))}}
describe('answer source disclosure',()=>{
  it('uses the native citation provider and additive tail seat without shadowing renderer-owned children',()=>{
    const registrations:Record<string,unknown>[]=[],cleanup:(()=>void)[]=[]
    const original=vi.fn(()=>undefined),provider={forClosing:original}
    const ctx={chatFileMentions:provider,inject:(_names:unknown,execute:(owner:unknown)=>void)=>execute(ctx),effect:(execute:()=>unknown)=>{const dispose=execute();if(typeof dispose==='function')cleanup.push(dispose as ()=>void);return dispose},sidebarRightTabs:{register:()=>()=>{}},sidebarRight:{openResource:vi.fn()},slots:{inject:(_key:unknown,execute:()=>()=>void)=>{cleanup.push(execute())},register:(options:Record<string,unknown>)=>{registrations.push(options);return()=>{}}}} as unknown as Context
    installKnowledgeAnswers(ctx)
    expect(registrations.some(r=>r.name==='conversation.chat.node')).toBe(false)
    expect(registrations.find(r=>r.name==='conversation.chat.turnTail')).toMatchObject({id:'lets-knowledge-sources',order:20})
    expect(provider.forClosing).not.toBe(original)
    for(const dispose of cleanup.reverse())dispose();expect(provider.forClosing).toBe(original)
  })
  it('keeps the native file opener and binds citations to the viewed account/session/answer',()=>{
    const file=vi.fn(),open=vi.fn(),original=vi.fn(()=>({resolve:(value:string)=>value==='report.md'?{label:'report',title:'report',open:file}:undefined})),provider:ChatFileMentions={forClosing:original}
    const stop=decorateKnowledgeFileMentions(provider,open)
    const owner={turn:{turn:1},seq:4} as Parameters<typeof provider.forClosing>[0]
    const mentions=provider.forClosing(owner,coordinates.sessionId)!
    mentions.resolve('[知识来源2]')!.open();expect(open).toHaveBeenCalledWith(coordinates,'知识来源2')
    mentions.resolve('report.md')!.open();expect(file).toHaveBeenCalledOnce()
    for(const value of ['[知识来源9]','[知识来源1](https://evil.invalid)','https://evil.invalid'])expect(mentions.resolve(value)).toBeUndefined()
    stop();expect(provider.forClosing).toBe(original)
  })
  it('links only this answer’s known inline-code citations and preserves ordinary file openers',()=>{
    const open=vi.fn(),file=vi.fn(),mentions=knowledgeCitationMentions(fixture(),open,{resolve:value=>value==='report.md'?{label:'report',title:'report',open:file}:undefined})
    mentions.resolve('[知识来源2]')!.open();expect(open).toHaveBeenCalledWith('知识来源2');expect(mentions.resolve('[知识来源8]')).toBeUndefined();expect(mentions.resolve('https://evil.invalid')).toBeUndefined();mentions.resolve('report.md')!.open();expect(file).toHaveBeenCalledOnce()
  })
  it('groups only real document identities and distinguishes annotated results',()=>{
    const docs=groupKnowledgeSources(fixture());expect(docs).toHaveLength(2);expect(docs[0]?.sources).toHaveLength(2);expect(docs[0]?.cited).toBe(true);expect(docs[1]?.cited).toBe(false)
    const other=fixture();other.sources[1]!.knowledgeBaseId='another-kb';expect(groupKnowledgeSources(other)).toHaveLength(3)
  })
  it('puts one-click evidence and citation buttons directly under the corresponding answer',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(fixture()))));const openSources=vi.fn(),turn={turn:1} as TurnLocation
    await act(async()=>root.render(createElement(KnowledgeAnswerTail,{sessionId:coordinates.sessionId,turn,seq:4,openSources})))
    expect(container.textContent).toContain('2 份文档 · 3 处片段');expect(container.querySelector('img')).toBeNull()
    await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='[知识来源2]')!.click())
    expect(openSources).toHaveBeenCalledWith(coordinates,'知识来源2')
  })
  it('shows escaped passages in a single-scrolling panel and focuses the selected citation',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(fixture()))))
    await act(async()=>root.render(createElement(KnowledgeSourceDetails,{coordinates,reference:'知识来源2'})))
    expect(container.querySelectorAll('.lets-kb-document')).toHaveLength(2);expect(container.querySelector('script')).toBeNull();expect(container.textContent).toContain('Evidence 2 <script>');expect(document.activeElement?.getAttribute('data-reference')).toBe('知识来源2');expect(container.textContent).toContain('其他检索资料')
  })
  it('does not label every retrieved passage as used by the model',async()=>{
    const data=fixture();data.citedReferences=[];vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(data))))
    await act(async()=>root.render(createElement(KnowledgeAnswerTail,{sessionId:SessionId('a'),turn:{turn:1} as TurnLocation,seq:4,openSources:vi.fn()})))
    expect(container.textContent).toContain('回答未标注具体来源');expect(container.textContent).not.toContain('回答已标注')
  })
  it('does not show stale evidence while moving to a different answer',async()=>{
    let settle!:(response:Response)=>void
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(fixture()))).mockReturnValueOnce(new Promise<Response>(r=>{settle=r})))
    await act(async()=>root.render(createElement(KnowledgeSourceDetails,{coordinates})))
    await act(async()=>root.render(createElement(KnowledgeSourceDetails,{coordinates:{...coordinates,turn:2,seq:20}})))
    expect(container.textContent).not.toContain('Evidence 1');expect(container.textContent).toContain('正在读取')
    await act(async()=>settle(new Response(JSON.stringify({sources:[],citedReferences:[],legacy:false}))));expect(container.textContent).toContain('没有可用')
  })
  it('retains answer coordinates in addresses without accepting foreign/malformed resources',()=>{
    expect(parseKnowledgeAnswerAddress(knowledgeAnswerAddress(coordinates))).toEqual(coordinates)
    for(const value of ['https://evil.invalid','dsh-resource://lets-knowledge/session/a/turn/1/answer/NaN','dsh-resource://lets-knowledge/session/%ZZ/turn/1/answer/4'])expect(parseKnowledgeAnswerAddress(value)).toBeUndefined()
  })
})
