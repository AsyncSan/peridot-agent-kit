import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'

// ── Mock the db module so tests never need a real Postgres connection ─────────
const mockSql = vi.fn()
vi.mock('../../db', () => ({
  sql: Object.assign(mockSql, {
    end: vi.fn().mockResolvedValue(undefined),
  }),
}))

// Import after mocking
const { healthRoute } = await import('../health')

function makeApp() {
  const app = new Hono()
  app.route('/health', healthRoute)
  return app
}

describe('GET /health', () => {
  it('returns 200 with ok: true', async () => {
    const res = await makeApp().request('/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('includes a ts timestamp close to now', async () => {
    const before = Date.now()
    const res = await makeApp().request('/health')
    const after = Date.now()
    const { ts } = await res.json()
    expect(typeof ts).toBe('number')
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after + 5)
  })
})

describe('GET /health/db', () => {
  beforeEach(() => {
    mockSql.mockReset()
  })

  it('returns 200 with db: up when SELECT 1 succeeds', async () => {
    mockSql.mockResolvedValueOnce([{ '?column?': 1 }])
    const res = await makeApp().request('/health/db')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, db: 'up' })
    expect(typeof body.latencyMs).toBe('number')
    expect(body.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('returns 503 with db: down when DB throws', async () => {
    mockSql.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const res = await makeApp().request('/health/db')
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, db: 'down' })
    expect(typeof body.error).toBe('string')
    expect(body.error).toContain('ECONNREFUSED')
  })

  it('includes the DB error message verbatim in the 503 body', async () => {
    const errMsg = 'self-signed certificate in certificate chain'
    mockSql.mockRejectedValueOnce(new Error(errMsg))
    const res = await makeApp().request('/health/db')
    const body = await res.json()
    expect(body.error).toBe(errMsg)
  })

  it('handles non-Error throws gracefully', async () => {
    mockSql.mockRejectedValueOnce('string error')
    const res = await makeApp().request('/health/db')
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe('string')
  })
})
