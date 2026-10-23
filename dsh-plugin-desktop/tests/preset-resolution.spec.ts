import { createRequire } from 'node:module'
import { mkdirSync,mkdtempSync,rmSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect,it } from 'vitest'
import {composeEntries} from '@deepseek-ai/dsh-app-boot'
import {prepareDesktopProfile} from '../src/profile.ts'
import {installProfilePackageResolver} from '../src/module-resolution.ts'

it('resolves every declared native preset dependency without evaluating a profile plugin',()=>{
  const home=mkdtempSync(join(tmpdir(),'lets-native-preset-resolution-'))
  let release:(()=>void)|undefined
  try {
    const prepared=prepareDesktopProfile('1',home,'win32','desktop',undefined,{requested:'disabled',effective:'disabled',legacyDefaulted:false})
    release=installProfilePackageResolver(prepared.bareModuleBaseUrl)
    const require=createRequire(prepared.bareModuleBaseUrl)
    const presets=composeEntries([prepared.patches]).filter(row=>row.name==='@deepseek-ai/dsh-agent-preset')
    expect(presets.length).toBeGreaterThanOrEqual(4)
    const failures:string[]=[]
    function inspect(rows:unknown) {
      if(!Array.isArray(rows))return
      for(const row of rows){
        if(typeof row.name==='string' && !row.name.startsWith('cordis:')){
          try{require.resolve(row.name)}catch{failures.push(row.name)}
        }
        if(row.group)inspect(row.config)
      }
    }
    for(const row of presets)inspect((row.config as {plugins?:unknown}).plugins)
    expect([...new Set(failures)]).toEqual([])
    const probe=join(prepared.profile.dir,'node_modules','preset-discovery-probe')
    mkdirSync(probe,{recursive:true})
    writeFileSync(join(probe,'package.json'),JSON.stringify({name:'preset-discovery-probe',type:'module',exports:'./index.js'}))
    writeFileSync(join(probe,'index.js'),'throw Error("discovery evaluated plugin")')
    expect(require.resolve('preset-discovery-probe')).toBe(join(probe,'index.js'))
    expect(()=>require.resolve('missing-preset-fixture')).toThrow()
  }finally{release?.();rmSync(home,{recursive:true,force:true})}
})
