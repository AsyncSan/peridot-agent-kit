import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getMarketRates } from '../get-market-rates'
import type { PeridotConfig } from '../../../../shared/types'

const config: PeridotConfig = { apiBaseUrl: 'https://app.peridot.finance' }

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_METRICS = {
  ok: true,
  data: {
    'USDC:56':  { utilizationPct: 72.5, tvlUsd: 5_000_000, liquidityUnderlying: 100_000, liquidityUsd: 100_000, priceUsd: 1.0,   collateral_factor_pct: 80, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
    'WETH:56':  { utilizationPct: 55.0, tvlUsd: 10_000_000, liquidityUnderlying: 500,    liquidityUsd: 1_500_000, priceUsd: 3000, collateral_factor_pct: 75, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
    'WBTC:56':  { utilizationPct: 40.0, tvlUsd: 3_000_000,  liquidityUnderlying: 10,     liquidityUsd: 500_000,   priceUsd: 50000, collateral_factor_pct: 70, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
    'USDC:143': { utilizationPct: 30.0, tvlUsd: 1_000_000,  liquidityUnderlying: 50_000, liquidityUsd: 50_000,    priceUsd: 1.0,   collateral_factor_pct: 80, updatedAt: '2024-01-01T00:00:00Z', chainId: 143 },
  },
}

const MOCK_APY = {
  ok: true,
  data: {
    usdc: {
      56: {
        supplyApy: 3.21,
        borrowApy: 5.67,
        peridotSupplyApy: 1.10,
        peridotBorrowApy: 0.80,
        boostSourceSupplyApy: 0.50,
        boostRewardsSupplyApy: 0.20,
        totalSupplyApy: 5.01,
        netBorrowApy: 4.87,
        timestamp: '2024-01-01T00:00:00Z',
      },
      143: {
        supplyApy: 1.50,
        borrowApy: 3.00,
        peridotSupplyApy: 0.50,
        peridotBorrowApy: 0.30,
        boostSourceSupplyApy: 0,
        boostRewardsSupplyApy: 0,
        totalSupplyApy: 2.00,
        netBorrowApy: 2.70,
        timestamp: '2024-01-01T00:00:00Z',
      },
    },
    weth: {
      56: {
        supplyApy: 1.80,
        borrowApy: 3.50,
        peridotSupplyApy: 0.60,
        peridotBorrowApy: 0.40,
        boostSourceSupplyApy: 0,
        boostRewardsSupplyApy: 0,
        totalSupplyApy: 2.40,
        netBorrowApy: 3.10,
        timestamp: '2024-01-01T00:00:00Z',
      },
    },
  },
}

// Route fetch calls by URL so both metrics and APY mocks work simultaneously.
function mockFetch(metricsResponse = MOCK_METRICS, apyResponse = MOCK_APY) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/apy')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(apyResponse) })
      }
      // Default: markets/metrics
      return Promise.resolve({ ok: true, json: () => Promise.resolve(metricsResponse) })
    }),
  )
}

