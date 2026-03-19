import { describe, it, expect, vi, afterEach } from 'vitest'
import { simulateBorrow } from '../simulate-borrow'
import type { PeridotConfig } from '../../../../shared/types'

vi.mock('../../../../shared/on-chain-position', () => ({
  readOnChainPosition: vi.fn(),
}))

import { readOnChainPosition } from '../../../../shared/on-chain-position'

const config: PeridotConfig = { apiBaseUrl: 'https://app.peridot.finance' }
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

const METRICS = {
  ok: true,
  data: {
    'USDC:56': { priceUsd: 1.0, utilizationPct: 70, tvlUsd: 5_000_000, liquidityUnderlying: 100_000, liquidityUsd: 100_000, collateral_factor_pct: 80, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
    'WETH:56': { priceUsd: 3000, utilizationPct: 55, tvlUsd: 10_000_000, liquidityUnderlying: 500, liquidityUsd: 1_500_000, collateral_factor_pct: 75, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
  },
}

function setupMocks(totalSupplied: number, totalBorrowed: number) {
  vi.mocked(readOnChainPosition).mockResolvedValue({
    totalSuppliedUsd: totalSupplied,
    totalBorrowedUsd: totalBorrowed,
    assets: [],
  })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(METRICS),
  }))
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('simulateBorrow — risk levels', () => {
  it('classifies as SAFE: projected HF ≥ 2.0', async () => {
    setupMocks(20_000, 0)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '1000', chainId: 56 }, config)
    // supply=20000, borrow=1000, HF = 20000/1000 = 20
    expect(result.riskLevel).toBe('safe')
    expect(result.isSafe).toBe(true)
  })

  it('classifies as MODERATE: 1.5 ≤ projected HF < 2.0', async () => {
    setupMocks(10_000, 0)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '5_800', chainId: 56 }, config)
    // HF = 10000/5800 ≈ 1.724
    expect(result.riskLevel).toBe('moderate')
  })

  it('classifies as HIGH: 1.2 ≤ projected HF < 1.5', async () => {
    setupMocks(10_000, 0)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '7_500', chainId: 56 }, config)
    // HF = 10000/7500 ≈ 1.333
    expect(result.riskLevel).toBe('high')
    expect(result.isSafe).toBe(true) // ≥1.2 threshold
  })

  it('classifies as CRITICAL: 1.0 ≤ projected HF < 1.2', async () => {
    setupMocks(10_000, 0)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '9_000', chainId: 56 }, config)
    // HF = 10000/9000 ≈ 1.111
    expect(result.riskLevel).toBe('critical')
  })

  it('classifies as LIQUIDATABLE: projected HF < 1.0', async () => {
    setupMocks(10_000, 0)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '11_000', chainId: 56 }, config)
    // HF = 10000/11000 ≈ 0.909
    expect(result.riskLevel).toBe('liquidatable')
  })
})

describe('simulateBorrow — health factor calculations', () => {
  it('currentHealthFactor is null when there is no existing debt', async () => {
    setupMocks(10_000, 0)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '100', chainId: 56 }, config)
    expect(result.currentHealthFactor).toBeNull()
  })

  it('computes currentHealthFactor as supply / borrow', async () => {
    setupMocks(10_000, 4_000)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '100', chainId: 56 }, config)
    expect(result.currentHealthFactor).toBeCloseTo(10_000 / 4_000)
  })

  it('accounts for asset price in borrowAmountUsd', async () => {
    setupMocks(100_000, 0)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'WETH', amount: '1', chainId: 56 }, config)
    expect(result.borrowAmountUsd).toBeCloseTo(3000)
  })

  it('handles fractional amounts correctly', async () => {
    setupMocks(10_000, 0)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '0.5', chainId: 56 }, config)
    expect(result.borrowAmountUsd).toBeCloseTo(0.5)
  })
})

describe('simulateBorrow — maxSafeBorrowUsd', () => {
  it('calculates maxSafeBorrowUsd to keep HF at 2.0 (safe threshold)', async () => {
    setupMocks(10_000, 0)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '100', chainId: 56 }, config)
    // maxSafe = supply/2.0 - existingBorrow = 5000 - 0 = 5000
    expect(result.maxSafeBorrowUsd).toBeCloseTo(5_000)
  })

  it('reduces maxSafeBorrowUsd when there is existing debt', async () => {
    setupMocks(10_000, 2_000)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '100', chainId: 56 }, config)
    // maxSafe = 10000/2.0 - 2000 = 5000 - 2000 = 3000
    expect(result.maxSafeBorrowUsd).toBeCloseTo(3_000)
  })

  it('returns 0 maxSafeBorrowUsd when already above the safe threshold', async () => {
    setupMocks(10_000, 6_000)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '100', chainId: 56 }, config)
    // maxSafe = 10000/2.0 - 6000 = -1000 → clamped to 0
    expect(result.maxSafeBorrowUsd).toBe(0)
  })
})

describe('simulateBorrow — edge and error cases', () => {
  it('returns liquidatable with warning when no collateral supplied', async () => {
    setupMocks(0, 0)
    const result = await simulateBorrow({ address: ADDRESS, asset: 'USDC', amount: '100', chainId: 56 }, config)
    expect(result.isSafe).toBe(false)
    expect(result.riskLevel).toBe('liquidatable')
    expect(result.warning).toMatch(/no supplied collateral/i)
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

  it('throws when there is no market data for the asset', async () => {
    setupMocks(10_000, 0)
    await expect(
      simulateBorrow({ address: ADDRESS, asset: 'UNKNOWN', amount: '100', chainId: 56 }, config),
    ).rejects.toThrow('No market data')
  })
})
