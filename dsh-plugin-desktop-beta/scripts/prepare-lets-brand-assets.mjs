/** Derive LETSDSH client and tray assets from the user-supplied application icon. */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const buildRoot = join(packageRoot, 'build')
const sourcePath = join(buildRoot, 'app-icon.png')
const trayIconPath = join(buildRoot, 'tray-icon.svg')
const clientBrandDataPath = join(packageRoot, 'src', 'client', 'lets-brand-data.ts')
const TRAY_CANVAS_SIZE = 512

const source = await readFile(sourcePath)

const clientBrandPng = await sharp(source, { failOn: 'warning' })
  .resize({
    width: 128,
    height: 128,
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    kernel: sharp.kernel.lanczos3,
  })
  .ensureAlpha()
  .png({ compressionLevel: 9, progressive: false, adaptiveFiltering: false, palette: false })
  .toBuffer()
const clientBrandModule = [
  '/** Generated from build/app-icon.png by prepare-lets-brand-assets.mjs. */',
  `export const LETS_BRAND_IMAGE_DATA_URL = 'data:image/png;base64,${clientBrandPng.toString('base64')}'`,
  '',
].join('\n')
let currentClientBrandModule
try {
  currentClientBrandModule = await readFile(clientBrandDataPath, 'utf8')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}
if (currentClientBrandModule !== clientBrandModule) {
  await writeFile(clientBrandDataPath, clientBrandModule)
}

const rendered = await sharp(source, { failOn: 'warning' })
  .resize({
    width: TRAY_CANVAS_SIZE,
    height: TRAY_CANVAS_SIZE,
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    kernel: sharp.kernel.lanczos3,
  })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })
const pixels = Buffer.from(rendered.data)
for (let offset = 0; offset < pixels.length; offset += rendered.info.channels) {
  const [red, green, blue] = [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
  if (blue > 140 && blue > green * 1.1 && blue > red * 1.1) {
    pixels[offset] = 0
    pixels[offset + 1] = 0
    pixels[offset + 2] = 0
  } else {
    pixels[offset + 3] = 0
  }
}
const trayPng = await sharp(pixels, {
  raw: { width: rendered.info.width, height: rendered.info.height, channels: 4 },
}).png({ compressionLevel: 9, progressive: false, adaptiveFiltering: false, palette: false }).toBuffer()
const traySvg = [
  '<!-- LETSDSH tray mark generated from app-icon.png -->',
  `<svg xmlns="http://www.w3.org/2000/svg" width="${TRAY_CANVAS_SIZE}" height="${TRAY_CANVAS_SIZE}" viewBox="0 0 ${TRAY_CANVAS_SIZE} ${TRAY_CANVAS_SIZE}">`,
  `  <image width="${TRAY_CANVAS_SIZE}" height="${TRAY_CANVAS_SIZE}" href="data:image/png;base64,${trayPng.toString('base64')}"/>`,
  '</svg>',
  '',
].join('\n')
await writeFile(trayIconPath, traySvg)
