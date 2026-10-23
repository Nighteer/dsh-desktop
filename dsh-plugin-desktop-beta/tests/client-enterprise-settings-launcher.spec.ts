// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {describe,it,expect,vi} from 'vitest'
import {EnterpriseSettingsLauncher} from '../src/client/enterprise-settings-launcher.tsx'

describe('enterprise-only settings launcher',()=>{
  it('opens settings directly without offering upstream sign-in or feedback',async()=>{
    Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
    const container=document.createElement('div'),root=createRoot(container),openSettings=vi.fn()
    try{
      await act(async()=>root.render(createElement(EnterpriseSettingsLauncher,{wide:true,settingsOpen:false,openSettings,openOnboarding:vi.fn()})))
      expect(container.textContent).toBe('设置')
      expect(container.textContent).not.toMatch(/登录|意见反馈|更多/)
      await act(async()=>container.querySelector('button')!.click())
      expect(openSettings).toHaveBeenCalledOnce()
      await act(async()=>root.render(createElement(EnterpriseSettingsLauncher,{wide:false,settingsOpen:false,openSettings,openOnboarding:vi.fn()})))
      expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('设置')
    }finally{await act(async()=>root.unmount())}
  })
})
