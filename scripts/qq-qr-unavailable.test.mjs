import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {startQrConnect,qrConnect} from '../vendor/lets/qq-qr-unavailable/index.js'

test('QQ QR adapter fails explicitly without executing callbacks',async()=>{
  let called=false
  assert.throws(()=>startQrConnect({onSuccess(){called=true}}),/手动填写 AppID 和 AppSecret/u)
  await assert.rejects(qrConnect(),/暂不支持 QQ 扫码/u)
  assert.equal(called,false)
})
test('desktop uses the owned adapter and it ships no third-party SDK dependencies',()=>{
  const root=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)))
  assert.equal(root.resolutions['@tencent-connect/qqbot-connector@npm:1.2.0'],'file:vendor/lets/lets-qq-qr-unavailable-1.0.0.tgz')
  const adapter=JSON.parse(readFileSync(new URL('../vendor/lets/qq-qr-unavailable/package.json',import.meta.url)))
  assert.equal(adapter.name,'@lets/qq-qr-unavailable')
  assert.equal(adapter.dependencies,undefined)
  assert.equal(adapter.license,'MIT')
})
