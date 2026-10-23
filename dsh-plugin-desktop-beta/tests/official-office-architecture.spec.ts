import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {describe,expect,it} from 'vitest'
import {locateOfficialOffice} from '../src/official-office.ts'

function fixture(){
  const base=resolve('../.artifacts')
  mkdirSync(base,{recursive:true})
  const directory=mkdtempSync(join(base,'office-architectures-')) // Retained for inspection.
  const resources=join(directory,'resources'),root=join(resources,'official-office')
  mkdirSync(root,{recursive:true})
  const pointer=(name:string,digest:string)=>writeFileSync(join(root,name),JSON.stringify({schema:1,directory:digest,coreVersion:'0.2.1-rc.2'}))
  return {root,resources,packageDirectory:join(directory,'package'),pointer}
}

describe('official Office architecture selection',()=>{
  it('selects each native payload from one universal application',()=>{
    const f=fixture()
    f.pointer('current-x64.json','a'.repeat(64));f.pointer('current-arm64.json','b'.repeat(64))
    expect(locateOfficialOffice({...f,resourcesPath:f.resources,arch:'x64'})).toBe(join(f.root,'a'.repeat(64)))
    expect(locateOfficialOffice({...f,resourcesPath:f.resources,arch:'arm64'})).toBe(join(f.root,'b'.repeat(64)))
  })
  it('keeps ordinary single-architecture snapshots compatible',()=>{
    const f=fixture();f.pointer('current.json','c'.repeat(64))
    expect(locateOfficialOffice({...f,resourcesPath:f.resources,arch:'x64'})).toBe(join(f.root,'c'.repeat(64)))
  })
  it('rejects a malformed native pointer instead of falling back to another runtime',()=>{
    const f=fixture();f.pointer('current.json','c'.repeat(64));f.pointer('current-arm64.json','../escape')
    expect(()=>locateOfficialOffice({...f,resourcesPath:f.resources,arch:'arm64'})).toThrow('Invalid official Office')
  })
})
