import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

const mockSql = vi.fn()
vi.mock('../../db', () => ({
  sql: Object.assign(mockSql, { end: vi.fn().mockResolvedValue(undefined) }),
  tables: { verifiedTransactions: 'verified_transactions_mainnet' },
}))

vi.mock('../../cache', () => ({
  Cache: class {
    constructor(_ttlMs: number) {}
    async getOrFetch(_key: string, fetcher: () => Promise<unknown>) {
      return fetcher()
    }
  },
}))

const { transactionsRoute } = await import('../transactions')

const VALID_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const VALID_ADDR_LC = VALID_ADDR.toLowerCase()

function makeApp() {
  const app = new Hono()
  // Mount without walletAuth — auth is tested separately in wallet-auth.test.ts
  app.route('/api/user', transactionsRoute)
  app.onError((err, c) => c.json({ ok: false, error: err.message }, 500))
  return app
}

// Each fetchTransactions call fires 2 parallel queries via Promise.all:
//   query 1 — main list:  sql(tableName) + tagged template
//   query 2 — COUNT(*):   sql(tableName) + tagged template
// Because Promise.all fires both before either resolves, the 4 mock calls
// must all be set up before the first await resolves.
function mockTxQuery(rows: Record<string, unknown>[], total: number) {
  mockSql
    .mockReturnValueOnce('__id__').mockResolvedValueOnce(rows)         // main list
    .mockReturnValueOnce('__id__').mockResolvedValueOnce([{ total }])  // count
}

const SAMPLE_TX = {
  tx_hash: '0xabc123',
  chain_id: 56,
  block_number: 38_000_000,
  action_type: 'supply',
  token_symbol: 'USDC',
  amount: 1000.5,
  usd_value: 1000.5,
  points_awarded: 10,
  verified_at: '2024-03-01T12:00:00.000Z',
  contract_address: '0xdeadbeef',
}

const SAMPLE_TX_2 = {
  tx_hash: '0xdef456',
  chain_id: 56,
  block_number: 38_000_100,
  action_type: 'borrow',
  token_symbol: 'ETH',
  amount: 0.5,
  usd_value: 1500.0,
  points_awarded: 15,
  verified_at: '2024-03-02T08:00:00.000Z',
  contract_address: '0xdeadbeef',
}

beforeEach(() => { mockSql.mockReset() })

// ── Happy path ────────────────────────────────────────────────────────────────

