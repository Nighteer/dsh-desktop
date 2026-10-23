/** Actual full-tree boot in a newly created temporary home; never opens Electron. */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'

const root=resolve(import.meta.dirname,'..')
const edition=process.argv[2] ?? 'dsh-plugin-desktop-beta'
const market=process.argv.includes('--market')?'dsh-market':'disabled'
if(!['dsh-plugin-desktop-beta','dsh-plugin-desktop'].includes(edition))throw Error('Unexpected edition')
const require=createRequire(join(root,edition,'package.json'))
const keep=process.argv.includes('--keep')
if(keep)mkdirSync(join(root,'.enterprise-local'),{recursive:true})
const home=mkdtempSync(keep?join(root,'.enterprise-local','native-host-acceptance-'):join(tmpdir(),'lets-harness-upgrade-boot-'))
const cwd=process.cwd(),oldHome=process.env.DSH_HOME
let ctx,releaseResolver,nativeWindowSpec,tasks
const rendererToken=randomBytes(32).toString('base64url')
const {installDesktopTaskControl}=await import(pathToFileURL(join(root,edition,'src/desktop-task-control.ts')).href)
const model={id:'11111111-1111-4111-8111-111111111111',name:'Upgrade fixture',contextWindow:65536,maxTokens:1024,supportsTools:true,supportsImages:false,contextSource:'manual'}
const gateway=createServer((req,res)=>{
  if(req.url!=='/models'){res.writeHead(404);res.end();return}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify([model]))
})
try {
  gateway.listen(0,'127.0.0.1');await once(gateway,'listening')
  process.env.DSH_HOME=home
  process.chdir(home)
  const {boot}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
  const {provideCmdline}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-cmdline')).href)
  const {prepareDesktopProfile,installDesktopProfileContext}=await import(pathToFileURL(join(root,edition,'lib/profile.js')).href)
  const {installProfilePackageResolver}=await import(pathToFileURL(join(root,edition,'lib/module-resolution.js')).href)
  const {prepareEnterpriseModels,installEnterpriseModels,ENTERPRISE_MODEL_PROVIDER}=await import(pathToFileURL(join(root,edition,'lib/enterprise-models.js')).href)
  const {installOfficialOffice}=await import(pathToFileURL(join(root,edition,'lib/official-office.js')).href)
  const legacy='dsh-desktop:\n  mode: advanced\n  port: 0\n'
  writeFileSync(join(home,'settings.yaml'),legacy)
  const prepared=prepareDesktopProfile('1',home,process.platform,'desktop',undefined,{requested:market,effective:market,legacyDefaulted:false})
  prepareEnterpriseModels(prepared)
  releaseResolver=installProfilePackageResolver(prepared.bareModuleBaseUrl)
  const patches=[...prepared.patches,
    {id:'llm-deepseek',disabled:true},{id:'llm-pi-ai',disabled:true},
    // No online account/model is needed to judge runtime activation.
    {id:'deepseek-account',disabled:true},{id:'account-controller',disabled:true},
    ...['desktop-terminal','desktop-diagnostics','desktop-pnpm','desktop-profiles','desktop-updates'].map(id=>({id,disabled:true})),
  ]
  ctx=await boot('lets-upgrade-full-tree',prepared.rootConfig,patches,async child=>{
    if(process.argv.includes('--tasks'))tasks=installDesktopTaskControl(child)
    child.loader.internal=undefined
    await installDesktopProfileContext(child,prepared)
    // Announce the third-party Desktop boundary so Market never chooses the
    // official Electron-only pluginManager branch for this shell's profile.
    child.provide('desktopProfiles',{current:{name:prepared.profile.name,dir:prepared.profile.dir}})
    child.provide('desktopPnpm',{runPlugin(){throw Error('The smoke must never install packages')}})
    child.provide('desktopRuntime',{
      platform:process.platform,locale:'zh',updates:{currentVersion:'upgrade-smoke'},
      schedule(spec){nativeWindowSpec=spec;return()=>{}},
      setThemeSource(){},setLocalePreference(){},notifyAttention(){},async requestRestart(){},
    })
    child.provide('desktopBrowserAccess',{
      ordinaryBrowserEnabled:false,rendererHeader:{name:'x-dsh-desktop-renderer',value:rendererToken},setOrdinaryBrowserEnabled(){},
    })
    child.provide('desktopLanHttps',{
      caCertificate:null,attach(){},async setEnabled(){return {state:'inactive'}},async stop(){},
    })
    provideCmdline(child,{args:[],exit:()=>{throw Error('Unexpected CLI exit')}})
  },prepared.bareModuleBaseUrl)
  await installEnterpriseModels(ctx,{baseUrl:`http://127.0.0.1:${gateway.address().port}`,capability:'upgrade-test-capability'})
  if(process.argv.includes('--office')){
    assert.equal((await installOfficialOffice(ctx)).enabled,true,'Official Office payload was not enabled')
    assert.equal((await ctx.skills.list()).filter(row=>row.provider==='dsh-office').length,7)
    assert.ok(ctx.tools.schemas().some(row=>row.name==='load_workspace_dependencies'),'Official dependency query missing from full Host')
    const scope=await ctx.agentPresets.acquireScope('standard')
    try{
      assert.ok(ctx.tools.get('load_workspace_dependencies',scope.key),'Official dependency query is hidden in standard mode')
      assert.ok(await ctx.skills.get('office-docx',{scope:scope.key}),'Official Word workflow is hidden in standard mode')
    }finally{await scope[Symbol.asyncDispose]()}
  }
  assert.deepEqual(ctx.agentDefaultModel.currentSelection(),{provider:ENTERPRISE_MODEL_PROVIDER,model:model.id})
  assert.match(readFileSync(prepared.profile.patchPath,'utf8'),/lets-enterprise/)
  const failures=[...ctx.loader.entries()].filter(row=>!row.disabled && row.fiber?.state===3).map(row=>({id:row.options.id,name:row.options.name}))
  assert.deepEqual(failures,[],'Full runtime contains failed plugins')
  for(const key of ['llm','settings','agentPresets','sessionQuery','tools','skills','webServer'])assert.ok(ctx.get(key),'Missing '+key)
  assert.ok(ctx.agentPresets && (await ctx.agentPresets.list()).some(row=>row.id==='standard' && !row.broken),'Standard preset unavailable')
  if(market!=='disabled')assert.ok([...ctx.loader.entries()].some(row=>row.options.name==='dshmarket' && !row.disabled && row.fiber?.state===2),'Market did not activate')
  assert.equal(readFileSync(join(home,'settings.yaml'),'utf8'),legacy)
  assert.equal(nativeWindowSpec?.mode,'advanced','Desktop did not register its native window generation')
  assert.match(nativeWindowSpec.url,/^http:\/\/127\.0\.0\.1:/)
  if(tasks){
    assert.deepEqual(await tasks.inspectQuit(),{activeTasks:false,scheduledTasks:false})
    ctx.connection.fetch.register({path:'/api/lets-admission-probe',methods:['GET'],requestBody:'buffered',fetch:()=>new Response('ready')})
    const origin=new URL(nativeWindowSpec.url).origin
    const headers={[nativeWindowSpec.rendererAccessHeader.name]:nativeWindowSpec.rendererAccessHeader.value}
    const authentication=await fetch(nativeWindowSpec.authenticationUrl,{headers,redirect:'manual'})
    await authentication.body?.cancel()
    assert.equal(authentication.status,303)
    const cookie=authentication.headers.get('set-cookie')?.split(';')[0]
    assert(cookie)
    const probe=async()=>{
      const response=await fetch(origin+'/api/lets-admission-probe',{headers:{...headers,cookie,origin}})
      await response.text();return response.status
    }
    assert.equal(await probe(),200)
    assert.equal(await tasks.updateTasks('lock'),false)
    assert.equal(await probe(),503)
    await tasks.updateTasks('unlock')
    assert.equal(await probe(),200)
  }
  console.log(JSON.stringify({edition,version:'0.2.1-rc.2',entries:[...ctx.loader.entries()].length,port:ctx.webServer.port,legacyPreserved:true,tasksVerified:!!tasks,...(keep?{evidence:home}:{})}))
} finally {
  await ctx?.fiber.dispose()
  gateway.closeAllConnections();gateway.close()
  releaseResolver?.()
  process.chdir(cwd)
  if(oldHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome
  if(!keep)rmSync(home,{recursive:true,force:true})
}
