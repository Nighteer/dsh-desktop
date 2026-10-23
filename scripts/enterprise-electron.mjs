/** Resolve the selected edition's exact Electron version without replacing an existing runtime. */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export async function ensureEnterpriseElectron(name) {
  if (!['dsh-plugin-desktop', 'dsh-plugin-desktop-beta'].includes(name)) throw new Error('Unknown Desktop edition')
  const root = resolve(import.meta.dirname, '..')
  const desktopRequire = createRequire(resolve(root, name, 'package.json'))
  const project = JSON.parse(readFileSync(resolve(root, name, 'package.json'), 'utf8'))
  const expected = project.devDependencies.electron
  const candidates = [desktopRequire.resolve('electron/package.json'), ...['dsh-plugin-desktop-beta', 'dsh-plugin-desktop'].filter(other => other !== name).map(other => createRequire(resolve(root, other, 'package.json')).resolve('electron/package.json'))]
  const manifestPath = candidates.find(path => JSON.parse(readFileSync(path, 'utf8')).version === expected)
  if (!manifestPath) throw new Error(`Install Electron ${expected} in a fresh build workspace; existing runtimes are preserved`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const version = manifest.version
  const local = resolve(root, '.enterprise-local')
  const prefix = `electron-${version}-${process.platform}-${process.arch}-`
  const executable = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron'
  const valid = directory => existsSync(join(directory, executable)) &&
    existsSync(join(directory, 'version')) && readFileSync(join(directory, 'version'), 'utf8').trim() === version
  const installed = join(dirname(manifestPath), 'dist')
  if (valid(installed)) return installed
  mkdirSync(local, { recursive: true })
  for (const entry of readdirSync(local, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(prefix)) {
      const cached = join(local, entry.name, 'dist')
      if (valid(cached)) return cached
    }
  }
  if (!['win32', 'darwin'].includes(process.platform)) throw new Error('Enterprise runtime setup supports Windows and macOS only')
  const staging = mkdtempSync(join(local, prefix))
  const electronRequire = createRequire(manifestPath)
  const { downloadArtifact, initializeProxy } = electronRequire('@electron/get')
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) initializeProxy()
  const { extract } = electronRequire('@electron-internal/extract-zip')
  console.log(`Preparing Electron ${version} (${process.platform}/${process.arch}) in a new directory`)
  const archive = await downloadArtifact({
    version, artifactName: 'electron', platform: process.platform, arch: process.arch,
    cacheRoot: join(staging, 'cache'), checksums: electronRequire('./checksums.json'),
    mirrorOptions: { mirror: 'https://github.com/electron/electron/releases/download/' },
  })
  const distribution = join(staging, 'dist')
  await extract(archive, { dir: distribution })
  if (!valid(distribution)) throw new Error('Downloaded Electron runtime did not match its declared version')
  return distribution
}
