/** Hidden Electron qualification. Keeps all evidence in a fresh task-owned directory. */
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const edition = process.argv.find(arg => arg.startsWith('--edition='))?.slice(10) ?? 'dsh-plugin-desktop-beta'
assert(['dsh-plugin-desktop-beta', 'dsh-plugin-desktop'].includes(edition))
if (!process.versions.electron) {
  const local = join(root, '.enterprise-local')
  mkdirSync(local, {recursive: true})
  const evidence = mkdtempSync(join(local, 'native-capabilities-acceptance-'))
  const require = createRequire(join(root, edition, 'package.json'))
  const electron = require('electron')
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, [fileURLToPath(import.meta.url), `--edition=${edition}`, `--evidence=${evidence}`], {cwd: root, env, stdio: 'inherit', windowsHide: true})
  process.exitCode = await new Promise((done, fail) => {child.once('error', fail); child.once('exit', code => done(code ?? 1))})
} else {
  const {app, BrowserWindow, webContents} = await import('electron')
  const evidence = process.argv.find(arg => arg.startsWith('--evidence='))?.slice(11)
  assert(evidence && resolve(evidence).startsWith(join(root, '.enterprise-local', 'native-capabilities-acceptance-')))
  app.setPath('userData', evidence)
  app.on('window-all-closed', () => {})
  // Do not await app readiness in the ESM entry's evaluation: Electron emits
  // ready only after that evaluation has returned.
  async function qualify() {
  let window, dispose
  let hostHits = 0
  const host = createServer((req, res) => {
    if (req.url === '/private') hostHits++
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html><body><input id="file" type="file"><div id="browser"></div></body></html>')
  })
  const page = createServer((_req, res) => {
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html><head><title>LETS native browser fixture</title></head><body>Isolated fixture</body></html>')
  })
  const listen = server => new Promise(done => server.listen(0, '127.0.0.1', done))
  const deadline = setTimeout(() => {console.error('Native qualification timed out'); app.exit(1)}, 45000)
  try {
    await app.whenReady(); await Promise.all([listen(host), listen(page)])
    const origin = `http://127.0.0.1:${host.address().port}`
    const pageUrl = `http://127.0.0.1:${page.address().port}/`
    const {bindNativeCapabilities} = await import(pathToFileURL(join(root, edition, 'lib/native-capabilities.js')).href)
    window = new BrowserWindow({show: false, webPreferences: {
      partition: 'lets-native-acceptance', preload: join(root, edition, 'lib/preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, webviewTag: true,
      additionalArguments: ['--lets-desktop-origin=' + origin],
    }})
    window.webContents.on('preload-error', (_event, _path, error) => {console.error(error)})
    dispose = bindNativeCapabilities(window, window.webContents, origin, () => {})
    await window.loadURL(origin)
    const initial = await window.webContents.executeJavaScript(`({protocol: window.dshDesktop?.protocolVersion, platform: document.documentElement.dataset.platform, paths: typeof window.__DSH_HOST_PATHS__?.pathFor})`)
    assert.equal(initial.protocol, 1); assert.equal(initial.platform, process.platform); assert.equal(initial.paths, 'function')
    const shortcuts = await window.webContents.executeJavaScript('window.dshDesktop.shortcuts.get([])')
    assert.notEqual(shortcuts.status, 'loading')
    const fixture = join(evidence, '中文 文件路径.txt')
    writeFileSync(fixture, 'LETS native file fixture')
    window.webContents.debugger.attach('1.3')
    const {root: document} = await window.webContents.debugger.sendCommand('DOM.getDocument')
    const {nodeId} = await window.webContents.debugger.sendCommand('DOM.querySelector', {nodeId: document.nodeId, selector: '#file'})
    await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', {nodeId, files: [fixture]})
    const resolvedPath = await window.webContents.executeJavaScript(`window.__DSH_HOST_PATHS__.pathFor(document.querySelector('#file').files[0])`)
    assert.equal(resolvedPath, fixture)
    window.webContents.debugger.detach()
    const guestId = await window.webContents.executeJavaScript(`(async () => {
      const reservation = await window.dshDesktop.browser.acquire('acceptance-workspace');
      const view = document.createElement('webview'); view.name = reservation.lease;
      view.setAttribute('partition', reservation.partition); view.setAttribute('allowpopups', '');
      view.setAttribute('src', 'about:blank#' + reservation.lease);
      const ready = new Promise(resolve => view.addEventListener('dom-ready', resolve, {once:true}));
      document.querySelector('#browser').append(view); await ready;
      await view.loadURL(${JSON.stringify(pageUrl)}); window.fixtureView = view;
      return view.getWebContentsId();
    })()`)
    const guest = webContents.fromId(guestId)
    assert(guest); assert.equal(guest.getTitle(), 'LETS native browser fixture')
    const preferences = guest.getLastWebPreferences()
    assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true)
    assert.equal(await guest.executeJavaScript('typeof require'), 'undefined')
    assert.equal(await guest.executeJavaScript('typeof window.dshDesktop'), 'undefined')
    const result = await guest.executeJavaScript(`fetch(${JSON.stringify(origin + '/private')}).then(()=>'unexpected',()=> 'blocked')`)
    assert.equal(result, 'blocked'); assert.equal(hostHits, 0)
    const report = {edition, filePath: true, nativeShortcuts: true, browserLoadsFrameDeniedPage: true,
      sandboxedGuest: true, guestHasNoDesktopBridge: true, guestCannotReachHost: true, hiddenWindow: !window.isVisible()}
    writeFileSync(join(evidence, 'result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({...report, evidence}))
  } catch(error) {
    console.error(error); process.exitCode = 1
  } finally {
    clearTimeout(deadline)
    await dispose?.(); window?.destroy()
    await Promise.all([host, page].map(server => new Promise(done => server.close(done))))
    app.exit(process.exitCode ?? 0)
  }
  }
  void qualify().catch(error => {console.error(error); app.exit(1)})
}
