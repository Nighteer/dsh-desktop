import { afterEach, describe, expect, it } from 'vitest'
import { configureEnterpriseHttpOrigins, enterpriseServiceUrl } from '../src/enterprise-client.ts'

const original = process.env.DSH_ENTERPRISE_HTTP_ORIGINS
afterEach(() => {
  configureEnterpriseHttpOrigins([])
  if (original === undefined) delete process.env.DSH_ENTERPRISE_HTTP_ORIGINS
  else process.env.DSH_ENTERPRISE_HTTP_ORIGINS = original
})
describe('enterprise HTTP compatibility is restricted to configured origins', () => {
  it('keeps HTTPS and loopback available but rejects remote HTTP by default', () => {
    delete process.env.DSH_ENTERPRISE_HTTP_ORIGINS
    expect(enterpriseServiceUrl('https://enterprise.example/')).toBe('https://enterprise.example')
    expect(enterpriseServiceUrl('http://127.0.0.1:4310')).toBe('http://127.0.0.1:4310')
    expect(() => enterpriseServiceUrl('http://10.10.0.5')).toThrow()
  })
  it('permits only the exact packaged host and port', () => {
    configureEnterpriseHttpOrigins(['http://10.10.0.5:8080'])
    expect(enterpriseServiceUrl('http://10.10.0.5:8080')).toBe('http://10.10.0.5:8080')
    for (const value of ['http://10.10.0.6:8080', 'http://10.10.0.5', 'http://user@10.10.0.5:8080', 'http://10.10.0.5:8080/path', 'http://10.10.0.5:8080?token=x']) expect(() => enterpriseServiceUrl(value)).toThrow()
  })
  it('supports an IT-managed environment allowlist and fails on malformed policy', () => {
    process.env.DSH_ENTERPRISE_HTTP_ORIGINS = 'http://lets.intranet:8080'
    expect(enterpriseServiceUrl('http://lets.intranet:8080')).toBe('http://lets.intranet:8080')
    process.env.DSH_ENTERPRISE_HTTP_ORIGINS = '*'
    expect(() => enterpriseServiceUrl('https://enterprise.example')).toThrow()
  })
})
