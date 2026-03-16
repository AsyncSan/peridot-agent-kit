import { describe, it, expect } from 'vitest'
import { decodeFunctionData } from 'viem'
import { buildHubEnableCollateralIntent } from '../enable-collateral'
import { buildHubDisableCollateralIntent } from '../disable-collateral'
import { COMPTROLLER_ABI } from '../../../../../shared/abis'
import { BSC_MAINNET_CHAIN_ID, PERIDOT_MARKETS, getControllerAddress } from '../../../../../shared/constants'
import type { PeridotConfig } from '../../../../../shared/types'

const config: PeridotConfig = {}
const USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const BSC = BSC_MAINNET_CHAIN_ID

describe('buildHubEnableCollateralIntent', () => {
  describe('structure', () => {
    it('produces exactly 1 call (enterMarkets)', () => {
      const intent = buildHubEnableCollateralIntent({ userAddress: USER, assets: ['WETH'], chainId: BSC }, config)
      expect(intent.type).toBe('hub')
      expect(intent.calls).toHaveLength(1)
    })
  })

  describe('call[0]: enterMarkets', () => {
    it('targets the Peridottroller controller', () => {
      const intent = buildHubEnableCollateralIntent({ userAddress: USER, assets: ['WETH'], chainId: BSC }, config)
      expect(intent.calls[0]!.to.toLowerCase()).toBe(getControllerAddress(BSC).toLowerCase())
    })

    it('encodes enterMarkets([pToken]) for a single asset', () => {
      const intent = buildHubEnableCollateralIntent({ userAddress: USER, assets: ['USDC'], chainId: BSC }, config)
      const decoded = decodeFunctionData({ abi: COMPTROLLER_ABI, data: intent.calls[0]!.data })
      expect(decoded.functionName).toBe('enterMarkets')
      const markets = decoded.args[0] as string[]
      expect(markets).toHaveLength(1)
      expect(markets[0]!.toLowerCase()).toBe(PERIDOT_MARKETS[BSC]!['USDC']!.toLowerCase())
    })

    it('encodes all pTokens when multiple assets are provided', () => {
      const intent = buildHubEnableCollateralIntent({ userAddress: USER, assets: ['WETH', 'USDC', 'WBTC'], chainId: BSC }, config)
      const decoded = decodeFunctionData({ abi: COMPTROLLER_ABI, data: intent.calls[0]!.data })
      const markets = decoded.args[0] as string[]
      expect(markets).toHaveLength(3)
      const lowerMarkets = markets.map((m) => m.toLowerCase())
      expect(lowerMarkets).toContain(PERIDOT_MARKETS[BSC]!['WETH']!.toLowerCase())
      expect(lowerMarkets).toContain(PERIDOT_MARKETS[BSC]!['USDC']!.toLowerCase())
      expect(lowerMarkets).toContain(PERIDOT_MARKETS[BSC]!['WBTC']!.toLowerCase())
    })
  })

  describe('summary', () => {
    it('names all assets in the summary', () => {
      const intent = buildHubEnableCollateralIntent({ userAddress: USER, assets: ['WETH', 'USDC'], chainId: BSC }, config)
      expect(intent.summary).toContain('WETH')
      expect(intent.summary).toContain('USDC')
    })
  })

  describe('error cases', () => {
    it('throws for unknown assets', () => {
      expect(() =>
        buildHubEnableCollateralIntent({ userAddress: USER, assets: ['FAKE'], chainId: BSC }, config),
      ).toThrow()
    })
  })
})

describe('buildHubDisableCollateralIntent', () => {
  describe('structure', () => {
    it('produces exactly 1 call (exitMarket)', () => {
      const intent = buildHubDisableCollateralIntent({ userAddress: USER, asset: 'USDC', chainId: BSC }, config)
      expect(intent.type).toBe('hub')
      expect(intent.calls).toHaveLength(1)
    })

    it('includes a warning about existing borrows', () => {
      const intent = buildHubDisableCollateralIntent({ userAddress: USER, asset: 'USDC', chainId: BSC }, config)
      expect(intent.warning).toBeDefined()
      expect(intent.warning).toContain('borrows')
    })
  })

  describe('call[0]: exitMarket', () => {
    it('targets the Peridottroller controller', () => {
      const intent = buildHubDisableCollateralIntent({ userAddress: USER, asset: 'USDC', chainId: BSC }, config)
      expect(intent.calls[0]!.to.toLowerCase()).toBe(getControllerAddress(BSC).toLowerCase())
    })

    it('encodes exitMarket(pToken)', () => {
      const intent = buildHubDisableCollateralIntent({ userAddress: USER, asset: 'USDC', chainId: BSC }, config)
      const decoded = decodeFunctionData({ abi: COMPTROLLER_ABI, data: intent.calls[0]!.data })
      expect(decoded.functionName).toBe('exitMarket')
      expect((decoded.args[0] as string).toLowerCase()).toBe(PERIDOT_MARKETS[BSC]!['USDC']!.toLowerCase())
    })

    it('encodes exitMarket for WETH', () => {
      const intent = buildHubDisableCollateralIntent({ userAddress: USER, asset: 'WETH', chainId: BSC }, config)
      const decoded = decodeFunctionData({ abi: COMPTROLLER_ABI, data: intent.calls[0]!.data })
      expect((decoded.args[0] as string).toLowerCase()).toBe(PERIDOT_MARKETS[BSC]!['WETH']!.toLowerCase())
    })
  })

  describe('enterMarkets vs exitMarket are different function selectors', () => {
    it('disable calldata is different from enable calldata', () => {
      const enable = buildHubEnableCollateralIntent({ userAddress: USER, assets: ['USDC'], chainId: BSC }, config)
      const disable = buildHubDisableCollateralIntent({ userAddress: USER, asset: 'USDC', chainId: BSC }, config)
      // First 4 bytes (function selector) should differ
      expect(enable.calls[0]!.data.slice(0, 10)).not.toBe(disable.calls[0]!.data.slice(0, 10))
    })
  })
})
