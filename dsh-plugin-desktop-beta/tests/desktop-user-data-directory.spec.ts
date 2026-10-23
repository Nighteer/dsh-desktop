import { describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_USER_DATA_DIRECTORY_ENV,
  resolveDesktopUserDataDirectory,
  type DesktopUserDataPathKind,
} from '../src/desktop-user-data-directory.ts'

const WINDOWS_APP_DATA = 'C:\\Users\\Example\\AppData\\Roaming'
const WINDOWS_OVERRIDE = 'D:\\workspace\\.runtime-appdata\\desktop-beta'

function resolveOverride(value: string, kind: DesktopUserDataPathKind = 'missing') {
  return resolveDesktopUserDataDirectory({
    platform: 'win32',
    environment: { [DESKTOP_USER_DATA_DIRECTORY_ENV]: value },
    defaultAppDataDirectory: () => { throw new Error('default AppData must not be read') },
    inspectPath: () => kind,
  })
}

describe('Desktop user-data directory', () => {
  it('preserves the product-specific default when the override is absent', () => {
    const getDefaultAppData = vi.fn(() => WINDOWS_APP_DATA)
    expect(resolveDesktopUserDataDirectory({
      platform: 'win32',
      environment: {},
      defaultAppDataDirectory: getDefaultAppData,
    })).toEqual({
      source: 'default',
      userDataDir: `${WINDOWS_APP_DATA}\\DSH Desktop Beta`,
      releaseUserDataRoot: WINDOWS_APP_DATA,
    })
    expect(getDefaultAppData).toHaveBeenCalledOnce()
  })

  it('uses an absolute override without reading default AppData', () => {
    expect(resolveOverride(WINDOWS_OVERRIDE)).toEqual({
      source: 'environment',
      userDataDir: WINDOWS_OVERRIDE,
      releaseUserDataRoot: `${WINDOWS_OVERRIDE}\\.release-user-data`,
    })
  })

  it('accepts an existing ordinary directory', () => {
    expect(resolveOverride(WINDOWS_OVERRIDE, 'directory').userDataDir).toBe(WINDOWS_OVERRIDE)
  })

  it.each([
    ['', 'must not be empty'],
    ['   ', 'must not be empty'],
    ['relative\\desktop-data', 'must be absolute'],
    ['C:\\', 'filesystem root'],
    ['D:\\workspace\nunsafe', 'control characters'],
  ])('rejects unsafe override %j', (configured, message) => {
    expect(() => resolveOverride(configured)).toThrow(message)
  })

  it.each(['file', 'symbolic-link', 'other'] as const)('rejects an existing %s', kind => {
    expect(() => resolveOverride(WINDOWS_OVERRIDE, kind)).toThrow(`found ${kind}`)
  })
})
