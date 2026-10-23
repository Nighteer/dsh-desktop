import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs'
import {registerHooks} from 'node:module'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {officeDependencyResolver} from './office-dependency-resolution.mjs'

test('Office preparation resolves tar through its ESM export without changing upstream',async()=>{
  const artifacts=resolve(import.meta.dirname,'../.artifacts')
  mkdirSync(artifacts,{recursive:true})
  const root=mkdtempSync(join(artifacts,'office-import-')) // Retained.
  const upstream=join(root,'upstream'),tools=join(root,'tools'),pkg=join(tools,'node_modules/tar')
  mkdirSync(upstream,{recursive:true});mkdirSync(pkg,{recursive:true})
  writeFileSync(join(tools,'package.json'),'{}')
  writeFileSync(join(pkg,'package.json'),JSON.stringify({type:'module',exports:{import:'./esm.js',require:'./cjs.cjs'}}))
  writeFileSync(join(pkg,'esm.js'),'export const x = "esm-tar"')
  writeFileSync(join(pkg,'cjs.cjs'),'module.exports = {}')
  const entry=join(upstream,'prepare.mjs')
  writeFileSync(entry,'export {x} from "tar"')
  const hook=registerHooks({resolve:officeDependencyResolver({upstream,tools,desktopManifest:join(root,'package.json')})})
  try{assert.equal((await import(pathToFileURL(entry).href)).x,'esm-tar')}
  finally{hook.deregister()}
})
