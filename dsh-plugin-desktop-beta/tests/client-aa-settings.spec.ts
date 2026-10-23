// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopSettingsSection, type DesktopSettingsSectionProps } from '../src/client/DesktopSettingsSection.tsx'
import { zh } from '../src/client/desktop-settings-locales.ts'

let root: Root | undefined
let container: HTMLDivElement | undefined

function scope(value: unknown) {
  const snapshot = { status: 'ready', writable: true, value }
  return { getSnapshot: () => snapshot, subscribe: () => () => {} }
}

async function mount(selectAa: (enabled: boolean) => Promise<{ accepted: true; restartRequired: boolean }>, aa = { requested: false, effective: false }) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const props = {
    t: (key: keyof typeof zh) => zh[key],
    api: {
      read: async () => ({ current: 'desktop', profiles: [],
        aa,
        market: { requested: 'disabled', effective: 'disabled', legacyDefaulted: false },
        web: { localUrl: '', lanUrls: [], lanState: 'inactive', lanError: null, lanCaFingerprint: null, lanCaUrls: [] },
      }), selectAa,
    },
    platform: 'darwin', initialMode: 'compatibility', micaSupported: false, setMode: async () => {},
    desktopSettings: scope({ mode: 'compatibility', openBrowser: false, networkExposure: 'loopback', macosMaterial: 'off', windowsMaterial: 'off' }),
    notificationSettings: scope({ enabled: false }),
  } as unknown as DesktopSettingsSectionProps
  await act(async () => { root!.render(createElement(DesktopSettingsSection, props)) })
  return container
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  vi.unstubAllGlobals()
})

describe('removed remote control settings', () => {
  it('does not offer activation or retry for a legacy requested adapter', async () => {
    const select = vi.fn(async () => ({ accepted: true as const, restartRequired: true }))
    const section = await mount(select, { requested: true, effective: false })
    expect(section.querySelector('[aria-labelledby="dsh-desktop-aa-title"]')).toBeNull()
    expect(section.textContent).not.toContain(zh.retryAa)
    expect(select).not.toHaveBeenCalled()
  })

  it('keeps normal desktop settings without the remote-control section', async () => {
    const select = vi.fn()
    const section = await mount(select)
    expect(section.textContent).toContain(zh.notificationsTitle)
    expect(section.textContent).not.toContain(zh.aaTitle)
    expect(select).not.toHaveBeenCalled()
  })

  it('does not expose obsolete background-command notification toggles', async () => {
    const select = vi.fn()
    const section = await mount(select)
    expect(section.textContent).not.toContain(zh.jobCompletion)
    expect(section.textContent).not.toContain(zh.jobFailure)
    expect(section.textContent).toContain(zh.turnCompletion)
  })
})
