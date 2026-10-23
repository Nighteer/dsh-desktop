/** Headless artifact smoke for the Electron-backed dsh and pnpm command entries. */

import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join,resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { installDesktopPnpmRuntime } from '../lib/desktop-runtime-environment.js'

const packageRoot = new URL('../', import.meta.url)
const desktopCli = fileURLToPath(new URL('lib/desktop-cli.js', packageRoot))
const dshAppBootPackage = fileURLToPath(new URL('node_modules/@deepseek-ai/dsh-app-boot/', packageRoot))
const dshAtomicWritePackage = fileURLToPath(new URL('node_modules/@deepseek-ai/dsh-atomic-write/', packageRoot))
const cordisPluginLoaderPackage = fileURLToPath(new URL('node_modules/@deepseek-ai/cordis-plugin-loader/', packageRoot))
const dshHomePathsPackage = fileURLToPath(new URL('node_modules/@deepseek-ai/dsh-home-paths/', packageRoot))
const dshPackage = fileURLToPath(new URL('node_modules/@deepseek-ai/dsh/', packageRoot))
const semverPackage = fileURLToPath(new URL('node_modules/semver/', packageRoot))
const pnpmCli = fileURLToPath(new URL('node_modules/pnpm/bin/pnpm.mjs', packageRoot))
const dshVersion = JSON.parse(readFileSync(new URL('node_modules/@deepseek-ai/dsh/package.json', packageRoot), 'utf8')).version
const pnpmVersion = JSON.parse(readFileSync(new URL('node_modules/pnpm/package.json', packageRoot), 'utf8')).version
const electronVersion = JSON.parse(readFileSync(new URL('node_modules/electron/package.json', packageRoot), 'utf8')).version
const RUNNER_ENVIRONMENT_NAMES = new Set([
  'ELECTRON_RUN_AS_NODE',
  'NPM_CONFIG_RUNTIME',
  'NPM_CONFIG_TARGET',
  'NPM_CONFIG_DISTURL',
])

function cleanEnvironment() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    const normalized = key.toUpperCase()
    if (!RUNNER_ENVIRONMENT_NAMES.has(normalized)) env[key] = value
  }
  return env
}

function assertNoRunnerEnvironment(label, env) {
  const leaked = Object.keys(env).filter((key) => {
    return RUNNER_ENVIRONMENT_NAMES.has(key.toUpperCase())
  })
  if (leaked.length > 0) {
    throw new Error(`${label} leaked runner-only environment variables: ${leaked.join(', ')}`)
  }
}

