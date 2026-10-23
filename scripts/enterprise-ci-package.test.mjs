import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { prepareEnterpriseCiPackage, verifyEnterpriseCiPackage } from './enterprise-ci-package.mjs'
import { hashFile } from './release-utils.mjs'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(join(root, 'dsh-plugin-desktop-beta/package.json'))
const { parse } = require('yaml')

function fixture(workspace, platform) {
  mkdirSync(join(root, '.artifacts'), { recursive: true })
  const directory = mkdtempSync(join(root, '.artifacts', 'enterprise-ci-test-')) // Retained, never cleaned up.
  const productName = workspace.endsWith('-beta') ? 'LETS Desktop Beta' : 'LETS Desktop'
  const manifest = { name: workspace, version: '1.0.0', build: { productName, extraMetadata: { fixture: 'preserved' } } }
  const manifestPath = join(directory, workspace, 'package.json')
  mkdirSync(join(directory, workspace), { recursive: true })
  writeFileSync(manifestPath, JSON.stringify(manifest))
  const output = join(directory, workspace, 'dist', ...(platform === 'darwin' ? ['mac-smoke'] : []))
  const appRoot = platform === 'win32' ? join(output, 'win-unpacked', 'resources', 'app')
    : join(output, 'mac-universal', `${productName}.app`, 'Contents', 'Resources', 'app')
  mkdirSync(appRoot, { recursive: true })
  const installer = platform === 'win32' ? 'fixture-1.0.0-x64-Setup.exe' : 'fixture-1.0.0-universal.dmg'
  writeFileSync(join(output, installer), 'Inert fixture; never executed.')
  const packagedPath = join(appRoot, 'package.json')
  writeFileSync(packagedPath, JSON.stringify({ name: workspace, version: '1.0.0', dshEnterprise: true }))
  return { directory, manifest, manifestPath, output, installer, packagedPath }
}

for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-plugin-desktop']) {
  for (const platform of ['win32', 'darwin']) {
    test(`${workspace}/${platform}: prepared metadata and verified package require enterprise login`, () => {
      const f = fixture(workspace, platform)
      const prepared = prepareEnterpriseCiPackage(workspace, f.directory)
      assert.equal(prepared.dshEnterprise, true)
      assert.deepEqual(prepared.build.extraMetadata, { fixture: 'preserved', dshEnterprise: true })
      assert.equal(prepared.version, f.manifest.version)
      const report = verifyEnterpriseCiPackage(workspace, platform, f.directory)
      assert.equal(report.enterpriseLoginRequired, true)
      assert.equal(report.serviceAddress, null)
      assert.equal(report.readyForProduction, false)
      assert.equal(report.installerSha256, hashFile(join(f.output, f.installer)))
      assert.deepEqual(JSON.parse(readFileSync(join(f.output, `enterprise-${platform}-verification.json`), 'utf8')), report)
    })
  }
}

test('rejects ordinary, wrong-edition, wrong-version and preset-address packaged applications', () => {
  const workspace = 'dsh-plugin-desktop-beta'
  const f = fixture(workspace, 'win32')
  assert.throws(() => verifyEnterpriseCiPackage(workspace, 'win32', f.directory), /preparation/u)
  prepareEnterpriseCiPackage(workspace, f.directory)
  for (const override of [
    { dshEnterprise: false }, { name: 'ordinary-desktop' }, { version: '0.0.0' },
    { dshEnterpriseServer: 'http://127.0.0.1:4310' },
  ]) {
    writeFileSync(f.packagedPath, JSON.stringify({ name: workspace, version: '1.0.0', dshEnterprise: true, ...override }))
    assert.throws(() => verifyEnterpriseCiPackage(workspace, 'win32', f.directory))
  }
})

test('refuses source address presets and undeclared workspace paths', () => {
  const workspace = 'dsh-plugin-desktop', f = fixture(workspace, 'darwin')
  for (const patch of [
    { dshEnterpriseServer: 'https://private.example' },
    { build: { ...f.manifest.build, extraMetadata: { dshEnterpriseServer: 'https://private.example' } } },
  ]) {
    writeFileSync(f.manifestPath, JSON.stringify({ ...f.manifest, ...patch }))
    assert.throws(() => prepareEnterpriseCiPackage(workspace, f.directory), /service address/u)
  }
  assert.throws(() => prepareEnterpriseCiPackage('../enterprise', f.directory), /declared desktop/u)
})

test('workflow enables enterprise mode after package checks and verifies it before uploading', () => {
  const workflow = parse(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'))
  for (const [jobName, platform, gate, build] of [
    ['desktop-windows', 'win32', 'check:win-package', 'dist:win'],
    ['desktop-macos', 'darwin', 'check:mac-package', 'dist:mac-smoke'],
  ]) {
    const job = workflow.jobs[jobName], steps = job.steps
    const findRun = command => steps.findIndex(step => step.run === command)
    const gateIndex = findRun(`yarn workspace \${{ matrix.workspace }} ${gate}`)
    const prepareIndex = findRun('node scripts/enterprise-ci-package.mjs prepare ${{ matrix.workspace }}')
    const officeIndex = findRun(platform === 'win32' ? 'yarn office:prepare:stable' : 'yarn office:prepare:mac')
    const buildIndex = findRun(`yarn workspace \${{ matrix.workspace }} ${build}`)
    const verifyIndex = findRun(`node scripts/enterprise-ci-package.mjs verify \${{ matrix.workspace }} ${platform}`)
    const uploadIndex = steps.findIndex(step => step.uses === 'actions/upload-artifact@v6')
    assert.ok(gateIndex >= 0 && prepareIndex > gateIndex && buildIndex > prepareIndex && verifyIndex > buildIndex && uploadIndex > verifyIndex)
    assert.ok(officeIndex > gateIndex && officeIndex < prepareIndex, 'Office payload must be prepared before enterprise metadata changes the package')
    assert.ok(steps[uploadIndex].with.path.includes(`enterprise-${platform}-verification.json`))
    assert.ok(steps.some(step => step.with?.submodules === 'recursive'))
    assert.deepEqual(job.strategy.matrix.include.map(entry => entry.workspace), ['dsh-plugin-desktop'])
  }
  assert.equal(workflow.jobs.release, undefined)
  assert.equal(workflow.on.push.tags, undefined)
})
