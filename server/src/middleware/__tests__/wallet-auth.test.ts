import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { buildAuthMessage, walletAuth } from '../wallet-auth'

// ── Mock viem so tests never touch real cryptography ─────────────────────────
// vi.mock is hoisted above variable declarations, so use vi.hoisted() to
// create the mock function in the hoisted scope where it is referenced.
const mockRecover = vi.hoisted(() => vi.fn<() => Promise<string>>())
vi.mock('viem', () => ({ recoverMessageAddress: mockRecover }))

const VALID_ADDRESS = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'
const OTHER_ADDRESS = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const VALID_SIG = '0xdeadbeef'

function nowSeconds() {
  return Math.floor(Date.now() / 1000)
}

function makeApp(maxAgeSecs?: number) {
  const app = new Hono()
  app.use('/protected/*', walletAuth(maxAgeSecs))
  app.get('/protected/data', (c) => c.json({ success: true }))
  return app
}

function makeAppWithApiKeyBypass() {
  const app = new Hono()
  app.use('/protected/*', walletAuth({ allowApiKey: true }))
  app.get('/protected/data', (c) => c.json({ success: true }))
  return app
}

function makeReq(address: string | null, sig?: string, ts?: number) {
  const url = address !== null ? `/protected/data?address=${address}` : '/protected/data'
  const headers: Record<string, string> = {}
  if (sig !== undefined) headers['x-wallet-signature'] = sig
  if (ts !== undefined) headers['x-wallet-timestamp'] = String(ts)
  return { url, init: { headers } }
}

describe('buildAuthMessage', () => {
  it('lowercases the address', () => {
    const msg = buildAuthMessage('0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266', 1000)
    expect(msg).toContain('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266')
  })

  it('includes the timestamp', () => {
    const msg = buildAuthMessage(VALID_ADDRESS, 1710761234)
    expect(msg).toContain('1710761234')
  })

  it('is deterministic for the same inputs', () => {
    const a = buildAuthMessage(VALID_ADDRESS, 9999)
    const b = buildAuthMessage(VALID_ADDRESS, 9999)
    expect(a).toBe(b)
  })
})

describe('walletAuth middleware — API key bypass', () => {
  const VALID_KEY = 'test-api-key-abc123'

  beforeEach(() => {
    mockRecover.mockReset()
    process.env['API_KEY'] = VALID_KEY
  })

  afterEach(() => {
    delete process.env['API_KEY']
  })

  it('bypasses wallet auth when allowApiKey=true and key matches', async () => {
    const res = await makeAppWithApiKeyBypass().request(
      `/protected/data?address=${VALID_ADDRESS}`,
      { headers: { 'x-api-key': VALID_KEY } },
    )
    expect(res.status).toBe(200)
    expect(mockRecover).not.toHaveBeenCalled()
  })

  it('falls through to wallet auth when key is wrong', async () => {
    // Wrong API key → bypass skipped → wallet sig check runs → other address recovered → 401
    mockRecover.mockResolvedValueOnce(OTHER_ADDRESS)
    const res = await makeAppWithApiKeyBypass().request(
      `/protected/data?address=${VALID_ADDRESS}`,
      { headers: { 'x-api-key': 'wrong-key', 'x-wallet-signature': VALID_SIG, 'x-wallet-timestamp': String(nowSeconds()) } },
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/does not match/i)
  })

  it('falls through to wallet auth when no x-api-key header', async () => {
    const res = await makeAppWithApiKeyBypass().request(
      `/protected/data?address=${VALID_ADDRESS}`,
    )
    expect(res.status).toBe(401)
  })

  it('does NOT bypass when allowApiKey=false even with correct key', async () => {
    // Default walletAuth (no allowApiKey) ignores the key header entirely
    const app = new Hono()
    app.use('/protected/*', walletAuth())
    app.get('/protected/data', (c) => c.json({ success: true }))
    const res = await app.request(
      `/protected/data?address=${VALID_ADDRESS}`,
      { headers: { 'x-api-key': VALID_KEY } },
    )
    expect(res.status).toBe(401)
    expect(mockRecover).not.toHaveBeenCalled()
  })

  it('does NOT bypass when API_KEY env is not set', async () => {
    delete process.env['API_KEY']
    const res = await makeAppWithApiKeyBypass().request(
      `/protected/data?address=${VALID_ADDRESS}`,
      { headers: { 'x-api-key': VALID_KEY } },
    )
    expect(res.status).toBe(401)
  })
})

