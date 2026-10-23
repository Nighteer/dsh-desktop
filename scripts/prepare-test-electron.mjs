import {createRequire} from 'node:module'
import {basename,dirname,join} from 'node:path'
import {existsSync,writeFileSync} from 'node:fs'
import {ensureEnterpriseElectron} from './enterprise-electron.mjs'

/** Prepare exact public runtime without opening a window or changing system Electron. */
export default async function prepareTestElectron(project){
 const require=createRequire(join(project.config.root,'package.json'))
 const distribution=await ensureEnterpriseElectron(basename(project.config.root))
 process.env.ELECTRON_OVERRIDE_DIST_PATH=distribution
 const manifest=require.resolve('electron/package.json'),pointer=join(dirname(manifest),'path.txt')
 if(!existsSync(pointer))writeFileSync(pointer,process.platform==='win32'?'electron.exe':process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':'electron',{flag:'wx'})
 require('electron')
}
