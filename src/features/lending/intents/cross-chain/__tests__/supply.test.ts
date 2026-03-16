import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildCrossChainSupplyIntent } from '../supply'
import {
  BSC_MAINNET_CHAIN_ID,
  ARBITRUM_CHAIN_ID,
  BASE_CHAIN_ID,
  PERIDOT_MARKETS,
  SPOKE_TOKENS,
  BSC_UNDERLYING_TOKENS,
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
  estimatedGas: '750000',
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

describe('buildCrossChainSupplyIntent', () => {
  describe('return type', () => {
    it('returns a cross-chain intent', async () => {
      const result = await buildCrossChainSupplyIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '100' },
        config,
      )
      expect(result.type).toBe('cross-chain')
      expect(result.sourceChainId).toBe(ARBITRUM_CHAIN_ID)
      expect(result.destinationChainId).toBe(BSC_MAINNET_CHAIN_ID)
    })

    it('returns the biconomyInstructions from the compose response', async () => {
      const result = await buildCrossChainSupplyIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '100' },
        config,
      )
      expect(result.biconomyInstructions).toEqual(MOCK_BICONOMY)
      expect(result.estimatedGas).toBe('750000')
    })

    it('includes human-readable userSteps', async () => {
      const result = await buildCrossChainSupplyIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '100' },
        config,
      )
      expect(result.userSteps.length).toBeGreaterThan(0)
      // Must mention the bridge step
      expect(result.userSteps.some((s) => s.toLowerCase().includes('bridge'))).toBe(true)
    })
  })

  describe('Biconomy compose request — flow structure', () => {
    it('sends to the Biconomy compose endpoint with the user address', async () => {
      await buildCrossChainSupplyIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '100' },
        config,
      )
      expect(capturedRequest!.ownerAddress.toLowerCase()).toBe(USER.toLowerCase())
      expect(capturedRequest!.mode).toBe('eoa')
    })

    it('builds 5 flows: bridge + approve + mint + enterMarkets + transfer (enableAsCollateral omitted, defaults to true)', async () => {
      await buildCrossChainSupplyIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '100' },
        config,
      )
      expect(capturedRequest!.composeFlows).toHaveLength(5)
    })

    it('builds 4 flows when enableAsCollateral=false (no enterMarkets)', async () => {
      await buildCrossChainSupplyIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '100', enableAsCollateral: false },
        config,
      )
      expect(capturedRequest!.composeFlows).toHaveLength(4)
    })

    it('flow[0] is an intent-simple bridge from source to BSC', async () => {
      await buildCrossChainSupplyIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '100' },
        config,
      )
      const bridgeFlow = capturedRequest!.composeFlows[0]!
      expect(bridgeFlow.type).toBe('/instructions/intent-simple')
      expect(bridgeFlow.data['srcChainId']).toBe(ARBITRUM_CHAIN_ID)
      expect(bridgeFlow.data['dstChainId']).toBe(BSC_MAINNET_CHAIN_ID)
      expect(bridgeFlow.data['srcToken']).toBe(SPOKE_TOKENS[ARBITRUM_CHAIN_ID]!['USDC'])
      expect(bridgeFlow.data['dstToken']).toBe(BSC_UNDERLYING_TOKENS['USDC'])
      expect(bridgeFlow.data['amount']).toBe(parseUnits('100', 6).toString())
    })

    it('flow[1] is an approve call on BSC', async () => {
      await buildCrossChainSupplyIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '100' },
        config,
      )
      const approveFlow = capturedRequest!.composeFlows[1]!
      expect(approveFlow.type).toBe('/instructions/build')
      expect(approveFlow.data['chainId']).toBe(BSC_MAINNET_CHAIN_ID)
      expect(approveFlow.data['functionSignature']).toContain('approve')
    })

    it('flow[2] is a mint call on the pToken', async () => {
      await buildCrossChainSupplyIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '100' },
        config,
      )
      const mintFlow = capturedRequest!.composeFlows[2]!
      expect(mintFlow.type).toBe('/instructions/build')
      expect((mintFlow.data['to'] as string).toLowerCase()).toBe(PERIDOT_MARKETS[BSC_MAINNET_CHAIN_ID]!['USDC']!.toLowerCase())
      expect(mintFlow.data['functionSignature']).toContain('mint')
    })

    it('flow[3] is enterMarkets targeting the controller (when collateral enabled)', async () => {
      await buildCrossChainSupplyIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '100' },
        config,
      )
      const enterFlow = capturedRequest!.composeFlows[3]!
      expect(enterFlow.data['functionSignature']).toContain('enterMarkets')
      expect((enterFlow.data['to'] as string).toLowerCase()).toBe(getControllerAddress(BSC_MAINNET_CHAIN_ID).toLowerCase())
    })

    it('flow[4] transfers pTokens back to the user', async () => {
      await buildCrossChainSupplyIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '100' },
        config,
      )
      const transferFlow = capturedRequest!.composeFlows[4]!
      expect(transferFlow.data['functionSignature']).toContain('transfer')
      const args = transferFlow.data['args'] as unknown[]
      expect((args[0] as string).toLowerCase()).toBe(USER.toLowerCase())
    })
  })

  describe('source chain variation', () => {
    it('uses the correct source token for Base', async () => {
      await buildCrossChainSupplyIntent(
        { userAddress: USER, sourceChainId: BASE_CHAIN_ID, asset: 'USDC', amount: '100' },
        config,
      )
      const bridgeFlow = capturedRequest!.composeFlows[0]!
      expect(bridgeFlow.data['srcToken']).toBe(SPOKE_TOKENS[BASE_CHAIN_ID]!['USDC'])
      expect(bridgeFlow.data['srcChainId']).toBe(BASE_CHAIN_ID)
    })
  })

  describe('error cases', () => {
    it('throws when biconomyApiKey is not configured', async () => {
      await expect(
        buildCrossChainSupplyIntent(
          { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '100' },
          { apiBaseUrl: 'https://app.peridot.finance' }, // no apiKey
        ),
      ).rejects.toThrow('biconomyApiKey is required')
    })

    it('throws when Biconomy returns an error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid token' }),
      }))
      await expect(
        buildCrossChainSupplyIntent(
          { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '100' },
          config,
        ),
      ).rejects.toThrow('Biconomy compose error')
    })
  })
})
