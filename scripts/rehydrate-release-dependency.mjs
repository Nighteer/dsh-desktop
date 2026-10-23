/** Recover a release input from a lock-verified Yarn archive into a NEW directory. */
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { filesAt, hashFile, run } from './release-utils.mjs'

const root = resolve(import.meta.dirname, '..')
export function rehydrateDependency(name, archive) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(name)) throw new Error('Invalid package name')
  const original = JSON.parse(readFileSync(join(root, 'dsh-plugin-desktop-beta/node_modules', name, 'package.json'), 'utf8'))
  const require = createRequire(createRequire(join(root,'package.json')).resolve('dsh-enterprise-contracts'))
  const lock = require('yaml').parse(readFileSync(join(root, 'yarn.lock'), 'utf8'))
  const entry = Object.values(lock).find(value => value.resolution === `${name}@npm:${original.version}`)
  const digest = createHash('sha512').update(readFileSync(archive)).digest('hex')
  if (!entry?.checksum || entry.checksum.split('/').at(-1) !== digest) throw new Error('Archive does not match the root Yarn lock checksum')
  mkdirSync(join(root, '.artifacts'), { recursive: true })
  const staging = mkdtempSync(join(root, '.artifacts', 'rehydrated-dependency-'))
  run('tar', ['-xf', resolve(archive), '-C', staging], root)
  const directory = join(staging, 'node_modules', name)
  const recovered = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (recovered.name !== name || recovered.version !== original.version) throw new Error('Recovered package identity mismatch')
  // Read every recovered file; do not silently skip missing or corrupt inputs.
  const files = filesAt(directory).map(file => ({ file, sha256: hashFile(join(directory, file)) }))
  const manifest = { name, version: original.version, directory, archiveSha512: digest, files }
  writeFileSync(join(staging, 'recovery.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  const overlays = join(staging, 'overlays.json')
  writeFileSync(overlays, JSON.stringify([{ name, directory, archiveSha512: digest }], null, 2) + '\n', { flag: 'wx' })
  console.log(`Verified replacement (original untouched): ${overlays}`)
  return overlays
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { rehydrateDependency(process.argv[2], process.argv[3]) } catch (error) { console.error(error.message); process.exitCode = 1 }
}
