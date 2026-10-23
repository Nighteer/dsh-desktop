import {join,sep} from 'node:path'
import {pathToFileURL} from 'node:url'

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
