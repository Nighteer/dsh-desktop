/** Fail before packaging rather than silently shipping an Office-less client. */
import {existsSync,readFileSync,statSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'

export default async function verifyOfficialOfficePackage(context){
  const directory=context.packager.projectDir
  const root=join(directory,'build/official-office'),pointer=join(root,'current.json')
  if(!existsSync(pointer))throw Error('Official Office payload is missing. Run corepack yarn office:prepare before packaging.')
  const current=JSON.parse(readFileSync(pointer,'utf8'))
  if(current.schema!==1||current.coreVersion!=='0.2.1-rc.2'||!/^[a-f0-9]{64}$/u.test(current.directory))throw Error('Invalid official Office snapshot')
  const snapshot=join(root,current.directory),source=join(snapshot,'primary-runtime')
  const require=createRequire(join(directory,'package.json'))
  const {readPrimaryRuntime,resolvePrimaryRuntime}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tool-workspace-dependencies')).href)
  const manifest=await readPrimaryRuntime(source)
  const targetArch=['ia32','x64','armv7l','arm64','universal'][context.arch]
  if(manifest.platform!==context.electronPlatformName||manifest.arch!==targetArch)throw Error('Official Office payload target does not match the package target')
  if(manifest.payloadDigest!==current.directory)throw Error('Official Office payload digest mismatch')
  const paths=await resolvePrimaryRuntime(source)
  if(!paths.node)throw Error('Official Office standalone Node is missing')
  for(const name of ['python-docx','python-pptx','openpyxl','pandas','Pillow','lxml'])if(!manifest.pythonPackages[name])throw Error(`Missing official Office library: ${name}`)
  for(const name of ['office','office-docx','office-pptx','office-xlsx','office-render','office-recalculate','office-export-pdf'])if(!statSync(join(snapshot,'office-skills',name,'SKILL.md')).isFile())throw Error('Official Office skill resources are incomplete')
}
