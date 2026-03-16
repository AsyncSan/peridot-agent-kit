import { describe, it, expect, vi, afterEach } from 'vitest'
import type * as Viem from 'viem'
import type { PeridotConfig } from '../../../../shared/types'
import { BSC_MAINNET_CHAIN_ID } from '../../../../shared/constants'

// Mock viem's createPublicClient before importing the module under test
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof Viem>()
  return {
    ...actual,
    createPublicClient: vi.fn(),
  }
})

import { createPublicClient } from 'viem'
import { getAccountLiquidity } from '../get-account-liquidity'

const config: PeridotConfig = {
  apiBaseUrl: 'https://app.peridot.finance',
  rpcUrls: { [BSC_MAINNET_CHAIN_ID]: 'https://bsc-dataseed.binance.org' },
}
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

function mockReadContract(returnValue: readonly [bigint, bigint, bigint]) {
  vi.mocked(createPublicClient).mockReturnValue({
    readContract: vi.fn().mockResolvedValue(returnValue),
  } as unknown as ReturnType<typeof createPublicClient>)
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('getAccountLiquidity', () => {
  describe('healthy position (no shortfall)', () => {
    it('returns positive liquidity and isHealthy=true', async () => {
      // [error=0, liquidity=$1500 USD in 1e18, shortfall=0]
      mockReadContract([0n, BigInt(1500e18), 0n])
      const result = await getAccountLiquidity({ address: ADDRESS, chainId: BSC_MAINNET_CHAIN_ID }, config)
      expect(result.isHealthy).toBe(true)
      expect(result.liquidityUsd).toBeCloseTo(1500, 2)
      expect(result.shortfallUsd).toBe(0)
    })

    it('passes through address and chainId', async () => {
      mockReadContract([0n, BigInt(500e18), 0n])
      const result = await getAccountLiquidity({ address: ADDRESS, chainId: BSC_MAINNET_CHAIN_ID }, config)
      expect(result.address).toBe(ADDRESS)
      expect(result.chainId).toBe(BSC_MAINNET_CHAIN_ID)
    })
  })

  describe('undercollateralized position (shortfall)', () => {
    it('returns positive shortfall and isHealthy=false', async () => {
      // [error=0, liquidity=0, shortfall=$200 USD in 1e18]
      mockReadContract([0n, 0n, BigInt(200e18)])
      const result = await getAccountLiquidity({ address: ADDRESS, chainId: BSC_MAINNET_CHAIN_ID }, config)
      expect(result.isHealthy).toBe(false)
      expect(result.shortfallUsd).toBeCloseTo(200, 2)
      expect(result.liquidityUsd).toBe(0)
    })
  })

  describe('exact boundary: zero liquidity and zero shortfall', () => {
    it('is considered healthy at exact zero', async () => {
      mockReadContract([0n, 0n, 0n])
      const result = await getAccountLiquidity({ address: ADDRESS, chainId: BSC_MAINNET_CHAIN_ID }, config)
      expect(result.isHealthy).toBe(true)
      expect(result.liquidityUsd).toBe(0)
      expect(result.shortfallUsd).toBe(0)
    })
  })

  describe('error cases', () => {
    it('throws when the comptroller returns a non-zero error code', async () => {
      mockReadContract([3n, 0n, 0n]) // error code 3
      await expect(
        getAccountLiquidity({ address: ADDRESS, chainId: BSC_MAINNET_CHAIN_ID }, config),
      ).rejects.toThrow('error code 3')
    })

    it('throws when no RPC URL is available for the chain', async () => {
      const configNoRpc: PeridotConfig = {}
      await expect(
        getAccountLiquidity({ address: ADDRESS, chainId: 99999 }, configNoRpc),
      ).rejects.toThrow('No RPC URL available for chain 99999')
    })

    it('throws when the controller address is not configured for the chain', async () => {
      mockReadContract([0n, 0n, 0n])
      const configWithRpc: PeridotConfig = { rpcUrls: { 999: 'https://rpc.example.com' } }
      await expect(
        getAccountLiquidity({ address: ADDRESS, chainId: 999 }, configWithRpc),
      ).rejects.toThrow('No Peridot controller for chain 999')
    })
  })
})
