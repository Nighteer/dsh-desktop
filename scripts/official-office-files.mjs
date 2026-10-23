import {cpSync} from 'node:fs'

/** Keep interpreter aliases relative so an Office snapshot remains relocatable. */
export function copyOfficialOfficeSnapshot(source,destination){
  cpSync(source,destination,{recursive:true,dereference:false,verbatimSymlinks:true,force:false,errorOnExist:true})
}
