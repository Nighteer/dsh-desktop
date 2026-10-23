/** Add missing development links only; never replace or delete an existing path. */
import {createRequire} from 'node:module'
import {existsSync,lstatSync,mkdirSync,symlinkSync} from 'node:fs'
import {dirname,resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..')
const dependencyRoot=resolve(process.argv[2]??'')
if(!dependencyRoot.startsWith(resolve(root,'.enterprise-local')+'\\')&&!dependencyRoot.startsWith(resolve(root,'.enterprise-local')+'/'))throw new Error('Use a new workspace-local PPT dependency directory')
if(!existsSync(resolve(dependencyRoot,'node_modules/pptxgenjs/package.json')))throw new Error('PPT dependencies are not installed')
function link(target,path){
  if(existsSync(path))return
  try{lstatSync(path);throw new Error(`Existing broken path must be reviewed: ${path}`)}catch(error){if(error.code!=='ENOENT')throw error}
  mkdirSync(dirname(path),{recursive:true});symlinkSync(target,path,'junction')
}
const require=createRequire(resolve(root,'dsh-plugin-desktop-beta/package.json'))
for(const name of ['@deepseek-ai/dsh-llm','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-skill','@deepseek-ai/cordis','react','react-dom']){
  const manifest=require.resolve(`${name}/package.json`)
  link(dirname(manifest),resolve(dependencyRoot,'node_modules',name))
}
link(resolve(dependencyRoot,'node_modules'),resolve(root,'dsh-ppt-runtime/node_modules'))
for(const edition of ['dsh-plugin-desktop-beta','dsh-plugin-desktop'])link(resolve(root,'dsh-ppt-runtime'),resolve(root,edition,'node_modules/dsh-ppt'))
console.log('Added missing PPT development links; existing dependencies were preserved.')
