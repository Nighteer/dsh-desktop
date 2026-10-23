import {describe,expect,it} from 'vitest'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'

describe('native enterprise login layout boundary',()=>{
  it('loads compact styling only in the native login document, preserving browser administration',()=>{
    const html=readFileSync(resolve('src/native-ui/enterprise-login.html'),'utf8')
    const entry=readFileSync(resolve('src/native-ui/enterprise-login.tsx'),'utf8')
    const css=readFileSync(resolve('src/native-ui/enterprise-login.css'),'utf8')
    expect(html).toContain('enterprise-admin enterprise-desktop-login')
    expect(entry).toContain("import './enterprise-login.css'")
    expect(css).toContain('html.enterprise-admin.enterprise-desktop-login .admin-auth-form')
    expect(html).toContain("connect-src 'none'")
  })
  it('retains scrolling for long errors/password forms rather than clipping controls',()=>{
    const css=readFileSync(resolve('src/native-ui/enterprise-login.css'),'utf8')
    expect(css).toContain('scrollbar-width: thin')
    expect(css).not.toMatch(/overflow(?:-y)?\s*:\s*(hidden|clip)|scrollbar-width\s*:\s*none/u)
    expect(css).toContain('@media (max-height: 680px)')
  })
})
