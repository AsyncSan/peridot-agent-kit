import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { listMarkets } from '../list-markets'
import type { PeridotConfig } from '../../../../shared/types'

const config: PeridotConfig = { apiBaseUrl: 'https://app.peridot.finance' }

const MOCK_METRICS = {
  ok: true,
  data: {
    'USDC:56':  { utilizationPct: 72.5, tvlUsd: 5_000_000, liquidityUnderlying: 100_000, liquidityUsd: 100_000, priceUsd: 1.0,  collateral_factor_pct: 80, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
    'WETH:56':  { utilizationPct: 55.0, tvlUsd: 10_000_000, liquidityUnderlying: 500, liquidityUsd: 1_500_000, priceUsd: 3000, collateral_factor_pct: 75, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
    'USDC:143': { utilizationPct: 40.0, tvlUsd: 500_000,    liquidityUnderlying: 10_000, liquidityUsd: 10_000, priceUsd: 1.0,  collateral_factor_pct: 80, updatedAt: '2024-01-01T00:00:00Z', chainId: 143 },
  },
}

function makeFetch(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) })
}

beforeEach(() => { vi.stubGlobal('fetch', makeFetch(MOCK_METRICS)) })
afterEach(() => { vi.unstubAllGlobals() })

describe('listMarkets', () => {
  it('returns all markets when no chainId filter', async () => {
    const result = await listMarkets({}, config)
    expect(result.count).toBe(3)
    expect(result.markets).toHaveLength(3)
  })

  it('filters by chainId', async () => {
    const result = await listMarkets({ chainId: 56 }, config)
    expect(result.count).toBe(2)
    expect(result.markets.every((m) => m.chainId === 56)).toBe(true)
  })

  it('returns empty list for chainId with no markets', async () => {
    const result = await listMarkets({ chainId: 1868 }, config)
    expect(result.count).toBe(0)
    expect(result.markets).toHaveLength(0)
  })

  it('sorts by TVL descending', async () => {
    const result = await listMarkets({ chainId: 56 }, config)
    expect(result.markets[0]!.tvlUsd).toBeGreaterThanOrEqual(result.markets[1]!.tvlUsd)
  })

  it('includes all expected fields on each market', async () => {
    const result = await listMarkets({}, config)
    const market = result.markets[0]!
    expect(typeof market.asset).toBe('string')
    expect(typeof market.chainId).toBe('number')
    expect(typeof market.priceUsd).toBe('number')
    expect(typeof market.tvlUsd).toBe('number')
    expect(typeof market.utilizationPct).toBe('number')
    expect(typeof market.liquidityUsd).toBe('number')
    expect(typeof market.collateralFactorPct).toBe('number')
    expect(typeof market.updatedAt).toBe('string')
  })

  it('parses asset name correctly from metric key', async () => {
    const result = await listMarkets({ chainId: 56 }, config)
    const assets = result.markets.map((m) => m.asset)
    expect(assets).toContain('USDC')
    expect(assets).toContain('WETH')
  })

  it('throws when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable', json: () => Promise.resolve({}) }))
    await expect(listMarkets({}, config)).rejects.toThrow('503')
  })

  it('throws when API returns ok: false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: false, error: 'db_down' }) }))
    await expect(listMarkets({}, config)).rejects.toThrow('db_down')
  })

  it('returns empty list when metrics data is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true, data: {} }) }))
    const result = await listMarkets({}, config)
    expect(result.count).toBe(0)
    expect(result.markets).toHaveLength(0)
  })
})
