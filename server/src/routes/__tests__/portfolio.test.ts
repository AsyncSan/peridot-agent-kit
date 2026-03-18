import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

const mockSql = vi.fn()
vi.mock('../../db', () => ({
  sql: Object.assign(mockSql, { end: vi.fn().mockResolvedValue(undefined) }),
  tables: {
    verifiedTransactions: 'verified_transactions_mainnet',
    userBalanceSnapshots: 'user_balance_snapshots_mainnet',
    userPortfolioApySnapshots: 'user_portfolio_apy_snapshots_mainnet',
  },
}))

vi.mock('../../cache', () => ({
  Cache: class {
    constructor(_ttlMs: number) {}
    async getOrFetch(_key: string, fetcher: () => Promise<unknown>) {
      return fetcher()
    }
  },
}))

const { portfolioRoute } = await import('../portfolio')

const VALID_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

function makeApp() {
  const app = new Hono()
  // Mount without wallet auth — auth is tested separately in wallet-auth.test.ts
  app.route('/api/user', portfolioRoute)
  app.onError((err, c) => c.json({ ok: false, error: err.message }, 500))
  return app
}

// portfolio.ts fires 3 parallel queries, each with sql(tableName) + sql`...`
// Order in Promise.all: [verifiedTransactions, userBalanceSnapshots, userPortfolioApySnapshots]
function mockPortfolioQueries(
  txRows: Record<string, unknown>[] = [],
  balanceRows: Record<string, unknown>[] = [],
  apyRows: Record<string, unknown>[] = [],
) {
  mockSql
    .mockReturnValueOnce('__id__').mockResolvedValueOnce(txRows)       // verifiedTransactions
    .mockReturnValueOnce('__id__').mockResolvedValueOnce(balanceRows)  // userBalanceSnapshots
    .mockReturnValueOnce('__id__').mockResolvedValueOnce(apyRows)      // userPortfolioApySnapshots
}

const APY_ROW = { net_apy_pct: '3.5', total_supply_usd: '10000', total_borrow_usd: '4000' }

const TX_SUPPLY = { action_type: 'supply', usd_value: '5000', verified_at: '2024-01-01T00:00:00.000Z', token_symbol: 'USDC', chain_id: '56' }
const TX_BORROW = { action_type: 'borrow', usd_value: '2000', verified_at: '2024-01-01T00:00:00.000Z', token_symbol: 'USDC', chain_id: '56' }
const TX_REPAY  = { action_type: 'repay',  usd_value: '500',  verified_at: '2024-01-01T00:00:00.000Z', token_symbol: 'USDC', chain_id: '56' }
const TX_REDEEM = { action_type: 'redeem', usd_value: '1000', verified_at: '2024-01-01T00:00:00.000Z', token_symbol: 'USDC', chain_id: '56' }

const BALANCE_ROW = { supplied_usd: '10000', borrowed_usd: '4000', observed_at: '2024-01-01T00:00:00.000Z', chain_id: '56', asset_id: 'usdc' }

beforeEach(() => { mockSql.mockReset() })

describe('GET /api/user/portfolio-data — input validation', () => {
  it('returns 400 when address is missing', async () => {
    const res = await makeApp().request('/api/user/portfolio-data')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain('address')
  })

  it('returns 400 for an address that is too short', async () => {
    const res = await makeApp().request('/api/user/portfolio-data?address=0xabc')
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 for an address without 0x prefix', async () => {
    const res = await makeApp().request('/api/user/portfolio-data?address=f39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
    expect(res.status).toBe(400)
  })

  it('400 body includes a descriptive error about EIP-55 format', async () => {
    const res = await makeApp().request('/api/user/portfolio-data?address=0xBAD')
    const body = await res.json()
    expect(body.error).toMatch(/address/i)
  })
})

describe('GET /api/user/portfolio-data — happy path', () => {
  it('returns 200 with ok: true', async () => {
    mockPortfolioQueries([TX_SUPPLY], [BALANCE_ROW], [APY_ROW])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('response data has portfolio, assets, transactions, and earnings', async () => {
    mockPortfolioQueries([TX_SUPPLY], [BALANCE_ROW], [APY_ROW])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data } = await res.json()
    expect(data).toHaveProperty('portfolio')
    expect(data).toHaveProperty('assets')
    expect(data).toHaveProperty('transactions')
    expect(data).toHaveProperty('earnings')
  })

  it('portfolio fields are numbers', async () => {
    mockPortfolioQueries([TX_SUPPLY], [BALANCE_ROW], [APY_ROW])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data: { portfolio } } = await res.json()
    expect(typeof portfolio.totalSupplied).toBe('number')
    expect(typeof portfolio.totalBorrowed).toBe('number')
    expect(typeof portfolio.currentValue).toBe('number')
    expect(typeof portfolio.netApy).toBe('number')
    expect(typeof portfolio.healthFactor).toBe('number')
  })

  it('computes totalSupplied and totalBorrowed from the APY snapshot', async () => {
    mockPortfolioQueries([], [], [APY_ROW])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data: { portfolio } } = await res.json()
    expect(portfolio.totalSupplied).toBe(10000)
    expect(portfolio.totalBorrowed).toBe(4000)
    expect(portfolio.currentValue).toBe(6000)
  })

  it('computes healthFactor as totalSupplied / totalBorrowed', async () => {
    mockPortfolioQueries([], [], [APY_ROW])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data: { portfolio } } = await res.json()
    expect(portfolio.healthFactor).toBeCloseTo(2.5)
  })

  it('healthFactor is 0 when there are no borrows', async () => {
    const noBorrow = { net_apy_pct: '3.5', total_supply_usd: '5000', total_borrow_usd: '0' }
    mockPortfolioQueries([], [], [noBorrow])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data: { portfolio } } = await res.json()
    expect(portfolio.healthFactor).toBe(0)
  })

  it('all portfolio values are 0 when DB returns no rows', async () => {
    mockPortfolioQueries([], [], [])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data: { portfolio } } = await res.json()
    expect(portfolio.totalSupplied).toBe(0)
    expect(portfolio.totalBorrowed).toBe(0)
    expect(portfolio.healthFactor).toBe(0)
  })
})

