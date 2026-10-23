import {describe,it,expect,vi} from 'vitest'
import {desktopApplicationMenu} from '../src/desktop-application-menu.ts'
import {enterpriseAccountMenu,enterpriseAccountSummary,enterpriseAccountMenuPoint} from '../src/enterprise-account-menu.ts'

describe('simplified desktop menu',()=>{
  it('provides an explicit safe enterprise-service switch beside account actions',()=>{
    const logout=vi.fn(),change=vi.fn(),menu=enterpriseAccountMenu({name:'员工',username:'employee',departmentName:'总部'},false,logout,change)
    menu.find(item=>item.label==='更换企业服务（退出当前账号）')!.click!({} as never,{} as never,{} as never)
    expect(change).toHaveBeenCalledOnce();expect(logout).not.toHaveBeenCalled()
  })
  it('has five product entries and keeps account/enterprise navigation out of it',()=>{
    const run=vi.fn(),about=vi.fn(),remoteControl=vi.fn()
    const menu=desktopApplicationMenu(false,{run,about,remoteControl})
    expect(menu.filter(item=>item.type!=='separator').map(item=>item.label)).toEqual(['视图','工具','检查更新','关于 LETS','退出应用'])
    expect(JSON.stringify(menu)).not.toMatch(/退出登录|切换账号|企业应用|编辑/)
    const view=menu[0]!.submenu as Electron.MenuItemConstructorOptions[]
    view[0]!.click!({} as never,{} as never,{} as never);expect(run).toHaveBeenCalledWith('reload')
    const tools=menu[1]!.submenu as Electron.MenuItemConstructorOptions[]
    expect(tools.some(item=>item.label==='远程控制')).toBe(false);expect(remoteControl).not.toHaveBeenCalled()
    menu.find(item=>item.label==='关于 LETS')!.click!({} as never,{} as never,{} as never);expect(about).toHaveBeenCalledOnce()
    expect(menu.at(-1)?.role).toBe('quit')
  })
  it('localizes labels and omits unsupported remote control',()=>{
    const menu=desktopApplicationMenu(true,{run:vi.fn(),about:vi.fn()})
    expect(menu[0]!.label).toBe('View');expect(menu[1]!.label).toBe('Tools')
    expect(JSON.stringify(menu)).not.toContain('Remote control')
  })
})

describe('public account menu boundary',()=>{
  const account={name:'张三',username:'zhangsan',departmentName:'研发部'}
  it('projects only the three public identity fields',()=>{
    expect(enterpriseAccountSummary({...account,accessToken:'secret',refreshToken:'private',password:'hidden'} as typeof account)).toEqual(account)
  })
  it('separates identity from switch/logout and uses the existing secure logout path',()=>{
    const logout=vi.fn(),menu=enterpriseAccountMenu(account,false,logout)
    expect(menu.slice(0,3).every(item=>item.enabled===false)).toBe(true)
    expect(menu[3]!.type).toBe('separator')
    expect(menu.slice(4).map(item=>item.label)).toEqual(['切换账号','退出登录'])
    for(const item of menu.slice(4))item.click!({} as never,{} as never,{} as never)
    expect(logout).toHaveBeenCalledTimes(2)
  })
  it('anchors keyboard and mouse menus within the trusted content view at its zoom',()=>{
    const base={x:0,y:32,width:1000,height:700}
    expect(enterpriseAccountMenuPoint(100,400,1.5,base)).toEqual({x:150,y:632})
    for(const x of [NaN,Infinity,-1,1001,'1',undefined])expect(()=>enterpriseAccountMenuPoint(x,0,1,base)).toThrow()
    expect(()=>enterpriseAccountMenuPoint(0,701,1,base)).toThrow()
  })
})
