import {describe,it,expect,vi} from 'vitest'
import {desktopNotificationIcon,desktopNotificationOptions,registerDesktopNotificationBranding} from '../src/desktop-notification-branding.ts'
import {DESKTOP_APP_ID} from '../src/product-identity.ts'

describe('LETS notification identity',()=>{
  it('adds the shipped blue logo without changing notification text',()=>{
    expect(desktopNotificationIcon()).toMatch(/[\\/]build[\\/]app-icon\.png$/u)
    expect(desktopNotificationOptions({title:'完成',body:'查看结果'})).toEqual({title:'完成',body:'查看结果',icon:desktopNotificationIcon()})
  })
  it('updates only this edition’s current-user display metadata using fixed argv, never shell or deletion',()=>{
    const execute=vi.fn((_program:string,_args:string[],_options:unknown)=>({status:0,error:undefined}))
    registerDesktopNotificationBranding('win32',execute as never)
    expect(execute).toHaveBeenCalledTimes(2)
    for(const [program,args,options] of execute.mock.calls as unknown as [string,string[],Record<string,unknown>][]){
      expect(program).toMatch(/System32\\reg\.exe$/u)
      expect(args.slice(0,2)).toEqual(['add',`HKCU\\Software\\Classes\\AppUserModelId\\${DESKTOP_APP_ID}`])
      expect(options).toMatchObject({shell:false,windowsHide:true,timeout:3000})
    }
    expect(execute.mock.calls[0]?.[1]).toContain('LETS')
  })
  it('does not mutate registration on other platforms and reports errors',()=>{
    const execute=vi.fn(()=>({status:1}))
    registerDesktopNotificationBranding('linux',execute as never);expect(execute).not.toHaveBeenCalled()
    expect(()=>registerDesktopNotificationBranding('win32',execute as never)).toThrow('Could not register')
  })
})