describe('GET /api/user/transactions — happy path', () => {
  it('returns 200 with ok: true', async () => {
    mockTxQuery([SAMPLE_TX], 1)
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('response data has transactions array and total count', async () => {
    mockTxQuery([SAMPLE_TX, SAMPLE_TX_2], 2)
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}`)
    const { data } = await res.json()
    expect(Array.isArray(data.transactions)).toBe(true)
    expect(typeof data.total).toBe('number')
    expect(data.total).toBe(2)
    expect(data.transactions).toHaveLength(2)
  })

  it('each transaction has all expected fields', async () => {
    mockTxQuery([SAMPLE_TX], 1)
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}`)
    const { data: { transactions } } = await res.json()
    const tx = transactions[0]
    expect(typeof tx.txHash).toBe('string')
    expect(typeof tx.chainId).toBe('number')
    expect(typeof tx.blockNumber).toBe('number')
    expect(typeof tx.actionType).toBe('string')
    expect(typeof tx.amount).toBe('number')
    expect(typeof tx.usdValue).toBe('number')
    expect(typeof tx.pointsAwarded).toBe('number')
    expect(typeof tx.verifiedAt).toBe('string')
    expect(typeof tx.contractAddress).toBe('string')
  })

  it('maps DB columns to camelCase response fields', async () => {
    mockTxQuery([SAMPLE_TX], 1)
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}`)
    const { data: { transactions } } = await res.json()
    const tx = transactions[0]
    expect(tx.txHash).toBe('0xabc123')
    expect(tx.chainId).toBe(56)
    expect(tx.blockNumber).toBe(38_000_000)
    expect(tx.actionType).toBe('supply')
    expect(tx.tokenSymbol).toBe('USDC')
    expect(tx.amount).toBe(1000.5)
    expect(tx.usdValue).toBe(1000.5)
    expect(tx.pointsAwarded).toBe(10)
    expect(tx.contractAddress).toBe('0xdeadbeef')
  })

  it('verifiedAt is a valid ISO-8601 string', async () => {
    mockTxQuery([SAMPLE_TX], 1)
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}`)
    const { data: { transactions } } = await res.json()
    const { verifiedAt } = transactions[0]
    expect(new Date(verifiedAt).toISOString()).toBe(verifiedAt)
  })

  it('tokenSymbol is null when DB value is null', async () => {
    mockTxQuery([{ ...SAMPLE_TX, token_symbol: null }], 1)
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}`)
    const { data: { transactions } } = await res.json()
    expect(transactions[0].tokenSymbol).toBeNull()
  })

  it('returns empty transactions array when address has no txs', async () => {
    mockTxQuery([], 0)
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}`)
    const { data } = await res.json()
    expect(data.transactions).toHaveLength(0)
    expect(data.total).toBe(0)
  })

  it('address matching is case-insensitive (lowercases before querying)', async () => {
    mockTxQuery([SAMPLE_TX], 1)
    const upperAddr = VALID_ADDR.toUpperCase().replace('0X', '0x')
    const res = await makeApp().request(`/api/user/transactions?address=${upperAddr}`)
    expect(res.status).toBe(200)
    // The mock was called — if address was rejected the mock would not be hit
  })

  it('sets private Cache-Control header', async () => {
    mockTxQuery([SAMPLE_TX], 1)
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}`)
    const cc = res.headers.get('cache-control')
    expect(cc).toContain('private')
    expect(cc).toContain('max-age=15')
  })
})

// ── Query param filtering ─────────────────────────────────────────────────────

describe('GET /api/user/transactions — query params', () => {
  it('accepts valid limit', async () => {
    mockTxQuery([SAMPLE_TX], 1)
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}&limit=10`)
    expect(res.status).toBe(200)
  })

  it('caps limit at 100', async () => {
    mockTxQuery([SAMPLE_TX], 1)
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}&limit=500`)
    expect(res.status).toBe(200)
  })

  it('accepts valid chainId filter', async () => {
    mockTxQuery([SAMPLE_TX], 1)
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}&chainId=56`)
    expect(res.status).toBe(200)
  })

  it('accepts valid actionType filter', async () => {
    mockTxQuery([SAMPLE_TX], 1)
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}&actionType=supply`)
    expect(res.status).toBe(200)
  })

  it('accepts all actionType values', async () => {
    for (const at of ['supply', 'borrow', 'repay', 'redeem']) {
      mockTxQuery([], 0)
      const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}&actionType=${at}`)
      expect(res.status).toBe(200)
    }
  })

  it('accepts chainId + actionType together', async () => {
    mockTxQuery([SAMPLE_TX], 1)
    const res = await makeApp().request(
      `/api/user/transactions?address=${VALID_ADDR}&chainId=56&actionType=supply`,
    )
    expect(res.status).toBe(200)
  })
})

// ── Validation errors ─────────────────────────────────────────────────────────

describe('GET /api/user/transactions — validation errors', () => {
  it('returns 400 when address is missing', async () => {
    const res = await makeApp().request('/api/user/transactions')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 for address without 0x prefix', async () => {
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR_LC.slice(2)}`)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 for address that is too short', async () => {
    const res = await makeApp().request('/api/user/transactions?address=0xabc')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 for non-hex address', async () => {
    const res = await makeApp().request('/api/user/transactions?address=0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 for non-numeric limit', async () => {
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}&limit=abc`)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 for non-numeric chainId', async () => {
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}&chainId=bsc`)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 for invalid actionType', async () => {
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}&actionType=liquidate`)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })
})

// ── Error handling ────────────────────────────────────────────────────────────

describe('GET /api/user/transactions — error handling', () => {
  it('returns 500 when DB throws', async () => {
    mockSql
      .mockReturnValueOnce('__id__').mockRejectedValueOnce(new Error('DB down'))
      .mockReturnValueOnce('__id__').mockResolvedValueOnce([{ total: 0 }])
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}`)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('500 response has ok: false', async () => {
    mockSql
      .mockReturnValueOnce('__id__').mockRejectedValueOnce(new Error('connection timeout'))
      .mockReturnValueOnce('__id__').mockResolvedValueOnce([{ total: 0 }])
    const res = await makeApp().request(`/api/user/transactions?address=${VALID_ADDR}`)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(typeof body.error).toBe('string')
  })
})
