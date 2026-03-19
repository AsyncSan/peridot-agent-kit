import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { rateLimit, _clearWindowsForTesting } from '../rate-limit'

// Each test uses a unique IP drawn from this counter so the module-level
// windows Map never has cross-test contamination — no beforeEach needed.
let ipCounter = 0
function nextIp() { return `10.0.${Math.floor(ipCounter / 255)}.${++ipCounter % 255}` }

function makeApp(maxRpm: number) {
  const app = new Hono()
  app.use('/api/*', rateLimit(maxRpm))
  app.get('/api/test', (c) => c.json({ ok: true }))
  app.get('/health', (c) => c.json({ ok: true })) // not rate-limited
  return app
}

async function req(
  app: ReturnType<typeof makeApp>,
  ip: string,
  path = '/api/test',
) {
  return app.request(path, { headers: { 'x-forwarded-for': ip } })
}

// The main suite uses TRUSTED_PROXY=true so header-based IP tracking works in tests
// (Hono's test runner has no real socket, so remoteAddress is always undefined).
describe('rateLimit middleware', () => {
  beforeAll(() => { process.env['TRUSTED_PROXY'] = 'true' })
  afterAll(() => { delete process.env['TRUSTED_PROXY'] })
  it('allows requests under the limit', async () => {
    const ip = nextIp()
    const app = makeApp(5)
    for (let i = 0; i < 5; i++) {
      const res = await req(app, ip)
      expect(res.status).toBe(200)
    }
  })

  it('blocks the request that exceeds the limit with 429', async () => {
    const ip = nextIp()
    const app = makeApp(3)
    for (let i = 0; i < 3; i++) await req(app, ip)
    const res = await req(app, ip)
    expect(res.status).toBe(429)
  })

  it('returns { ok: false, error: "Too many requests" } body on 429', async () => {
    const ip = nextIp()
    const app = makeApp(1)
    await req(app, ip)
    const res = await req(app, ip)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'Too many requests' })
  })

  it('sets Retry-After header on 429', async () => {
    const ip = nextIp()
    const app = makeApp(1)
    await req(app, ip)
    const res = await req(app, ip)
    const retryAfter = res.headers.get('retry-after')
    expect(retryAfter).not.toBeNull()
    expect(Number(retryAfter)).toBeGreaterThan(0)
  })

  it('sets X-RateLimit-Limit header on successful responses', async () => {
    const ip = nextIp()
    const app = makeApp(10)
    const res = await req(app, ip)
    expect(res.headers.get('x-ratelimit-limit')).toBe('10')
  })

  it('decrements X-RateLimit-Remaining with each request', async () => {
    const ip = nextIp()
    const app = makeApp(5)
    const r1 = await req(app, ip)
    const r2 = await req(app, ip)
    const r3 = await req(app, ip)
    expect(r1.headers.get('x-ratelimit-remaining')).toBe('4')
    expect(r2.headers.get('x-ratelimit-remaining')).toBe('3')
    expect(r3.headers.get('x-ratelimit-remaining')).toBe('2')
  })

  it('sets X-RateLimit-Remaining to 0 on 429', async () => {
    const ip = nextIp()
    const app = makeApp(2)
    await req(app, ip)
    await req(app, ip)
    const res = await req(app, ip)
    expect(res.status).toBe(429)
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0')
  })

  it('tracks limits independently per IP', async () => {
    const ipA = nextIp()
    const ipB = nextIp()
    const app = makeApp(2)

    // IP A exhausts its limit
    await req(app, ipA)
    await req(app, ipA)
    const blockedA = await req(app, ipA)
    expect(blockedA.status).toBe(429)

    // IP B is completely unaffected
    const okB = await req(app, ipB)
    expect(okB.status).toBe(200)
  })

  it('prefers cf-connecting-ip over x-forwarded-for', async () => {
    const cfIp = nextIp()
    const fwdIp = nextIp()
    const app = makeApp(1)

    // First request identified by cf-connecting-ip
    const r1 = await app.request('/api/test', {
      headers: { 'cf-connecting-ip': cfIp, 'x-forwarded-for': fwdIp },
    })
    expect(r1.status).toBe(200)

    // Second request — same cf-connecting-ip is now blocked
    const r2 = await app.request('/api/test', {
      headers: { 'cf-connecting-ip': cfIp, 'x-forwarded-for': fwdIp },
    })
    expect(r2.status).toBe(429)

    // The x-forwarded-for IP has never been seen — still allowed
    const r3 = await app.request('/api/test', {
      headers: { 'x-forwarded-for': fwdIp },
    })
    expect(r3.status).toBe(200)
  })

  it('does not rate-limit routes outside /api/*', async () => {
    const ip = nextIp()
    const app = makeApp(1)
    // Exhaust the API limit
    await req(app, ip)
    await req(app, ip)
    // /health is outside /api/* — must not be blocked
    const healthRes = await app.request('/health', {
      headers: { 'x-forwarded-for': ip },
    })
    expect(healthRes.status).toBe(200)
  })
})

describe('rateLimit middleware — TRUSTED_PROXY=false (default)', () => {
  beforeAll(() => { delete process.env['TRUSTED_PROXY'] })
  beforeEach(() => { _clearWindowsForTesting() })

  it('ignores x-forwarded-for — different header IPs share the same bucket', async () => {
    // In untrusted mode, all requests without a real socket get IP='unknown'
    // so two requests with different x-forwarded-for values are treated as the same client
    const app = makeApp(1)
    const r1 = await app.request('/api/test', { headers: { 'x-forwarded-for': nextIp() } })
    expect(r1.status).toBe(200)
    // Second request — different spoofed IP but still 'unknown' bucket → blocked
    const r2 = await app.request('/api/test', { headers: { 'x-forwarded-for': nextIp() } })
    expect(r2.status).toBe(429)
  })

  it('ignores cf-connecting-ip — cannot bypass via Cloudflare header spoofing', async () => {
    const app = makeApp(1)
    const r1 = await app.request('/api/test', { headers: { 'cf-connecting-ip': nextIp() } })
    expect(r1.status).toBe(200)
    const r2 = await app.request('/api/test', { headers: { 'cf-connecting-ip': nextIp() } })
    expect(r2.status).toBe(429)
  })
})
