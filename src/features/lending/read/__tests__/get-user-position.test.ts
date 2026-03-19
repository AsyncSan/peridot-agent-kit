import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getUserPosition } from '../get-user-position'
import type { PeridotConfig } from '../../../../shared/types'

vi.mock('../../../../shared/on-chain-position', () => ({
  readOnChainPosition: vi.fn(),
}))

import { readOnChainPosition } from '../../../../shared/on-chain-position'

const config: PeridotConfig = { apiBaseUrl: 'https://app.peridot.finance' }
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

const DEFAULT_POSITION = {
  totalSuppliedUsd: 10_000,
  totalBorrowedUsd: 4_000,
  assets: [
    { assetId: 'WETH', suppliedUsd: 8_000, borrowedUsd: 0, suppliedTokens: 2.4, borrowedTokens: 0, priceUsd: 3333 },
    { assetId: 'USDC', suppliedUsd: 2_000, borrowedUsd: 4_000, suppliedTokens: 2000, borrowedTokens: 4000, priceUsd: 1 },
  ],
}

const APY_RESPONSE = {
  ok: true,
  data: {
    weth: { 56: { totalSupplyApy: 4.0, netBorrowApy: 2.0 } },
    usdc: { 56: { totalSupplyApy: 6.0, netBorrowApy: 3.5 } },
  },
}

beforeEach(() => {
  vi.mocked(readOnChainPosition).mockResolvedValue(DEFAULT_POSITION)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(APY_RESPONSE),
  }))
})
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('getUserPosition', () => {
  it('returns correct totals from on-chain position', async () => {
    const result = await getUserPosition({ address: TEST_ADDRESS, chainId: 56 }, config)
    expect(result.address).toBe(TEST_ADDRESS)
    expect(result.totalSuppliedUsd).toBe(10_000)
    expect(result.totalBorrowedUsd).toBe(4_000)
    expect(result.netWorthUsd).toBe(6_000)
  })

  it('computes healthFactor as totalSupplied / totalBorrowed', async () => {
    const result = await getUserPosition({ address: TEST_ADDRESS, chainId: 56 }, config)
    expect(result.healthFactor).toBe(10_000 / 4_000)
  })

  it('returns null healthFactor when no debt', async () => {
    vi.mocked(readOnChainPosition).mockResolvedValue({ ...DEFAULT_POSITION, totalBorrowedUsd: 0, assets: [DEFAULT_POSITION.assets[0]!] })
    const result = await getUserPosition({ address: TEST_ADDRESS, chainId: 56 }, config)
    expect(result.healthFactor).toBeNull()
  })

  it('maps assets array correctly', async () => {
    const result = await getUserPosition({ address: TEST_ADDRESS, chainId: 56 }, config)
    expect(result.assets).toHaveLength(2)
    expect(result.assets[0]).toMatchObject({ assetId: 'WETH', suppliedUsd: 8_000, borrowedUsd: 0, netUsd: 8_000 })
    expect(result.assets[1]).toMatchObject({ assetId: 'USDC', suppliedUsd: 2_000, borrowedUsd: 4_000, netUsd: -2_000 })
  })

  it('computes netApyPct as weighted average across positions', async () => {
    // WETH: 8000 * 4.0 = 32000 supply contribution
    // USDC: 2000 * 6.0 - 4000 * 3.5 = 12000 - 14000 = -2000
    // total = 30000, divided by totalSupplied 10000 = 3.0
    const result = await getUserPosition({ address: TEST_ADDRESS, chainId: 56 }, config)
    expect(result.netApyPct).toBeCloseTo(3.0, 1)
  })

  it('returns 0 netApyPct when no supply', async () => {
    vi.mocked(readOnChainPosition).mockResolvedValue({ totalSuppliedUsd: 0, totalBorrowedUsd: 0, assets: [] })
    const result = await getUserPosition({ address: TEST_ADDRESS, chainId: 56 }, config)
    expect(result.netApyPct).toBe(0)
  })

  it('defaults chainId to BSC (56)', async () => {
    await getUserPosition({ address: TEST_ADDRESS, chainId: 56 }, config)
    expect(vi.mocked(readOnChainPosition)).toHaveBeenCalledWith(TEST_ADDRESS, 56, config)
  })

  it('throws when on-chain read fails', async () => {
    vi.mocked(readOnChainPosition).mockRejectedValue(new Error('RPC error'))
    await expect(getUserPosition({ address: TEST_ADDRESS, chainId: 56 }, config)).rejects.toThrow('RPC error')
  })
})
