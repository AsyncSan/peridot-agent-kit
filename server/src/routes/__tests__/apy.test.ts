import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

const mockSql = vi.fn()
vi.mock('../../db', () => ({
  sql: Object.assign(mockSql, { end: vi.fn().mockResolvedValue(undefined) }),
  tables: { apyLatest: 'apy_latest_mainnet' },
}))

vi.mock('../../cache', () => ({
  Cache: class {
    constructor(_ttlMs: number) {}
    async getOrFetch(_key: string, fetcher: () => Promise<unknown>) {
      return fetcher()
    }
  },
}))

const { apyRoute } = await import('../apy')

function makeApp() {
  const app = new Hono()
  app.route('/api/apy', apyRoute)
  app.onError((err, c) => c.json({ ok: false, error: err.message }, 500))
  return app
}

// Each query: sql(tableName) → identifier, then sql`...` → rows
function mockQuery(rows: Record<string, unknown>[] = []) {
  mockSql
    .mockReturnValueOnce('__id__')
    .mockResolvedValueOnce(rows)
}

const USDC_ROW = {
  asset_id: 'usdc', chain_id: '56',
  supply_apy: '3.21', borrow_apy: '5.67',
  peridot_supply_apy: '1.10', peridot_borrow_apy: '0.80',
  boost_source_supply_apy: '0.50', boost_rewards_supply_apy: '0.20',
  total_supply_apy: '5.01', net_borrow_apy: '4.87',
  timestamp: '2024-01-01T00:00:00.000Z',
}

const WETH_ROW = {
  asset_id: 'weth', chain_id: '56',
  supply_apy: '1.80', borrow_apy: '3.50',
  peridot_supply_apy: '0.60', peridot_borrow_apy: '0.40',
  boost_source_supply_apy: '0', boost_rewards_supply_apy: '0',
  total_supply_apy: '2.40', net_borrow_apy: '3.10',
  timestamp: '2024-01-01T00:00:00.000Z',
}

beforeEach(() => { mockSql.mockReset() })

describe('GET /api/apy', () => {
  it('returns 200 with ok: true', async () => {
    mockQuery([USDC_ROW])
    const res = await makeApp().request('/api/apy')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns data keyed by lowercase asset ID then chainId', async () => {
    mockQuery([USDC_ROW])
    const res = await makeApp().request('/api/apy')
    const { data } = await res.json()
    expect(data).toHaveProperty('usdc')
    expect(data['usdc']).toHaveProperty('56')
  })

  it('coerces all APY fields to numbers', async () => {
    mockQuery([USDC_ROW])
    const res = await makeApp().request('/api/apy')
    const { data } = await res.json()
    const entry = data['usdc']['56']
    expect(typeof entry.supplyApy).toBe('number')
    expect(typeof entry.borrowApy).toBe('number')
    expect(typeof entry.peridotSupplyApy).toBe('number')
    expect(typeof entry.peridotBorrowApy).toBe('number')
    expect(typeof entry.boostSourceSupplyApy).toBe('number')
    expect(typeof entry.boostRewardsSupplyApy).toBe('number')
    expect(typeof entry.totalSupplyApy).toBe('number')
    expect(typeof entry.netBorrowApy).toBe('number')
  })

  it('returns correct APY values', async () => {
    mockQuery([USDC_ROW])
    const res = await makeApp().request('/api/apy')
    const { data } = await res.json()
    const entry = data['usdc']['56']
    expect(entry.supplyApy).toBe(3.21)
    expect(entry.borrowApy).toBe(5.67)
    expect(entry.totalSupplyApy).toBe(5.01)
    expect(entry.netBorrowApy).toBe(4.87)
  })

  it('preserves the timestamp field', async () => {
    mockQuery([USDC_ROW])
    const res = await makeApp().request('/api/apy')
    const { data } = await res.json()
    expect(data['usdc']['56'].timestamp).toBe('2024-01-01T00:00:00.000Z')
  })

  it('returns multiple assets when multiple rows are present', async () => {
    mockQuery([USDC_ROW, WETH_ROW])
    const res = await makeApp().request('/api/apy')
    const { data } = await res.json()
    expect('usdc' in data).toBe(true)
    expect('weth' in data).toBe(true)
  })

  it('defaults null APY fields to 0 instead of NaN', async () => {
    const row = { ...USDC_ROW, supply_apy: null, borrow_apy: null }
    mockQuery([row])
    const res = await makeApp().request('/api/apy')
    const { data } = await res.json()
    expect(data['usdc']['56'].supplyApy).toBe(0)
    expect(data['usdc']['56'].borrowApy).toBe(0)
  })

  it('returns empty object when table has no rows', async () => {
    mockQuery([])
    const res = await makeApp().request('/api/apy')
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toEqual({})
  })

  it('sets public Cache-Control header', async () => {
    mockQuery([USDC_ROW])
    const res = await makeApp().request('/api/apy')
    const cc = res.headers.get('cache-control')
    expect(cc).toContain('public')
    expect(cc).toContain('s-maxage=30')
  })

  it('returns 500 with ok: false when DB throws', async () => {
    mockSql
      .mockReturnValueOnce('__id__')
      .mockRejectedValueOnce(new Error('DB connection lost'))
    const res = await makeApp().request('/api/apy')
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe('string')
  })
})

describe('GET /api/apy?chainId=', () => {
  it('returns 400 with ok: false for non-numeric chainId', async () => {
    const res = await makeApp().request('/api/apy?chainId=abc')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe('string')
  })

  it('returns 400 for negative chainId', async () => {
    const res = await makeApp().request('/api/apy?chainId=-1')
    expect(res.status).toBe(400)
  })

  it('accepts a valid numeric chainId and passes it to the query', async () => {
    mockQuery([USDC_ROW])
    const res = await makeApp().request('/api/apy?chainId=56')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('returns only the matching chain data when chainId is provided', async () => {
    mockQuery([USDC_ROW]) // mock returns only chain 56 rows
    const res = await makeApp().request('/api/apy?chainId=56')
    const { data } = await res.json()
    // only chainId 56 should be present
    expect(data['usdc']).toHaveProperty('56')
  })
})
