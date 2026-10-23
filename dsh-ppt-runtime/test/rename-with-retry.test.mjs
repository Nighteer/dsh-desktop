import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rename} from '../packages/ppt-runtime/core/lib/rename-with-retry.js';

test('retries transient Windows locks on exactly the same paths',async()=>{
  const calls=[],waits=[];
  await rename('stage','output',{platform:'win32',wait:async ms=>waits.push(ms),operation:async(...paths)=>{
    calls.push(paths);if(calls.length<3)throw Object.assign(new Error('locked'),{code:'EPERM'});
  }});
  assert.deepEqual(calls,[['stage','output'],['stage','output'],['stage','output']]);
  assert.deepEqual(waits,[50,100]);
});
test('does not retry conflicts or non-Windows errors and bounds permanent locks',async()=>{
  for(const [platform,code,count] of [['win32','EEXIST',1],['linux','EPERM',1],['win32','EPERM',6]]){
    let calls=0;const error=Object.assign(new Error(code),{code});
    await assert.rejects(rename('stage','output',{platform,wait:async()=>{},operation:async()=>{calls++;throw error}}),e=>e===error);
    assert.equal(calls,count);
  }
});
