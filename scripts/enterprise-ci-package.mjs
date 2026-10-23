/** Add enterprise metadata to CI artifacts without changing ordinary local builds. */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashFile } from './release-utils.mjs'

const projectRoot = resolve(import.meta.dirname, '..')
const editions = new Set(['dsh-plugin-desktop', 'dsh-plugin-desktop-beta'])

function sourceManifest(workspace, root) {
  if (!editions.has(workspace)) throw new Error('Select a declared desktop workspace')
  const path = join(root, workspace, 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  if (manifest.name !== workspace || !manifest.build?.productName) throw new Error('Invalid desktop manifest')
  return { path, manifest }
}

function assertNoPreset(manifest) {
  if (Object.hasOwn(manifest, 'dshEnterpriseServer')) {
    throw new Error('CI enterprise artifacts must let the user select the service address')
  }
}

export function prepareEnterpriseCiPackage(workspace, root = projectRoot) {
  const { path, manifest } = sourceManifest(workspace, root)
  assertNoPreset(manifest)
  assertNoPreset(manifest.build.extraMetadata ?? {})
  manifest.dshEnterprise = true
  manifest.build.extraMetadata = { ...manifest.build.extraMetadata, dshEnterprise: true }
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

export function verifyEnterpriseCiPackage(workspace, platform, root = projectRoot) {
  if (!['win32', 'darwin'].includes(platform)) throw new Error('Select a Windows or macOS artifact')
  const { manifest } = sourceManifest(workspace, root)
  if (manifest.dshEnterprise !== true || manifest.build.extraMetadata?.dshEnterprise !== true) {
    throw new Error('Enterprise CI preparation was not applied')
  }
  assertNoPreset(manifest)
  assertNoPreset(manifest.build.extraMetadata)
  const output = join(root, workspace, 'dist', ...(platform === 'darwin' ? ['mac-smoke'] : []))
  const appRoot = platform === 'win32'
    ? join(output, 'win-unpacked', 'resources', 'app')
    : join(output, 'mac-universal', `${manifest.build.productName}.app`, 'Contents', 'Resources', 'app')
  const packagedBytes = readFileSync(join(appRoot, 'package.json'))
  const packaged = JSON.parse(packagedBytes)
  if (packaged.name !== workspace || packaged.version !== manifest.version || packaged.dshEnterprise !== true) {
    throw new Error('Packaged application is not the expected enterprise desktop')
  }
  assertNoPreset(packaged)
  const installers = readdirSync(output).filter(name => platform === 'win32' ? name.endsWith('-Setup.exe') : name.endsWith('.dmg'))
  if (installers.length !== 1) throw new Error('Expected exactly one installer in the verified output')
  const report = {
    workspace,
    version: packaged.version,
    platform,
    enterpriseLoginRequired: true,
    serviceAddress: null,
    signed: false,
    readyForProduction: false,
    installer: installers[0],
    installerSha256: hashFile(join(output, installers[0])),
    packagedManifestSha256: createHash('sha256').update(packagedBytes).digest('hex'),
  }
  writeFileSync(join(output, `enterprise-${platform}-verification.json`), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, workspace, platform, ...extra] = process.argv.slice(2)
    if (extra.length || (action === 'prepare' && platform !== undefined)) throw new Error('Unexpected argument')
    if (action === 'prepare') {
      prepareEnterpriseCiPackage(workspace)
      console.log(`Enterprise login enabled for ${workspace}; service address remains user-selected.`)
    } else if (action === 'verify') {
      console.log(JSON.stringify(verifyEnterpriseCiPackage(workspace, platform)))
    } else throw new Error('Usage: enterprise-ci-package.mjs prepare <workspace> | verify <workspace> <win32|darwin>')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
