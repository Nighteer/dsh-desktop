/** Generate native tray bitmaps from the repository-owned monochrome SVG. */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const buildRoot = join(packageRoot, 'build')
const sourcePath = join(buildRoot, 'tray-icon.svg')
const source = await readFile(sourcePath, 'utf8')

if (/<style\b/iu.test(source)) {
  throw new Error('generate-tray-icons: tray-icon.svg must not contain style rules')
}

const variants = [
  ['tray-iconTemplate.png', '#000000', 16],
  ['tray-iconTemplate@2x.png', '#000000', 32],
  ['tray-icon-blue.png', '#4D6BFE', 16],
  ['tray-icon-blue@1.25x.png', '#4D6BFE', 20],
  ['tray-icon-blue@1.5x.png', '#4D6BFE', 24],
  ['tray-icon-blue@2x.png', '#4D6BFE', 32],
]

await Promise.all(variants.map(async ([filename, color, size]) => {
  await sharp(Buffer.from(source))
    .resize({ width: size, height: size, fit: 'contain' })
    .tint(color)
    .png({ compressionLevel: 9 })
    .toFile(join(buildRoot, filename))
}))
