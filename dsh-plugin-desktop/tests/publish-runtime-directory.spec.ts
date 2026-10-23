import {describe,it,expect,vi} from 'vitest'
import {publishRuntimeDirectory} from '../src/publish-runtime-directory.ts'

describe('immutable runtime directory publication',()=>{
  it('retries the identical atomic rename after transient Windows file locks',()=>{
    const error=Object.assign(new Error('locked'),{code:'EPERM'})
    const rename=vi.fn().mockImplementationOnce(()=>{throw error}).mockImplementationOnce(()=>{throw error})
    const wait=vi.fn()
    publishRuntimeDirectory('new-stage','new-target',{platform:'win32',rename,wait})
    expect(rename.mock.calls).toEqual([['new-stage','new-target'],['new-stage','new-target'],['new-stage','new-target']])
    expect(wait.mock.calls).toEqual([[50],[100]])
  })
  it.each([['win32','EEXIST',1],['linux','EPERM',1],['win32','EPERM',6]] as const)(
    'fails closed for %s %s with at most %i attempts',(platform,code,attempts)=>{
      const error=Object.assign(new Error(code),{code}),rename=vi.fn(()=>{throw error}),wait=vi.fn()
      expect(()=>publishRuntimeDirectory('new-stage','new-target',{platform,rename,wait})).toThrow(error)
      expect(rename).toHaveBeenCalledTimes(attempts)
    })
})
