import {describe,it,expect,vi} from 'vitest'
import {DesktopSettingsController} from '../src/desktop-settings-controller.ts'

describe('remote control is unavailable',()=>{
  it('rejects activation without writing preferences or scheduling a restart',async()=>{
    const selectAa=vi.fn(),scheduleRestart=vi.fn()
    const controller=new DesktopSettingsController({readMarket:()=>({requested:'disabled',effective:'disabled'}),readAa:()=>({requested:true,effective:false}),selectAa,scheduleRestart} as never)
    await expect(controller.selectAa(true)).rejects.toThrow('远程控制已从当前桌面版停用')
    expect(selectAa).not.toHaveBeenCalled();expect(scheduleRestart).not.toHaveBeenCalled()
  })
})
