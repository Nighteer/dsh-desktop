import {existsSync,readFileSync} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { ensureEnterpriseElectron } from './enterprise-electron.mjs'
const root=resolve(import.meta.dirname,'..')
const config=resolve(root,'local-development.json')
const dataRoot=existsSync(config)?JSON.parse(readFileSync(config,'utf8')).legacyRoot:root
const args=new Set(process.argv.slice(2))
for(const arg of args)if(!['--beta','--package','--build-only'].includes(arg))throw new Error(`Unknown option: ${arg}`)
const name=args.has('--beta')?'dsh-plugin-desktop-beta':'dsh-plugin-desktop'
const cwd=resolve(root,name), require=createRequire(resolve(cwd,'package.json'))
const preset=process.env.DSH_ENTERPRISE_SERVER_URL
const env={...process.env,DSH_ENTERPRISE_MODE:'1',...(!args.has('--package')?{DSH_ENTERPRISE_SERVER_URL:preset??'http://127.0.0.1:4310'}:{}),DSH_DESKTOP_USER_DATA_DIR:process.env.DSH_DESKTOP_USER_DATA_DIR??resolve(dataRoot,'.runtime-appdata',`enterprise-${args.has('--beta')?'beta':'stable'}`)}
function run(script,argv=[]){const result=spawnSync(process.execPath,[script,...argv],{cwd,env,stdio:'inherit',windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw new Error(`Enterprise build step failed (${result.status})`)}
// Incremental builds preserve all existing files; no clean/delete step.
const marketBuild=spawnSync(process.execPath,[resolve(root,'.yarn/releases/yarn-4.18.0.cjs'),'workspace','dsh-community-market','build'],{cwd:root,env,stdio:'inherit',windowsHide:true});if(marketBuild.error)throw marketBuild.error;if(marketBuild.status!==0)throw new Error('Market build failed')
run(resolve(root,'dsh-ppt-runtime/scripts/build.mjs'))
run(resolve(cwd,'scripts/generate-windows-app-icon.mjs'))
run(require.resolve('tsdown/run'))
run(resolve(require.resolve('vite/package.json'),'../bin/vite.js'),['build','--config','vite.native-ui.config.ts'])
if(args.has('--build-only'))process.exit(0)
const electronDist=await ensureEnterpriseElectron(name)
env.ELECTRON_OVERRIDE_DIST_PATH=electronDist
if(args.has('--package')){
  if(process.platform!=='win32'||!['x64','arm64'].includes(process.arch))throw new Error('Enterprise directory packaging currently supports Windows x64/arm64 hosts only')
  const output=resolve(root,'.artifacts',`enterprise-${name}-${Date.now()}`)
  env.DSH_ENTERPRISE_PACKAGE_OUTPUT=output
  env.DSH_ENTERPRISE_PACKAGE_WORKSPACE=name
  run(require.resolve('electron-builder/cli.js'),['--dir',`--${process.arch}`,'--publish','never',`--config.win.target=dir:${process.arch}`,`--config.afterPack=${resolve(root,'scripts/enterprise-after-pack.mjs')}`,'--config.forceCodeSigning=false','--config.win.signExecutable=false',`--config.electronDist=${electronDist}`,`--config.directories.output=${output}`,'--config.extraMetadata.dshEnterprise=true',...(preset?[`--config.extraMetadata.dshEnterpriseServer=${preset}`]:[])])
  console.log(`Enterprise package: ${output}`)
}else run(resolve(cwd,'lib/bin.js'))
