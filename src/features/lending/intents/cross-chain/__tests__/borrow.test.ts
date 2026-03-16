import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildCrossChainBorrowIntent } from '../borrow'
import {
  BSC_MAINNET_CHAIN_ID,
  ARBITRUM_CHAIN_ID,
  BASE_CHAIN_ID,
  PERIDOT_MARKETS,
  BSC_UNDERLYING_TOKENS,
  SPOKE_TOKENS,
  getControllerAddress,
} from '../../../../../shared/constants'
import type { ComposeRequest, PeridotConfig } from '../../../../../shared/types'
import { parseUnits } from 'viem'

const config: PeridotConfig = {
  apiBaseUrl: 'https://app.peridot.finance',
  biconomyApiKey: 'test-key',
}
const USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

const MOCK_BICONOMY = {
  instructions: [{ calls: [], chainId: BSC_MAINNET_CHAIN_ID, isComposable: true }],
  estimatedGas: '620000',
  route: {},
}

let capturedRequest: ComposeRequest | undefined

beforeEach(() => {
  capturedRequest = undefined
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
    if ((url as string).includes('biconomy.io')) {
      capturedRequest = JSON.parse(opts?.body as string) as ComposeRequest
      return { ok: true, json: async () => MOCK_BICONOMY }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildCrossChainBorrowIntent', () => {
  describe('return type', () => {
    it('returns a cross-chain intent with hub as source', async () => {
      const result = await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500' },
        config,
      )
      expect(result.type).toBe('cross-chain')
      expect(result.sourceChainId).toBe(BSC_MAINNET_CHAIN_ID)
    })

    it('destination is hub chain when no targetChainId', async () => {
      const result = await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500' },
        config,
      )
      expect(result.destinationChainId).toBe(BSC_MAINNET_CHAIN_ID)
    })

    it('destination is targetChainId when provided', async () => {
      const result = await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500', targetChainId: ARBITRUM_CHAIN_ID },
        config,
      )
      expect(result.destinationChainId).toBe(ARBITRUM_CHAIN_ID)
    })

    it('returns biconomyInstructions and estimatedGas', async () => {
      const result = await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500' },
        config,
      )
      expect(result.biconomyInstructions).toEqual(MOCK_BICONOMY)
      expect(result.estimatedGas).toBe('620000')
    })

    it('includes borrow step in userSteps', async () => {
      const result = await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500' },
        config,
      )
      expect(result.userSteps.length).toBeGreaterThan(0)
      expect(result.userSteps.some((s) => s.toLowerCase().includes('borrow'))).toBe(true)
    })
  })

  describe('Biconomy compose request — hub-only delivery (no targetChainId)', () => {
    it('sends ownerAddress and eoa mode', async () => {
      await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500' },
        config,
      )
      expect(capturedRequest!.ownerAddress.toLowerCase()).toBe(USER.toLowerCase())
      expect(capturedRequest!.mode).toBe('eoa')
    })

    it('builds 3 flows: enterMarkets + borrow + transfer', async () => {
      await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500' },
        config,
      )
      expect(capturedRequest!.composeFlows).toHaveLength(3)
    })

    it('flow[0] is enterMarkets targeting the controller', async () => {
      await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500' },
        config,
      )
      const enterFlow = capturedRequest!.composeFlows[0]!
      expect(enterFlow.type).toBe('/instructions/build')
      expect((enterFlow.data['to'] as string).toLowerCase()).toBe(getControllerAddress(BSC_MAINNET_CHAIN_ID).toLowerCase())
      expect(enterFlow.data['functionSignature']).toContain('enterMarkets')
      expect(enterFlow.data['chainId']).toBe(BSC_MAINNET_CHAIN_ID)
    })

    it('flow[0] enterMarkets contains the WETH collateral pToken', async () => {
      await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500' },
        config,
      )
      const enterFlow = capturedRequest!.composeFlows[0]!
      const markets = (enterFlow.data['args'] as unknown[][])[0] as string[]
      expect(markets.map((m) => m.toLowerCase())).toContain(PERIDOT_MARKETS[BSC_MAINNET_CHAIN_ID]!['WETH']!.toLowerCase())
    })

    it('flow[0] enterMarkets supports multiple collateral assets', async () => {
      await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH', 'WBTC'], borrowAsset: 'USDC', borrowAmount: '500' },
        config,
      )
      const markets = ((capturedRequest!.composeFlows[0]!.data['args'] as unknown[][])[0]) as string[]
      expect(markets).toHaveLength(2)
      const lower = markets.map((m) => m.toLowerCase())
      expect(lower).toContain(PERIDOT_MARKETS[BSC_MAINNET_CHAIN_ID]!['WETH']!.toLowerCase())
      expect(lower).toContain(PERIDOT_MARKETS[BSC_MAINNET_CHAIN_ID]!['WBTC']!.toLowerCase())
    })

    it('flow[1] is borrow targeting the USDC pToken', async () => {
      await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500' },
        config,
      )
      const borrowFlow = capturedRequest!.composeFlows[1]!
      expect(borrowFlow.type).toBe('/instructions/build')
      expect((borrowFlow.data['to'] as string).toLowerCase()).toBe(PERIDOT_MARKETS[BSC_MAINNET_CHAIN_ID]!['USDC']!.toLowerCase())
      expect(borrowFlow.data['functionSignature']).toContain('borrow')
      expect(borrowFlow.data['chainId']).toBe(BSC_MAINNET_CHAIN_ID)
    })

    it('flow[1] borrow encodes correct USDC amount (6 decimals)', async () => {
      await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500' },
        config,
      )
      const borrowFlow = capturedRequest!.composeFlows[1]!
      const args = borrowFlow.data['args'] as string[]
      expect(args[0]).toBe(parseUnits('500', 6).toString())
    })

    it('flow[1] borrow encodes correct WETH amount (18 decimals)', async () => {
      await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['USDC'], borrowAsset: 'WETH', borrowAmount: '1.5' },
        config,
      )
      const borrowFlow = capturedRequest!.composeFlows[1]!
      const args = borrowFlow.data['args'] as string[]
      expect(args[0]).toBe(parseUnits('1.5', 18).toString())
    })

    it('flow[2] is a transfer back to the user EOA on BSC (no bridge)', async () => {
      await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500' },
        config,
      )
      const transferFlow = capturedRequest!.composeFlows[2]!
      expect(transferFlow.type).toBe('/instructions/build')
      expect(transferFlow.data['functionSignature']).toContain('transfer')
      const args = transferFlow.data['args'] as unknown[]
      expect((args[0] as string).toLowerCase()).toBe(USER.toLowerCase())
    })

    it('flow[2] transfer targets the BSC underlying token contract', async () => {
      await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500' },
        config,
      )
      const transferFlow = capturedRequest!.composeFlows[2]!
      expect((transferFlow.data['to'] as string).toLowerCase()).toBe(BSC_UNDERLYING_TOKENS['USDC']!.toLowerCase())
    })
  })

  describe('Biconomy compose request — with targetChainId (bridge delivery)', () => {
    it('builds 3 flows: enterMarkets + borrow + intent-simple bridge', async () => {
      await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500', targetChainId: ARBITRUM_CHAIN_ID },
        config,
      )
      expect(capturedRequest!.composeFlows).toHaveLength(3)
    })

    it('flow[2] is an intent-simple bridge from BSC → target chain', async () => {
      await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500', targetChainId: ARBITRUM_CHAIN_ID },
        config,
      )
      const bridgeFlow = capturedRequest!.composeFlows[2]!
      expect(bridgeFlow.type).toBe('/instructions/intent-simple')
      expect(bridgeFlow.data['srcChainId']).toBe(BSC_MAINNET_CHAIN_ID)
      expect(bridgeFlow.data['dstChainId']).toBe(ARBITRUM_CHAIN_ID)
      expect((bridgeFlow.data['srcToken'] as string).toLowerCase()).toBe(BSC_UNDERLYING_TOKENS['USDC']!.toLowerCase())
      expect((bridgeFlow.data['dstToken'] as string).toLowerCase()).toBe(SPOKE_TOKENS[ARBITRUM_CHAIN_ID]!['USDC']!.toLowerCase())
    })

    it('flow[2] uses runtimeErc20Balance (dynamic borrow proceeds)', async () => {
      await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500', targetChainId: ARBITRUM_CHAIN_ID },
        config,
      )
      const bridgeFlow = capturedRequest!.composeFlows[2]!
      const amount = bridgeFlow.data['amount'] as { type: string }
      expect(amount.type).toBe('runtimeErc20Balance')
    })

    it('bridges to Base when targetChainId is Base', async () => {
      await buildCrossChainBorrowIntent(
        { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '200', targetChainId: BASE_CHAIN_ID },
        config,
      )
      const bridgeFlow = capturedRequest!.composeFlows[2]!
      expect(bridgeFlow.data['dstChainId']).toBe(BASE_CHAIN_ID)
      expect((bridgeFlow.data['dstToken'] as string).toLowerCase()).toBe(SPOKE_TOKENS[BASE_CHAIN_ID]!['USDC']!.toLowerCase())
    })
  })

  describe('error cases', () => {
    it('throws when biconomyApiKey is not configured', async () => {
      await expect(
        buildCrossChainBorrowIntent(
          { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500' },
          { apiBaseUrl: 'https://app.peridot.finance' },
        ),
      ).rejects.toThrow('biconomyApiKey is required')
    })

    it('throws when Biconomy returns an error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid collateral' }),
      }))
      await expect(
        buildCrossChainBorrowIntent(
          { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500' },
          config,
        ),
      ).rejects.toThrow('Biconomy compose error')
    })

    it('throws for unknown borrow asset', async () => {
      await expect(
        buildCrossChainBorrowIntent(
          { userAddress: USER, collateralAssets: ['WETH'], borrowAsset: 'FAKE', borrowAmount: '100' },
          config,
        ),
      ).rejects.toThrow()
    })

    it('throws for unknown collateral asset', async () => {
      await expect(
        buildCrossChainBorrowIntent(
          { userAddress: USER, collateralAssets: ['NOTREAL'], borrowAsset: 'USDC', borrowAmount: '100' },
          config,
        ),
      ).rejects.toThrow()
    })
  })
})
