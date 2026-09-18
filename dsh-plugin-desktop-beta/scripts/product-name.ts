import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Read the Electron Builder product name used for installed application paths. */
export function readDesktopProductName(desktopRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
    build?: { productName?: unknown }
  }
  const productName = manifest.build?.productName
  if (typeof productName !== 'string' || productName.trim().length === 0) {
    throw new Error(`desktop package at ${desktopRoot} has no valid build.productName`)
  }
  return productName
}

/** Convert the installed product name into this project's versioned artifact prefix. */
export function productArtifactStem(productName: string): string {
  return productName.trim().replaceAll(/\s+/gu, '-')
}