function verifyResult(label, result, expectedOutput) {
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label} artifact smoke exited ${String(result.status)}: ${result.stderr.trim()}`)
  }
  if (expectedOutput === undefined) return
  const output = result.stdout.trim()
  const matches = expectedOutput instanceof RegExp
    ? expectedOutput.test(output)
    : output === expectedOutput
  if (!matches) {
    throw new Error(`${label} artifact smoke returned ${JSON.stringify(output)} instead of matching ${String(expectedOutput)}`)
  }
}

function runElectronEntry(label, nodeArgs, entry, args, expectedOutput, extraEnvironment = {}) {
  const env = cleanEnvironment()
  Object.assign(env, extraEnvironment)
  env.ELECTRON_RUN_AS_NODE = '1'
  const result = spawnSync(electronPath, [...nodeArgs, entry, ...args], {
    encoding: 'utf8',
    env,
    shell: false,
  })
  verifyResult(label, result, expectedOutput)
}

function environmentValue(env, name) {
  const normalized = name.toUpperCase()
  return Object.entries(env).find(([key]) => key.toUpperCase() === normalized)?.[1]
}

function runPnpm(env, args, cwd) {
  return process.platform === 'win32'
    ? spawnSync(environmentValue(env, 'ComSpec') ?? 'cmd.exe', ['/d', '/s', '/c', `pnpm ${args.join(' ')}`], {
        cwd,
        encoding: 'utf8',
        env,
        shell: false,
      })
    : spawnSync('pnpm', args, {
        cwd,
        encoding: 'utf8',
        env,
        shell: false,
      })
}

function verifyLifecycleEnvironment(stateRoot, installation, env) {
  const project = join(stateRoot, 'lifecycle-project')
  const resultPath = join(project, 'result.json')
  mkdirSync(project)
  writeFileSync(join(project, 'package.json'), JSON.stringify({
    name: 'dsh-desktop-pnpm-lifecycle-smoke',
    version: '0.0.0',
    private: true,
    scripts: { install: 'node lifecycle.mjs' },
  }) + '\n')
  writeFileSync(join(project, 'lifecycle.mjs'), [
    "import { writeFileSync } from 'node:fs'",
    "writeFileSync(new URL('result.json', import.meta.url), JSON.stringify({",
    "  runAsNode: Object.keys(process.env).filter(name => name.toUpperCase() === 'ELECTRON_RUN_AS_NODE'),",
    '  node: process.env.NODE,',
    '  npmNodeExecPath: process.env.npm_node_execpath,',
    '  runtime: process.env.npm_config_runtime,',
    '  target: process.env.npm_config_target,',
    '  disturl: process.env.npm_config_disturl,',
    '}))',
    '',
  ].join('\n'))

  const result = runPnpm(env, ['install', '--offline', '--reporter=silent'], project)
  verifyResult('pnpm lifecycle smoke', result, '')
  const actual = JSON.parse(readFileSync(resultPath, 'utf8'))
  // Windows descendants retain Electron's required Node-mode flag; this is
  // a runtime switch, never an enterprise or provider credential.
  actual.node=resolve(actual.node)
  actual.npmNodeExecPath=resolve(actual.npmNodeExecPath)
  const expected = {
    runAsNode: process.platform==='win32'?['ELECTRON_RUN_AS_NODE']:[],
    node: installation.nodeShimPath,
    npmNodeExecPath: installation.nodeShimPath,
    runtime: 'electron',
    target: electronVersion,
    disturl: 'https://electronjs.org/headers',
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`pnpm lifecycle smoke returned ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`)
  }
}

function runPackagedPnpmShim() {
  const stateRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-pnpm-smoke-'))
  const env = cleanEnvironment()
  let installation
  try {
    installation = installDesktopPnpmRuntime({
      platform: process.platform,
      appExecutable: electronPath,
      pnpmBinPath: pnpmCli,
      electronVersion,
      stateDir: join(stateRoot, 'runtime'),
      environment: env,
    })
    assertNoRunnerEnvironment('pnpm Host PATH installation', env)
    const result = runPnpm(env, ['--version'])
    verifyResult('pnpm PATH shim', result, pnpmVersion)
    verifyLifecycleEnvironment(stateRoot, installation, env)
    assertNoRunnerEnvironment('pnpm Host PATH after child exit', env)
  } finally {
    try {
      installation?.dispose()
      assertNoRunnerEnvironment('pnpm Host PATH disposal', env)
    } finally {
      rmSync(stateRoot, { recursive: true, force: true })
    }
  }
}

/** Reproduce enterprise account depth, including non-ASCII paths, without real accounts or downloads. */
function runEnterpriseProfilePnpm() {
  if (process.platform !== 'win32') return
  const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-long-path-'))
  const env = cleanEnvironment()
  let installation
  try {
    const accountPrefix = join(root, '企业 账号')
    const account = join(accountPrefix, 'a'.repeat(Math.max(1, 140 - accountPrefix.length - 1)))
    const home = join(account, 'harness')
    const profile = join(home, 'profiles', 'desktop')
    mkdirSync(profile, { recursive: true })
    installation = installDesktopPnpmRuntime({
      platform: 'win32', appExecutable: electronPath, pnpmBinPath: pnpmCli,
      electronVersion, stateDir: join(account, 'runtime-commands'), environment: env,
    })
    if (installation.nodeShimPath.length >= 260) throw new Error('Windows lifecycle shim still exceeds MAX_PATH')
    const resultPath = join(profile, 'result.json')
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      name: 'dsh-desktop-enterprise-cli-smoke', private: true,
      scripts: { verify: 'node lifecycle.cjs' }, dependencies: {},
    }))
    writeFileSync(join(profile, 'lifecycle.cjs'), [
      "const { writeFileSync } = require('node:fs')",
      "const { spawnSync } = require('node:child_process')",
      "const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(\"child-ok\")'], { encoding: 'utf8' })",
      "if (child.status !== 0 || child.stdout !== 'child-ok') throw new Error('Electron child left Node mode')",
      "writeFileSync('result.json', JSON.stringify({node:process.env.NODE, runtime:process.env.npm_config_runtime, target:process.env.npm_config_target, nodeMode:process.env.ELECTRON_RUN_AS_NODE}))",
    ].join('\n'))
    const fixture = join(root, '插件 fixture')
    mkdirSync(fixture)
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({
      name: 'dsh-desktop-offline-fixture', version: '1.0.0', main: 'index.cjs',
    }))
    writeFileSync(join(fixture, 'index.cjs'), "module.exports = 'offline-plugin-ok'\n")
    writeFileSync(join(profile, 'pnpm-workspace.yaml'), "packages:\n  - '.'\n")
    // Deliberately poison public pnpm dispatch. The native plugin-manager must
    // use the installation-owned executable descriptor, not PATH or user pnpm.
    const poison = join(root, 'poison-bin')
    mkdirSync(poison)
    writeFileSync(join(poison, 'pnpm.cmd'), '@exit /b 91\r\n')
    for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key]
    Object.assign(env, {
      PATH: `${poison};${installation.nodeBinDir};${process.env.PATH ?? process.env.Path ?? ''}`,
      NODE: installation.nodeShimPath, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home,
      npm_config_runtime: 'electron', npm_config_target: electronVersion,
      npm_config_disturl: 'https://electronjs.org/headers',
    })
    const result = spawnSync(electronPath, [
      '--expose-internals', desktopCli, 'plugin', '--profile', 'desktop', 'run', 'verify',
    ], { cwd: profile, encoding: 'utf8', env, shell: false, timeout: 60000 })
    verifyResult('enterprise native plugin pnpm lifecycle', result)
    const added = spawnSync(electronPath, [
      '--expose-internals', desktopCli, 'plugin', '--profile', 'desktop',
      'add', '-w', `file:${fixture}`, '--offline', '--reporter=ndjson',
    ], { cwd: profile, encoding: 'utf8', env, shell: false, timeout: 60000 })
    verifyResult('enterprise native plugin offline add', added)
    if (readFileSync(join(profile, 'node_modules', 'dsh-desktop-offline-fixture', 'index.cjs'), 'utf8')
      !== "module.exports = 'offline-plugin-ok'\n") throw new Error('Offline fixture was not installed')
    const actual = JSON.parse(readFileSync(resultPath, 'utf8'))
    if (resolve(actual.node) !== installation.nodeShimPath || actual.nodeMode !== '1'
      || actual.runtime !== 'electron' || actual.target !== electronVersion) {
      throw new Error(`Enterprise lifecycle environment mismatch: ${JSON.stringify(actual)}`)
    }
    // The public PATH shim must also support this same account depth.
    verifyResult('enterprise long pnpm shim', runPnpm({ ...env, PATH: `${installation.pathDir};${env.PATH}` }, ['--version'], profile), pnpmVersion)
    // A public dsh terminal has no private NODE shim or system Node available.
    const terminalEnv = { ...env, PATH: `${poison};${process.env.SystemRoot}\\System32` }
    delete terminalEnv.NODE
    const terminal = spawnSync(electronPath, [
      '--expose-internals', desktopCli, 'plugin', '--profile', 'desktop', 'run', 'verify',
    ], { cwd: profile, encoding: 'utf8', env: terminalEnv, shell: false, timeout: 60000 })
    verifyResult('enterprise terminal plugin without system Node', terminal)
    console.log(`enterprise plugin lifecycle passed (node shim ${installation.nodeShimPath.length} chars)`)
  } finally {
    installation?.dispose()
    rmSync(root, { recursive: true, force: true })
  }
}

function runFlatProfileDshEntry() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-flat-cli-smoke-'))
  const desktopPackage = join(root, 'node_modules', 'dsh-plugin-desktop-beta')
  const linkedAppBootPackage = join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot')
  const linkedAtomicWritePackage = join(root, 'node_modules', '@deepseek-ai', 'dsh-atomic-write')
  const linkedCordisPluginLoaderPackage = join(root, 'node_modules', '@deepseek-ai', 'cordis-plugin-loader')
  const linkedDshHomePathsPackage = join(root, 'node_modules', '@deepseek-ai', 'dsh-home-paths')
  const linkedDshPackage = join(root, 'node_modules', '@deepseek-ai', 'dsh')
  const linkedSemverPackage = join(root, 'node_modules', 'semver')
  try {
    mkdirSync(join(root, 'node_modules', '@deepseek-ai'), { recursive: true })
    cpSync(fileURLToPath(new URL('lib/', packageRoot)), join(desktopPackage, 'lib'), { recursive: true })
    cpSync(fileURLToPath(new URL('package.json', packageRoot)), join(desktopPackage, 'package.json'))
    symlinkSync(dshAppBootPackage, linkedAppBootPackage, process.platform === 'win32' ? 'junction' : 'dir')
    symlinkSync(dshAtomicWritePackage, linkedAtomicWritePackage, process.platform === 'win32' ? 'junction' : 'dir')
    symlinkSync(cordisPluginLoaderPackage, linkedCordisPluginLoaderPackage, process.platform === 'win32' ? 'junction' : 'dir')
    symlinkSync(dshHomePathsPackage, linkedDshHomePathsPackage, process.platform === 'win32' ? 'junction' : 'dir')
    symlinkSync(dshPackage, linkedDshPackage, process.platform === 'win32' ? 'junction' : 'dir')
    symlinkSync(semverPackage, linkedSemverPackage, process.platform === 'win32' ? 'junction' : 'dir')
    symlinkSync(dirname(dirname(pnpmCli)), join(root, 'node_modules', 'pnpm'), process.platform === 'win32' ? 'junction' : 'dir')
    runElectronEntry(
      'flat profile dsh plugin help',
      ['--expose-internals'],
      join(desktopPackage, 'lib', 'desktop-cli.js'),
      ['plugin', '--help'],
      undefined,
      { DSH_DESKTOP_DEFAULT_PROFILE: 'desktop' },
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

runElectronEntry('dsh', ['--expose-internals'], desktopCli, ['--version'], dshVersion)
runFlatProfileDshEntry()
runPackagedPnpmShim()
runEnterpriseProfilePnpm()
