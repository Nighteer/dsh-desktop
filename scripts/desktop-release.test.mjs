import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cleanBuildEnvironment, releasePlan, verifyPE, windowsInstallerOptions } from './release-enterprise-desktop.mjs'
import { filesAt, hashFile, safeVersion } from './release-utils.mjs'

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
test('legacy HTTP release options remain accepted without requiring a domain preset', () => {
  const env = { DSH_ENTERPRISE_SERVER_URL: 'http://10.10.0.5', WIN_CSC_LINK: 'managed-signing.pfx' }
  assert.equal(releasePlan([], env, 'win32', 'x64').url, undefined)
  for (const edition of [[], ['--beta']]) {
    assert.deepEqual(releasePlan(edition, env, 'win32', 'x64').allowedHttpOrigins, [])
    assert.deepEqual(releasePlan([...edition, '--allow-http-origin', 'http://10.10.0.5'], env, 'win32', 'x64').allowedHttpOrigins, ['http://10.10.0.5'])
  }
  assert.throws(() => releasePlan(['--allow-http-origin', '*'], env, 'win32', 'x64'))
})
test('build subprocesses do not inherit signing credentials', () => {
  assert.deepEqual(cleanBuildEnvironment({ PATH: 'tools', CSC_LINK: 'secret', APPLE_ID: 'secret', WIN_CSC_KEY_PASSWORD: 'secret', MAC_CERT_P12_BASE64: 'secret' }), { PATH: 'tools' })
})
test('Windows candidates and formal installers share the working NSIS 7z decoder', () => {
  for (const args of [['--candidate', '--beta'], ['--candidate'], ['--beta'], []]) {
    const plan = releasePlan(args, { WIN_CSC_LINK: 'fixture.pfx' }, 'win32', 'x64')
    const options = windowsInstallerOptions({ ...plan.manifest.build, nsis: { ...plan.manifest.build.nsis, useZip: true } })
    assert.equal(options.useZip, false)
    assert.equal(options.differentialPackage, false)
    assert.equal(options.shortcutName, plan.manifest.build.productName)
  }
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
