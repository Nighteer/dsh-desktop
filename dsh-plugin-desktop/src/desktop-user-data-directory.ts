/** Safe, explicit selection of Electron's Desktop userData directory. */

import { lstatSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { DESKTOP_USER_DATA_DIRECTORY_NAME } from './product-identity.ts'

/** Development-only escape hatch for isolating all Electron-owned state. */
export const DESKTOP_USER_DATA_DIRECTORY_ENV = 'DSH_DESKTOP_USER_DATA_DIR'

const OVERRIDE_RELEASE_USER_DATA_ROOT = '.release-user-data'

export type DesktopUserDataPathKind =
  | 'directory'
  | 'file'
  | 'missing'
  | 'other'
  | 'symbolic-link'

export interface DesktopUserDataDirectoryOptions {
  readonly environment?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  /** Kept lazy so an override never needs to read Electron's default appData path. */
  readonly defaultAppDataDirectory: () => string
  /** Injectable for deterministic path-safety tests. */
  readonly inspectPath?: (path: string) => DesktopUserDataPathKind
}

export interface DesktopUserDataDirectoryResolution {
  readonly source: 'default' | 'environment'
  readonly userDataDir: string
  /** Root used to inspect the stable/Beta sibling channel without escaping isolation. */
  readonly releaseUserDataRoot: string
}

/** Invalid or unsafe DSH_DESKTOP_USER_DATA_DIR configuration. */
export class DesktopUserDataDirectoryError extends Error {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(
      `${DESKTOP_USER_DATA_DIRECTORY_ENV}: ${message}`,
      options.cause === undefined ? undefined : { cause: options.cause },
    )
    this.name = 'DesktopUserDataDirectoryError'
  }
}

function inspectDesktopUserDataPath(path: string): DesktopUserDataPathKind {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return 'symbolic-link'
    if (stat.isDirectory()) return 'directory'
    if (stat.isFile()) return 'file'
    return 'other'
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw new DesktopUserDataDirectoryError('the configured path could not be inspected', { cause })
  }
}

/** Resolve the Desktop userData tree without creating or modifying it. */
export function resolveDesktopUserDataDirectory(
  options: DesktopUserDataDirectoryOptions,
): DesktopUserDataDirectoryResolution {
  const environment = options.environment ?? process.env
  const platform = options.platform ?? process.platform
  const path = platform === 'win32' ? win32 : posix
  const configured = environment[DESKTOP_USER_DATA_DIRECTORY_ENV]

  if (configured === undefined) {
    const appDataDir = options.defaultAppDataDirectory()
    return {
      source: 'default',
      userDataDir: path.join(appDataDir, DESKTOP_USER_DATA_DIRECTORY_NAME),
      releaseUserDataRoot: appDataDir,
    }
  }

  if (configured.trim().length === 0) {
    throw new DesktopUserDataDirectoryError('the configured path must not be empty')
  }
  if (/\0|\r|\n/u.test(configured)) {
    throw new DesktopUserDataDirectoryError('the configured path must not contain control characters')
  }
  if (!path.isAbsolute(configured)) {
    throw new DesktopUserDataDirectoryError('the configured path must be absolute')
  }

  const userDataDir = path.resolve(configured)
  const root = path.parse(userDataDir).root
  const isRoot = platform === 'win32'
    ? userDataDir.toLowerCase() === root.toLowerCase()
    : userDataDir === root
  if (isRoot) {
    throw new DesktopUserDataDirectoryError('a filesystem root cannot be used as Desktop user data')
  }

  const kind = (options.inspectPath ?? inspectDesktopUserDataPath)(userDataDir)
  if (kind !== 'missing' && kind !== 'directory') {
    throw new DesktopUserDataDirectoryError(
      `the configured path must be a directory or a path that does not yet exist (found ${kind})`,
    )
  }

  return {
    source: 'environment',
    userDataDir,
    releaseUserDataRoot: path.join(userDataDir, OVERRIDE_RELEASE_USER_DATA_ROOT),
  }
}
