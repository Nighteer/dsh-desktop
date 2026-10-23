import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {runInNewContext} from 'node:vm'
import {JSDOM} from 'jsdom'

test('mounts the real template viewer outside clipped workspace containers',async()=>{
  const require=createRequire(resolve(import.meta.dirname,'../../dsh-plugin-desktop-beta/package.json'))
  const react=require('react'),reactDom=require('react-dom'),{createRoot}=require('react-dom/client')
  const dom=new JSDOM('<!doctype html><body><div id="frame" style="overflow:hidden"><div id="mount"></div></div></body>',{url:'http://localhost'})
  const originals=new Map()
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true})
  }
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true}
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false}
  const code=await readFile(resolve(import.meta.dirname,'../packages/ppt-runtime/client/personal-template-manager.js'),'utf8')
  const context={react,reactDom,document:dom.window.document,window:dom.window,TemplateCard:()=>null}
  runInNewContext(code+'\nglobalThis.Viewer=TemplatePreviewCard;',context)
  const root=createRoot(dom.window.document.getElementById('mount'))
  try{
    await react.act(async()=>root.render(react.createElement(context.Viewer,{template:{id:'test',name:'Test',origin:'builtin',previewImages:['about:blank']},selected:false,choose:()=>{},client:{bound:false},t:key=>key})))
    await react.act(async()=>dom.window.document.querySelector('.ppt-preview-open').click())
    const dialog=dom.window.document.querySelector('.ppt-template-viewer')
    assert.equal(dialog.parentElement,dom.window.document.body)
    assert.equal(dialog.open,true)
    assert.equal(dom.window.document.getElementById('frame').querySelector('dialog'),null)
    assert.equal(dom.window.document.activeElement.getAttribute('aria-label'),'personal.close')
    await react.act(async()=>dialog.querySelector('header button').click())
    assert.equal(dom.window.document.querySelector('.ppt-template-viewer'),null)
  }finally{
    await react.act(async()=>root.unmount());dom.window.close()
    for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
  }
})
