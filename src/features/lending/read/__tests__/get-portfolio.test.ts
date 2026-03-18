import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getPortfolio, portfolioCache } from '../get-portfolio'
import type { PeridotConfig } from '../../../../shared/types'

const config: PeridotConfig = { apiBaseUrl: 'https://app.peridot.finance' }
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const OTHER_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

function makePortfolioResponse(overrides: {
  totalSupplied?: number
  totalBorrowed?: number
  netApy?: number
  totalLifetimeEarnings?: number
} = {}) {
  const totalSupplied = overrides.totalSupplied ?? 10_000
  const totalBorrowed = overrides.totalBorrowed ?? 4_000
  return {
    ok: true,
    data: {
      portfolio: {
        currentValue: totalSupplied - totalBorrowed,
        totalSupplied,
        totalBorrowed,
        netApy: overrides.netApy ?? 3.5,
        healthFactor: totalBorrowed > 0 ? totalSupplied / totalBorrowed : 0,
      },
      assets: [
        { assetId: 'WETH', supplied: 8_000, borrowed: 0, net: 8_000, percentage: 80 },
        { assetId: 'USDC', supplied: 2_000, borrowed: 4_000, net: -2_000, percentage: 20 },
      ],
      transactions: {
        totalCount: 10,
        supplyCount: 4,
        borrowCount: 3,
        repayCount: 2,
        redeemCount: 1,
      },
      earnings: {
        effectiveApy: overrides.netApy ?? 3.5,
        totalLifetimeEarnings: overrides.totalLifetimeEarnings ?? 250,
      },
    },
  }
}

function stubFetch(response = makePortfolioResponse()) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(response),
  })
}

