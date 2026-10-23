/** Prepare the pinned upstream Office payload in fresh directories only. */
import {spawnSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {createRequire,registerHooks} from 'node:module'
import {dirname,join,resolve,sep} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {officeDependencyResolver,lockedOfficePnpmArchive} from './office-dependency-resolution.mjs'
import {copyOfficialOfficeSnapshot} from './official-office-files.mjs'

const root=resolve(import.meta.dirname,'..')
const edition=process.argv.includes('--stable')?'dsh-plugin-desktop':'dsh-plugin-desktop-beta'
const publishBoth=process.argv.includes('--both')
if(process.argv.includes('--universal')){
  if(process.platform!=='darwin')throw Error('Universal Office preparation requires macOS')
  for(const arch of ['x64','arm64']){
    const args=[fileURLToPath(import.meta.url),`--target=mac-${arch}`,'--architecture-pointers',...(edition==='dsh-plugin-desktop'?['--stable']:[])]
    const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env,windowsHide:true})
    if(result.status!==0)throw Error(`Official Office ${arch} preparation failed`)
  }
  process.exit(0)
}
const desktopRequire=createRequire(join(root,edition,'package.json'))
const target=process.argv.find(value=>value.startsWith('--target='))?.slice('--target='.length)
  ??(process.platform==='win32'?'win-x64':`${process.platform==='darwin'?'mac':'linux'}-${process.arch}`)
if(!target.startsWith(process.platform==='darwin'?'mac-':process.platform==='win32'?'win-':'linux-'))throw Error('Office target must match the build host platform')
const pointerName=process.argv.includes('--architecture-pointers')?`current-${target.endsWith('-x64')?'x64':'arm64'}.json`:'current.json'
if(process.platform==='win32'&&process.arch!=='x64')throw Error('Official Windows Office payload currently supports x64 only')
const lockPath=join(root,'deepseek-harness/scripts/primary-runtime/lock.json')
const lock=JSON.parse(readFileSync(lockPath,'utf8'))
const pnpmArchive=lockedOfficePnpmArchive(
  JSON.parse(readFileSync(join(root,'deepseek-harness/package.json'),'utf8')),
  desktopRequire('yaml').parse(readFileSync(join(root,'deepseek-harness/pnpm-lock.yaml'),'utf8')),
)
if(!lock.targets[target])throw Error(`Unsupported Office target: ${target}`)
const version=JSON.parse(readFileSync(join(root,edition,'package.json'),'utf8')).version
const inputs=createHash('sha256').update(readFileSync(lockPath)).update(version).digest('hex')
const destination=join(root,edition,'build/official-office')
const currentPath=join(destination,pointerName)
if(existsSync(currentPath)){
  const current=JSON.parse(readFileSync(currentPath,'utf8'))
  if(current.inputs!==inputs)throw Error('Existing official Office snapshot differs; preserve it and prepare an explicitly reviewed update')
  if(!/^[a-f0-9]{64}$/u.test(current.directory)||!existsSync(join(destination,current.directory,'primary-runtime/runtime.json')))throw Error('Existing Office pointer is invalid')
  if(publishBoth){
    for(const name of ['dsh-plugin-desktop-beta','dsh-plugin-desktop']){
      const pointer=join(root,name,'build/official-office',pointerName)
      if(!existsSync(pointer))throw Error(`Missing ${name} Office snapshot; preserve the existing snapshot and complete preparation explicitly`)
      const peer=JSON.parse(readFileSync(pointer,'utf8'))
      if(peer.directory!==current.directory||peer.coreVersion!==current.coreVersion)throw Error('Desktop editions have different official Office snapshots')
      if(!existsSync(join(root,name,'build/official-office',peer.directory,'primary-runtime/runtime.json')))throw Error(`Incomplete ${name} Office snapshot`)
    }
  }
  console.log(`Official Office already prepared: ${destination}`)
  process.exit(0)
}

