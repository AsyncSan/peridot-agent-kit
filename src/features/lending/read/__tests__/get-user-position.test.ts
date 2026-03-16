import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getUserPosition } from '../get-user-position'
import type { PeridotConfig } from '../../../../shared/types'

const config: PeridotConfig = { apiBaseUrl: 'https://app.peridot.finance' }
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

function makePortfolioResponse(overrides: Partial<{
  totalSupplied: number
  totalBorrowed: number
  netApy: number
  healthFactor: number
}> = {}) {
  const base = { totalSupplied: 10000, totalBorrowed: 4000, netApy: 3.5, healthFactor: 2.5 }
  const portfolio = { ...base, ...overrides, currentValue: (overrides.totalSupplied ?? base.totalSupplied) - (overrides.totalBorrowed ?? base.totalBorrowed) }
  return {
    success: true,
    data: {
      portfolio,
      assets: [
        { assetId: 'WETH', supplied: 8000, borrowed: 0, net: 8000, percentage: 80 },
        { assetId: 'USDC', supplied: 2000, borrowed: 4000, net: -2000, percentage: 20 },
      ],
      transactions: { totalCount: 10, supplyCount: 4, borrowCount: 3, repayCount: 2, redeemCount: 1 },
      earnings: { effectiveApy: 3.5, totalLifetimeEarnings: 120 },
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => makePortfolioResponse(),
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('getUserPosition', () => {
  describe('data mapping', () => {
    it('maps portfolio fields correctly', async () => {
      const result = await getUserPosition({ address: TEST_ADDRESS }, config)
      expect(result.address).toBe(TEST_ADDRESS)
      expect(result.totalSuppliedUsd).toBe(10000)
      expect(result.totalBorrowedUsd).toBe(4000)
      expect(result.netWorthUsd).toBe(6000) // currentValue
      expect(result.netApyPct).toBe(3.5)
    })

    it('computes healthFactor as totalSupplied / totalBorrowed', async () => {
      const result = await getUserPosition({ address: TEST_ADDRESS }, config)
      expect(result.healthFactor).toBe(10000 / 4000) // 2.5
    })

    it('returns null healthFactor when no debt', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => makePortfolioResponse({ totalBorrowed: 0 }),
      }))
      const result = await getUserPosition({ address: TEST_ADDRESS }, config)
      expect(result.healthFactor).toBeNull()
    })

    it('maps assets array correctly', async () => {
      const result = await getUserPosition({ address: TEST_ADDRESS }, config)
      expect(result.assets).toHaveLength(2)
      expect(result.assets[0]).toMatchObject({ assetId: 'WETH', suppliedUsd: 8000, borrowedUsd: 0, netUsd: 8000 })
      expect(result.assets[1]).toMatchObject({ assetId: 'USDC', suppliedUsd: 2000, borrowedUsd: 4000, netUsd: -2000 })
    })

    it('maps transaction counts correctly', async () => {
      const result = await getUserPosition({ address: TEST_ADDRESS }, config)
      expect(result.transactions).toMatchObject({
        supplyCount: 4,
        borrowCount: 3,
        repayCount: 2,
        redeemCount: 1,
      })
    })
  })

  describe('API interaction', () => {
    it('passes the address as a query parameter', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => makePortfolioResponse() })
      vi.stubGlobal('fetch', fetchMock)
      await getUserPosition({ address: TEST_ADDRESS }, config)
      const calledUrl = (fetchMock.mock.calls[0] as [string])[0]
      expect(calledUrl).toContain(`address=${TEST_ADDRESS}`)
    })

    it('throws when the API returns success: false', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: 'wallet_not_found' }),
      }))
      await expect(getUserPosition({ address: TEST_ADDRESS }, config)).rejects.toThrow('wallet_not_found')
    })

    it('throws on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' }))
      await expect(getUserPosition({ address: TEST_ADDRESS }, config)).rejects.toThrow()
    })
  })

  describe('edge cases', () => {
    it('handles a new wallet with zero portfolio values', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => makePortfolioResponse({ totalSupplied: 0, totalBorrowed: 0 }),
      }))
      const result = await getUserPosition({ address: TEST_ADDRESS }, config)
      expect(result.totalSuppliedUsd).toBe(0)
      expect(result.totalBorrowedUsd).toBe(0)
      expect(result.healthFactor).toBeNull()
    })
  })
})
