/** Non-destructive source checkpoint before an upstream runtime migration. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const parent = join(root, '.enterprise-local/harness-upgrade-backups')
await mkdir(parent, { recursive: true })
const backup = await mkdtemp(join(parent, 'pre-0.2.1-rc.2-'))
const files = [...new Set(execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean))]
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const entries = []
for (const file of files) {
  if (file === 'deepseek-harness' || /^(?:vendor\/|output\/)/u.test(file) || /(?:^|\/)(?:node_modules|lib|dist|\.build)(?:\/|$)/u.test(file)) continue
  const source = join(root, file)
  const info = await lstat(source)
  if (!info.isFile()) continue
  const destination = join(backup, 'source', file)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination)
  const hash = sha(await readFile(source))
  if (sha(await readFile(destination)) !== hash) throw new Error(`Backup mismatch: ${file}`)
  entries.push({ file, bytes: info.size, sha256: hash })
}
await writeFile(join(backup, 'worktree.patch'), execFileSync('git', ['diff', '--binary'], { cwd: root, maxBuffer: 100_000_000 }), { flag: 'wx' })
await writeFile(join(backup, 'manifest.json'), JSON.stringify({ entries, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(), upstream: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(root, 'deepseek-harness') }).toString().trim() }, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ backup, verifiedFiles: entries.length }))
