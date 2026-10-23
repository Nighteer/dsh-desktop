import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {cp,mkdir,readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {createRequire,registerHooks} from 'node:module'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {unzipSync,strFromU8} from 'fflate'
import {runCli} from '../.build/ppt-runtime/packages/dsh-ppt/lib/bin.js'
import {definitions} from '../.build/ppt-runtime/packages/dsh-ppt/lib/catalog.js'

const root=resolve(import.meta.dirname,'..'),edition=process.env.DSH_PPT_TEST_EDITION??'dsh-plugin-desktop-beta'
const require=createRequire(resolve(root,'..',edition,'package.json'))
// Standalone Node tests bind the selected edition's framework packages,
// rather than resolving peers from the historical isolated PPT download cache.
let resolvingFramework=false
const frameworkHooks=registerHooks({resolve(specifier,context,next){
  if(!resolvingFramework && specifier.startsWith('@deepseek-ai/')){
    try{resolvingFramework=true;return next(pathToFileURL(require.resolve(specifier)).href,context)}catch(error){
      if(!['MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND','ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code))throw error
    }finally{resolvingFramework=false}
  }
  return next(specifier,context)
}})
const ppt=await import('../.build/ppt-runtime/packages/dsh-ppt/lib/index.js')
const load=name=>import(pathToFileURL(require.resolve(name)).href)
const {Context}=await load('@deepseek-ai/cordis')
const {SystemPrompt}=await load('@deepseek-ai/dsh-system-prompt')
const {SkillRegistry}=await load('@deepseek-ai/dsh-skill')

test('maintains sixteen bilingual templates with twelve editable layouts each',async()=>{
  assert.equal(definitions.length,16)
  const build=JSON.parse(await readFile(resolve(root,'.build/ppt-runtime/packages/build.json'),'utf8'))
  assert.equal(build.checks.length,16)
  for(const check of build.checks){assert.equal(check.pages,12);assert.equal(check.errors,0)}
  for(const template of definitions){
    for(const language of ['source','source-zh'])await readFile(resolve(root,'.build/ppt-runtime/packages/dsh-ppt/skills/dsh-ppt/references',template.referenceDirectory,language,'deck.pptd'))
  }
})

test('exports a Chinese template to a real editable twelve-slide PPTX',async()=>{
  const output=resolve(root,'.build/acceptance',randomUUID(),'editable.pptx')
  await mkdir(resolve(output,'..'),{recursive:true})
  const template=definitions.find(item=>item.id==='dsh-blue-professional')
  const project=resolve(root,'.build/ppt-runtime/packages/dsh-ppt/skills/dsh-ppt/references',template.referenceDirectory,'source-zh')
  let stdout='',stderr=''
  const code=await runCli(['render',project,'-o',output,'--json'],{stdout:{write:chunk=>stdout+=chunk},stderr:{write:chunk=>stderr+=chunk}})
  assert.equal(code,0,stderr||stdout)
  const files=unzipSync(await readFile(output))
  const slides=Object.keys(files).filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name))
  assert.equal(slides.length,12)
  const xml=slides.map(name=>strFromU8(files[name])).join('\n')
  assert.match(xml,/<a:t>/);assert.match(xml,/<p:sp>/)
  assert.match(xml,/[\u4e00-\u9fff]/)
  console.log('Retained editable PPTX acceptance file:',output)
})

test('uses real Harness services and confines PPT activation to its selected session',async()=>{
  const ctx=new Context(),tools=[],data=resolve(root,'.build/acceptance',randomUUID(),'account-ppt')
  let rpc
  try{
    await ctx.plugin(SystemPrompt,{includeHarnessIdentity:false,personaPrefix:'LETS test'})
    await ctx.plugin(SkillRegistry)
    ctx.reflect.provide('tools',{register:tool=>{tools.push(tool);return()=>{}}})
    ctx.reflect.provide('connection',{rpc:{handle:(_channel,handler)=>{rpc=handler;return()=>{}}}})
    ctx.reflect.provide('webServer',{register:()=>()=>{}})
    await ctx.plugin(ppt,{root:data})
    await new Promise(resolve=>setTimeout(resolve,0))
    assert.equal(typeof rpc,'function')
    const a=randomUUID(),b=randomUUID()
    const catalog=await rpc('template/catalog',{})
    assert.equal(catalog.ok,true);assert.equal(catalog.value.status,'ok')
    assert.equal(catalog.value.data.templates.length,16)
    const toggle=async(sessionId,mode)=>{const result=await rpc('presentation/mode',{sessionId,mode});assert.equal(result.ok,true);assert.equal(result.value.status,'ok')}
    const hasPrompt=async id=>(await ctx.systemPrompt.assemble(id?{agent:{id}}:{})).sections.some(section=>section.name==='tool:dsh-ppt')
    assert.equal(await hasPrompt(a),false);await toggle(a,'ppt')
    assert.equal(await hasPrompt(a),true);assert.equal(await hasPrompt(b),false);assert.equal(await hasPrompt(),false)
    await toggle(a,null);assert.equal(await hasPrompt(a),false)
    const render=tools.find(tool=>tool.name==='pptd_render')
    const list=tools.find(tool=>tool.name==='ppt_list_templates')
    assert.ok(render);assert.ok(list)
    const selected=await rpc('template/select',{sessionId:a,templateId:'dsh-blue-professional',mode:'ppt'})
    assert.equal(selected.ok,true);assert.equal(selected.value.status,'ok')
    const workspace=resolve(data,'workspace'),project=resolve(workspace,'source')
    await mkdir(workspace,{recursive:true})
    const template=definitions.find(item=>item.id==='dsh-blue-professional')
    await cp(resolve(root,'.build/ppt-runtime/packages/dsh-ppt/skills/dsh-ppt/references',template.referenceDirectory,'source-zh'),project,{recursive:true})
    const exec={agent:{id:a,session:{header:{cwd:workspace}}},signal:new AbortController().signal}
    const templates=await list.execute({workflow:'dsh-ppt'},exec)
    assert.equal(templates.find(item=>item.id==='dsh-blue-professional').selected,true)
    const rendered=await render.execute({project_path:'source',output_file:'editable.pptx'},exec)
    assert.equal(rendered.status,'exported');assert.equal(rendered.pageCount,12)
    assert.ok(rendered.workspaceDirectoryPath.startsWith(workspace))
    assert.ok((await readFile(resolve(workspace,rendered.outputPath))).length>1000)
    for(const invalid of ['../outside','/outside','C:\\outside']){
      await assert.rejects(render.execute({project_path:invalid,output_file:'test.pptx'},exec),/workspace|inside|path/)
    }
    await assert.rejects(render.execute({project_path:'source',output_file:'../outside.pptx'},exec),/workspace|inside|path/)
    await assert.rejects(render.execute({project_path:'source',output_file:'file.pptx'},{signal:exec.signal}),/active workspace/)
  }finally{await ctx.fiber.dispose()}
})

after(()=>frameworkHooks.deregister())
