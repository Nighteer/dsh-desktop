/** Local browser development of Desktop client plugins over the real DSH Host. */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
if (args.some(arg => !['--beta', '--no-open'].includes(arg))) {
  throw new Error('Usage: node scripts/dev-web.mjs [--beta] [--no-open]')
}
const channel = args.includes('--beta') ? 'beta' : 'stable'
const packageName = channel === 'beta' ? 'dsh-plugin-desktop-beta' : 'dsh-plugin-desktop'
const packageRoot = join(root, packageName)
const require = createRequire(join(packageRoot, 'package.json'))
const importPackage = name => import(pathToFileURL(require.resolve(name)).href)
const importBuilt = name => import(pathToFileURL(join(packageRoot, 'lib', `${name}.js`)).href)
if (!existsSync(join(packageRoot, 'lib', 'profile.js'))) {
  throw new Error(`Build once first: corepack yarn workspace ${packageName} build`)
}
const port = Number(process.env.DSH_DESKTOP_DEV_PORT ?? (channel === 'beta' ? 5174 : 5173))
const mode = process.env.DSH_DESKTOP_DEV_MODE ?? 'extended'
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid DSH_DESKTOP_DEV_PORT')
if (!['compatibility', 'extended', 'advanced'].includes(mode)) throw new Error('Invalid DSH_DESKTOP_DEV_MODE')
if (process.platform === 'linux' && mode !== 'compatibility') {
  throw new Error('On Linux, set DSH_DESKTOP_DEV_MODE=compatibility')
}

// Browser development always has its own Home, independent of installed products.
const home = join(root, '.runtime-dsh-home', `web-${channel}`)
const state = join(root, '.runtime-appdata', `web-${channel}`)
mkdirSync(home, { recursive: true })
mkdirSync(state, { recursive: true })
process.env.DSH_HOME = home
process.env.DSH_TELEMETRY_DISABLED = '1'
const settingsPath = join(home, 'settings.yaml')
if (!existsSync(settingsPath)) {
  writeFileSync(settingsPath, `dsh-desktop:\n  mode: ${mode}\n  port: ${port}\nagent-presets:\n  default: minimal\n`, { mode: 0o600 })
}

const [{ boot, loadLayeredEnv }, { provideCmdline }, { DSH_LAUNCH_ENVIRONMENT_KEY }, profileModule, desktop, resolution] = await Promise.all([
  importPackage('@deepseek-ai/dsh-app-boot'),
  importPackage('@deepseek-ai/dsh-cmdline'),
  importPackage('@deepseek-ai/dsh-launch-environment'),
  importBuilt('profile'),
  importBuilt('index'),
  importBuilt('module-resolution'),
])
const prepared = profileModule.prepareDesktopProfile('1', home, process.platform, 'desktop', undefined, {
  requested: 'disabled', effective: 'disabled', legacyDefaulted: false,
}, { aaEnabled: false, lanAddresses: [] })
await profileModule.healDesktopProfileModuleFallback(home, prepared.profile)
const releaseResolver = resolution.installProfilePackageResolver(prepared.bareModuleBaseUrl)

let host
let watcher
let stopping = false
const livePages = new Set()
async function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const response of livePages) response.end()
  watcher?.kill()
  try { await host?.fiber.dispose() } finally {
    releaseResolver()
    process.exit(code)
  }
}
process.once('SIGINT', () => { void stop() })
process.once('SIGTERM', () => { void stop() })

