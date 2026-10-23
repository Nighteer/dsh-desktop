import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cleanBuildEnvironment, releasePlan, verifyPE } from './release-enterprise-desktop.mjs'
import { filesAt, hashFile, safeVersion, copyReleaseInputs, RELEASE_TEMPLATE_FILES } from './package-enterprise-server.mjs'

test('formal releases allow user-selected endpoints but never silently become unsigned', () => {
  assert.throws(() => releasePlan([], {}, 'win32', 'x64'), /requires/u)
  assert.throws(() => releasePlan([], { DSH_ENTERPRISE_SERVER_URL: 'https://lets.example' }, 'win32', 'x64'), /signing/u)
  assert.equal(releasePlan([], { WIN_CSC_LINK: 'managed-signing.pfx' }, 'win32', 'x64').url, undefined)
  const plan = releasePlan(['--candidate'], {}, 'win32', 'x64')
  assert.equal(plan.candidate, true)
  assert.equal(plan.url, undefined)
  assert.throws(() => releasePlan(['--candidate'], {}, 'linux', 'x64'))
  assert.throws(() => releasePlan(['--acceptance-only'], { WIN_CSC_LINK: 'managed-signing.pfx' }, 'win32', 'x64'))
})
test('HTTP release configuration is exact and explicit', () => {
  const env = { DSH_ENTERPRISE_SERVER_URL: 'http://10.10.0.5', WIN_CSC_LINK: 'managed-signing.pfx' }
  assert.equal(releasePlan([], env, 'win32', 'x64').url, undefined)
  assert.deepEqual(releasePlan(['--allow-http-origin', 'http://10.10.0.5'], env, 'win32', 'x64').allowedHttpOrigins, ['http://10.10.0.5'])
  assert.throws(() => releasePlan(['--allow-http-origin', '*'], env, 'win32', 'x64'))
})
test('build subprocesses do not inherit signing credentials', () => {
  assert.deepEqual(cleanBuildEnvironment({ PATH: 'tools', CSC_LINK: 'secret', APPLE_ID: 'secret', WIN_CSC_KEY_PASSWORD: 'secret', MAC_CERT_P12_BASE64: 'secret' }), { PATH: 'tools' })
})
test('release manifests hash files and reject malformed Windows installers', () => {
  const artifacts = resolve(import.meta.dirname, '../.artifacts')
  mkdirSync(artifacts, { recursive: true })
  const directory = mkdtempSync(join(artifacts, 'release-unit-'))
  const file = join(directory, 'file.exe')
  writeFileSync(file, 'abc', { flag: 'wx' })
  assert.equal(hashFile(file), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.throws(() => verifyPE(file))
  mkdirSync(join(directory, 'node_modules'))
  writeFileSync(join(directory, 'node_modules/secret'), 'exclude')
  writeFileSync(join(directory, '.env'), 'exclude')
  assert.deepEqual(filesAt(directory), ['file.exe'])
  assert.equal(safeVersion('1.0.0'), '1.0.0')
  assert.throws(() => safeVersion('../unsafe'))
})
test('ops bundles exclude credentials, certificates and backups placed beside templates', () => {
  const artifacts = resolve(import.meta.dirname, '../.artifacts')
  const directory = mkdtempSync(join(artifacts, 'bundle-secrets-test-')), template = join(directory, 'template'), source = join(directory, 'source'), destination = join(directory, 'bundle')
  const put = (path, value) => { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, value, { flag: 'wx' }) }
  for (const entry of RELEASE_TEMPLATE_FILES) put(join(template, entry), 'public template fixture')
  for (const file of ['.env', 'certs/privkey.pem', 'backups/database.dump', 'runtime/model-key.bin']) put(join(template, file), 'fake-private-fixture-never-copy')
  for (const name of ['dsh-enterprise-server', 'dsh-enterprise-contracts']) put(join(source, name, 'src/example.ts'), 'export const example = true')
  copyReleaseInputs(destination, template, source)
  for (const file of ['.env', 'certs/privkey.pem', 'backups/database.dump', 'runtime/model-key.bin']) assert.equal(existsSync(join(destination, file)), false)
  assert.ok(existsSync(join(destination, 'runtime/dsh-enterprise-server/src/example.ts')))
})
