import {Context} from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import {ToolCallId} from '@deepseek-ai/dsh-llm'
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {dirname,join,resolve} from 'node:path'
import {afterEach,describe,expect,it} from 'vitest'
import {installOfficialOffice,locateOfficialOffice} from '../src/official-office.ts'

const roots:string[]=[],prefix=resolve('../.enterprise-local/official-office-tests-')
const names=['office','office-docx','office-export-pdf','office-pptx','office-recalculate','office-render','office-xlsx']
function fixture(){
  mkdirSync(dirname(prefix),{recursive:true})
  const root=mkdtempSync(prefix);roots.push(root)
  const runtime=join(root,'primary-runtime'),python=join(runtime,'dependencies/python'),node=join(runtime,'dependencies/node')
  for(const directory of [python,join(python,'Lib/site-packages'),join(python,'lib/python3.12/site-packages'),join(python,'bin'),join(node,'bin'),join(node,'node_modules')])mkdirSync(directory,{recursive:true})
  for(const file of [join(python,'python.exe'),join(python,'bin/python3'),join(node,'bin/node.exe'),join(node,'bin/node')])writeFileSync(file,'fixture')
  writeFileSync(join(runtime,'runtime.json'),JSON.stringify({desktopVersion:'test',platform:process.platform,arch:process.arch,python:'3.12.14',node:'24.21.0',pythonPackages:Object.fromEntries(['python-docx','python-pptx','openpyxl','pandas','Pillow','lxml'].map(name=>[name,'1.0.0']))}))
  const source=join(dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-skill-office/package.json')),'assets')
  for(const name of names){mkdirSync(join(root,'office-skills',name),{recursive:true});copyFileSync(join(source,name,'SKILL.md'),join(root,'office-skills',name,'SKILL.md'))}
  return root
}
afterEach(()=>{for(const root of roots.splice(0)){if(!resolve(root).startsWith(prefix))throw Error('Unexpected fixture cleanup target');rmSync(root,{recursive:true,force:true})}})

describe('official Office carrier integration',()=>{
  it('registers the seven official skills and the real read-only dependency query together',async()=>{
    const source=fixture(),ctx=new Context(),environment={...process.env}
    try{
      await ctx.plugin(AgentRegistry);await ctx.plugin(SystemPrompt);await ctx.plugin(SkillRegistry);await ctx.plugin(ToolRuntime)
      expect(await installOfficialOffice(ctx,{source})).toEqual({enabled:true,source})
      expect(await installOfficialOffice(ctx,{source})).toEqual({enabled:true,source})
      expect((await ctx.skills.list()).map(skill=>skill.name).sort()).toEqual(names)
      expect(ctx.tools.schemas().filter(tool=>tool.name==='load_workspace_dependencies')).toHaveLength(1)
      const result=await ctx.tools.execute({callId:ToolCallId('official-office-dependencies'),name:'load_workspace_dependencies',arguments:{},signal:new AbortController().signal})
      expect(result.isError).toBe(false)
      if(result.isError)throw Error(JSON.stringify(result.error))
      expect(result.value).toMatchObject({python:expect.stringContaining('primary-runtime'),pythonDistributions:expect.objectContaining({'python-docx':'1.0.0'})})
      expect(process.env).toEqual(environment)
      expect((await ctx.skills.get('office-docx'))?.content).toContain('Do not install packages')
      expect((await ctx.skills.get('office-render'))?.content).toContain('Installed LibreOffice Kit')
      expect((await ctx.skills.get('office-render'))?.content).not.toContain('Word.Application')
      const sourceCode=readFileSync('src/official-office.ts','utf8')
      expect(sourceCode).toContain("name:'lets-official-office'")
      expect(sourceCode).toContain('Do not install pip/npm packages')
    }finally{await ctx.fiber.dispose()}
  })

  it('does not discover system Python or install anything when the default payload is absent',async()=>{
    const ctx=new Context(),directory=fixture()
    try{expect(await installOfficialOffice(ctx,{packageDirectory:join(directory,'missing'),resourcesPath:join(directory,'missing-resources')})).toEqual({enabled:false})}
    finally{await ctx.fiber.dispose()}
  })

  it('fails closed on explicit missing or mismatched payloads',async()=>{
    const source=fixture(),manifest=join(source,'primary-runtime/runtime.json'),data=JSON.parse(readFileSync(manifest,'utf8'));data.arch='unsupported';writeFileSync(manifest,JSON.stringify(data))
    const ctx=new Context()
    try{await expect(installOfficialOffice(ctx,{source})).rejects.toThrow();await expect(installOfficialOffice(ctx,{source:join(source,'missing')})).rejects.toThrow()}
    finally{await ctx.fiber.dispose()}
  })

  it('rejects traversal and wrong-core pointers and prefers external packaged resources',()=>{
    const directory=fixture(),resources=join(directory,'resources/official-office'),pack=join(directory,'package/build/official-office')
    mkdirSync(resources,{recursive:true});mkdirSync(pack,{recursive:true})
    writeFileSync(join(resources,'current.json'),JSON.stringify({schema:1,directory:'../escape',coreVersion:'0.2.1-rc.2'}))
    expect(()=>locateOfficialOffice({resourcesPath:dirname(resources),packageDirectory:join(directory,'package')})).toThrow('Invalid')
    writeFileSync(join(resources,'current.json'),JSON.stringify({schema:1,directory:'a'.repeat(64),coreVersion:'0.2.1-rc.2'}))
    expect(locateOfficialOffice({resourcesPath:dirname(resources),packageDirectory:join(directory,'package')})).toBe(join(resources,'a'.repeat(64)))
    expect(()=>locateOfficialOffice({source:'relative'})).toThrow('absolute')
  })

  it('covers isolated and in-process Host paths and keeps payloads outside ASAR',()=>{
    for(const file of ['src/main.ts','src/host-bootstrap.ts'])expect(readFileSync(file,'utf8')).toContain('await installOfficialOffice(ctx)')
    const manifest=JSON.parse(readFileSync('package.json','utf8'))
    expect(manifest.build.extraResources).toContainEqual({from:'build/official-office',to:'official-office',filter:['**/*']})
  })
})
