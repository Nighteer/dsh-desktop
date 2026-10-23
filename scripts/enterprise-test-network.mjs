/** Pick an unused Docker test subnet while retaining previous test networks. */
import { spawnSync } from 'node:child_process'
export function testNetwork() {
  const listed = spawnSync('docker', ['network', 'ls', '--format', '{{.ID}}'], { encoding: 'utf8' })
  if (listed.status !== 0) throw new Error('Cannot inspect isolated Docker networks')
  const ids = listed.stdout.trim().split(/\s+/u).filter(Boolean)
  const inspected = spawnSync('docker', ['network', 'inspect', ...ids], { encoding: 'utf8' })
  if (inspected.status !== 0) throw new Error('Cannot inspect allocated test subnets')
  const integer = value => value.split('.').reduce((result, byte) => (result << 8n) + BigInt(byte), 0n)
  const ranges = JSON.parse(inspected.stdout).flatMap(network => network.IPAM?.Config ?? []).map(config => config.Subnet).filter(value => typeof value === 'string' && /^\d+\.\d+\.\d+\.\d+\/\d+$/u.test(value)).map(value => {
    const [ip, length] = value.split('/'), prefix = Number(length)
    const mask = prefix === 0 ? 0n : ((1n << 32n) - 1n) << BigInt(32 - prefix) & ((1n << 32n) - 1n)
    const start = integer(ip) & mask
    return { start, end: start + (1n << BigInt(32 - prefix)) - 1n }
  })
  for (let octet = 100; octet < 255; octet++) {
    const base = `172.30.${octet}.0`, start = integer(base), end = start + 255n
    if (ranges.every(range => end < range.start || start > range.end)) return { subnet: base + '/24', proxy: `172.30.${octet}.10` }
  }
  throw new Error('No unused test subnet in 172.30.0.0/16; keep existing networks and choose an approved test range')
}