const privateRoot=join(root,'.enterprise-local')
mkdirSync(privateRoot,{recursive:true})
const resume=process.argv.find(value=>value.startsWith('--resume='))?.slice('--resume='.length)
const work=resume?resolve(resume):mkdtempSync(join(privateRoot,'official-office-build-'))
if(dirname(work)!==privateRoot||!work.startsWith(join(privateRoot,'official-office-build-')))throw Error('Preparation directory must be a task-owned official-office-build directory')
const tools=join(work,'tools'),temporary=join(work,'temporary'),output=join(work,'payload')
const prepared=existsSync(join(output,'primary-runtime/runtime.json'))&&existsSync(join(output,'office-skills/office/SKILL.md'))
if(!prepared&&(existsSync(join(output,'primary-runtime'))||existsSync(join(output,'office-skills'))))throw Error('Refusing to replace incomplete generated Office payloads')
mkdirSync(tools,{recursive:true});mkdirSync(temporary,{recursive:true})
// Every upstream staging directory, pip/venv smoke and cleanup stays inside this run.
process.env.TMP=temporary;process.env.TEMP=temporary;process.env.TMPDIR=temporary
process.env.PYTHONDONTWRITEBYTECODE='1'
if(!existsSync(join(tools,'package.json'))){
  writeFileSync(join(tools,'package.json'),JSON.stringify({private:true,packageManager:'yarn@4.18.0',dependencies:{'extract-zip':'2.0.1',papaparse:'5.5.3',tar:'7.5.22'}},null,2))
  writeFileSync(join(tools,'yarn.lock'),'')
  writeFileSync(join(tools,'.yarnrc.yml'),'nodeLinker: node-modules\nenableScripts: false\nenableGlobalCache: false\ncacheFolder: ./cache\nglobalFolder: ./global\n')
}
const yarn=join(root,'.yarn/releases/yarn-4.18.0.cjs')
if(!existsSync(yarn))throw Error('Run through the repository Corepack Yarn 4.18.0 release')
const yarnVersion=spawnSync(process.execPath,[yarn,'--version'],{encoding:'utf8',windowsHide:true})
if(yarnVersion.status!==0||yarnVersion.stdout.trim()!=='4.18.0')throw Error('Official Office preparation requires the root Yarn 4.18.0 release')
console.log(`Preparing official ${target} Office environment in ${work}`)
if(!existsSync(join(tools,'node_modules/papaparse/package.json'))){
  const installation=spawnSync(process.execPath,[yarn,'install'],{cwd:tools,env:{...process.env,YARN_ENABLE_IMMUTABLE_INSTALLS:'false'},stdio:'inherit',windowsHide:true})
  if(installation.status!==0)throw Error('Isolated official Office build-tool installation failed')
}
// curl uses the existing OS/proxy transport. Keep TLS checks and official
// SHA-256 pinning; the upstream builder independently verifies these cache bytes.
const downloads=join(work,'downloads');mkdirSync(downloads,{recursive:true})
const artifact=lock.targets[target]
const pythonFile=`cpython-${lock.pythonVersion}+${lock.pythonRelease}-${artifact.pythonTarget}-install_only_stripped.tar.gz`
const archives=[
  {url:pnpmArchive.url,sha256:Buffer.from(pnpmArchive.integrity.slice(7),'base64').toString('hex'),algorithm:'sha512'},
  {url:`https://nodejs.org/dist/v${lock.nodeVersion}/node-v${lock.nodeVersion}-${artifact.nodeArchive}`,sha256:artifact.nodeSha256},
  {url:`https://github.com/astral-sh/python-build-standalone/releases/download/${lock.pythonRelease}/${encodeURIComponent(pythonFile)}`,sha256:artifact.pythonSha256},
  ...artifact.wheels,...lock.wheels,
]
for(const archive of archives){
  const algorithm=archive.algorithm??'sha256'
  if(!archive.url.startsWith('https://')||!(algorithm==='sha512'?/^[a-f0-9]{128}$/u:/^[a-f0-9]{64}$/u).test(archive.sha256))throw Error('Invalid pinned Office download')
  const cache=join(downloads,archive.sha256)
  if(existsSync(cache)){
    if(createHash(algorithm).update(readFileSync(cache)).digest('hex')!==archive.sha256)throw Error('Existing Office cache checksum mismatch; preserving it')
    continue
  }
  const download=join(downloads,archive.sha256+'.download-'+randomUUID())
  console.log(`Downloading verified Office input: ${new URL(archive.url).pathname.split('/').at(-1)}`)
  const proxy=(process.env.HTTPS_PROXY||process.env.https_proxy)?['--noproxy','']:[]
  const fetched=spawnSync(process.platform==='win32'?'curl.exe':'curl',['--fail','--location','--silent','--show-error','--retry','2','--retry-all-errors','--connect-timeout','20','--max-time','180',...proxy,'--output',download,archive.url],{windowsHide:true,stdio:'inherit'})
  if(fetched.status!==0)throw Error('Official Office archive download failed; partial bytes are preserved')
  if(createHash(algorithm).update(readFileSync(download)).digest('hex')!==archive.sha256)throw Error('Official Office archive checksum mismatch')
  renameSync(download,cache)
}
const upstream=join(root,'deepseek-harness/scripts/primary-runtime')
// The read-only upstream workspace is not installed or edited. Its build script
// resolves helper packages from this fresh tools project and official installed DSH packages.
const hook=registerHooks({resolve:officeDependencyResolver({upstream,tools,desktopManifest:join(root,edition,'package.json')})})
try{
  const {preparePrimaryRuntime,smokePrimaryRuntime}=await import(pathToFileURL(join(upstream,'prepare.ts')).href)
  const skillSource=join(dirname(desktopRequire.resolve('@deepseek-ai/dsh-skill-office/package.json')),'assets')
  if(!prepared)await preparePrimaryRuntime({target,output,cache:join(work,'downloads'),version,skillSource,pnpmArchive})
  const smoke=mkdtempSync(join(work,'smoke-'))
  const payload=JSON.parse(readFileSync(join(output,'primary-runtime/runtime.json'),'utf8'))
  writeFileSync(join(smoke,'package.json'),JSON.stringify({private:true,packageManager:`pnpm@${payload.pnpm}`}))
  // pnpm's --version checks the nearest package manager. The verification is
  // not a pnpm operation on this Yarn repository: keep its cwd in our new fixture.
  const before=process.cwd()
  try{process.chdir(smoke);smokePrimaryRuntime(join(output,'primary-runtime'))}
  finally{process.chdir(before)}
}finally{hook.deregister()}

const manifest=JSON.parse(readFileSync(join(output,'primary-runtime/runtime.json'),'utf8'))
if(!/^[a-f0-9]{64}$/u.test(manifest.payloadDigest))throw Error('Missing official payload digest')
for(const name of publishBoth?['dsh-plugin-desktop-beta','dsh-plugin-desktop']:[edition]){
  const directory=join(root,name,'build/official-office')
  if(existsSync(join(directory,pointerName)))throw Error(`Refusing to replace existing Office snapshot: ${directory}`)
  mkdirSync(directory,{recursive:true})
  const snapshot=join(directory,manifest.payloadDigest)
  if(existsSync(snapshot))throw Error(`Refusing to overwrite existing snapshot: ${snapshot}`)
  copyOfficialOfficeSnapshot(output,snapshot)
  writeFileSync(join(directory,pointerName),JSON.stringify({schema:1,directory:manifest.payloadDigest,inputs,coreVersion:'0.2.1-rc.2'},null,2))
  console.log(`Official Office ready: ${directory}`)
}
console.log(`Preparation evidence and verified downloads retained: ${work}`)
