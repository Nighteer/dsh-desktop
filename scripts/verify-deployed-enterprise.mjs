/** HTTP(S) acceptance against an isolated deployment; never use a production URL. */
import assert from 'node:assert/strict'
import { openAsBlob } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
const origin = process.env.LETS_TEST_ORIGIN
if (!origin || !/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+$/u.test(origin)) throw new Error('Acceptance is restricted to a loopback test deployment')
const password = 'Isolated-acceptance-password-1', next = 'Isolated-acceptance-password-2'
const request = async (path, method = 'GET', body, cookie) => {
  const response = await fetch(origin + '/api/v1' + path, { method, redirect: 'error', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), 'x-forwarded-for': '198.51.100.99' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  return { response, data }
}
assert.equal((await request('/health')).response.status, 200)
assert.equal((await fetch(origin + '/')).status, 200)
assert.equal((await fetch(origin + '/api/v1/desktop-info')).status, 200)
assert.equal((await request('/employees')).response.status, 401)
const login = await request('/auth/login', 'POST', { username: 'release.admin', password, channel: 'browser' })
assert.equal(login.response.status, 200)
const setCookie = login.response.headers.get('set-cookie')
assert.ok(setCookie.includes('HttpOnly'))
assert.equal(setCookie.includes('; Secure'), origin.startsWith('https:'))
const cookie = setCookie.split(';')[0]
assert.equal((await request('/employees', 'GET', undefined, cookie)).response.status, 403)
assert.equal((await request('/auth/password', 'POST', { currentPassword: password, password: next }, cookie)).response.status, 200)
assert.equal((await request('/employees', 'GET', undefined, cookie)).response.status, 200)
assert.equal((await request('/roles', 'GET', undefined, cookie)).response.status, 200)
assert.equal((await request('/model-providers', 'POST', { name: 'Isolated acceptance provider', baseUrl: 'https://example.invalid/v1', enabled: false, apiKey: 'fixture-key-for-restore-verification' }, cookie)).response.status, 200)
const release = await request('/desktop-releases', 'POST', { version: '1.0.0-beta.0', channel: 'beta', platform: 'win32', arch: 'x64', notes: process.env.LETS_TEST_INSTALLER_PATH ? 'Actual candidate binary, loopback-only transfer acceptance. Never install or distribute.' : 'Inert isolated acceptance fixture; never install or distribute.' }, cookie)
assert.equal(release.response.status, 200)
const bytes = Buffer.alloc(512); bytes.write('MZ'); bytes.writeUInt32LE(64, 60); bytes.write('PE\0\0', 64)
const realInstaller = process.env.LETS_TEST_INSTALLER_PATH ? resolve(import.meta.dirname, '..', process.env.LETS_TEST_INSTALLER_PATH) : undefined
const body = realInstaller ? await openAsBlob(realInstaller) : bytes
assert.equal((await fetch(`${origin}/api/v1/desktop-releases/${release.data.id}/artifact`, { method: 'PUT', headers: { origin, cookie, 'content-type': 'application/octet-stream' }, body, signal: AbortSignal.timeout(1800000) })).status, 200)
assert.equal((await request(`/desktop-releases/${release.data.id}/state`, 'POST', { state: 'published' }, cookie)).response.status, 200)
const desktop = await request('/auth/login', 'POST', { username: 'release.admin', password: next, channel: 'desktop' })
assert.equal(desktop.response.status, 403) // Browser Origin cannot impersonate native desktop login.
const native = await fetch(origin + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'release.admin', password: next, channel: 'desktop' }) })
assert.equal(native.status, 200)
const session = await native.json()
assert.ok(session.accessToken)
if (realInstaller) {
  const headers = { authorization: `Bearer ${session.accessToken}` }
  const check = await fetch(origin + '/api/v1/desktop-updates/check?channel=beta&platform=win32&arch=x64', { headers })
  assert.equal(check.status, 200)
  const published = (await check.json()).release
  assert.equal(published.sha256, process.env.LETS_TEST_INSTALLER_SHA256)
  const download = await fetch(`${origin}/api/v1/desktop-updates/${published.id}/download`, { headers, signal: AbortSignal.timeout(1800000) })
  assert.equal(download.status, 200)
  const hash = createHash('sha256'); let size = 0
  for await (const chunk of download.body) { hash.update(chunk); size += chunk.byteLength }
  assert.equal(size, body.size)
  assert.equal(hash.digest('hex'), published.sha256)
  console.log(`Actual Windows installer upload/download verified through Nginx: ${size} bytes; SHA-256 matches`)
}
console.log(`Deployment acceptance passed: ${origin.startsWith('https:') ? 'HTTPS' : 'HTTP'}, static UI, DB, browser/native login, cookie policy, password change, RBAC, encrypted provider, installer upload.`)
