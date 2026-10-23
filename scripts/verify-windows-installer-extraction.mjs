/** Exercise the installer's actual NSIS decoder in a fresh directory, without installing. */
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashFile } from './release-utils.mjs'

const root = resolve(import.meta.dirname, '..')
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options })
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.status}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  return result.stdout
}
function entries(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw new Error('Installer trees cannot contain symlinks')
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory() ? entries(join(directory, entry.name), relative) : [relative]
  }).sort()
}
function nsis(value) {
  if (/[\r\n]/u.test(value)) throw new Error('Invalid NSIS path')
  return value.replaceAll('$', '$$').replaceAll('"', '$\\"')
}
export async function verifyInstallerExtraction(installer, expectedTree) {
  if (process.platform !== 'win32') throw new Error('NSIS decoder verification requires Windows')
  installer = resolve(installer)
  expectedTree = resolve(expectedTree)
  const artifactRoot = join(root, '.artifacts')
  mkdirSync(artifactRoot, { recursive: true })
  const directory = mkdtempSync(join(artifactRoot, 'installer-extraction-'))
  const require = createRequire(join(root, 'dsh-plugin-desktop-beta/package.json'))
  const builder = dirname(require.resolve('app-builder-lib/package.json'))
  const sevenZip = await require(join(builder, 'out/toolsets/7zip.js')).getPath7za()
  const tools = require(join(builder, 'out/toolsets/windows.js'))
  const compiler = await tools.getMakeNsisPath('1.2.1')
  const pluginRoot = await tools.getNsisPluginsPath('1.2.1')
  const listing = run(sevenZip, ['l', '-slt', installer])
  writeFileSync(join(directory, 'archive-listing.txt'), listing, { flag: 'wx' })
  for (const entry of listing.split('----------').slice(1).join('----------').matchAll(/^Path = (.+)$/gmu)) {
    if (/^(?:[a-z]:|[\\/])/iu.test(entry[1]) || entry[1].split(/[\\/]/u).includes('..')) throw new Error('Unsafe archive entry path')
  }
  const header = listing.split('----------')[0]
  const type = /^Type = (7z|zip)$/mu.exec(header)?.[1]
  const offset = Number(/^Offset = (\d+)$/mu.exec(header)?.[1])
  const size = Number(/^Physical Size = (\d+)$/mu.exec(header)?.[1])
  if (!type || !Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || size <= 0 || offset <= 0 || offset + size > statSync(installer).size) throw new Error('Cannot identify the embedded installer payload')
  const payload = join(directory, `payload.${type}`)
  await pipeline(createReadStream(installer, { start: offset, end: offset + size - 1 }), createWriteStream(payload, { flags: 'wx' }))
  run(sevenZip, ['t', '-bso0', '-bsp0', payload])
  // Longer than the normal per-user install prefix, and includes Chinese characters.
  const target = join(directory, '中文安装路径', 'LETS Desktop')
  mkdirSync(target, { recursive: true })
  const status = join(directory, 'decoder-status.txt')
  const harness = join(directory, 'decoder-probe.exe')
  const source = join(directory, 'decoder-probe.nsi')
  writeFileSync(source, `Unicode true
ManifestLongPathAware true
RequestExecutionLevel user
SilentInstall silent
Name "LETS decoder verification"
OutFile "${nsis(harness)}"
!addplugindir /x86-unicode "${nsis(join(pluginRoot, 'x86-unicode'))}"
Section
SetOutPath "${nsis(target)}"
${type === 'zip' ? `nsisunz::Unzip "${nsis(payload)}" "${nsis(target)}"\nPop $0` : `Nsis7z::Extract "${nsis(payload)}"\nStrCpy $0 "completed"`}
FileOpen $1 "${nsis(status)}" w
FileWriteUTF16LE /BOM $1 "$0"
FileClose $1
SectionEnd
`, { flag: 'wx' })
  // Invoke the compiler binary directly; no shell, install, registry or shortcut operations.
  const compilerRoot = dirname(compiler.path)
  const executable = compiler.path.endsWith('.cmd') ? join(compilerRoot, 'windows/makensis.exe') : compiler.path
  const compilerOutput = run(executable, ['-V2', '-INPUTCHARSET', 'UTF8', source], { env: { ...process.env, ...compiler.env, ...(compiler.path.endsWith('.cmd') ? { NSISDIR: join(compilerRoot, 'windows') } : {}) } })
  writeFileSync(join(directory, 'compiler.log'), compilerOutput)
  run(harness, ['/S'], { timeout: 10 * 60 * 1000 })
  const decoderStatus = existsSync(status) ? readFileSync(status, 'utf16le').replace(/^\uFEFF/u, '') : 'missing status'
  const expected = entries(expectedTree), actual = entries(target)
  const actualSet = new Set(actual), expectedSet = new Set(expected)
  const missing = expected.filter(file => !actualSet.has(file))
  const extra = actual.filter(file => !expectedSet.has(file))
  const changed = expected.filter(file => actualSet.has(file) && hashFile(join(expectedTree, file)) !== hashFile(join(target, file)))
  const passed = (type !== 'zip' || decoderStatus === 'success') && missing.length === 0 && extra.length === 0 && changed.length === 0
  const report = { passed, installer, sha256: hashFile(installer), format: type, decoderStatus, filesExpected: expected.length, filesExtracted: actual.length, target, missing, extra, changed }
  writeFileSync(join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ ...report, missing: missing.slice(0, 3), extra: extra.slice(0, 3), changed: changed.slice(0, 3), report: join(directory, 'result.json') }, null, 2))
  if (!passed) throw new Error(`Actual NSIS decoder verification failed; see ${join(directory, 'result.json')}`)
  return join(directory, 'result.json')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: verify-windows-installer-extraction.mjs installer.exe expected-win-unpacked')
  verifyInstallerExtraction(...process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1 })
}
