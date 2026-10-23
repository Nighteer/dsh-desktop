/** Produce an allowlisted ops bundle; never copy developer credentials or databases. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, openSync, readSync, closeSync, lstatSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(import.meta.dirname, '..')
export function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Release step failed: ${command} (${result.status})`)
}
export function hashFile(path) {
  const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024), fd = openSync(path, 'r')
  try {
    for (;;) { const length = readSync(fd, buffer); if (!length) break; hash.update(buffer.subarray(0, length)) }
    return hash.digest('hex')
  } finally { closeSync(fd) }
}
export function filesAt(path, base = path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.env'].includes(entry.name)) return []
    const full = join(path, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in release inputs: ${full}`)
    return entry.isDirectory() ? filesAt(full, base) : [relative(base, full).replaceAll('\\', '/')]
  }).sort()
}
export function safeVersion(value) {
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(value)) throw new Error('Invalid release version')
  return value
}
