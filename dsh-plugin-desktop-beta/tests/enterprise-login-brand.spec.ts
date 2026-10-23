import {describe,it,expect,vi} from 'vitest'
const {constructed}=vi.hoisted(()=>({constructed:vi.fn()}))
vi.mock('electron',async()=>{
  const {EventEmitter}=await import('node:events')
  class Window extends EventEmitter{
    webContents={setWindowOpenHandler:vi.fn(),on:vi.fn(),ipc:{handle:vi.fn()}}
    constructor(options:unknown){super();constructed(options)}
    async loadFile(){this.emit('closed')}
  }
  return {app:{whenReady:async()=>{}},BrowserWindow:Window,dialog:{},Menu:{},MenuItem:class{},safeStorage:{isEncryptionAvailable:()=>false},session:{},WebContentsView:class{}}
})
vi.mock('node:fs',()=>({existsSync:()=>false,mkdirSync:vi.fn(),readFileSync:vi.fn(),writeFileSync:vi.fn()}))
import {DesktopEnterpriseLogin} from '../src/enterprise-login.ts'
describe('enterprise login window branding',()=>{
  it('uses the shipped LETS icon without weakening the sandboxed login boundary',async()=>{
    const login=new DesktopEnterpriseLogin('C:/isolated-brand-test','http://127.0.0.1:4310')
    expect(await login.authenticate()).toBe(false)
    expect(constructed).toHaveBeenCalledWith(expect.objectContaining({title:'LETS · 企业登录',height:720,useContentSize:true,icon:expect.stringMatching(/[\\/]build[\\/]app-icon\.png$/u),backgroundColor:'#f3f8fe',webPreferences:expect.objectContaining({sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,partition:'dsh-enterprise-login'})}))
  })
})