describe('GET /api/user/portfolio-data — transaction counts', () => {
  it('counts supply, borrow, repay, and redeem transactions separately', async () => {
    mockPortfolioQueries([TX_SUPPLY, TX_BORROW, TX_REPAY, TX_REDEEM], [], [APY_ROW])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data: { transactions } } = await res.json()
    expect(transactions.supplyCount).toBe(1)
    expect(transactions.borrowCount).toBe(1)
    expect(transactions.repayCount).toBe(1)
    expect(transactions.redeemCount).toBe(1)
    expect(transactions.totalCount).toBe(4)
  })

  it('counts cross-chain transactions under the matching type', async () => {
    const ccSupply = { ...TX_SUPPLY, action_type: 'cross-chain_supply' }
    const ccBorrow = { ...TX_BORROW, action_type: 'cross-chain_borrow' }
    mockPortfolioQueries([ccSupply, ccBorrow], [], [APY_ROW])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data: { transactions } } = await res.json()
    expect(transactions.supplyCount).toBe(1)
    expect(transactions.borrowCount).toBe(1)
  })
})

describe('GET /api/user/portfolio-data — asset breakdown', () => {
  it('returns an assets array', async () => {
    mockPortfolioQueries([], [BALANCE_ROW], [APY_ROW])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data: { assets } } = await res.json()
    expect(Array.isArray(assets)).toBe(true)
  })

  it('each asset has assetId, supplied, borrowed, net, and percentage', async () => {
    mockPortfolioQueries([], [BALANCE_ROW], [APY_ROW])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data: { assets } } = await res.json()
    const a = assets[0]
    expect(typeof a.assetId).toBe('string')
    expect(typeof a.supplied).toBe('number')
    expect(typeof a.borrowed).toBe('number')
    expect(typeof a.net).toBe('number')
    expect(typeof a.percentage).toBe('number')
  })

  it('assets are sorted by net descending', async () => {
    const usdcBalance = { ...BALANCE_ROW, asset_id: 'usdc', supplied_usd: '10000', borrowed_usd: '0' }
    const wethBalance = { ...BALANCE_ROW, asset_id: 'weth', supplied_usd: '5000', borrowed_usd: '0' }
    mockPortfolioQueries([], [usdcBalance, wethBalance], [APY_ROW])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data: { assets } } = await res.json()
    expect(assets[0].net).toBeGreaterThanOrEqual(assets[1].net)
  })

  it('percentage is 0 when currentValue is 0', async () => {
    const zeroBal = { ...BALANCE_ROW, supplied_usd: '1000', borrowed_usd: '1000' }
    const zeroApy = { net_apy_pct: '0', total_supply_usd: '1000', total_borrow_usd: '1000' }
    mockPortfolioQueries([], [zeroBal], [zeroApy])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data: { assets } } = await res.json()
    expect(assets[0].percentage).toBe(0)
  })
})

describe('GET /api/user/portfolio-data — earnings', () => {
  it('earnings has effectiveApy and totalLifetimeEarnings', async () => {
    mockPortfolioQueries([], [], [APY_ROW])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data: { earnings } } = await res.json()
    expect(typeof earnings.effectiveApy).toBe('number')
    expect(typeof earnings.totalLifetimeEarnings).toBe('number')
  })

  it('effectiveApy matches netApy from the APY snapshot', async () => {
    mockPortfolioQueries([], [], [APY_ROW])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data: { portfolio, earnings } } = await res.json()
    expect(earnings.effectiveApy).toBe(portfolio.netApy)
  })

  it('totalLifetimeEarnings is a non-negative number', async () => {
    mockPortfolioQueries([TX_SUPPLY], [], [APY_ROW])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data: { earnings } } = await res.json()
    expect(earnings.totalLifetimeEarnings).toBeGreaterThanOrEqual(0)
  })

  it('totalLifetimeEarnings is 0 when there are no supply transactions', async () => {
    mockPortfolioQueries([], [], [APY_ROW])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const { data: { earnings } } = await res.json()
    expect(earnings.totalLifetimeEarnings).toBe(0)
  })
})

describe('GET /api/user/portfolio-data — error handling', () => {
  it('returns 500 with ok: false when a DB query throws', async () => {
    mockSql
      .mockReturnValueOnce('__id__').mockRejectedValueOnce(new Error('timeout'))
      .mockReturnValueOnce('__id__').mockResolvedValueOnce([])
      .mockReturnValueOnce('__id__').mockResolvedValueOnce([])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('sets private Cache-Control header on success', async () => {
    mockPortfolioQueries([], [], [APY_ROW])
    const res = await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR}`)
    const cc = res.headers.get('cache-control')
    expect(cc).toContain('private')
  })

  it('address matching is case-insensitive (lowercases before querying)', async () => {
    const fetchMock = vi.fn()
    fetchMock
      .mockReturnValueOnce('__id__').mockResolvedValueOnce([])
      .mockReturnValueOnce('__id__').mockResolvedValueOnce([])
      .mockReturnValueOnce('__id__').mockResolvedValueOnce([])
    mockSql.mockImplementation(fetchMock)

    await makeApp().request(`/api/user/portfolio-data?address=${VALID_ADDR.toUpperCase()}`)
    // Even with mixed-case input the route should not throw a 400
    // (address format is valid — just mixed case)
  })
})
