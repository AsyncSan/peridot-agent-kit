import { describe, it, expect, vi, afterEach } from 'vitest'
import { simulateBorrow } from '../simulate-borrow'
import type { PeridotConfig } from '../../../../shared/types'

const config: PeridotConfig = { apiBaseUrl: 'https://app.peridot.finance' }
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

const METRICS = {
  ok: true,
  data: {
    'USDC:56': { priceUsd: 1.0, utilizationPct: 70, tvlUsd: 5_000_000, liquidityUnderlying: 100_000, liquidityUsd: 100_000, collateral_factor_pct: 80, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
    'WETH:56': { priceUsd: 3000, utilizationPct: 55, tvlUsd: 10_000_000, liquidityUnderlying: 500, liquidityUsd: 1_500_000, collateral_factor_pct: 75, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
  },
}

function makePortfolio(totalSupplied: number, totalBorrowed: number) {
  return {
    success: true,
    data: {
      portfolio: {
        currentValue: totalSupplied - totalBorrowed,
        totalSupplied,
        totalBorrowed,
        netApy: 2.5,
        healthFactor: totalBorrowed > 0 ? totalSupplied / totalBorrowed : 0,
      },
      assets: [],
      transactions: { totalCount: 0, supplyCount: 0, borrowCount: 0, repayCount: 0, redeemCount: 0 },
      earnings: { effectiveApy: 2.5, totalLifetimeEarnings: 0 },
    },
  }
}

function setupMocks(totalSupplied: number, totalBorrowed: number) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if ((url).includes('/api/markets/metrics')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(METRICS) })
    }
    if ((url).includes('/api/user/portfolio-data')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makePortfolio(totalSupplied, totalBorrowed)) })
    }
    return Promise.resolve({ ok: false, status: 404 })
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('simulateBorrow — risk levels', () => {
  it('classifies as SAFE: projected HF ≥ 2.0', async () => {
    setupMocks(10_000, 0) // no existing debt
    // Borrow $3000 USDC with $10k collateral → HF = 10000/3000 = 3.33
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '3000', chainId: 56 }, config)
    expect(result.riskLevel).toBe('safe')
    expect(result.isSafe).toBe(true)
    expect(result.projectedHealthFactor).toBeCloseTo(10000 / 3000, 4)
  })

  it('classifies as MODERATE: 1.5 ≤ projected HF < 2.0', async () => {
    setupMocks(10_000, 3_000) // existing $3k borrow
    // Borrow $2000 more → totalBorrow = $5000, HF = 10000/5000 = 2.0 (boundary)
    // Borrow $2500 more → totalBorrow = $5500, HF = 10000/5500 = 1.82
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '2500', chainId: 56 }, config)
    expect(result.projectedHealthFactor).toBeCloseTo(10000 / 5500, 4)
    expect(result.riskLevel).toBe('moderate')
    // isSafe threshold is HF >= 1.2 (the "high" threshold) — moderate is still above this
    expect(result.isSafe).toBe(true)
  })

  it('classifies as HIGH: 1.2 ≤ projected HF < 1.5', async () => {
    setupMocks(10_000, 6_000)
    // Borrow $1500 more → totalBorrow = $7500, HF = 10000/7500 = 1.33
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '1500', chainId: 56 }, config)
    expect(result.projectedHealthFactor).toBeCloseTo(10000 / 7500, 4)
    expect(result.riskLevel).toBe('high')
    // isSafe = projectedHF >= 1.2; HF=1.33 is above this threshold
    expect(result.isSafe).toBe(true)
    expect(result.warning).toBeDefined()
  })

  it('classifies as CRITICAL: 1.0 ≤ projected HF < 1.2', async () => {
    setupMocks(10_000, 8_000)
    // Borrow $500 more → totalBorrow = $8500, HF = 10000/8500 = 1.18
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '500', chainId: 56 }, config)
    expect(result.projectedHealthFactor).toBeCloseTo(10000 / 8500, 4)
    expect(result.riskLevel).toBe('critical')
    expect(result.warning).toContain('critically low')
  })

  it('classifies as LIQUIDATABLE: projected HF < 1.0', async () => {
    setupMocks(10_000, 9_500)
    // Borrow $1000 more → totalBorrow = $10500, HF = 10000/10500 = 0.95
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '1000', chainId: 56 }, config)
    expect(result.projectedHealthFactor).toBeLessThan(1.0)
    expect(result.riskLevel).toBe('liquidatable')
    expect(result.isSafe).toBe(false)
    expect(result.warning).toContain('liquidation')
  })
})

