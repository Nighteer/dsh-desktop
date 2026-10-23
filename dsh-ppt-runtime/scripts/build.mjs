import {spawnSync} from 'node:child_process'
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'

const root=resolve(import.meta.dirname,'..')
const marker=resolve(root,'.build/ppt-runtime/lets-build.json')
const {readdir}=await import('node:fs/promises')
const inputs=[]
async function collect(directory){
  for(const item of await readdir(resolve(root,directory),{withFileTypes:true})){
    if(item.name==='node_modules'||item.name==='.build')continue
    const name=`${directory}/${item.name}`
    if(item.isDirectory())await collect(name);else inputs.push(name)
  }
}
await collect('packages');await collect('scripts')
inputs.push('package.json')
const hash=createHash('sha256')
for(const path of inputs.sort())hash.update(path).update(await readFile(resolve(root,path)))
const fingerprint=hash.digest('hex')
try{
  const saved=JSON.parse(await readFile(marker,'utf8'))
  await stat(resolve(root,'.build/ppt-runtime/packages/dsh-ppt/lib/catalog.js'))
  await stat(resolve(root,'.build/ppt-runtime/packages/dsh-ppt-composer/lib/client.js'))
  if(saved.fingerprint===fingerprint){console.log('LETS PPT runtime is up to date.');process.exit(0)}
}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error}
await mkdir(resolve(root,'.build/ppt-runtime/templates'),{recursive:true})
const env={...process.env,DSH_PPT_TEMPLATE_OUTPUT:resolve(root,'.build/ppt-runtime/templates')}
for(const script of ['generate-zara-ppt-templates.mjs','localize-ppt-templates.mjs','enrich-ppt-templates.mjs','build-ppt-runtime.mjs']){
  const result=spawnSync(process.execPath,[resolve(root,'scripts',script)],{cwd:root,env,stdio:'inherit',windowsHide:true})
  if(result.error)throw result.error
  if(result.status!==0)throw new Error(`PPT build failed: ${script} (${result.status})`)
}
await writeFile(marker,JSON.stringify({fingerprint,source:'bc732f5dc4c5465915d5b3f28d9b0b32703fc664'})+'\n')
