import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'

// ── Mock the db module so tests never need a real Postgres connection ─────────
const mockSql = vi.fn()
vi.mock('../../db', () => ({
  sql: Object.assign(mockSql, {
    end: vi.fn().mockResolvedValue(undefined),
  }),
  tables: {
    assetMetricsLatest: 'asset_metrics_latest_mainnet',
    apyLatest: 'apy_latest_mainnet',
  },
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

// Helper: mock two data-freshness queries (identifier call + two tag template calls)
function mockDataQuery(metricsUpdatedAt: Date | null, apyTs: Date | null) {
  mockSql
    .mockReturnValueOnce('__metrics_table__')          // sql(tables.assetMetricsLatest) identifier
    .mockResolvedValueOnce([{ updated_at: metricsUpdatedAt }])
    .mockReturnValueOnce('__apy_table__')              // sql(tables.apyLatest) identifier
    .mockResolvedValueOnce([{ ts: apyTs }])
}

describe('GET /health/data', () => {
  beforeEach(() => {
    mockSql.mockReset()
  })

  it('returns 200 with stale: false when both tables are fresh', async () => {
    const now = new Date()
    mockDataQuery(new Date(now.getTime() - 60_000), new Date(now.getTime() - 90_000))
    const res = await makeApp().request('/health/data')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.stale).toBe(false)
    expect(body.metrics.fresh).toBe(true)
    expect(body.apy.fresh).toBe(true)
    expect(typeof body.metrics.ageSeconds).toBe('number')
    expect(body.metrics.ageSeconds).toBeGreaterThan(0)
  })

  it('returns stale: true when metrics data is old', async () => {
    const now = new Date()
    mockDataQuery(new Date(now.getTime() - 400_000), new Date(now.getTime() - 60_000))
    const res = await makeApp().request('/health/data')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stale).toBe(true)
    expect(body.metrics.fresh).toBe(false)
    expect(body.apy.fresh).toBe(true)
  })

  it('returns stale: true when APY data is old', async () => {
    const now = new Date()
    mockDataQuery(new Date(now.getTime() - 60_000), new Date(now.getTime() - 600_000))
    const res = await makeApp().request('/health/data')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stale).toBe(true)
    expect(body.apy.fresh).toBe(false)
    expect(body.metrics.fresh).toBe(true)
  })

  it('returns stale: true when updated_at is null (table empty)', async () => {
    mockDataQuery(null, null)
    const res = await makeApp().request('/health/data')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stale).toBe(true)
    expect(body.metrics.updatedAt).toBeNull()
    expect(body.metrics.ageSeconds).toBeNull()
    expect(body.apy.updatedAt).toBeNull()
  })

  it('includes ISO updatedAt strings', async () => {
    const ts = new Date('2025-01-15T10:00:00Z')
    mockDataQuery(ts, ts)
    const res = await makeApp().request('/health/data')
    const body = await res.json()
    expect(body.metrics.updatedAt).toBe('2025-01-15T10:00:00.000Z')
    expect(body.apy.updatedAt).toBe('2025-01-15T10:00:00.000Z')
  })

  it('returns 503 when DB query throws', async () => {
    mockSql
      .mockReturnValueOnce('__table__')
      .mockRejectedValueOnce(new Error('DB down'))
    const res = await makeApp().request('/health/data')
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain('DB down')
  })
})
