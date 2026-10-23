/** Repair only the installer container around an existing, verified candidate app. */
import { createRequire } from 'node:module'
import { cpSync, mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanBuildEnvironment, verifyPE, windowsInstallerOptions } from './release-enterprise-desktop.mjs'
import { verifyInstallerExtraction } from './verify-windows-installer-extraction.mjs'
import { hashFile, run } from './release-utils.mjs'
import { MAX_DESKTOP_INSTALLER_BYTES } from 'dsh-enterprise-contracts/desktop-releases'

const root = resolve(import.meta.dirname, '..')
export async function repackageCandidate(argument) {
  if (process.platform !== 'win32') throw new Error('Use Windows for installer repair')
  const original = resolve(argument)
  if (!original.startsWith(join(root, '.artifacts') + '\\')) throw new Error('Only locally generated candidates are supported')
  const previous = JSON.parse(readFileSync(join(original, 'release-manifest.json'), 'utf8'))
  if (!previous.candidate || previous.signed || previous.platform !== 'win32' || previous.readyForProduction !== false || basename(previous.file) !== previous.file) throw new Error('Expected an unsigned Windows acceptance candidate')
  if (hashFile(join(original, previous.file)) !== previous.sha256) throw new Error('Original installer checksum mismatch')
  const config = JSON.parse(readFileSync(join(original, 'electron-builder.json'), 'utf8'))
  const name = config.productName === 'LETS Desktop Beta' ? 'dsh-plugin-desktop-beta' : config.productName === 'LETS Desktop' ? 'dsh-plugin-desktop' : null
  if (!name) throw new Error('Unexpected product identity')
  const unpackedName = previous.arch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked'
  const source = join(original, unpackedName)
  const app = JSON.parse(readFileSync(join(source, 'resources/app/package.json'), 'utf8'))
  if (app.dshEnterprise !== true || Object.hasOwn(app, 'dshEnterpriseServer') || app.version !== previous.version) throw new Error('Candidate must preserve generic enterprise connection and version')
  const destination = mkdtempSync(join(root, '.artifacts', `enterprise-${name}-`))
  const target = join(destination, unpackedName)
  cpSync(source, target, { recursive: true, force: false, errorOnExist: true })
  cpSync(join(original, 'license-check.log'), join(destination, 'license-check.log'), { force: false, errorOnExist: true })
  config.directories.output = destination
  config.nsis = windowsInstallerOptions(config)
  config.forceCodeSigning = false
  config.win.signExecutable = false
  const configPath = join(destination, 'electron-builder.json')
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' })
  const require = createRequire(join(root, name, 'package.json'))
  run(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', 'nsis', `--${previous.arch}`, '--publish', 'never', '--prepackaged', target, '--config', configPath], join(root, name), {
    ...cleanBuildEnvironment(process.env), CSC_IDENTITY_AUTO_DISCOVERY: 'false', ELECTRON_BUILDER_COMPRESSION_LEVEL: '1', DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1', DSH_ENTERPRISE_PACKAGE_OUTPUT: destination, DSH_ENTERPRISE_PACKAGE_WORKSPACE: name,
  })
  const installer = join(destination, previous.file)
  verifyPE(installer)
  if (statSync(installer).size > MAX_DESKTOP_INSTALLER_BYTES) throw new Error('Installer exceeds server limit')
  const extractionReport = await verifyInstallerExtraction(installer, target)
  const sha256 = hashFile(installer)
  writeFileSync(installer + '.sha256', `${sha256}  ${previous.file}\n`, { flag: 'wx' })
  writeFileSync(join(destination, 'release-manifest.json'), JSON.stringify({ ...previous, size: statSync(installer).size, sha256, repackagedAt: new Date().toISOString(), repairsInstallerSha256: previous.sha256, applicationSource: source, installerPayload: '7z', extractionReport, manualAcceptanceRequired: true, readyForProduction: false }, null, 2) + '\n', { flag: 'wx' })
  writeFileSync(join(destination, 'INSTALLER-FIX.md'), `# Windows 安装解压修复\n\n旧 ZIP 安装器 SHA-256：${previous.sha256}。已复现其 nsisunz 插件无法打开 ZIP 的错误。此包改为 NSIS 7z 载荷，不修改业务应用、企业地址填写方式和产品版本。最终 EXE 已通过实际 NSIS 插件在中文长路径中的全量解压及逐文件 SHA-256 校验。\n\n本包仍未签名，完整安装/卸载/旧版升级需在测试机验收；不代表正式发行。旧包与原业务数据保留。\n`, { flag: 'wx' })
  console.log(`Repaired candidate: ${destination}`)
  return destination
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: repackage-enterprise-windows-candidate.mjs original-candidate-directory')
  repackageCandidate(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1 })
}
