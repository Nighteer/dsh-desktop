import {join,sep} from 'node:path'
import {pathToFileURL} from 'node:url'

/** Use the pinned upstream tool archive instead of resolving its uninstalled workspace. */
export function lockedOfficePnpmArchive(manifest,lock){
  const version=manifest.devDependencies?.pnpm
  const integrity=lock.packages?.[`pnpm@${version}`]?.resolution?.integrity
  if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/u.test(version)||typeof integrity!=='string'||!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(integrity))throw Error('Missing pinned upstream Office pnpm archive')
  return {name:'pnpm',version,url:`https://registry.npmjs.org/pnpm/-/pnpm-${version}.tgz`,integrity}
}

/** Redirect imports without replacing ESM import conditions with require conditions. */
export function officeDependencyResolver({upstream,tools,desktopManifest}){
  const prefix=pathToFileURL(upstream+sep).href
  const helperNames=new Set(['extract-zip','papaparse','tar'])
  return (specifier,context,next)=>{
    if(context.parentURL?.startsWith(prefix)&&!specifier.startsWith('.')&&!specifier.startsWith('node:')){
      const parentURL=pathToFileURL(helperNames.has(specifier)?join(tools,'package.json'):desktopManifest).href
      return next(specifier,{...context,parentURL})
    }
    return next(specifier,context)
  }
}
