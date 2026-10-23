import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { resolveDesktopInitialSetup } from '../src/setup-wizard-startup.ts'
import { defaultDesktopSetupWizardSettings, readDesktopSetupWizardSettings, updateDesktopSetupWizardSettings } from '../src/setup-wizard-settings.ts'
import { completeOrSkipDesktopSetupWizard, desktopSetupWizardRequired, readDesktopSetupWizardState } from '../src/setup-wizard-state.ts'
import { desktopProfilePreferencesFromSettings, readDesktopProfilePreferences, writeDesktopProfilePreferences } from '../src/profile-preferences.ts'
import { isDesktopSetupWizardSelection, type DesktopSetupWizardInput, type DesktopSetupWizardResult } from '../src/setup-wizard-contract.ts'

const versions = { desktopVersion: '1.0.0', dshVersion: '0.2.1-rc.2', setupRevision: 1 }
function input(overrides: Partial<DesktopSetupWizardInput> = {}): DesktopSetupWizardInput {
  return {
    ...defaultDesktopSetupWizardSettings(), appVersion: '1.0.0', profileName: 'default',
    platform: 'win32', micaSupported: true, market: 'community-market', aaEnabled: false,
    ...overrides,
  }
}

describe('enterprise first-login setup', () => {
  it('persists recommended defaults and completion without showing a wizard, separately per account', async () => {
    const artifacts = new URL('../../.artifacts/', import.meta.url)
    mkdirSync(artifacts, { recursive: true })
    const root = mkdtempSync(fileURLToPath(new URL('enterprise-first-login-', artifacts))) // Retained acceptance data.
    const accountA = join(root, 'account-a'), accountB = join(root, 'account-b')
    mkdirSync(accountA)
    const profile = join(accountA, 'harness', 'profiles', 'default')
    const settingsPath = join(accountA, 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({ 'enterprise-guard': { enabled: true }, unrelated: 'keep' }))
    const showWizard = vi.fn<() => Promise<DesktopSetupWizardResult>>()
    const result = await resolveDesktopInitialSetup(input(readDesktopSetupWizardSettings(settingsPath)), true, showWizard)
    expect(showWizard).not.toHaveBeenCalled()
    expect(result.action).toBe('complete')
    if (result.action !== 'complete') throw new Error('Expected automatic completion')
    expect(isDesktopSetupWizardSelection(result.selection)).toBe(true)
    expect(result.selection).toMatchObject({ openBrowser: false, networkExposure: 'loopback', aaEnabled: false, notifications: { enabled: true } })
    await updateDesktopSetupWizardSettings(settingsPath, result.selection)
    await writeDesktopProfilePreferences(accountA, profile, desktopProfilePreferencesFromSettings(result.selection, result.selection.notifications, result.selection.market, result.selection.aaEnabled))
    await completeOrSkipDesktopSetupWizard(accountA, profile, 'completed', versions)
    expect(readDesktopProfilePreferences(accountA, profile)).toMatchObject({ mode: result.selection.mode, openBrowser: false, networkExposure: 'loopback', aaEnabled: false })
    expect(readDesktopSetupWizardSettings(settingsPath)).toEqual(defaultDesktopSetupWizardSettings())
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))['enterprise-guard']).toEqual({ enabled: true })
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).unrelated).toBe('keep')
    expect(desktopSetupWizardRequired(readDesktopSetupWizardState(accountA, profile), versions)).toBe(false)
    expect(desktopSetupWizardRequired(readDesktopSetupWizardState(accountB, profile), versions)).toBe(true)
  })
  it('preserves prepared preferences and does not mutate the supplied settings', async () => {
    const prepared = input({ mode: 'extended', market: 'disabled', openBrowser: true, networkExposure: 'lan', aaEnabled: true })
    const before = structuredClone(prepared)
    const result = await resolveDesktopInitialSetup(prepared, true, vi.fn())
    expect(result).toMatchObject({ action: 'complete', selection: { mode: 'extended', market: 'disabled', openBrowser: true, networkExposure: 'lan', aaEnabled: true } })
    if (result.action === 'complete') {
      expect(result.selection.notifications).not.toBe(prepared.notifications)
      expect(isDesktopSetupWizardSelection(result.selection)).toBe(true)
    }
    expect(prepared).toEqual(before)
  })
  it.each(['skip', 'quit'] as const)('keeps ordinary desktop wizard behavior for %s', async action => {
    const prepared = input(), showWizard = vi.fn().mockResolvedValue({ action })
    expect(await resolveDesktopInitialSetup(prepared, false, showWizard)).toEqual({ action })
    expect(showWizard).toHaveBeenCalledWith(prepared)
    expect(showWizard).toHaveBeenCalledTimes(1)
  })
})