beforeEach(() => {
  portfolioCache.clear()
  vi.stubGlobal('fetch', stubFetch())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

// ── Data mapping ─────────────────────────────────────────────────────────────

describe('data mapping', () => {
  it('maps portfolio summary fields', async () => {
    const result = await getPortfolio({ address: TEST_ADDRESS }, config)
    expect(result.address).toBe(TEST_ADDRESS)
    expect(result.portfolio.totalSupplied).toBe(10_000)
    expect(result.portfolio.totalBorrowed).toBe(4_000)
    expect(result.portfolio.currentValue).toBe(6_000)
    expect(result.portfolio.netApy).toBe(3.5)
  })

  it('computes healthFactor as totalSupplied / totalBorrowed', async () => {
    const result = await getPortfolio({ address: TEST_ADDRESS }, config)
    expect(result.portfolio.healthFactor).toBe(10_000 / 4_000)
  })

  it('sets healthFactor to null when there is no debt', async () => {
    vi.stubGlobal('fetch', stubFetch(makePortfolioResponse({ totalBorrowed: 0 })))
    const result = await getPortfolio({ address: TEST_ADDRESS }, config)
    expect(result.portfolio.healthFactor).toBeNull()
  })

  it('passes assets array through with supplied, borrowed, net, and percentage', async () => {
    const result = await getPortfolio({ address: TEST_ADDRESS }, config)
    expect(result.assets).toHaveLength(2)
    expect(result.assets[0]).toMatchObject({
      assetId: 'WETH',
      supplied: 8_000,
      borrowed: 0,
      net: 8_000,
      percentage: 80,
    })
    expect(result.assets[1]).toMatchObject({
      assetId: 'USDC',
      supplied: 2_000,
      borrowed: 4_000,
      net: -2_000,
      percentage: 20,
    })
  })

  it('includes totalCount in transactions (not present in get_user_position)', async () => {
    const result = await getPortfolio({ address: TEST_ADDRESS }, config)
    expect(result.transactions.totalCount).toBe(10)
    expect(result.transactions.supplyCount).toBe(4)
    expect(result.transactions.borrowCount).toBe(3)
    expect(result.transactions.repayCount).toBe(2)
    expect(result.transactions.redeemCount).toBe(1)
  })

  it('exposes earnings with effectiveApy and totalLifetimeEarnings', async () => {
    vi.stubGlobal('fetch', stubFetch(makePortfolioResponse({ netApy: 5.2, totalLifetimeEarnings: 1_500 })))
    const result = await getPortfolio({ address: TEST_ADDRESS }, config)
    expect(result.earnings.effectiveApy).toBe(5.2)
    expect(result.earnings.totalLifetimeEarnings).toBe(1_500)
  })

  it('returns zero totalLifetimeEarnings for a new wallet with no supply history', async () => {
    vi.stubGlobal('fetch', stubFetch(
      makePortfolioResponse({ totalSupplied: 0, totalBorrowed: 0, totalLifetimeEarnings: 0 }),
    ))
    const result = await getPortfolio({ address: TEST_ADDRESS }, config)
    expect(result.earnings.totalLifetimeEarnings).toBe(0)
    expect(result.portfolio.healthFactor).toBeNull()
  })
})

// ── Thundering herd protection ────────────────────────────────────────────────

describe('thundering herd protection', () => {
  it('coalesces concurrent requests for the same address into a single fetch', async () => {
    let fetchCallCount = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      fetchCallCount++
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(makePortfolioResponse()),
      })
    }))

    const [r1, r2, r3] = await Promise.all([
      getPortfolio({ address: TEST_ADDRESS }, config),
      getPortfolio({ address: TEST_ADDRESS }, config),
      getPortfolio({ address: TEST_ADDRESS }, config),
    ])

    expect(fetchCallCount).toBe(1)
    expect(r1).toEqual(r2)
    expect(r2).toEqual(r3)
  })

  it('caches result so a sequential second call does not refetch', async () => {
    const fetchMock = stubFetch()
    vi.stubGlobal('fetch', fetchMock)

    await getPortfolio({ address: TEST_ADDRESS }, config)
    await getPortfolio({ address: TEST_ADDRESS }, config)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats the same address in different cases as a single cache slot', async () => {
    const fetchMock = stubFetch()
    vi.stubGlobal('fetch', fetchMock)

    await getPortfolio({ address: TEST_ADDRESS }, config)
    // Same address, different casing — should not trigger a second fetch
    await getPortfolio({ address: TEST_ADDRESS.toLowerCase() as `0x${string}`, config } as never, config)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fires separate fetches for different addresses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makePortfolioResponse()),
    })
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([
      getPortfolio({ address: TEST_ADDRESS }, config),
      getPortfolio({ address: OTHER_ADDRESS }, config),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('clears the cache entry on fetch error so the next call retries', async () => {
    // First call: server error
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    }))
    await expect(getPortfolio({ address: TEST_ADDRESS }, config)).rejects.toThrow()

    // Second call: server recovers — should retry, not replay the rejection
    const successFetch = stubFetch()
    vi.stubGlobal('fetch', successFetch)
    const result = await getPortfolio({ address: TEST_ADDRESS }, config)

    expect(result.portfolio.totalSupplied).toBe(10_000)
    expect(successFetch).toHaveBeenCalledTimes(1)
  })

  it('concurrent callers all receive the rejection when the shared fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }))

    const results = await Promise.allSettled([
      getPortfolio({ address: TEST_ADDRESS }, config),
      getPortfolio({ address: TEST_ADDRESS }, config),
    ])

    expect(results[0].status).toBe('rejected')
    expect(results[1].status).toBe('rejected')
  })
})

// ── API interaction ───────────────────────────────────────────────────────────

describe('API interaction', () => {
  it('passes the address as a query parameter', async () => {
    const fetchMock = stubFetch()
    vi.stubGlobal('fetch', fetchMock)
    await getPortfolio({ address: TEST_ADDRESS }, config)
    const calledUrl = (fetchMock.mock.calls[0] as [string])[0]
    expect(calledUrl).toContain(`address=${TEST_ADDRESS}`)
  })

  it('throws when the API returns ok: false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: false, error: 'wallet_not_found' }),
    }))
    await expect(getPortfolio({ address: TEST_ADDRESS }, config)).rejects.toThrow('wallet_not_found')
  })

  it('throws on HTTP error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }))
    await expect(getPortfolio({ address: TEST_ADDRESS }, config)).rejects.toThrow()
  })
})
