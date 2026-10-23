/** Enterprise installers: unsigned candidates are explicit; formal releases fail closed. */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { ensureEnterpriseElectron } from './enterprise-electron.mjs'
import { hashFile, filesAt, run } from './package-enterprise-server.mjs'
import { explicitHttpOrigins } from '../dsh-enterprise-contracts/src/enterprise-origin.ts'
import { MAX_DESKTOP_INSTALLER_BYTES } from '../dsh-enterprise-contracts/src/desktop-releases.ts'

const root = resolve(import.meta.dirname, '..')
export function cleanBuildEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !/^(?:APPLE_|CSC_|WIN_CSC_|WIN_CERTIFICATE_|WIN_PUBLISHER_|MAC_CERT_|MACOS_SIGN_)/iu.test(key)))
}
export function releasePlan(argv, env = process.env, platform = process.platform, arch = process.arch) {
  const flagArgs = [...argv], allowedHttpOrigins = []
  for (let index = 0; index < flagArgs.length; index++) {
    if (flagArgs[index] === '--allow-http-origin') {
      allowedHttpOrigins.push(...explicitHttpOrigins(flagArgs[index + 1] ?? 'INVALID'))
      flagArgs.splice(index, 2); index--
    }
  }
  const flags = new Set(flagArgs)
  for (const value of flags) if (!['--beta', '--candidate', '--check-only', '--acceptance-only'].includes(value)) throw new Error(`Unknown option: ${value}`)
  if (!['win32', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Use a native Windows/macOS x64 or arm64 build machine')
  const candidate = flags.has('--candidate')
  const acceptanceOnly = flags.has('--acceptance-only')
  if (acceptanceOnly && !candidate) throw new Error('--acceptance-only is forbidden for a formal release')
  const name = flags.has('--beta') ? 'dsh-plugin-desktop-beta' : 'dsh-plugin-desktop'
  const manifest = JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8'))
  if (!candidate && platform === 'win32' && !env.WIN_CSC_LINK && !env.CSC_LINK && !env.WIN_CERTIFICATE_SHA1) throw new Error('Formal Windows release requires signing credentials; unsigned packages require --candidate')
  if (env.WIN_CERTIFICATE_SHA1 && !/^[a-f\d]{40}$/iu.test(env.WIN_CERTIFICATE_SHA1)) throw new Error('WIN_CERTIFICATE_SHA1 must be a 40-character certificate thumbprint')
  if (Object.hasOwn(manifest, 'dshEnterpriseServer')) throw new Error('Generic installers require an endpoint-free source manifest')
  return { name, candidate, acceptanceOnly, platform, arch, manifest, allowedHttpOrigins, checkOnly: flags.has('--check-only') }
}
export function verifyPE(path) {
  const fd = openSync(path, 'r'), header = Buffer.alloc(64), signature = Buffer.alloc(4)
  try {
    if (readSync(fd, header, 0, 64, 0) !== 64 || header.toString('ascii', 0, 2) !== 'MZ') throw new Error('Missing Windows PE header')
    const offset = header.readUInt32LE(60)
    if (offset > statSync(path).size - 4 || readSync(fd, signature, 0, 4, offset) !== 4 || !signature.equals(Buffer.from('PE\0\0'))) throw new Error('Invalid Windows PE signature')
  } finally { closeSync(fd) }
}
export async function releaseDesktop(argv = process.argv.slice(2)) {
  const plan = releasePlan(argv)
  const cwd = join(root, plan.name), require = createRequire(join(cwd, 'package.json'))
  let packagingEnv = { ...process.env }
  const buildEnv = cleanBuildEnvironment(process.env)
  if (!plan.candidate && plan.platform === 'darwin') {
    const { adaptMacReleaseEnvironment, assertMacReleaseReady } = await import(pathToFileURL(join(cwd, 'scripts/release-preflight.ts')).href)
    packagingEnv = adaptMacReleaseEnvironment(packagingEnv)
    assertMacReleaseReady({ platform: process.platform, env: packagingEnv, listCodeSigningIdentities: () => {
      const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { env: buildEnv, encoding: 'utf8' })
      if (result.status !== 0) throw new Error('Cannot inspect macOS signing identities')
      return result.stdout
    } })
  }
  console.log(`${plan.candidate ? 'CANDIDATE / NOT FOR PRODUCTION' : 'SIGNED ENTERPRISE RELEASE'}: ${plan.name} ${plan.platform}/${plan.arch}; server selected by the user on first connection`)
  if (plan.checkOnly) return plan
  mkdirSync(join(root, '.artifacts'), { recursive: true })
  const output = mkdtempSync(join(root, '.artifacts', `enterprise-${plan.name}-`))
  const licenseCheck = spawnSync(process.execPath, [join(cwd, 'scripts/verify-licenses.mjs')], { cwd, env: buildEnv, encoding: 'utf8', windowsHide: true })
  writeFileSync(join(output, 'license-check.log'), (licenseCheck.stdout ?? '') + (licenseCheck.stderr ?? ''), { flag: 'wx' })
  if (licenseCheck.status !== 0 && !plan.candidate) throw new Error('Formal release blocked by dependency license verification; see license-check.log')
  if (licenseCheck.status !== 0) console.log('Candidate only: dependency license review is pending; do not distribute as a production release.')
  // Incremental headless checks deliberately avoid existing scripts that clean dist/lib.
  run(process.execPath, [join(root, 'scripts/verify-desktop-variants.mjs')], root, buildEnv)
  for (const script of ['prepare-lets-brand-assets.mjs', 'generate-windows-app-icon.mjs', 'generate-mac-app-icon.mjs', 'generate-tray-icons.mjs']) {
    run(process.execPath, [join(cwd, 'scripts', script)], cwd, buildEnv)
  }
  run(process.execPath, [join(root, 'scripts/enterprise-desktop.mjs'), ...(plan.name.endsWith('-beta') ? ['--beta'] : []), '--build-only'], root, buildEnv)
  for (const config of ['tsconfig.json', 'tsconfig.client.json', 'tsconfig.native-ui.json', 'tsconfig.tests.json', 'tsconfig.tests.client.json']) {
    run(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', config, '--noEmit'], cwd, buildEnv)
  }
  const tests = plan.acceptanceOnly ? readdirSync(join(cwd, 'tests')).filter(name => /^(?:enterprise-|update-|desktop-installer-quit|installer-nsh|package-win|package-mac|verify-win-installer|verify-win-portable|release-preflight|release-mac)/u.test(name) && name.endsWith('.spec.ts')).map(name => `tests/${name}`) : []
  if (plan.acceptanceOnly) console.log('Acceptance-only candidate: targeted enterprise/installer checks; NOT a full release gate. See the separate full-suite failure report before publication.')
  run(process.execPath, [resolve(require.resolve('vitest/package.json'), '../vitest.mjs'), 'run', ...tests], cwd, buildEnv)
  const { prepareFsExtForElectron } = await import(pathToFileURL(join(cwd, 'scripts/prepare-fs-ext.ts')).href)
  prepareFsExtForElectron({ platform: plan.platform, arch: plan.arch, desktopRoot: cwd, env: buildEnv })
  const electronDist = await ensureEnterpriseElectron(plan.name)
  if (plan.candidate) packagingEnv = { ...buildEnv, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  const version = plan.candidate ? `${plan.manifest.version.split('-')[0]}-beta.0` : plan.manifest.version
  const overlays = process.env.DSH_RELEASE_DEPENDENCY_OVERLAYS ? JSON.parse(readFileSync(process.env.DSH_RELEASE_DEPENDENCY_OVERLAYS, 'utf8')) : []
  if (!Array.isArray(overlays)) throw new Error('Dependency overlay configuration must be an array')
  const overlayFiles = []
  for (const overlay of overlays) {
    if (!plan.candidate || typeof overlay.name !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(overlay.name)) throw new Error('Dependency recovery overlays are restricted to acceptance candidates')
    const original = JSON.parse(readFileSync(join(cwd, 'node_modules', overlay.name, 'package.json'), 'utf8'))
    const recovered = JSON.parse(readFileSync(join(overlay.directory, 'package.json'), 'utf8'))
    if (original.name !== recovered.name || original.version !== recovered.version) throw new Error('Dependency overlay must preserve the installed package identity and version')
    for (const file of filesAt(overlay.directory)) hashFile(join(overlay.directory, file))
    overlayFiles.push(`!node_modules/${overlay.name}/**`, { from: overlay.directory, to: `node_modules/${overlay.name}`, filter: ['**/*'] })
  }
  const config = {
    ...plan.manifest.build,
    files: [...plan.manifest.build.files, ...overlayFiles],
    directories: { ...plan.manifest.build.directories, output },
    electronDist,
    electronVersion: plan.manifest.devDependencies.electron,
    afterPack: join(root, 'scripts/enterprise-after-pack.mjs'),
    forceCodeSigning: !plan.candidate,
    extraMetadata: { dshEnterprise: true, author: { name: process.env.LETS_COMPANY_NAME?.trim() || 'LETS' }, ...(plan.allowedHttpOrigins.length ? { dshEnterpriseHttpOrigins: plan.allowedHttpOrigins } : {}), version },
    nsis: { ...plan.manifest.build.nsis, shortcutName: plan.manifest.build.productName, ...(plan.candidate ? { useZip: true } : {}) },
    win: { ...plan.manifest.build.win, signExecutable: !plan.candidate,
      ...(!plan.candidate && process.env.WIN_CERTIFICATE_SHA1 ? { signtoolOptions: { certificateSha1: process.env.WIN_CERTIFICATE_SHA1 } } : {}),
      ...(!plan.candidate && process.env.WIN_PUBLISHER_NAME ? { publisherName: process.env.WIN_PUBLISHER_NAME } : {}) },
    mac: { ...plan.manifest.build.mac, notarize: !plan.candidate, ...(plan.candidate ? { identity: null } : {}) },
  }
  const configFile = join(output, 'electron-builder.json')
  writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' })
  run(process.execPath, [require.resolve('electron-builder/cli.js'), plan.platform === 'win32' ? '--win' : '--mac', plan.platform === 'win32' ? 'nsis' : 'dmg', `--${plan.arch}`, '--publish', 'never', '--config', configFile], cwd, {
    ...packagingEnv, ...(plan.candidate ? { ELECTRON_BUILDER_COMPRESSION_LEVEL: '1' } : {}), DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1', DSH_ENTERPRISE_PACKAGE_OUTPUT: output, DSH_ENTERPRISE_PACKAGE_WORKSPACE: plan.name,
  })
  const installers = readdirSync(output).filter(name => name.endsWith(plan.platform === 'win32' ? '-Setup.exe' : '.dmg'))
  if (installers.length !== 1) throw new Error('Expected exactly one installer for the selected platform/architecture')
  for (const name of installers) {
    const installer = join(output, name)
    if (statSync(installer).size > MAX_DESKTOP_INSTALLER_BYTES) throw new Error('Installer exceeds the enterprise server upload limit; preserve this output and review the runtime payload before release')
    if (plan.platform === 'win32') {
      verifyPE(installer)
      if (!plan.candidate) for (const target of [installer, join(output, plan.arch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked', `${plan.manifest.build.productName}.exe`)]) {
        run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', join(root, 'deployment/desktop/verify-signature.ps1'), target], cwd, buildEnv)
      }
    } else if (!plan.candidate) {
      const app = join(output, plan.arch === 'arm64' ? 'mac-arm64' : 'mac', `${plan.manifest.build.productName}.app`)
      run('codesign', ['--verify', '--deep', '--strict', app], cwd, buildEnv)
      run('spctl', ['--assess', '--type', 'execute', app], cwd, buildEnv)
      run('xcrun', ['stapler', 'validate', app], cwd, buildEnv)
    }
    const sha256 = hashFile(installer)
    writeFileSync(installer + '.sha256', `${sha256}  ${name}\n`, { flag: 'wx' })
    writeFileSync(join(output, 'release-manifest.json'), JSON.stringify({ product: plan.manifest.build.productName, version, channel: plan.candidate || plan.name.endsWith('-beta') ? 'beta' : 'stable', platform: plan.platform, arch: plan.arch, candidate: plan.candidate, readyForProduction: false, signed: !plan.candidate, licenseCheckPassed: licenseCheck.status === 0, validationScope: plan.acceptanceOnly ? 'targeted-enterprise-installer-tests' : 'package-typecheck-and-unit-suite', dependencyRecovery: overlays.map(({ name, archiveSha512 }) => ({ name, archiveSha512 })), manualAcceptanceRequired: true, server: plan.url ?? null, file: name, size: statSync(installer).size, sha256, sourceCommit: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout?.trim() || null }, null, 2) + '\n', { flag: 'wx' })
    console.log(`Installer: ${installer}`)
  }
  return output
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  releaseDesktop().catch(error => { console.error(error.message); process.exitCode = 1 })
}