describe('walletAuth middleware', () => {
  beforeEach(() => mockRecover.mockReset())

  // ── No address → pass through ───────────────────────────────────────────────
  it('passes through when no address query param is present', async () => {
    const { url, init } = makeReq(null)
    const res = await makeApp().request(url, init)
    expect(res.status).toBe(200)
    expect(mockRecover).not.toHaveBeenCalled()
  })

  // ── Missing headers ─────────────────────────────────────────────────────────
  it('returns 401 when both headers are missing', async () => {
    const { url, init } = makeReq(VALID_ADDRESS)
    const res = await makeApp().request(url, init)
    expect(res.status).toBe(401)
  })

  it('returns 401 when only x-wallet-signature is missing', async () => {
    const { url, init } = makeReq(VALID_ADDRESS, undefined, nowSeconds())
    const res = await makeApp().request(url, init)
    expect(res.status).toBe(401)
  })

  it('returns 401 when only x-wallet-timestamp is missing', async () => {
    const { url, init } = makeReq(VALID_ADDRESS, VALID_SIG, undefined)
    const res = await makeApp().request(url, init)
    expect(res.status).toBe(401)
  })

  it('401 body includes a human-readable error', async () => {
    const { url, init } = makeReq(VALID_ADDRESS)
    const res = await makeApp().request(url, init)
    const body = await res.json()
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
    expect(body.ok).toBe(false)
  })

  // ── Bad timestamp ───────────────────────────────────────────────────────────
  it('returns 401 for non-numeric timestamp', async () => {
    const app = makeApp()
    const res = await app.request('/protected/data?address=' + VALID_ADDRESS, {
      headers: { 'x-wallet-signature': VALID_SIG, 'x-wallet-timestamp': 'not-a-number' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 for zero timestamp', async () => {
    const { url, init } = makeReq(VALID_ADDRESS, VALID_SIG, 0)
    const res = await makeApp().request(url, init)
    expect(res.status).toBe(401)
  })

  it('returns 401 for negative timestamp', async () => {
    const { url, init } = makeReq(VALID_ADDRESS, VALID_SIG, -1)
    const res = await makeApp().request(url, init)
    expect(res.status).toBe(401)
  })

  // ── Timestamp freshness ─────────────────────────────────────────────────────
  it('returns 401 when timestamp is older than maxAgeSeconds', async () => {
    mockRecover.mockResolvedValueOnce(VALID_ADDRESS)
    const staleTs = nowSeconds() - 301  // 301s ago, default max is 300s
    const { url, init } = makeReq(VALID_ADDRESS, VALID_SIG, staleTs)
    const res = await makeApp().request(url, init)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/expired/i)
  })

  it('returns 401 when timestamp is in the future beyond maxAgeSeconds', async () => {
    mockRecover.mockResolvedValueOnce(VALID_ADDRESS)
    const futureTs = nowSeconds() + 301
    const { url, init } = makeReq(VALID_ADDRESS, VALID_SIG, futureTs)
    const res = await makeApp().request(url, init)
    expect(res.status).toBe(401)
  })

  it('accepts a timestamp at exactly maxAgeSeconds boundary', async () => {
    mockRecover.mockResolvedValueOnce(VALID_ADDRESS)
    const maxAgeSeconds = 60
    const ts = nowSeconds() - maxAgeSeconds + 1  // 1s inside the window
    const { url, init } = makeReq(VALID_ADDRESS, VALID_SIG, ts)
    const res = await makeApp(maxAgeSeconds).request(url, init)
    expect(res.status).toBe(200)
  })

  it('custom maxAgeSeconds is respected', async () => {
    mockRecover.mockResolvedValueOnce(VALID_ADDRESS)
    const staleTs = nowSeconds() - 31  // 31s ago — fine with 60s window, stale with 30s
    const { url, init } = makeReq(VALID_ADDRESS, VALID_SIG, staleTs)
    const res = await makeApp(30).request(url, init)
    expect(res.status).toBe(401)
  })

  // ── Signature verification ──────────────────────────────────────────────────
  it('returns 401 when recovered address does not match ?address', async () => {
    mockRecover.mockResolvedValueOnce(OTHER_ADDRESS)  // signer is different wallet
    const { url, init } = makeReq(VALID_ADDRESS, VALID_SIG, nowSeconds())
    const res = await makeApp().request(url, init)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/does not match/i)
  })

  it('returns 401 when recoverMessageAddress throws (malformed sig)', async () => {
    mockRecover.mockRejectedValueOnce(new Error('invalid signature'))
    const { url, init } = makeReq(VALID_ADDRESS, '0xinvalid', nowSeconds())
    const res = await makeApp().request(url, init)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/invalid signature/i)
  })

  it('passes through to route handler on valid signature', async () => {
    mockRecover.mockResolvedValueOnce(VALID_ADDRESS)
    const { url, init } = makeReq(VALID_ADDRESS, VALID_SIG, nowSeconds())
    const res = await makeApp().request(url, init)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it('address comparison is case-insensitive', async () => {
    // recovered is checksummed; query address is lowercase — should still match
    mockRecover.mockResolvedValueOnce('0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266')
    const { url, init } = makeReq(VALID_ADDRESS, VALID_SIG, nowSeconds())
    const res = await makeApp().request(url, init)
    expect(res.status).toBe(200)
  })

  it('recoverMessageAddress is called with the canonical message', async () => {
    mockRecover.mockResolvedValueOnce(VALID_ADDRESS)
    const ts = nowSeconds()
    const { url, init } = makeReq(VALID_ADDRESS, VALID_SIG, ts)
    await makeApp().request(url, init)

    expect(mockRecover).toHaveBeenCalledWith({
      message: buildAuthMessage(VALID_ADDRESS, ts),
      signature: VALID_SIG,
    })
  })
})
