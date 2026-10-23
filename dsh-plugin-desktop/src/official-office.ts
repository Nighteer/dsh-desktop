/** Compose the official Office skills and read-only bundled dependency query. */
import type {Context} from '@deepseek-ai/cordis'
import * as officeSkills from '@deepseek-ai/dsh-skill-office'
import * as workspaceDependencies from '@deepseek-ai/dsh-tool-workspace-dependencies'
import {existsSync,readFileSync,statSync} from 'node:fs'
import {dirname,isAbsolute,join} from 'node:path'
import {fileURLToPath} from 'node:url'

export interface OfficialOfficeOptions {
  /** Snapshot containing primary-runtime/ and office-skills/. Explicit paths fail closed. */
  source?: string
  /** Injectable only for tests and packaged resource discovery. */
  resourcesPath?: string
  packageDirectory?: string
  arch?: NodeJS.Architecture
}
export interface OfficialOfficeState {enabled:boolean;source?:string}

/** No downloads, shell probes, system Python discovery or account writes. */
export function locateOfficialOffice(options:OfficialOfficeOptions={}):string|undefined{
  if(options.source!==undefined){
    if(!isAbsolute(options.source))throw Error('Official Office source must be absolute')
    return options.source
  }
  const resources=options.resourcesPath??(process as NodeJS.Process&{resourcesPath?:string}).resourcesPath
  const packageDirectory=options.packageDirectory??fileURLToPath(new URL('../',import.meta.url))
  const roots=[...(resources?[join(resources,'official-office')]:[]),join(packageDirectory,'build/official-office')]
  for(const root of roots){
    const architecturePointer=join(root,`current-${options.arch??process.arch}.json`)
    const pointer=existsSync(architecturePointer)?architecturePointer:join(root,'current.json')
    if(!existsSync(pointer))continue
    const value=JSON.parse(readFileSync(pointer,'utf8')) as {schema?:unknown;directory?:unknown;coreVersion?:unknown}
    if(value.schema!==1||typeof value.directory!=='string'||!/^[a-f0-9]{64}$/u.test(value.directory)||value.coreVersion!=='0.2.1-rc.2')throw Error('Invalid official Office snapshot pointer')
    return join(root,value.directory)
  }
  return undefined
}

const installations=new WeakMap<Context,Promise<OfficialOfficeState>>()
/** Activate after the ordinary Profile has loaded its tools and skills services. */
export function installOfficialOffice(ctx:Context,options:OfficialOfficeOptions={}):Promise<OfficialOfficeState>{
  const previous=installations.get(ctx)
  if(previous)return previous
  const installation=(async()=>{
    const source=locateOfficialOffice(options)
    if(!source){
      ctx.logger.warn('LETS: 官方 Office 运行环境尚未准备；请运行 yarn office:prepare。不会查找或安装系统 Python。')
      ctx.get('systemPrompt')?.section({name:'lets-official-office-unavailable',order:65,text:
        'The bundled LETS Office runtime has not been prepared by the administrator. For Office file tasks, explain this prerequisite instead of installing packages, probing system Python, invoking Microsoft Office COM or printers, or inventing a replacement pipeline. Respect an explicitly user-selected existing project environment.'})
      return {enabled:false}
    }
    const runtime=join(source,'primary-runtime')
    const paths=await workspaceDependencies.resolvePrimaryRuntime(runtime)
    const manifest=await workspaceDependencies.readPrimaryRuntime(runtime)
    for(const name of ['python-docx','python-pptx','openpyxl','pandas','Pillow','lxml']){
      if(!manifest.pythonPackages[name])throw Error(`Official Office payload lacks ${name}`)
    }
    if(!paths.node)throw Error('Official Office requires the bundled standalone Node executable')
    const assets=join(source,'office-skills')
    for(const name of ['office','office-docx','office-xlsx','office-pptx','office-render','office-recalculate','office-export-pdf']){
      if(!statSync(join(assets,name,'SKILL.md')).isFile())throw Error(`Missing official Office skill: ${name}`)
    }
    const cli=join(dirname(fileURLToPath(import.meta.resolve('@deepseek-ai/libreoffice-kit/package.json'))),'lib/cli.js')
    if(!statSync(cli).isFile())throw Error('Official LibreOffice Kit CLI is unavailable')
    // Omit root: the official query uses this app-owned payload in place. It
    // never replaces a per-account runtime or changes PATH/pip configuration.
    await ctx.plugin(workspaceDependencies,{source:runtime})
    await ctx.plugin(officeSkills,{assetRoot:assets,node:paths.node,cli})
    ctx.get('systemPrompt')?.section({name:'lets-official-office',order:65,text:[
      'For downloadable Word (.docx), Excel (.xlsx), and PowerPoint (.pptx) files, load the relevant official office skill and call load_workspace_dependencies before writing scripts.',
      'Use its bundled Python and libraries unless the user or project explicitly requires another environment. Do not install pip/npm packages or probe system Python to bootstrap the default Office workflow.',
      'Keep the existing PPT-mode workflow for PPT-mode tasks. Use Univer for its interactive document/workbook experience when requested; it is not the bundled Python environment.',
      'Follow the official validation scope. Do not invoke Microsoft Office COM, printers, or replacement renderers to work around errors. Preserve usable source files and report a failed optional operation instead of repeating it indefinitely.',
      'A missing-font warning alone does not mean file creation failed. Report font or rendering limitations; do not rewrite unrelated styles or repeatedly regenerate a file solely to silence a warning.',
    ].join('\n')})
    return {enabled:true,source}
  })()
  installations.set(ctx,installation)
  void installation.catch(()=>{installations.delete(ctx)})
  return installation
}
