import {cpSync,lstatSync} from 'node:fs'

/** Keep interpreter aliases relative so an Office snapshot remains relocatable. */
export function copyOfficialOfficeSnapshot(source,destination){
  if(lstatSync(destination,{throwIfNoEntry:false}))throw Error('Refusing to replace an existing Office snapshot')
  cpSync(source,destination,{recursive:true,dereference:false,verbatimSymlinks:true,force:false,errorOnExist:true})
}
