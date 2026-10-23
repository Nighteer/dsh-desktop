import {it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import {readFileSync,existsSync} from 'node:fs'
import {parseEnv} from 'node:util'
import {fileURLToPath} from 'node:url'
import {EnterpriseClient} from '../src/enterprise-client.ts'
import {EnterpriseDesktopUpdates} from '../src/enterprise-desktop-updates.ts'
import {checkForDesktopUpdate} from '../src/update-checker.ts'
import {downloadDesktopUpdate} from '../src/update-download.ts'

const environment=new URL('../../.enterprise-local/server.env',import.meta.url)
const databaseUrl=process.env.DATABASE_URL??(existsSync(environment)?parseEnv(readFileSync(environment,'utf8')).DATABASE_URL:undefined)
it.skipIf(!databaseUrl)('publishes in enterprise management and downloads through the real desktop session over HTTP',async()=>{
  // Load the independently owned server at runtime, outside Desktop's TS root.
  const {database,migrate}=await import(/* @vite-ignore */ new URL('../../dsh-enterprise-server/src/database.ts',import.meta.url).href)
  const {createApp,initializeAdmin}=await import(/* @vite-ignore */ new URL('../../dsh-enterprise-server/src/app.ts',import.meta.url).href)
  const root=database(databaseUrl),schema=`desktop_flow_${randomUUID().replaceAll('-','')}`
  await root.query(`CREATE SCHEMA ${schema}`)
  const connection=new URL(databaseUrl!);connection.searchParams.set('options',`-c search_path=${schema}`)
  const pool=database(connection.href),origin='http://127.0.0.1:5180'
  const directory=fileURLToPath(new URL(`../../output/desktop-release-tests/${schema}/`,import.meta.url))
  let app:Awaited<ReturnType<typeof createApp>>|undefined
  try {
    await migrate(pool);await initializeAdmin(pool,'flow.admin','测试发布管理员','Test-release-flow-password-1')
    await pool.query('UPDATE employees SET must_change_password=false')
    app=await createApp(pool,{origin,rateLimit:1000,modelEncryptionKey:Buffer.alloc(32,5),desktopReleaseDirectory:directory})
    const login=await app.inject({url:'/api/v1/auth/login',method:'POST',headers:{origin},payload:{username:'flow.admin',password:'Test-release-flow-password-1',channel:'browser'}})
    const cookie=String(login.headers['set-cookie']).split(';')[0]!,headers={origin,cookie}
    const created=await app.inject({url:'/api/v1/desktop-releases',method:'POST',headers,payload:{version:'1.0.1',channel:'stable',platform:'win32',arch:'x64',notes:'端到端测试用惰性安装包，不执行。'}})
    expect(created.statusCode).toBe(200)
    const id=created.json().id as string,exe=Buffer.alloc(512);exe.write('MZ');exe.writeUInt32LE(64,60);exe.write('PE\0\0',64)
    const uploaded=await app.inject({url:`/api/v1/desktop-releases/${id}/artifact`,method:'PUT',headers:{...headers,'content-type':'application/octet-stream'},payload:exe})
    expect(uploaded.statusCode).toBe(200)
    expect((await app.inject({url:`/api/v1/desktop-releases/${id}/state`,method:'POST',headers,payload:{state:'published'}})).statusCode).toBe(200)
    const address=await app.listen({host:'127.0.0.1',port:0}),client=new EnterpriseClient(address)
    await client.login('flow.admin','Test-release-flow-password-1',false)
    const updates=new EnterpriseDesktopUpdates(client,'win32','x64','1.0.0',fetch)
    expect(await checkForDesktopUpdate({currentVersion:'1.0.0',channel:'stable',request:updates.request})).toMatchObject({status:'update-available',latestVersion:'1.0.1'})
    const manifest=updates.release('stable','1.0.1')!
    const file=await downloadDesktopUpdate({platform:'win32',version:'1.0.1',request:updates.request,
      destinationPath:directory+'verified-inert-fixture.exe',expectedSize:manifest.size!,expectedSha256:manifest.sha256!})
    expect(readFileSync(file)).toEqual(exe)
    expect((await app.inject({url:`/api/v1/desktop-releases/${id}/state`,method:'POST',headers,payload:{state:'withdrawn'}})).statusCode).toBe(200)
    await expect(downloadDesktopUpdate({platform:'win32',version:'1.0.1',request:updates.request,
      destinationPath:directory+'withdrawn-inert-fixture.exe',expectedSize:manifest.size!,expectedSha256:manifest.sha256!})).rejects.toThrow()
  } finally {await app?.close();await pool.end();await root.end()}
},15000)
