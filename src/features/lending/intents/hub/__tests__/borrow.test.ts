import { describe, it, expect } from 'vitest'
import { decodeFunctionData, parseUnits } from 'viem'
import { buildHubBorrowIntent } from '../borrow'
import { PTOKEN_ABI, COMPTROLLER_ABI } from '../../../../../shared/abis'
import {
  BSC_MAINNET_CHAIN_ID,
  PERIDOT_MARKETS,
  getControllerAddress,
} from '../../../../../shared/constants'
import type { PeridotConfig } from '../../../../../shared/types'

const config: PeridotConfig = {}
const USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const BSC = BSC_MAINNET_CHAIN_ID

describe('buildHubBorrowIntent', () => {
  describe('structure', () => {
    it('always produces exactly 2 calls: enterMarkets + borrow', () => {
      const intent = buildHubBorrowIntent(
        { userAddress: USER, borrowAsset: 'USDC', borrowAmount: '500', collateralAssets: ['WETH'], chainId: BSC },
        config,
      )
      expect(intent.type).toBe('hub')
      expect(intent.calls).toHaveLength(2)
    })

    it('includes a warning about health factor', () => {
      const intent = buildHubBorrowIntent(
        { userAddress: USER, borrowAsset: 'USDC', borrowAmount: '500', collateralAssets: ['WETH'], chainId: BSC },
        config,
      )
      expect(intent.warning).toBeDefined()
      expect(intent.warning).toContain('simulate_borrow')
    })
  })

  describe('call[0]: enterMarkets', () => {
    it('targets the Peridottroller', () => {
      const intent = buildHubBorrowIntent(
        { userAddress: USER, borrowAsset: 'USDC', borrowAmount: '500', collateralAssets: ['WETH'], chainId: BSC },
        config,
      )
      expect(intent.calls[0]!.to.toLowerCase()).toBe(getControllerAddress(BSC).toLowerCase())
    })

    it('encodes enterMarkets with the collateral pToken addresses', () => {
      const intent = buildHubBorrowIntent(
        { userAddress: USER, borrowAsset: 'USDC', borrowAmount: '500', collateralAssets: ['WETH'], chainId: BSC },
        config,
      )
      const decoded = decodeFunctionData({ abi: COMPTROLLER_ABI, data: intent.calls[0]!.data })
      expect(decoded.functionName).toBe('enterMarkets')
      const markets = decoded.args[0] as string[]
      expect(markets[0]!.toLowerCase()).toBe(PERIDOT_MARKETS[BSC]!['WETH']!.toLowerCase())
    })

    it('includes all collateral markets when multiple assets are provided', () => {
      const intent = buildHubBorrowIntent(
        { userAddress: USER, borrowAsset: 'USDC', borrowAmount: '500', collateralAssets: ['WETH', 'WBTC'], chainId: BSC },
        config,
      )
      const decoded = decodeFunctionData({ abi: COMPTROLLER_ABI, data: intent.calls[0]!.data })
      const markets = decoded.args[0] as string[]
      expect(markets).toHaveLength(2)
      expect(markets.map((m) => m.toLowerCase())).toContain(PERIDOT_MARKETS[BSC]!['WETH']!.toLowerCase())
      expect(markets.map((m) => m.toLowerCase())).toContain(PERIDOT_MARKETS[BSC]!['WBTC']!.toLowerCase())
    })
  })

  describe('call[1]: borrow', () => {
    it('targets the borrow asset pToken', () => {
      const intent = buildHubBorrowIntent(
        { userAddress: USER, borrowAsset: 'USDC', borrowAmount: '500', collateralAssets: ['WETH'], chainId: BSC },
        config,
      )
      expect(intent.calls[1]!.to.toLowerCase()).toBe(PERIDOT_MARKETS[BSC]!['USDC']!.toLowerCase())
    })

    it('encodes borrow(amount) with correct USDC decimals (6)', () => {
      const intent = buildHubBorrowIntent(
        { userAddress: USER, borrowAsset: 'USDC', borrowAmount: '500', collateralAssets: ['WETH'], chainId: BSC },
        config,
      )
      const decoded = decodeFunctionData({ abi: PTOKEN_ABI, data: intent.calls[1]!.data })
      expect(decoded.functionName).toBe('borrow')
      expect(decoded.args[0]).toBe(parseUnits('500', 6))
    })

    it('encodes borrow(amount) with correct WETH decimals (18)', () => {
      const intent = buildHubBorrowIntent(
        { userAddress: USER, borrowAsset: 'WETH', borrowAmount: '0.25', collateralAssets: ['USDC'], chainId: BSC },
        config,
      )
      const decoded = decodeFunctionData({ abi: PTOKEN_ABI, data: intent.calls[1]!.data })
      expect(decoded.args[0]).toBe(parseUnits('0.25', 18))
    })
  })

  describe('error cases', () => {
    it('throws for unknown borrow asset', () => {
      expect(() =>
        buildHubBorrowIntent({ userAddress: USER, borrowAsset: 'FAKE', borrowAmount: '100', collateralAssets: ['WETH'], chainId: BSC }, config),
      ).toThrow()
    })

    it('throws for unknown collateral asset', () => {
      expect(() =>
        buildHubBorrowIntent({ userAddress: USER, borrowAsset: 'USDC', borrowAmount: '100', collateralAssets: ['FAKE'], chainId: BSC }, config),
      ).toThrow()
    })
  })
})
