import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// ── Mock the db module so tests never need a real Postgres connection ─────────
const mockSql = vi.fn()
vi.mock('../../db', () => ({
  sql: Object.assign(mockSql, {
    end: vi.fn().mockResolvedValue(undefined),
  }),
  tables: {
    assetMetricsLatest: 'asset_metrics_latest_mainnet',
  },
}))

// ── Mock Cache as a pass-through so every test hits the fetcher fresh ─────────
vi.mock('../../cache', () => ({
  Cache: class {
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(_ttlMs: number) {}
    async getOrFetch(_key: string, fetcher: () => Promise<unknown>) {
      return fetcher()
    }
  },
}))

// Import after mocking
const { marketsRoute } = await import('../markets')

function makeApp() {
  const app = new Hono()
  app.route('/api/markets', marketsRoute)
  app.onError((err, c) => c.json({ ok: false, error: err.message }, 500))
  return app
}

// Helper: each call to sql`...FROM ${sql(tableName)}` produces two mock calls:
//   1. sql(tableName)     → the SQL identifier fragment (return a plain value)
//   2. sql`SELECT ...`    → tagged template call (return resolved rows or reject)
function mockTableSuccess(rows: Record<string, unknown>[] = []) {
  mockSql
    .mockReturnValueOnce('__id__')      // sql(tableName)
    .mockResolvedValueOnce(rows)         // sql`SELECT ...`
}

function mockTableError(err: Error) {
  mockSql
    .mockReturnValueOnce('__id__')      // sql(tableName)
    .mockRejectedValueOnce(err)          // sql`SELECT ...`
}

const SAMPLE_ROW = {
  asset_id: 'BTC',
  chain_id: '56',
  utilization_pct: '0.75',
  tvl_usd: '1000000',
  liquidity_underlying: '5000',
  liquidity_usd: '500000',
  price_usd: '60000',
  collateral_factor_pct: '0.7',
  updated_at: '2024-01-15T12:00:00.000Z',
}

describe('GET /api/markets/metrics', () => {
  beforeEach(() => {
    mockSql.mockReset()
    // Clear the module-level cache between tests by re-requiring is not trivial,
    // so we rely on the cache TTL not expiring within the same test. Because each
    // test uses unique data and the cache is keyed on 'metrics', we clear it by
    // calling mockSql.mockReset() which ensures fresh mock values are used.
    // The cache will return fresh results since each test runs with a new import context.
  })

  it('returns 200 with ok: true on success', async () => {
    mockTableSuccess([SAMPLE_ROW])
    const res = await makeApp().request('/api/markets/metrics')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.data).toBe('object')
  })

  it('shapes each row into the expected key format ASSET:chainId', async () => {
    mockTableSuccess([SAMPLE_ROW])
    const res = await makeApp().request('/api/markets/metrics')
    const { data } = await res.json()
    expect('BTC:56' in data).toBe(true)
  })

  it('coerces all numeric fields to numbers', async () => {
    mockTableSuccess([SAMPLE_ROW])
    const res = await makeApp().request('/api/markets/metrics')
    const { data } = await res.json()
    const entry = data['BTC:56']
    expect(typeof entry.utilizationPct).toBe('number')
    expect(typeof entry.tvlUsd).toBe('number')
    expect(typeof entry.liquidityUnderlying).toBe('number')
    expect(typeof entry.liquidityUsd).toBe('number')
    expect(typeof entry.priceUsd).toBe('number')
    expect(typeof entry.collateral_factor_pct).toBe('number')
    expect(typeof entry.chainId).toBe('number')
  })

  it('defaults null fields to 0 instead of NaN', async () => {
    const rowWithNulls = { ...SAMPLE_ROW, utilization_pct: null, price_usd: null }
    mockTableSuccess([rowWithNulls])
    const res = await makeApp().request('/api/markets/metrics')
    const { data } = await res.json()
    const entry = data['BTC:56']
    expect(entry.utilizationPct).toBe(0)
    expect(entry.priceUsd).toBe(0)
  })

  it('includes updatedAt as an ISO-8601 string', async () => {
    mockTableSuccess([SAMPLE_ROW])
    const res = await makeApp().request('/api/markets/metrics')
    const { data } = await res.json()
    const { updatedAt } = data['BTC:56']
    expect(typeof updatedAt).toBe('string')
    expect(new Date(updatedAt).toISOString()).toBe(updatedAt)
  })

  it('returns ok: true with empty data object when the table has no rows', async () => {
    mockTableSuccess([])
    const res = await makeApp().request('/api/markets/metrics')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data).toEqual({})
  })

  it('asset_id is uppercased in the key', async () => {
    const row = { ...SAMPLE_ROW, asset_id: 'eth' }
    mockTableSuccess([row])
    const res = await makeApp().request('/api/markets/metrics')
    const { data } = await res.json()
    expect('ETH:56' in data).toBe(true)
    expect('eth:56' in data).toBe(false)
  })
})

describe('GET /api/markets/metrics — table fallback behaviour', () => {
  beforeEach(() => {
    mockSql.mockReset()
  })

  it('falls back to the non-suffixed table when the mainnet table throws', async () => {
    // First table (asset_metrics_latest_mainnet) → error
    mockTableError(new Error('relation "asset_metrics_latest_mainnet" does not exist'))
    // Second table (asset_metrics_latest) → success
    mockTableSuccess([SAMPLE_ROW])

    const res = await makeApp().request('/api/markets/metrics')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns 500 when both tables throw', async () => {
    mockTableError(new Error('connection refused'))
    mockTableError(new Error('connection refused'))

    const res = await makeApp().request('/api/markets/metrics')
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('500 body has a non-empty error field', async () => {
    mockTableError(new Error('connection refused'))
    mockTableError(new Error('connection refused'))

    const res = await makeApp().request('/api/markets/metrics')
    const body = await res.json()
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })

  it('does NOT return 500 when only the first table fails (fallback succeeds)', async () => {
    mockTableError(new Error('table not found'))
    mockTableSuccess([SAMPLE_ROW])

    const res = await makeApp().request('/api/markets/metrics')
    expect(res.status).not.toBe(500)
  })
})
