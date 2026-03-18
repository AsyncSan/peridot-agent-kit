import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

const mockSql = vi.fn()
vi.mock('../../db', () => ({
  sql: Object.assign(mockSql, { end: vi.fn().mockResolvedValue(undefined) }),
  tables: { leaderboardUsers: 'leaderboard_users_mainnet' },
}))

vi.mock('../../cache', () => ({
  Cache: class {
    constructor(_ttlMs: number) {}
    async getOrFetch(_key: string, fetcher: () => Promise<unknown>) {
      return fetcher()
    }
  },
}))

const { leaderboardRoute } = await import('../leaderboard')

function makeApp() {
  const app = new Hono()
  app.route('/api/leaderboard', leaderboardRoute)
  app.onError((err, c) => c.json({ ok: false, error: err.message }, 500))
  return app
}

// leaderboard fires 2 queries per request: the main list + COUNT(*)
// Each query has a sql(tableName) identifier call + tagged template
function mockLeaderboard(rows: Record<string, unknown>[], total: number) {
  mockSql
    .mockReturnValueOnce('__id__').mockResolvedValueOnce(rows)             // main query
    .mockReturnValueOnce('__id__').mockResolvedValueOnce([{ total }])      // count query
}

// When chainId is provided the queries also embed chainId as a bind param,
// but the mock shape is identical.
function mockLeaderboardWithChain(rows: Record<string, unknown>[], total: number) {
  mockSql
    .mockReturnValueOnce('__id__').mockResolvedValueOnce(rows)
    .mockReturnValueOnce('__id__').mockResolvedValueOnce([{ total }])
}

const SAMPLE_ROW = {
  wallet_address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  rank: '1',
  total_points: '1500',
  total_supplied_usd: '50000',
  total_borrowed_usd: '20000',
  chain_id: '56',
  updated_at: '2024-03-01T00:00:00.000Z',
}

const SAMPLE_ROW_2 = {
  wallet_address: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  rank: '2',
  total_points: '900',
  total_supplied_usd: '25000',
  total_borrowed_usd: '10000',
  chain_id: '56',
  updated_at: '2024-03-01T00:00:00.000Z',
}

beforeEach(() => { mockSql.mockReset() })

describe('GET /api/leaderboard', () => {
  it('returns 200 with ok: true', async () => {
    mockLeaderboard([SAMPLE_ROW], 1)
    const res = await makeApp().request('/api/leaderboard')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('response data has entries array and total count', async () => {
    mockLeaderboard([SAMPLE_ROW, SAMPLE_ROW_2], 2)
    const res = await makeApp().request('/api/leaderboard')
    const { data } = await res.json()
    expect(Array.isArray(data.entries)).toBe(true)
    expect(typeof data.total).toBe('number')
    expect(data.total).toBe(2)
  })

  it('each entry has all expected fields', async () => {
    mockLeaderboard([SAMPLE_ROW], 1)
    const res = await makeApp().request('/api/leaderboard')
    const { data: { entries } } = await res.json()
    const e = entries[0]
    expect(typeof e.rank).toBe('number')
    expect(typeof e.address).toBe('string')
    expect(typeof e.totalSuppliedUsd).toBe('number')
    expect(typeof e.totalBorrowedUsd).toBe('number')
    expect(typeof e.netWorthUsd).toBe('number')
    expect(typeof e.totalPoints).toBe('number')
    expect(typeof e.updatedAt).toBe('string')
  })

  it('maps wallet_address to address field', async () => {
    mockLeaderboard([SAMPLE_ROW], 1)
    const res = await makeApp().request('/api/leaderboard')
    const { data: { entries } } = await res.json()
    expect(entries[0].address).toBe(SAMPLE_ROW.wallet_address)
  })

  it('coerces rank and numeric fields from strings', async () => {
    mockLeaderboard([SAMPLE_ROW], 1)
    const res = await makeApp().request('/api/leaderboard')
    const { data: { entries } } = await res.json()
    const e = entries[0]
    expect(e.rank).toBe(1)
    expect(e.totalSuppliedUsd).toBe(50000)
    expect(e.totalBorrowedUsd).toBe(20000)
    expect(e.totalPoints).toBe(1500)
  })

  it('computes netWorthUsd as supplied - borrowed', async () => {
    mockLeaderboard([SAMPLE_ROW], 1)
    const res = await makeApp().request('/api/leaderboard')
    const { data: { entries } } = await res.json()
    expect(entries[0].netWorthUsd).toBe(30000)
  })

  it('updatedAt is a valid ISO-8601 string', async () => {
    mockLeaderboard([SAMPLE_ROW], 1)
    const res = await makeApp().request('/api/leaderboard')
    const { data: { entries } } = await res.json()
    const { updatedAt } = entries[0]
    expect(new Date(updatedAt).toISOString()).toBe(updatedAt)
  })

  it('returns empty entries array when table has no rows', async () => {
    mockLeaderboard([], 0)
    const res = await makeApp().request('/api/leaderboard')
    const { data } = await res.json()
    expect(data.entries).toHaveLength(0)
    expect(data.total).toBe(0)
  })

  it('sets public Cache-Control header', async () => {
    mockLeaderboard([SAMPLE_ROW], 1)
    const res = await makeApp().request('/api/leaderboard')
    const cc = res.headers.get('cache-control')
    expect(cc).toContain('public')
    expect(cc).toContain('s-maxage=60')
  })

  it('returns 500 when DB throws', async () => {
    mockSql
      .mockReturnValueOnce('__id__').mockRejectedValueOnce(new Error('DB down'))
      .mockReturnValueOnce('__id__').mockResolvedValueOnce([{ total: 0 }])
    const res = await makeApp().request('/api/leaderboard')
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })
})

describe('GET /api/leaderboard — query params', () => {
  it('accepts valid numeric limit', async () => {
    mockLeaderboard([SAMPLE_ROW], 1)
    const res = await makeApp().request('/api/leaderboard?limit=10')
    expect(res.status).toBe(200)
  })

  it('caps limit at 100', async () => {
    // We verify no 400 is thrown — the route clamps the value internally
    mockLeaderboard([SAMPLE_ROW], 1)
    const res = await makeApp().request('/api/leaderboard?limit=500')
    expect(res.status).toBe(200)
  })

  it('returns 400 for non-numeric limit', async () => {
    const res = await makeApp().request('/api/leaderboard?limit=abc')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('accepts valid chainId filter', async () => {
    mockLeaderboardWithChain([SAMPLE_ROW], 1)
    const res = await makeApp().request('/api/leaderboard?chainId=56')
    expect(res.status).toBe(200)
  })

  it('returns 400 for non-numeric chainId', async () => {
    const res = await makeApp().request('/api/leaderboard?chainId=bsc')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 for negative chainId', async () => {
    const res = await makeApp().request('/api/leaderboard?chainId=-5')
    expect(res.status).toBe(400)
  })
})
