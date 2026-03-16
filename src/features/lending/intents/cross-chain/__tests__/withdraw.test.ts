import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildCrossChainWithdrawIntent } from '../withdraw'
import {
  BSC_MAINNET_CHAIN_ID,
  ARBITRUM_CHAIN_ID,
  BASE_CHAIN_ID,
  PERIDOT_MARKETS,
  BSC_UNDERLYING_TOKENS,
  SPOKE_TOKENS,
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
  estimatedGas: '540000',
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
afterEach(() => vi.unstubAllGlobals())

describe('buildCrossChainWithdrawIntent', () => {
  describe('return type', () => {
    it('returns a cross-chain intent with BSC as source', async () => {
      const result = await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200' },
        config,
      )
      expect(result.type).toBe('cross-chain')
      expect(result.sourceChainId).toBe(BSC_MAINNET_CHAIN_ID)
    })

    it('destination is hub chain when no targetChainId', async () => {
      const result = await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200' },
        config,
      )
      expect(result.destinationChainId).toBe(BSC_MAINNET_CHAIN_ID)
    })

    it('destination is targetChainId when provided', async () => {
      const result = await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200', targetChainId: ARBITRUM_CHAIN_ID },
        config,
      )
      expect(result.destinationChainId).toBe(ARBITRUM_CHAIN_ID)
    })

    it('returns biconomyInstructions and estimatedGas', async () => {
      const result = await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200' },
        config,
      )
      expect(result.biconomyInstructions).toEqual(MOCK_BICONOMY)
      expect(result.estimatedGas).toBe('540000')
    })

    it('userSteps mention redeem', async () => {
      const result = await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200' },
        config,
      )
      expect(result.userSteps.some((s) => s.toLowerCase().includes('redeem'))).toBe(true)
    })
  })

  describe('Biconomy compose request — hub-only delivery (no targetChainId)', () => {
    it('sends ownerAddress and eoa mode', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200' },
        config,
      )
      expect(capturedRequest!.ownerAddress.toLowerCase()).toBe(USER.toLowerCase())
      expect(capturedRequest!.mode).toBe('eoa')
    })

    it('builds 2 flows: redeemUnderlying + transfer', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200' },
        config,
      )
      expect(capturedRequest!.composeFlows).toHaveLength(2)
    })

    it('flow[0] is redeemUnderlying targeting the USDC pToken', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200' },
        config,
      )
      const redeemFlow = capturedRequest!.composeFlows[0]!
      expect(redeemFlow.type).toBe('/instructions/build')
      expect((redeemFlow.data['to'] as string).toLowerCase()).toBe(PERIDOT_MARKETS[BSC_MAINNET_CHAIN_ID]!['USDC']!.toLowerCase())
      expect(redeemFlow.data['functionSignature']).toContain('redeemUnderlying')
      expect(redeemFlow.data['chainId']).toBe(BSC_MAINNET_CHAIN_ID)
    })

    it('flow[0] encodes correct USDC amount (6 decimals)', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200' },
        config,
      )
      const redeemFlow = capturedRequest!.composeFlows[0]!
      const args = redeemFlow.data['args'] as string[]
      expect(args[0]).toBe(parseUnits('200', 6).toString())
    })

    it('flow[0] encodes correct WETH amount (18 decimals)', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'WETH', amount: '3.5' },
        config,
      )
      const redeemFlow = capturedRequest!.composeFlows[0]!
      const args = redeemFlow.data['args'] as string[]
      expect(args[0]).toBe(parseUnits('3.5', 18).toString())
    })

    it('flow[0] encodes correct WBTC amount (8 decimals)', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'WBTC', amount: '0.05' },
        config,
      )
      const redeemFlow = capturedRequest!.composeFlows[0]!
      const args = redeemFlow.data['args'] as string[]
      expect(args[0]).toBe(parseUnits('0.05', 8).toString())
    })

    it('flow[0] targets the WETH pToken for WETH withdrawals', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'WETH', amount: '1' },
        config,
      )
      const redeemFlow = capturedRequest!.composeFlows[0]!
      expect((redeemFlow.data['to'] as string).toLowerCase()).toBe(PERIDOT_MARKETS[BSC_MAINNET_CHAIN_ID]!['WETH']!.toLowerCase())
    })

    it('flow[1] is a transfer to the user EOA on BSC', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200' },
        config,
      )
      const transferFlow = capturedRequest!.composeFlows[1]!
      expect(transferFlow.type).toBe('/instructions/build')
      expect(transferFlow.data['functionSignature']).toContain('transfer')
      const args = transferFlow.data['args'] as unknown[]
      expect((args[0] as string).toLowerCase()).toBe(USER.toLowerCase())
    })

    it('flow[1] transfer targets the BSC underlying contract', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200' },
        config,
      )
      const transferFlow = capturedRequest!.composeFlows[1]!
      expect((transferFlow.data['to'] as string).toLowerCase()).toBe(BSC_UNDERLYING_TOKENS['USDC']!.toLowerCase())
    })

    it('flow[1] transfer uses runtimeErc20Balance (dynamic redeemed amount)', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200' },
        config,
      )
      const transferFlow = capturedRequest!.composeFlows[1]!
      const args = transferFlow.data['args'] as unknown[]
      const amount = args[1] as { type: string }
      expect(amount.type).toBe('runtimeErc20Balance')
    })
  })

  describe('Biconomy compose request — with targetChainId (bridge delivery)', () => {
    it('builds 2 flows: redeemUnderlying + intent-simple bridge', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200', targetChainId: ARBITRUM_CHAIN_ID },
        config,
      )
      expect(capturedRequest!.composeFlows).toHaveLength(2)
    })

    it('flow[1] is intent-simple bridge from BSC → target chain', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200', targetChainId: ARBITRUM_CHAIN_ID },
        config,
      )
      const bridgeFlow = capturedRequest!.composeFlows[1]!
      expect(bridgeFlow.type).toBe('/instructions/intent-simple')
      expect(bridgeFlow.data['srcChainId']).toBe(BSC_MAINNET_CHAIN_ID)
      expect(bridgeFlow.data['dstChainId']).toBe(ARBITRUM_CHAIN_ID)
      expect((bridgeFlow.data['srcToken'] as string).toLowerCase()).toBe(BSC_UNDERLYING_TOKENS['USDC']!.toLowerCase())
      expect((bridgeFlow.data['dstToken'] as string).toLowerCase()).toBe(SPOKE_TOKENS[ARBITRUM_CHAIN_ID]!['USDC']!.toLowerCase())
    })

    it('flow[1] bridge uses runtimeErc20Balance for dynamic amount', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200', targetChainId: ARBITRUM_CHAIN_ID },
        config,
      )
      const bridgeFlow = capturedRequest!.composeFlows[1]!
      const amount = bridgeFlow.data['amount'] as { type: string }
      expect(amount.type).toBe('runtimeErc20Balance')
    })

    it('bridges WETH to Arbitrum with correct token addresses', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'WETH', amount: '1', targetChainId: ARBITRUM_CHAIN_ID },
        config,
      )
      const bridgeFlow = capturedRequest!.composeFlows[1]!
      expect((bridgeFlow.data['srcToken'] as string).toLowerCase()).toBe(BSC_UNDERLYING_TOKENS['WETH']!.toLowerCase())
      expect((bridgeFlow.data['dstToken'] as string).toLowerCase()).toBe(SPOKE_TOKENS[ARBITRUM_CHAIN_ID]!['WETH']!.toLowerCase())
    })

    it('bridges to Base with correct token addresses', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '100', targetChainId: BASE_CHAIN_ID },
        config,
      )
      const bridgeFlow = capturedRequest!.composeFlows[1]!
      expect(bridgeFlow.data['dstChainId']).toBe(BASE_CHAIN_ID)
      expect((bridgeFlow.data['dstToken'] as string).toLowerCase()).toBe(SPOKE_TOKENS[BASE_CHAIN_ID]!['USDC']!.toLowerCase())
    })

    it('userSteps includes bridge step when targetChainId is set', async () => {
      const result = await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200', targetChainId: ARBITRUM_CHAIN_ID },
        config,
      )
      expect(result.userSteps.some((s) => s.toLowerCase().includes('bridge'))).toBe(true)
    })
  })

  describe('flow[0] redeemUnderlying is consistent regardless of delivery method', () => {
    it('same pToken target with or without bridge', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200' },
        config,
      )
      const hubTarget = capturedRequest!.composeFlows[0]!.data['to'] as string

      capturedRequest = undefined
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200', targetChainId: ARBITRUM_CHAIN_ID },
        config,
      )
      const bridgeTarget = capturedRequest!.composeFlows[0]!.data['to'] as string

      expect(hubTarget.toLowerCase()).toBe(bridgeTarget.toLowerCase())
    })

    it('same amount encoding with or without bridge', async () => {
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200' },
        config,
      )
      const hubArgs = capturedRequest!.composeFlows[0]!.data['args'] as string[]

      capturedRequest = undefined
      await buildCrossChainWithdrawIntent(
        { userAddress: USER, asset: 'USDC', amount: '200', targetChainId: ARBITRUM_CHAIN_ID },
        config,
      )
      const bridgeArgs = capturedRequest!.composeFlows[0]!.data['args'] as string[]

      expect(hubArgs[0]).toBe(bridgeArgs[0])
    })
  })

  describe('error cases', () => {
    it('throws when biconomyApiKey is not configured', async () => {
      await expect(
        buildCrossChainWithdrawIntent(
          { userAddress: USER, asset: 'USDC', amount: '200' },
          { apiBaseUrl: 'https://app.peridot.finance' },
        ),
      ).rejects.toThrow('biconomyApiKey is required')
    })

    it('throws when Biconomy returns an error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Insufficient liquidity' }),
      }))
      await expect(
        buildCrossChainWithdrawIntent(
          { userAddress: USER, asset: 'USDC', amount: '200' },
          config,
        ),
      ).rejects.toThrow('Biconomy compose error')
    })

    it('throws for unknown asset', async () => {
      await expect(
        buildCrossChainWithdrawIntent(
          { userAddress: USER, asset: 'UNKNOWN', amount: '100' },
          config,
        ),
      ).rejects.toThrow()
    })

    it('throws when targetChainId has no token config for the asset', async () => {
      await expect(
        buildCrossChainWithdrawIntent(
          { userAddress: USER, asset: 'WBNB', amount: '1', targetChainId: ARBITRUM_CHAIN_ID },
          config,
        ),
      ).rejects.toThrow()
    })
  })
})