beforeEach(() => { mockFetch() })
afterEach(() => { vi.unstubAllGlobals() })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getMarketRates', () => {
  describe('happy path — market metrics fields', () => {
    it('returns all metric fields for a known asset', async () => {
      const result = await getMarketRates({ asset: 'USDC', chainId: 56 }, config)
      expect(result).toMatchObject({
        asset: 'USDC',
        chainId: 56,
        tvlUsd: 5_000_000,
        utilizationPct: 72.5,
        liquidityUsd: 100_000,
        priceUsd: 1.0,
        collateralFactorPct: 80,
        updatedAt: '2024-01-01T00:00:00Z',
      })
    })

    it('returns correct metric data for WETH', async () => {
      const result = await getMarketRates({ asset: 'WETH', chainId: 56 }, config)
      expect(result.priceUsd).toBe(3000)
      expect(result.tvlUsd).toBe(10_000_000)
      expect(result.collateralFactorPct).toBe(75)
    })

    it('defaults collateralFactorPct to 0 when collateral_factor_pct is absent from metric', async () => {
      const metricsNoFactor = {
        ok: true,
        data: {
          'USDC:56': { utilizationPct: 72.5, tvlUsd: 5_000_000, liquidityUnderlying: 100_000, liquidityUsd: 100_000, priceUsd: 1.0, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
        },
      }
      mockFetch(metricsNoFactor as any)
      const result = await getMarketRates({ asset: 'USDC', chainId: 56 }, config)
      expect(result.collateralFactorPct).toBe(0)
    })

    it('resolves assets on Monad (chainId 143)', async () => {
      const result = await getMarketRates({ asset: 'USDC', chainId: 143 }, config)
      expect(result.chainId).toBe(143)
      expect(result.tvlUsd).toBe(1_000_000)
    })
  })

  describe('happy path — APY fields', () => {
    it('returns base supply and borrow APY from /api/apy', async () => {
      const result = await getMarketRates({ asset: 'USDC', chainId: 56 }, config)
      expect(result.supplyApyPct).toBe(3.21)
      expect(result.borrowApyPct).toBe(5.67)
    })

    it('returns PERIDOT reward APY breakdown', async () => {
      const result = await getMarketRates({ asset: 'USDC', chainId: 56 }, config)
      expect(result.peridotSupplyApyPct).toBe(1.10)
      expect(result.peridotBorrowApyPct).toBe(0.80)
    })

    it('returns boost APY breakdown', async () => {
      const result = await getMarketRates({ asset: 'USDC', chainId: 56 }, config)
      expect(result.boostSourceSupplyApyPct).toBe(0.50)
      expect(result.boostRewardsSupplyApyPct).toBe(0.20)
    })

    it('returns totalSupplyApyPct and netBorrowApyPct', async () => {
      const result = await getMarketRates({ asset: 'USDC', chainId: 56 }, config)
      expect(result.totalSupplyApyPct).toBe(5.01)
      expect(result.netBorrowApyPct).toBe(4.87)
    })

    it('returns APY for WETH on BSC', async () => {
      const result = await getMarketRates({ asset: 'WETH', chainId: 56 }, config)
      expect(result.supplyApyPct).toBe(1.80)
      expect(result.totalSupplyApyPct).toBe(2.40)
    })

    it('returns APY on Monad (chainId 143)', async () => {
      const result = await getMarketRates({ asset: 'USDC', chainId: 143 }, config)
      expect(result.supplyApyPct).toBe(1.50)
      expect(result.totalSupplyApyPct).toBe(2.00)
    })

    it('falls back to 0 for all APY fields when asset has no entry in /api/apy', async () => {
      // WBTC has no entry in MOCK_APY
      const result = await getMarketRates({ asset: 'WBTC', chainId: 56 }, config)
      expect(result.supplyApyPct).toBe(0)
      expect(result.borrowApyPct).toBe(0)
      expect(result.totalSupplyApyPct).toBe(0)
      expect(result.netBorrowApyPct).toBe(0)
      // Metrics fields still populated
      expect(result.tvlUsd).toBe(3_000_000)
    })

    it('falls back to 0 when /api/apy returns empty data', async () => {
      mockFetch(MOCK_METRICS, { ok: true, data: {} } as typeof MOCK_APY)
      const result = await getMarketRates({ asset: 'USDC', chainId: 56 }, config)
      expect(result.supplyApyPct).toBe(0)
      expect(result.totalSupplyApyPct).toBe(0)
    })
  })

  describe('parallel fetch behaviour', () => {
    it('calls both /api/markets/metrics and /api/apy', async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/apy')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_APY) })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_METRICS) })
      })
      vi.stubGlobal('fetch', fetchMock)

      await getMarketRates({ asset: 'USDC', chainId: 56 }, config)

      const urls = (fetchMock.mock.calls as [string][]).map(([u]) => u)
      expect(urls.some((u) => u.includes('/api/markets/metrics'))).toBe(true)
      expect(urls.some((u) => u.includes('/api/apy'))).toBe(true)
    })

    it('passes chainId as query param to /api/apy', async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/apy')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_APY) })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_METRICS) })
      })
      vi.stubGlobal('fetch', fetchMock)

      await getMarketRates({ asset: 'USDC', chainId: 56 }, config)

      const apyUrl = (fetchMock.mock.calls as [string][]).map(([u]) => u).find((u) => u.includes('/api/apy'))
      expect(apyUrl).toContain('chainId=56')
    })
  })

  describe('input normalization', () => {
    it('uppercases lowercase asset symbols', async () => {
      const result = await getMarketRates({ asset: 'usdc', chainId: 56 }, config)
      expect(result.asset).toBe('USDC')
    })

    it('uppercases mixed-case asset symbols', async () => {
      const result = await getMarketRates({ asset: 'wEtH', chainId: 56 }, config)
      expect(result.asset).toBe('WETH')
    })
  })

  describe('error cases', () => {
    it('throws with helpful message listing available assets for unknown asset', async () => {
      await expect(getMarketRates({ asset: 'SHIB', chainId: 56 }, config)).rejects.toThrow(
        '"SHIB" on chain 56',
      )
    })

    it('error message lists what IS available on the chain', async () => {
      await expect(getMarketRates({ asset: 'SHIB', chainId: 56 }, config)).rejects.toThrow(/USDC|WETH/)
    })

    it('throws for a valid asset on a chain it is not listed on', async () => {
      await expect(getMarketRates({ asset: 'WBTC', chainId: 143 }, config)).rejects.toThrow()
    })

    it('throws when metrics API returns ok: false', async () => {
      mockFetch({ ok: false, error: 'db_unavailable' } as any, MOCK_APY)
      await expect(getMarketRates({ asset: 'USDC', chainId: 56 }, config)).rejects.toThrow('db_unavailable')
    })

    it('throws when APY API returns ok: false', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if (url.includes('/api/apy')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: false, error: 'apy_unavailable' }) })
          }
          return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_METRICS) })
        }),
      )
      await expect(getMarketRates({ asset: 'USDC', chainId: 56 }, config)).rejects.toThrow('apy_unavailable')
    })

    it('throws when metrics HTTP request fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if (url.includes('/api/apy')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_APY) })
          }
          return Promise.resolve({ ok: false, status: 503, statusText: 'Service Unavailable' })
        }),
      )
      await expect(getMarketRates({ asset: 'USDC', chainId: 56 }, config)).rejects.toThrow('503')
    })

    it('throws when APY HTTP request fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if (url.includes('/api/apy')) {
            return Promise.resolve({ ok: false, status: 502, statusText: 'Bad Gateway' })
          }
          return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_METRICS) })
        }),
      )
      await expect(getMarketRates({ asset: 'USDC', chainId: 56 }, config)).rejects.toThrow('502')
    })
  })
})
