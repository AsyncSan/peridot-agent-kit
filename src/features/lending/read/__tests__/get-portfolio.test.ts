import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getPortfolio, portfolioCache } from '../get-portfolio'
import type { PeridotConfig } from '../../../../shared/types'

vi.mock('../../../../shared/on-chain-position', () => ({
  readOnChainPosition: vi.fn(),
}))

import { readOnChainPosition } from '../../../../shared/on-chain-position'

const config: PeridotConfig = { apiBaseUrl: 'https://app.peridot.finance' }
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const OTHER_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

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
  portfolioCache.clear()
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

describe('getPortfolio', () => {
  describe('data mapping', () => {
    it('maps portfolio summary fields', async () => {
      const result = await getPortfolio({ address: TEST_ADDRESS, chainId: 56 }, config)
      expect(result.address).toBe(TEST_ADDRESS)
      expect(result.portfolio.totalSupplied).toBe(10_000)
      expect(result.portfolio.totalBorrowed).toBe(4_000)
      expect(result.portfolio.currentValue).toBe(6_000)
    })

    it('computes healthFactor as totalSupplied / totalBorrowed', async () => {
      const result = await getPortfolio({ address: TEST_ADDRESS, chainId: 56 }, config)
      expect(result.portfolio.healthFactor).toBe(10_000 / 4_000)
    })

    it('sets healthFactor to null when there is no debt', async () => {
      vi.mocked(readOnChainPosition).mockResolvedValue({ ...DEFAULT_POSITION, totalBorrowedUsd: 0 })
      const result = await getPortfolio({ address: TEST_ADDRESS, chainId: 56 }, config)
      expect(result.portfolio.healthFactor).toBeNull()
    })

    it('passes assets array with supplied, borrowed, net, and percentage', async () => {
      const result = await getPortfolio({ address: TEST_ADDRESS, chainId: 56 }, config)
      expect(result.assets).toHaveLength(2)
      expect(result.assets[0]).toMatchObject({ assetId: 'WETH', supplied: 8_000, borrowed: 0, net: 8_000 })
      expect(result.assets[1]).toMatchObject({ assetId: 'USDC', supplied: 2_000, borrowed: 4_000, net: -2_000 })
    })
  })

  describe('caching', () => {
    it('coalesces concurrent requests for the same address into a single on-chain read', async () => {
      const [r1, r2, r3] = await Promise.all([
        getPortfolio({ address: TEST_ADDRESS, chainId: 56 }, config),
        getPortfolio({ address: TEST_ADDRESS, chainId: 56 }, config),
        getPortfolio({ address: TEST_ADDRESS, chainId: 56 }, config),
      ])
      expect(vi.mocked(readOnChainPosition)).toHaveBeenCalledTimes(1)
      expect(r1).toEqual(r2)
      expect(r2).toEqual(r3)
    })

    it('caches result so a sequential second call does not re-read on-chain', async () => {
      await getPortfolio({ address: TEST_ADDRESS, chainId: 56 }, config)
      await getPortfolio({ address: TEST_ADDRESS, chainId: 56 }, config)
      expect(vi.mocked(readOnChainPosition)).toHaveBeenCalledTimes(1)
    })

    it('fires separate reads for different addresses', async () => {
      await Promise.all([
        getPortfolio({ address: TEST_ADDRESS, chainId: 56 }, config),
        getPortfolio({ address: OTHER_ADDRESS, chainId: 56 }, config),
      ])
      expect(vi.mocked(readOnChainPosition)).toHaveBeenCalledTimes(2)
    })

    it('clears cache on error so next call retries', async () => {
      vi.mocked(readOnChainPosition).mockRejectedValueOnce(new Error('RPC error'))
      await expect(getPortfolio({ address: TEST_ADDRESS, chainId: 56 }, config)).rejects.toThrow('RPC error')
      await getPortfolio({ address: TEST_ADDRESS, chainId: 56 }, config)
      expect(vi.mocked(readOnChainPosition)).toHaveBeenCalledTimes(2)
    })
  })
})
