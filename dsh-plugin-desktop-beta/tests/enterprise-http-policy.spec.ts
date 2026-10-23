import { afterEach, describe, expect, it, vi } from 'vitest'
import { enterpriseServiceUrl } from '../src/enterprise-client.ts'
import { inspectEnterpriseService } from '../src/enterprise-service.ts'

const original = process.env.DSH_ENTERPRISE_HTTP_ORIGINS
afterEach(() => {
  if (original === undefined) delete process.env.DSH_ENTERPRISE_HTTP_ORIGINS
  else process.env.DSH_ENTERPRISE_HTTP_ORIGINS = original
})

describe('enterprise HTTP and HTTPS connections need no host allowlist', () => {
  it('accepts arbitrary HTTP domains, IPs, IPv6 and ports without environment configuration', () => {
    delete process.env.DSH_ENTERPRISE_HTTP_ORIGINS
    for (const value of [
      'http://lets-harness.letsbim.cn', 'http://another-company.example',
      'http://another-company.example:8080', 'http://192.168.15.216:4310',
      'http://10.10.0.5', 'http://[2001:db8::1]:4310',
      'http://127.0.0.1:4310', 'https://enterprise.example',
    ]) expect(enterpriseServiceUrl(`${value}/`)).toBe(value)
  })
  it('does not let an old or malformed environment allowlist restrict connections', () => {
    for (const policy of ['http://old-company.example', '*']) {
      process.env.DSH_ENTERPRISE_HTTP_ORIGINS = policy
      expect(enterpriseServiceUrl('http://another-company.example')).toBe('http://another-company.example')
      expect(enterpriseServiceUrl('https://enterprise.example')).toBe('https://enterprise.example')
    }
  })
  it('checks any HTTP endpoint without credentials and without following redirects', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({
      product: 'lets-enterprise', desktopApiVersion: 1, instanceId: '11111111-1111-4111-8111-111111111111',
    }))
    for (const origin of ['http://lets-harness.letsbim.cn', 'http://another-company.example:8080']) {
      expect((await inspectEnterpriseService(`${origin}/`, transport)).origin).toBe(origin)
      expect(transport).toHaveBeenLastCalledWith(`${origin}/api/v1/desktop-info`, expect.objectContaining({
        method: 'GET', redirect: 'error', headers: { Accept: 'application/json' },
      }))
    }
  })
  it('still rejects credentials, paths, queries, fragments and non-HTTP protocols before networking', async () => {
    const transport = vi.fn<typeof fetch>()
    for (const value of [
      'http://user:password@company.example', 'http://company.example/api/',
      'http://company.example/?token=x', 'http://company.example/#fragment',
      'ftp://company.example', 'file:///local', 'javascript:alert(1)',
      'http://company.example/\\evil', 'http://comp\nany.example',
    ]) {
      expect(() => enterpriseServiceUrl(value)).toThrow()
      await expect(inspectEnterpriseService(value, transport)).rejects.toThrow()
    }
    expect(transport).not.toHaveBeenCalled()
  })
})
