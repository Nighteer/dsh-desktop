// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest'
import {createElement,act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {DesktopWorkspaceFlow,applyNativeWorkspaceFlow,type DesktopWorkspaceFlowProps} from '../src/client/native-workspace-flow.tsx'

let root:Root|undefined,container:HTMLDivElement|undefined
afterEach(async()=>{if(root)await act(async()=>root!.unmount());container?.remove();root=undefined;container=undefined;vi.unstubAllGlobals()})
function fixture(){
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
  const props:DesktopWorkspaceFlowProps={open:true,busy:false,pick:vi.fn(async()=>'D:\\work'),validate:vi.fn(async()=>true),onPicked:vi.fn(),onCancel:vi.fn(),onError:vi.fn()}
  const render=async()=>{await act(async()=>{root!.render(createElement(DesktopWorkspaceFlow,props))})}
  return{props,render}
}
describe('one-step native workspace selection',()=>{
  it('opens the native picker once and validates before adoption, without a browser dialog',async()=>{
    const {props,render}=fixture();await render();props.busy=true;await render()
    expect(props.pick).toHaveBeenCalledOnce();expect(props.validate).toHaveBeenCalledWith('D:\\work');expect(props.onPicked).toHaveBeenCalledWith('D:\\work');expect(container!.textContent).toBe('')
  })
  it('cancels without adopting a directory and opens again on a fresh request',async()=>{
    const {props,render}=fixture();props.pick=vi.fn(async()=>null);await render()
    expect(props.onCancel).toHaveBeenCalledOnce();expect(props.onPicked).not.toHaveBeenCalled();expect(props.validate).not.toHaveBeenCalled()
    props.open=false;await render();props.open=true;await render();expect(props.pick).toHaveBeenCalledTimes(2)
  })
  it('reports a validation denial to the workspace owner without persisting the path',async()=>{
    const {props,render}=fixture();props.validate=vi.fn(async()=>false);await render()
    expect(props.onPicked).not.toHaveBeenCalled();expect(props.onError).toHaveBeenCalledWith(expect.stringContaining('安全校验'))
  })
  it('reports a failed chooser through the existing retryable workspace error flow',async()=>{
    const {props,render}=fixture();props.pick=vi.fn(async()=>{throw new Error('picker unavailable')});await render()
    expect(props.onError).toHaveBeenCalledWith('picker unavailable');expect(props.onPicked).not.toHaveBeenCalled()
  })
  it('ignores results from a withdrawn request',async()=>{
    const {props,render}=fixture();let finish!:(path:string)=>void
    props.pick=vi.fn(()=>new Promise<string|null>(resolve=>{finish=resolve}));await render();props.open=false;await render()
    await act(async()=>finish('D:\\old'));expect(props.validate).not.toHaveBeenCalled();expect(props.onPicked).not.toHaveBeenCalled()
  })
  it('overrides both supported directory seats at a higher priority',()=>{
    const register=vi.fn(),ctx={slots:{inject:(_name:string,run:()=>void)=>run(),register}}
    applyNativeWorkspaceFlow(ctx as never)
    expect(register.mock.calls.map(([options])=>[options.name,options.priority])).toEqual([['conversation.hero.workspace.directoryFlow',-100],['sidebar.workspaces.directoryFlow',-100]])
  })
})
