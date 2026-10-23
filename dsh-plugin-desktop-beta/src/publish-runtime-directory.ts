import {renameSync} from 'node:fs'

interface PublishOptions {
  platform?:NodeJS.Platform
  rename?:(source:string,destination:string)=>void
  wait?:(milliseconds:number)=>void
}

/** Retry only transient Windows locks while publishing a never-reused directory. */
export function publishRuntimeDirectory(source:string,destination:string,options:PublishOptions={}):void {
  const rename=options.rename??renameSync
  const wait=options.wait??(milliseconds=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,milliseconds)})
  for(let attempt=0;;attempt++){
    try{rename(source,destination);return}
    catch(error){
      const code=(error as NodeJS.ErrnoException).code
      if((options.platform??process.platform)!=='win32'||!['EPERM','EACCES','EBUSY'].includes(code??'')||attempt>=5)throw error
      // No remove/copy fallback: target conflicts and permanent denials still fail.
      wait(50*2**attempt)
    }
  }
}
