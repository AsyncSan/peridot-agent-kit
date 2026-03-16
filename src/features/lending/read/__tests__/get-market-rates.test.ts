import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getMarketRates } from '../get-market-rates'
import type { PeridotConfig } from '../../../../shared/types'

const config: PeridotConfig = { apiBaseUrl: 'https://app.peridot.finance' }

const MOCK_METRICS = {
  ok: true,
  data: {
    'USDC:56': { utilizationPct: 72.5, tvlUsd: 5_000_000, liquidityUnderlying: 100_000, liquidityUsd: 100_000, priceUsd: 1.0, collateral_factor_pct: 80, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
    'WETH:56': { utilizationPct: 55.0, tvlUsd: 10_000_000, liquidityUnderlying: 500, liquidityUsd: 1_500_000, priceUsd: 3000, collateral_factor_pct: 75, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
    'WBTC:56': { utilizationPct: 40.0, tvlUsd: 3_000_000, liquidityUnderlying: 10, liquidityUsd: 500_000, priceUsd: 50000, collateral_factor_pct: 70, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
    'USDC:143': { utilizationPct: 30.0, tvlUsd: 1_000_000, liquidityUnderlying: 50_000, liquidityUsd: 50_000, priceUsd: 1.0, collateral_factor_pct: 80, updatedAt: '2024-01-01T00:00:00Z', chainId: 143 },
  },
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => MOCK_METRICS }))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getMarketRates', () => {
  describe('happy path', () => {
    it('returns all fields for a known asset', async () => {
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

    it('returns correct data for WETH', async () => {
      const result = await getMarketRates({ asset: 'WETH', chainId: 56 }, config)
      expect(result.priceUsd).toBe(3000)
      expect(result.tvlUsd).toBe(10_000_000)
      expect(result.collateralFactorPct).toBe(75)
    })

    it('resolves assets on Monad (chainId 143)', async () => {
      const result = await getMarketRates({ asset: 'USDC', chainId: 143 }, config)
      expect(result.chainId).toBe(143)
      expect(result.tvlUsd).toBe(1_000_000)
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
      let err: Error | null = null
      try {
        await getMarketRates({ asset: 'SHIB', chainId: 56 }, config)
      } catch (e) {
        err = e as Error
      }
      expect(err).not.toBeNull()
      expect(err!.message).toContain('USDC')
      expect(err!.message).toContain('WETH')
    })

    it('throws for a valid asset on a chain it is not listed on', async () => {
      // WBTC is in data for chain 56 but not 143
      await expect(getMarketRates({ asset: 'WBTC', chainId: 143 }, config)).rejects.toThrow()
    })

    it('throws when the API returns ok: false', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: false, error: 'db_unavailable' }),
      }))
      await expect(getMarketRates({ asset: 'USDC', chainId: 56 }, config)).rejects.toThrow('db_unavailable')
    })

    it('throws when the HTTP request fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' }))
      await expect(getMarketRates({ asset: 'USDC', chainId: 56 }, config)).rejects.toThrow('503')
    })
  })
})
