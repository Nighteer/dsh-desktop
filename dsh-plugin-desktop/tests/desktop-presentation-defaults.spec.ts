import {describe,it,expect} from 'vitest'
import {desktopStartupSettingsFromSettings} from '../src/profile.ts'
import {defaultDesktopSetupWizardSettings} from '../src/setup-wizard-settings.ts'
import {DESKTOP_SAFE_MODE_DEFAULTS} from '../src/safe-mode.ts'

describe('desktop presentation defaults',()=>{
  it.each(['win32','darwin','linux'] as const)('projects defaults for %s without depending on the test host',platform=>{
    expect(desktopStartupSettingsFromSettings({},platform).mode).toBe(platform==='win32'?'advanced':'compatibility')
    expect(desktopStartupSettingsFromSettings({'dsh-desktop':{}},platform).mode).toBe(platform==='win32'?'advanced':'compatibility')
  })
  it('defaults new Windows installations to enhanced mode consistently',()=>{
    const mode=process.platform==='win32'?'advanced':'compatibility'
    expect(desktopStartupSettingsFromSettings({}).mode).toBe(mode)
    expect(defaultDesktopSetupWizardSettings().mode).toBe(mode)
  })
  it.each(['compatibility','extended','advanced'])('preserves an explicit %s choice',mode=>{
    expect(desktopStartupSettingsFromSettings({'dsh-desktop':{mode}}).mode).toBe(mode)
  })
  it.each([{openBrowser:true},{networkExposure:'lan'}])('keeps legacy browser access compatible: %j',settings=>{
    expect(desktopStartupSettingsFromSettings({'dsh-desktop':settings})).toMatchObject({mode:'compatibility',openBrowser:true})
  })
  it('keeps the recovery environment in compatibility mode',()=>{
    expect(DESKTOP_SAFE_MODE_DEFAULTS.settings.mode).toBe('compatibility')
  })
})
