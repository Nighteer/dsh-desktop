/** Fail before packaging rather than silently shipping an Office-less client. */
import {existsSync,readFileSync,statSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'

export default async function verifyOfficialOfficePackage(context){
  const directory=context.packager.projectDir
  const root=join(directory,'build/official-office')
  const targetArch=['ia32','x64','armv7l','arm64','universal'][context.arch]
  if(targetArch==='universal'){
    for(const arch of [1,3])await verifyOfficialOfficePackage({...context,arch})
    return
  }
  const architecturePointer=join(root,`current-${targetArch}.json`)
  const pointer=existsSync(architecturePointer)?architecturePointer:join(root,'current.json')
  if(!existsSync(pointer))throw Error('Official Office payload is missing. Run corepack yarn office:prepare before packaging.')
  const current=JSON.parse(readFileSync(pointer,'utf8'))
  if(current.schema!==1||current.coreVersion!=='0.2.1-rc.2'||!/^[a-f0-9]{64}$/u.test(current.directory))throw Error('Invalid official Office snapshot')
  const snapshot=join(root,current.directory),source=join(snapshot,'primary-runtime')
  const require=createRequire(join(directory,'package.json'))
  const {readPrimaryRuntime,resolvePrimaryRuntime}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tool-workspace-dependencies')).href)
  const manifest=await readPrimaryRuntime(source)
  if(manifest.platform!==context.electronPlatformName||manifest.arch!==targetArch)throw Error('Official Office payload target does not match the package target')
  if(manifest.payloadDigest!==current.directory)throw Error('Official Office payload digest mismatch')
  if(targetArch===process.arch&&manifest.platform===process.platform){
    const paths=await resolvePrimaryRuntime(source)
    if(!paths.node)throw Error('Official Office standalone Node is missing')
  }else{
    // Cross-architecture payloads cannot execute on this builder. Check the
    // same required files without pretending that their architecture is native.
    const windows=manifest.platform==='win32'
    for(const file of [
      join('dependencies/node/bin',windows?'node.exe':'node'),
      join('dependencies/python',...(windows?['python.exe']:['bin','python3'])),
    ])if(!statSync(join(source,file)).isFile())throw Error(`Missing official Office interpreter: ${file}`)
    for(const folder of [
      'dependencies/node/node_modules',
      join('dependencies/python',...(windows?['Lib','site-packages']:['lib',`python${manifest.python.split('.').slice(0,2).join('.')}`,'site-packages'])),
    ])if(!statSync(join(source,folder)).isDirectory())throw Error(`Missing official Office library directory: ${folder}`)
  }
  for(const name of ['python-docx','python-pptx','openpyxl','pandas','Pillow','lxml'])if(!manifest.pythonPackages[name])throw Error(`Missing official Office library: ${name}`)
  for(const name of ['office','office-docx','office-pptx','office-xlsx','office-render','office-recalculate','office-export-pdf'])if(!statSync(join(snapshot,'office-skills',name,'SKILL.md')).isFile())throw Error('Official Office skill resources are incomplete')
}
