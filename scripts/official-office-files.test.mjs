import {test} from 'node:test'
import assert from 'node:assert/strict'
import {lstatSync,mkdirSync,mkdtempSync,readFileSync,readlinkSync,symlinkSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {copyOfficialOfficeSnapshot} from './official-office-files.mjs'

test('published Office snapshots preserve relative Python aliases after relocation',{skip:process.platform==='win32'},()=>{
  const artifacts=resolve(import.meta.dirname,'../.artifacts')
  mkdirSync(artifacts,{recursive:true})
  const root=mkdtempSync(join(artifacts,'office-snapshot-')) // Retained.
  const source=join(root,'prepared'),destination=join(root,'published')
  const bin=join('primary-runtime','dependencies','python','bin')
  mkdirSync(join(source,bin),{recursive:true})
  writeFileSync(join(source,bin,'python3.12'),'interpreter fixture')
  for(const alias of ['python','python3'])symlinkSync('python3.12',join(source,bin,alias))
  copyOfficialOfficeSnapshot(source,destination)
  for(const alias of ['python','python3']){
    const path=join(destination,bin,alias)
    assert.ok(lstatSync(path).isSymbolicLink())
    assert.equal(readlinkSync(path),'python3.12')
    assert.equal(readFileSync(path,'utf8'),'interpreter fixture')
  }
  assert.throws(()=>copyOfficialOfficeSnapshot(source,destination),{code:'ERR_FS_CP_EEXIST'})
})
