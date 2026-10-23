/** Fetch exact official published artifacts into a NEW vendored generation, without executing packages. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const source = join(root, 'deepseek-harness')
const version = '0.2.1-rc.2'
const commit = '687f282e8625c6b8d11ff58211a90524be2e4317'
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source }).toString().trim() !== commit) throw new Error('Unexpected upstream source pin')
const names = []
const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: source }).toString().split('\n').filter(p => p.endsWith('/package.json'))
for (const path of paths) {
  const p = JSON.parse(await readFile(join(source, path), 'utf8'))
  if (!p.private && p.version === version && (p.name === '@deepseek-ai/dsh' || p.name?.startsWith('@deepseek-ai/dsh-'))) names.push(p.name)
}
const directory = join(root, 'vendor/dsh-runtime', version)
await mkdir(directory, { recursive: true })
const packages = [], missing = []
let next = 0
async function fetchRetry(url) {
  let cause
  for (let i = 0; i < 3; i++) {
    try { return await fetch(url, { signal: AbortSignal.timeout(45000) }) } catch (error) { cause = error }
  }
  throw cause
}
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < names.length) {
    const name = names[next++]
    const response = await fetchRetry(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`)
    if (response.status === 404) { missing.push(name); continue }
    if (!response.ok) throw new Error(`Registry metadata failed for ${name}: ${response.status}`)
    const metadata = await response.json()
    const filename = `${name.replace('@', '').replace('/', '-')}-${version}.tgz`
    const destination = join(directory, filename)
    const integrity = metadata.dist.integrity
    if (!integrity?.startsWith('sha512-') || !metadata.dist.tarball.startsWith('https://registry.npmjs.org/')) throw new Error('Unexpected registry integrity/source')
    let bytes
    try { bytes = await readFile(destination) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (!bytes) {
      const artifact = await fetchRetry(metadata.dist.tarball)
      if (!artifact.ok) throw new Error(`Artifact failed: ${name}: ${artifact.status}`)
      bytes = Buffer.from(await artifact.arrayBuffer())
      if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== integrity) throw new Error(`Artifact integrity mismatch: ${name}`)
      await writeFile(destination, bytes, { flag: 'wx' })
    }
    if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== integrity) throw new Error(`Existing artifact mismatch: ${name}`)
    packages.push({ name, version, filename, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity, registryTarball: metadata.dist.tarball })
    if (packages.length % 25 === 0) console.log(`Verified ${packages.length}/${names.length} Harness artifacts`)
  }
}))
if (!packages.some(p => p.name === '@deepseek-ai/dsh')) throw new Error('Launcher artifact missing')
const manifest = { formatVersion: 1, repository: 'https://github.com/deepseek-ai/deepseek-harness.git', commit, version, buildProfile: 'official', artifactOrigin: 'official-npm-registry', provenanceNote: 'Commit identifies the reviewed source release; these are integrity-verified official npm artifacts, not a locally rebuilt source attestation.', packages: packages.sort((a, b) => a.name.localeCompare(b.name)) }
await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2)+'\n')
console.log(JSON.stringify({ version, verifiedPackages: packages.length, missing }))
