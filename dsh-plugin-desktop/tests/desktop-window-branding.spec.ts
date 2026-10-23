import { describe, expect, it, vi } from 'vitest'
import { configureDesktopWindowBranding, consumeDesktopTaskbarLaunch, desktopTaskbarRelaunchCommand } from '../src/desktop-window-branding.ts'
import { readFileSync } from 'node:fs'
import { DESKTOP_APP_ID } from '../src/product-identity.ts'

describe('Windows window branding', () => {
  it('uses the same ICO for native chrome and taskbar without changing launch behavior', () => {
    const window = { setIcon: vi.fn(), setAppDetails: vi.fn() }
    configureDesktopWindowBranding(window, 'win32')
    const iconPath = window.setIcon.mock.calls[0]?.[0]
    expect(iconPath).toMatch(/[\\/]build[\\/]app-icon\.ico$/u)
    expect(window.setAppDetails).toHaveBeenCalledExactlyOnceWith({
      appId: DESKTOP_APP_ID, appIconPath: iconPath, appIconIndex: 0,
    })
  })

  it.each(['darwin', 'linux'] as const)('keeps %s platform icon handling unchanged', platform => {
    const window = { setIcon: vi.fn(), setAppDetails: vi.fn() }
    configureDesktopWindowBranding(window, platform)
    expect(window.setIcon).not.toHaveBeenCalled()
    expect(window.setAppDetails).not.toHaveBeenCalled()
  })

  it('sets a complete taskbar identity rather than only the small window icon', () => {
    const window = {setIcon:vi.fn(),setAppDetails:vi.fn()}
    configureDesktopWindowBranding(window,'win32','"C:\\LETS\\LETS.exe"')
    expect(window.setAppDetails).toHaveBeenCalledWith(expect.objectContaining({
      appId:DESKTOP_APP_ID,relaunchCommand:'"C:\\LETS\\LETS.exe"',relaunchDisplayName:'LETS',
    }))
  })

  it('preserves the enterprise development entry and data isolation without a shell or secrets', () => {
    const command=desktopTaskbarRelaunchCommand('C:\\Program Files\\Electron\\electron.exe',['D:\\团队 & 项目\\lib\\main.js'],{
      development:true,enterprise:true,userDataDir:'D:\\团队 & 项目\\.runtime-appdata\\enterprise-beta',
    })
    expect(command).toContain('"C:\\Program Files\\Electron\\electron.exe" "D:\\团队 & 项目\\lib\\main.js"')
    expect(command).toContain('"--lets-taskbar-enterprise"')
    expect(command).not.toMatch(/cmd\.exe|powershell|token|password/iu)
    const env:NodeJS.ProcessEnv={}
    expect(consumeDesktopTaskbarLaunch(['electron.exe','main.js','--lets-taskbar-enterprise','--lets-taskbar-user-data=D:\\团队 & 项目\\.runtime-appdata\\enterprise-beta'],env)).toEqual(['electron.exe','main.js'])
    expect(env).toEqual({DSH_ENTERPRISE_MODE:'1',DSH_DESKTOP_USER_DATA_DIR:'D:\\团队 & 项目\\.runtime-appdata\\enterprise-beta'})
    expect(()=>consumeDesktopTaskbarLaunch(['electron.exe','--lets-taskbar-user-data=relative'],{})).toThrow('Invalid')
  })

  it('keeps packaged taskbar commands on the shipped executable and registers identity before login', () => {
    expect(desktopTaskbarRelaunchCommand('C:\\LETS\\LETS.exe',[],{development:false,enterprise:true,userDataDir:'C:\\unused'})).toBe('"C:\\LETS\\LETS.exe"')
    expect(desktopTaskbarRelaunchCommand('C:\\Electron\\electron.exe',['C:\\LETS\\lib\\main.js'],{development:true,enterprise:false})).not.toContain('--lets-taskbar-user-data=')
    const main=readFileSync(new URL('../src/main.ts',import.meta.url),'utf8'),run=main.slice(main.indexOf('async function run()'))
    expect(run.indexOf('app.setAppUserModelId')).toBeLessThan(run.indexOf('enterprise.authenticate()'))
    expect(run.match(/app\.on\('browser-window-created'/gu)).toHaveLength(1)
    expect(run).toContain('configureDesktopWindowBranding(window, process.platform, relaunchCommand)')
  })
})