try {
  const tsdownManifestPath = require.resolve('tsdown/package.json')
  const tsdownManifest = JSON.parse(readFileSync(tsdownManifestPath, 'utf8'))
  const tsdownBin = typeof tsdownManifest.bin === 'string' ? tsdownManifest.bin : tsdownManifest.bin.tsdown
  watcher = spawn(process.execPath, [
    resolve(tsdownManifestPath, '..', tsdownBin),
    '--filter', `${packageName}/client`, '--watch', '--no-clean',
  ], { cwd: packageRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  await new Promise((ready, reject) => {
    const deadline = setTimeout(() => reject(new Error('Client watcher did not finish its first build')), 60_000)
    watcher.stdout.on('data', bytes => {
      process.stdout.write(bytes)
      if (/Build complete|Rebuilt in/u.test(bytes.toString())) {
        clearTimeout(deadline)
        ready()
        if (host !== undefined) {
          // Publish new bytes and revision before refreshing pages: the Host
          // otherwise keeps serving its cached startup client bundle.
          try { host.clientModules.rebuilt(packageName) } catch (error) {
            console.error('[dev:web] Could not publish rebuilt client:', error)
            return
          }
        }
        for (const response of livePages) response.write('data: rebuilt\n\n')
      }
    })
    watcher.stderr.on('data', bytes => { process.stderr.write(bytes) })
    watcher.once('error', error => { clearTimeout(deadline); reject(error) })
    watcher.once('exit', code => {
      clearTimeout(deadline)
      if (!stopping) { reject(new Error(`Client watcher exited: ${code}`)); void stop(code ?? 1) }
    })
  })

  host = await boot('desktop-dev-web', prepared.rootConfig, [
    ...prepared.patches,
    // A dedicated development Host uses the upstream loopback web server.
    // Production Electron's renderer-capability fence remains untouched.
    { id: 'desktop-webserver', disabled: true },
    { id: 'webserver', disabled: false, config: { host: '127.0.0.1', port } },
    { id: 'web-runtime', config: { openBrowser: false, printUrl: false, surfaceContext: true, trustedHosts: [] } },
    { id: 'ui-layout', disabled: mode !== 'compatibility' },
    // Desktop owns the root layout. Replacing that whole plugin in place can
    // leave React without a root registration, so reload after a successful build.
    { id: 'client-hmr', disabled: true },
    ...['desktop-terminal', 'desktop-diagnostics', 'desktop-notifications', 'desktop-pnpm', 'desktop-profiles', 'desktop-updates']
      .map(id => ({ id, disabled: true })),
  ], ctx => {
    ctx.loader.internal = undefined
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, loadLayeredEnv('desktop-dev-web', packageRoot))
    provideCmdline(ctx, { args: ['--host', '127.0.0.1', '--port', String(port)], exit: code => { void stop(code) } })
    ctx.inject(['settings'], owner => {
      owner.settings.register(desktop.DESKTOP_SETTINGS_NAMESPACE, desktop.DesktopSettingsSchema, { applies: 'restart' })
    })
    ctx.inject(['webServer', 'connection'], owner => {
      // Connection exchanges the launch token for a cookie and redirects to `/`.
      // Set Desktop presentation markers after that redirect, before Web boot.
      owner.on('webserver/index-inject', table => {
        table.push({ kind: 'script', placement: 'head', text: `{
          const url = new URL(location.href);
          url.searchParams.set('dsh-desktop-mode', ${JSON.stringify(mode)});
          url.searchParams.set('dsh-desktop-platform', ${JSON.stringify(process.platform)});
          url.searchParams.set('dsh-desktop-version', ${JSON.stringify(JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version)});
          url.searchParams.set('dsh-desktop-material', 'off');
          ${process.platform === 'win32' ? "url.searchParams.set('dsh-desktop-mica', '0');" : ''}
          history.replaceState(history.state, '', url);
          const events = new EventSource('/_dev/events');
          events.onmessage = () => location.reload();
          window.addEventListener('pagehide', () => events.close(), { once: true });
        }` })
      })
      owner.effect(() => owner.webServer.register({
        kind: 'exact', path: '/_dev/events',
        handler: (req, res) => {
          const rejection = owner.connection.requestRejection(req)
          if (rejection !== undefined) { res.writeHead(rejection); res.end(); return }
          if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
          res.write(': connected\n\n')
          livePages.add(res)
          res.on('close', () => livePages.delete(res))
        },
      }), 'desktop-dev-web: live reload')
      owner.effect(() => owner.webServer.register({
        kind: 'exact', path: desktop.RENDERER_BOOT_REPORT_PATH ?? '/_dsh/desktop/renderer-boot',
        handler: (req, res) => {
          const rejection = owner.connection.requestRejection(req)
          if (rejection !== undefined) { res.writeHead(rejection); res.end(); return }
          if (req.method !== 'POST') { res.writeHead(405); res.end(); return }
          let body = ''
          req.on('data', bytes => { body += bytes; if (body.length > 16384) req.destroy() })
          req.on('end', () => {
            try {
              const report = JSON.parse(body)
              writeFileSync(join(state, 'renderer-health.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
              console.log(`[dev:web] Renderer: ${report.status}`)
              res.writeHead(204); res.end()
            } catch { res.writeHead(400); res.end() }
          })
        },
      }), 'desktop-dev-web: browser health report')
    })
  }, prepared.bareModuleBaseUrl)

  const authenticated = new URL(host.connection.authenticatedUrl(`http://127.0.0.1:${host.webServer.port}`))
  writeFileSync(join(state, 'connection.json'), JSON.stringify({ url: authenticated.href, channel, mode, pid: process.pid }, null, 2), { mode: 0o600 })
  console.log(`\n[dev:web] ${packageName}: ${authenticated.href}`)
  console.log(`[dev:web] Watching ${packageName}/src/client — save to rebuild and auto-refresh.`)
  console.log('[dev:web] Native Electron actions are unavailable in this browser preview. Ctrl+C stops the Host and watcher.')
  if (!args.includes('--no-open')) {
    const webApp = await importPackage('@deepseek-ai/dsh-web-app')
    await webApp.internals.openBrowser(authenticated.href)
  }
} catch (error) {
  console.error(error)
  await stop(1)
}