describe('simulateBorrow — health factor calculations', () => {
  it('currentHealthFactor is null when there is no existing debt', async () => {
    setupMocks(10_000, 0)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '1000', chainId: 56 }, config)
    expect(result.currentHealthFactor).toBeNull()
  })

  it('computes currentHealthFactor as supply / borrow', async () => {
    setupMocks(10_000, 4_000)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '100', chainId: 56 }, config)
    expect(result.currentHealthFactor).toBeCloseTo(10000 / 4000, 4)
  })

  it('accounts for asset price in borrowAmountUsd', async () => {
    setupMocks(100_000, 0)
    // Borrow 1 WETH at $3000 = $3000 USD borrow
    const result = await simulateBorrow({ address: ADDRESS, asset: 'WETH', amount: '1', chainId: 56 }, config)
    expect(result.borrowAmountUsd).toBe(3000)
    expect(result.projectedHealthFactor).toBeCloseTo(100_000 / 3_000, 4)
  })

  it('handles fractional amounts correctly', async () => {
    setupMocks(10_000, 0)
    // Borrow 0.5 WETH at $3000 = $1500 USD
    const result = await simulateBorrow({ address: ADDRESS, asset: 'WETH', amount: '0.5', chainId: 56 }, config)
    expect(result.borrowAmountUsd).toBeCloseTo(1500, 2)
  })
})

describe('simulateBorrow — maxSafeBorrowUsd', () => {
  it('calculates maxSafeBorrowUsd to keep HF at 2.0 (safe threshold)', async () => {
    setupMocks(10_000, 0)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '100', chainId: 56 }, config)
    // maxSafe = totalSupplied / 2.0 - totalBorrowed = 10000/2 - 0 = 5000
    expect(result.maxSafeBorrowUsd).toBeCloseTo(5000, 2)
  })

  it('reduces maxSafeBorrowUsd when there is existing debt', async () => {
    setupMocks(10_000, 3_000)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '100', chainId: 56 }, config)
    // maxSafe = 10000/2 - 3000 = 2000
    expect(result.maxSafeBorrowUsd).toBeCloseTo(2000, 2)
  })

  it('returns 0 maxSafeBorrowUsd when already above the safe threshold', async () => {
    setupMocks(10_000, 6_000) // HF already = 1.67, below safe threshold
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '10', chainId: 56 }, config)
    expect(result.maxSafeBorrowUsd).toBe(0)
  })
})

describe('simulateBorrow — edge and error cases', () => {
  it('returns liquidatable with warning when no collateral supplied', async () => {
    setupMocks(0, 0)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '100', chainId: 56 }, config)
    expect(result.riskLevel).toBe('liquidatable')
    expect(result.warning).toContain('No collateral')
  })

  it('throws for an invalid (non-numeric) amount', async () => {
    setupMocks(10_000, 0)
    await expect(
      simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: 'lots', chainId: 56 }, config),
    ).rejects.toThrow('Invalid borrow amount')
  })

  it('throws for a zero amount', async () => {
    setupMocks(10_000, 0)
    await expect(
      simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '0', chainId: 56 }, config),
    ).rejects.toThrow('Invalid borrow amount')
  })

  it('throws for an unknown asset', async () => {
    setupMocks(10_000, 0)
    await expect(
      simulateBorrow({ address: ADDRESS, asset: 'FAKECOIN', amount: '100', chainId: 56 }, config),
    ).rejects.toThrow()
  })
})
