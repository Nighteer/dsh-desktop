/** Real Office files through the official query, isolated Python and Kit CLI. No model or GUI. */
import {execFileSync} from 'node:child_process'
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'

const root=resolve(import.meta.dirname,'..'),edition=process.argv[2]??'dsh-plugin-desktop-beta'
if(!['dsh-plugin-desktop-beta','dsh-plugin-desktop'].includes(edition))throw Error('Unexpected edition')
const directory=join(root,edition),require=createRequire(join(directory,'package.json'))
const load=name=>import(pathToFileURL(require.resolve(name)).href)
const [{Context},{default:Agents},{default:SystemPrompt},{default:Tools},{default:Skills},{ToolCallId},{installOfficialOffice}]=await Promise.all([
  load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-agent'),load('@deepseek-ai/dsh-system-prompt'),load('@deepseek-ai/dsh-tools'),load('@deepseek-ai/dsh-skill'),load('@deepseek-ai/dsh-llm'),import(pathToFileURL(join(directory,'lib/official-office.js')).href),
])
const parent=join(root,'.enterprise-local');mkdirSync(parent,{recursive:true})
const work=mkdtempSync(join(parent,'official-office-acceptance-'))
const tasks=join(work,'中文 Office 文件 验收');mkdirSync(tasks)
const environment={...process.env,TMP:work,TEMP:work,TMPDIR:work,PYTHONDONTWRITEBYTECODE:'1'}
delete environment.PYTHONHOME;delete environment.PYTHONPATH
const ctx=new Context()
try{
  await ctx.plugin(Agents);await ctx.plugin(SystemPrompt);await ctx.plugin(Tools);await ctx.plugin(Skills)
  const status=await installOfficialOffice(ctx)
  assert.equal(status.enabled,true)
  assert.equal((await ctx.skills.list()).filter(s=>s.provider==='dsh-office').length,7)
  const result=await ctx.tools.execute({callId:ToolCallId('office-acceptance'),name:'load_workspace_dependencies',arguments:{},signal:new AbortController().signal})
  assert.equal(result.isError,false)
  const paths=result.value
  const run=(program,args)=>execFileSync(program,args,{cwd:tasks,env:environment,encoding:'utf8',timeout:120000,windowsHide:true})
  const script=String.raw`
from pathlib import Path
import sys,json
from docx import Document
from openpyxl import Workbook,load_workbook
from pptx import Presentation
root=Path(sys.argv[1])
text='WorkBuddy 的专家，本质上是把大模型的通用智能，封装成面向特定任务的、可复用的 AI 工作能力。'
doc=Document();doc.add_heading('Office 官方工作流验收',0);doc.add_paragraph(text);doc.save(root/'中文文档.docx')
assert Document(root/'中文文档.docx').paragraphs[1].text==text
book=Workbook();sheet=book.active;sheet.title='测试数据';sheet.append(['项目','数量']);sheet.append(['甲',2]);sheet.append(['乙',3]);sheet['B4']='=SUM(B2:B3)';book.save(root/'中文表格.xlsx')
assert load_workbook(root/'中文表格.xlsx').active['B4'].value=='=SUM(B2:B3)'
deck=Presentation();slide=deck.slides.add_slide(deck.slide_layouts[1]);slide.shapes.title.text='Office 官方工作流验收';slide.placeholders[1].text=text;deck.save(root/'中文演示.pptx')
assert Presentation(root/'中文演示.pptx').slides[0].shapes.title.text=='Office 官方工作流验收'
print(json.dumps({'python':sys.executable,'docx':True,'xlsx':True,'pptx':True},ensure_ascii=False))
`
  const created=JSON.parse(run(paths.python,['-I','-B','-c',script,tasks]).trim())
  const render=await ctx.skills.get('office-export-pdf')
  const payload=JSON.parse(render.content.slice(render.content.lastIndexOf('\n{')+1))
  const cli=payload.libreofficeKit.cli
  const pdf=join(tasks,'中文文档.pdf')
  const conversion=run(paths.node,[cli,'convert','--input',join(tasks,'中文文档.docx'),'--output',pdf])
  assert.equal(readFileSync(pdf).subarray(0,5).toString(),'%PDF-')
  const recalculated=join(tasks,'中文表格-已重算.xlsx')
  run(paths.node,[cli,'recalculate','--input',join(tasks,'中文表格.xlsx'),'--output',recalculated])
  run(paths.python,['-I','-B','-c',"import sys;from openpyxl import load_workbook;assert load_workbook(sys.argv[1],data_only=True).active['B4'].value==5;assert load_workbook(sys.argv[1],data_only=False).active['B4'].value.startswith('=')",recalculated])
  const record={edition,work,filesCreated:created,officialSkills:7,pdf:true,formulaCache:5,conversion:JSON.parse(conversion)}
  writeFileSync(join(work,'verification.json'),JSON.stringify(record,null,2))
  console.log(JSON.stringify(record))
}finally{await ctx.fiber.dispose()}
