import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildCrossChainRepayIntent } from '../repay'
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
const OTHER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

const MOCK_BICONOMY = {
  instructions: [{ calls: [], chainId: BSC_MAINNET_CHAIN_ID, isComposable: true }],
  estimatedGas: '680000',
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

describe('buildCrossChainRepayIntent', () => {
  describe('return type', () => {
    it('returns a cross-chain intent with sourceChainId and hub destination', async () => {
      const result = await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
        config,
      )
      expect(result.type).toBe('cross-chain')
      expect(result.sourceChainId).toBe(ARBITRUM_CHAIN_ID)
      expect(result.destinationChainId).toBe(BSC_MAINNET_CHAIN_ID)
    })

    it('returns biconomyInstructions and estimatedGas', async () => {
      const result = await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
        config,
      )
      expect(result.biconomyInstructions).toEqual(MOCK_BICONOMY)
      expect(result.estimatedGas).toBe('680000')
    })

    it('userSteps mention bridge and repay', async () => {
      const result = await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
        config,
      )
      expect(result.userSteps.some((s) => s.toLowerCase().includes('bridge'))).toBe(true)
      expect(result.userSteps.some((s) => s.toLowerCase().includes('repay'))).toBe(true)
    })
  })

  describe('Biconomy compose request — standard repay (self)', () => {
    it('sends ownerAddress and eoa mode', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
        config,
      )
      expect(capturedRequest!.ownerAddress.toLowerCase()).toBe(USER.toLowerCase())
      expect(capturedRequest!.mode).toBe('eoa')
    })

    it('always builds exactly 4 flows', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
        config,
      )
      expect(capturedRequest!.composeFlows).toHaveLength(4)
    })

    it('flow[0] is intent-simple bridge from source chain to BSC', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
        config,
      )
      const bridgeFlow = capturedRequest!.composeFlows[0]!
      expect(bridgeFlow.type).toBe('/instructions/intent-simple')
      expect(bridgeFlow.data['srcChainId']).toBe(ARBITRUM_CHAIN_ID)
      expect(bridgeFlow.data['dstChainId']).toBe(BSC_MAINNET_CHAIN_ID)
      expect((bridgeFlow.data['srcToken'] as string).toLowerCase()).toBe(SPOKE_TOKENS[ARBITRUM_CHAIN_ID]!['USDC']!.toLowerCase())
      expect((bridgeFlow.data['dstToken'] as string).toLowerCase()).toBe(BSC_UNDERLYING_TOKENS['USDC']!.toLowerCase())
    })

    it('flow[0] bridge uses the exact repay amount (6 decimals for USDC)', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
        config,
      )
      const bridgeFlow = capturedRequest!.composeFlows[0]!
      expect(bridgeFlow.data['amount']).toBe(parseUnits('300', 6).toString())
    })

    it('flow[0] bridge uses 18 decimals for WETH', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'WETH', amount: '2' },
        config,
      )
      const bridgeFlow = capturedRequest!.composeFlows[0]!
      expect(bridgeFlow.data['amount']).toBe(parseUnits('2', 18).toString())
    })

    it('flow[1] is approve targeting the BSC underlying token', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
        config,
      )
      const approveFlow = capturedRequest!.composeFlows[1]!
      expect(approveFlow.type).toBe('/instructions/build')
      expect((approveFlow.data['to'] as string).toLowerCase()).toBe(BSC_UNDERLYING_TOKENS['USDC']!.toLowerCase())
      expect(approveFlow.data['functionSignature']).toContain('approve')
      expect(approveFlow.data['chainId']).toBe(BSC_MAINNET_CHAIN_ID)
    })

    it('flow[1] approve grants spend allowance to the pToken', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
        config,
      )
      const approveFlow = capturedRequest!.composeFlows[1]!
      const args = approveFlow.data['args'] as unknown[]
      expect((args[0] as string).toLowerCase()).toBe(PERIDOT_MARKETS[BSC_MAINNET_CHAIN_ID]!['USDC']!.toLowerCase())
    })

    it('flow[1] approve uses runtimeErc20Balance (dynamic bridged amount)', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
        config,
      )
      const approveFlow = capturedRequest!.composeFlows[1]!
      const amount = (approveFlow.data['args'] as unknown[])[1] as { type: string }
      expect(amount.type).toBe('runtimeErc20Balance')
    })

    it('flow[2] is repayBorrow (not behalf) targeting the pToken', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
        config,
      )
      const repayFlow = capturedRequest!.composeFlows[2]!
      expect(repayFlow.type).toBe('/instructions/build')
      expect((repayFlow.data['to'] as string).toLowerCase()).toBe(PERIDOT_MARKETS[BSC_MAINNET_CHAIN_ID]!['USDC']!.toLowerCase())
      expect(repayFlow.data['functionSignature']).toContain('repayBorrow')
      expect(repayFlow.data['functionSignature']).not.toContain('Behalf')
      expect(repayFlow.data['chainId']).toBe(BSC_MAINNET_CHAIN_ID)
    })

    it('flow[2] repayBorrow uses runtimeErc20Balance', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
        config,
      )
      const repayFlow = capturedRequest!.composeFlows[2]!
      const args = repayFlow.data['args'] as unknown[]
      const repayAmount = args[0] as { type: string }
      expect(repayAmount.type).toBe('runtimeErc20Balance')
    })

    it('flow[3] returns excess tokens to the user EOA on BSC', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
        config,
      )
      const returnFlow = capturedRequest!.composeFlows[3]!
      expect(returnFlow.type).toBe('/instructions/build')
      expect(returnFlow.data['functionSignature']).toContain('transfer')
      const args = returnFlow.data['args'] as unknown[]
      expect((args[0] as string).toLowerCase()).toBe(USER.toLowerCase())
    })

    it('flow[3] return targets the BSC underlying contract', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
        config,
      )
      const returnFlow = capturedRequest!.composeFlows[3]!
      expect((returnFlow.data['to'] as string).toLowerCase()).toBe(BSC_UNDERLYING_TOKENS['USDC']!.toLowerCase())
    })
  })

  describe('repay on behalf of another address', () => {
    it('builds 4 flows when repayForAddress is provided', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300', repayForAddress: OTHER },
        config,
      )
      expect(capturedRequest!.composeFlows).toHaveLength(4)
    })

    it('flow[2] uses repayBorrowBehalf with the target address', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300', repayForAddress: OTHER },
        config,
      )
      const repayFlow = capturedRequest!.composeFlows[2]!
      expect(repayFlow.data['functionSignature']).toContain('repayBorrowBehalf')
      const args = repayFlow.data['args'] as unknown[]
      expect((args[0] as string).toLowerCase()).toBe(OTHER.toLowerCase())
    })

    it('flow[3] returns excess to the payer (USER) not the borrower', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300', repayForAddress: OTHER },
        config,
      )
      const returnFlow = capturedRequest!.composeFlows[3]!
      const args = returnFlow.data['args'] as unknown[]
      expect((args[0] as string).toLowerCase()).toBe(USER.toLowerCase())
    })

    it('uses repayBorrow (not behalf) when repayForAddress equals userAddress', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300', repayForAddress: USER },
        config,
      )
      const repayFlow = capturedRequest!.composeFlows[2]!
      expect(repayFlow.data['functionSignature']).not.toContain('Behalf')
    })
  })

  describe('source chain variation', () => {
    it('uses the correct source token for Base', async () => {
      await buildCrossChainRepayIntent(
        { userAddress: USER, sourceChainId: BASE_CHAIN_ID, asset: 'USDC', amount: '100' },
        config,
      )
      const bridgeFlow = capturedRequest!.composeFlows[0]!
      expect(bridgeFlow.data['srcChainId']).toBe(BASE_CHAIN_ID)
      expect((bridgeFlow.data['srcToken'] as string).toLowerCase()).toBe(SPOKE_TOKENS[BASE_CHAIN_ID]!['USDC']!.toLowerCase())
    })
  })

  describe('error cases', () => {
    it('throws when biconomyApiKey is not configured', async () => {
      await expect(
        buildCrossChainRepayIntent(
          { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
          { apiBaseUrl: 'https://app.peridot.finance' },
        ),
      ).rejects.toThrow('biconomyApiKey is required')
    })

    it('throws when Biconomy returns an error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Slippage too high' }),
      }))
      await expect(
        buildCrossChainRepayIntent(
          { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'USDC', amount: '300' },
          config,
        ),
      ).rejects.toThrow('Biconomy compose error')
    })

    it('throws for unknown asset', async () => {
      await expect(
        buildCrossChainRepayIntent(
          { userAddress: USER, sourceChainId: ARBITRUM_CHAIN_ID, asset: 'FAKECOIN', amount: '100' },
          config,
        ),
      ).rejects.toThrow()
    })

    it('throws for unknown source chain', async () => {
      await expect(
        buildCrossChainRepayIntent(
          { userAddress: USER, sourceChainId: 99999, asset: 'USDC', amount: '100' },
          config,
        ),
      ).rejects.toThrow()
    })
  })
})
