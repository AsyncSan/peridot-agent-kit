import { describe, it, expect } from 'vitest'
import { decodeFunctionData, parseUnits } from 'viem'
import { buildHubSupplyIntent } from '../supply'
import { ERC20_ABI, PTOKEN_ABI, COMPTROLLER_ABI } from '../../../../../shared/abis'
import {
  BSC_MAINNET_CHAIN_ID,
  PERIDOT_MARKETS,
  BSC_UNDERLYING_TOKENS,
  getControllerAddress,
} from '../../../../../shared/constants'
import type { PeridotConfig } from '../../../../../shared/types'

const config: PeridotConfig = {}
const USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

// Shorthand to decode a call and assert the function name
function decodeAs<TAbi extends readonly unknown[]>(abi: TAbi, data: `0x${string}`) {
  return decodeFunctionData({ abi, data })
}

describe('buildHubSupplyIntent', () => {
  describe('structure', () => {
    it('returns a hub intent with type="hub"', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC_MAINNET_CHAIN_ID }, config)
      expect(intent.type).toBe('hub')
      expect(intent.chainId).toBe(BSC_MAINNET_CHAIN_ID)
    })

    it('includes 3 calls when enableAsCollateral is omitted (defaults to true)', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC_MAINNET_CHAIN_ID }, config)
      expect(intent.calls).toHaveLength(3)
    })

    it('includes 2 calls when enableAsCollateral=false', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC_MAINNET_CHAIN_ID, enableAsCollateral: false }, config)
      expect(intent.calls).toHaveLength(2)
    })

    it('all calls have value=0n', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC_MAINNET_CHAIN_ID }, config)
      for (const call of intent.calls) expect(call.value).toBe(0n)
    })
  })

  describe('call[0]: ERC-20 approve', () => {
    it('targets the underlying token contract', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC_MAINNET_CHAIN_ID }, config)
      expect(intent.calls[0]!.to.toLowerCase()).toBe(BSC_UNDERLYING_TOKENS['USDC']!.toLowerCase())
    })

    it('encodes approve(pToken, amount)', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC_MAINNET_CHAIN_ID }, config)
      const decoded = decodeAs(ERC20_ABI, intent.calls[0]!.data)
      expect(decoded.functionName).toBe('approve')
      expect((decoded.args[0] as string).toLowerCase()).toBe(PERIDOT_MARKETS[BSC_MAINNET_CHAIN_ID]!['USDC']!.toLowerCase())
      expect(decoded.args[1]).toBe(parseUnits('100', 6)) // USDC has 6 decimals
    })

    it('encodes the correct amount for WETH (18 decimals)', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'WETH', amount: '1.5', chainId: BSC_MAINNET_CHAIN_ID }, config)
      const decoded = decodeAs(ERC20_ABI, intent.calls[0]!.data)
      expect(decoded.args[1]).toBe(parseUnits('1.5', 18))
    })

    it('encodes the correct amount for WBTC (8 decimals)', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'WBTC', amount: '0.5', chainId: BSC_MAINNET_CHAIN_ID }, config)
      const decoded = decodeAs(ERC20_ABI, intent.calls[0]!.data)
      expect(decoded.args[1]).toBe(parseUnits('0.5', 8))
    })
  })

  describe('call[1]: pToken mint', () => {
    it('targets the correct pToken market', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC_MAINNET_CHAIN_ID }, config)
      expect(intent.calls[1]!.to.toLowerCase()).toBe(PERIDOT_MARKETS[BSC_MAINNET_CHAIN_ID]!['USDC']!.toLowerCase())
    })

    it('encodes mint(amount) with correct USDC value', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'USDC', amount: '500', chainId: BSC_MAINNET_CHAIN_ID }, config)
      const decoded = decodeAs(PTOKEN_ABI, intent.calls[1]!.data)
      expect(decoded.functionName).toBe('mint')
      expect(decoded.args[0]).toBe(parseUnits('500', 6))
    })

    it('approve and mint use the same amount', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'USDC', amount: '1000', chainId: BSC_MAINNET_CHAIN_ID }, config)
      const approve = decodeAs(ERC20_ABI, intent.calls[0]!.data)
      const mint = decodeAs(PTOKEN_ABI, intent.calls[1]!.data)
      expect(approve.args[1]).toBe(mint.args[0])
    })
  })

  describe('call[2]: enterMarkets (enable collateral)', () => {
    it('targets the Peridottroller controller', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC_MAINNET_CHAIN_ID }, config)
      expect(intent.calls[2]!.to.toLowerCase()).toBe(getControllerAddress(BSC_MAINNET_CHAIN_ID).toLowerCase())
    })

    it('encodes enterMarkets([pToken])', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC_MAINNET_CHAIN_ID }, config)
      const decoded = decodeAs(COMPTROLLER_ABI, intent.calls[2]!.data)
      expect(decoded.functionName).toBe('enterMarkets')
      const markets = decoded.args[0] as string[]
      expect(markets).toHaveLength(1)
      expect(markets[0]!.toLowerCase()).toBe(PERIDOT_MARKETS[BSC_MAINNET_CHAIN_ID]!['USDC']!.toLowerCase())
    })
  })

  describe('summary', () => {
    it('includes "and enable as collateral" when enableAsCollateral=true (default)', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC_MAINNET_CHAIN_ID }, config)
      expect(intent.summary).toMatch(/and enable as collateral/)
    })

    it('omits collateral note when enableAsCollateral=false', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC_MAINNET_CHAIN_ID, enableAsCollateral: false }, config)
      expect(intent.summary).not.toMatch(/and enable as collateral/)
    })

    it('defaults chainId to BSC when not provided', () => {
      const intent = buildHubSupplyIntent({ userAddress: USER, asset: 'USDC', amount: '100' }, config)
      expect(intent.chainId).toBe(BSC_MAINNET_CHAIN_ID)
    })
  })

  describe('error cases', () => {
    it('throws for an asset with no pToken on the chain', () => {
      expect(() =>
        buildHubSupplyIntent({ userAddress: USER, asset: 'FAKECOIN', amount: '1', chainId: BSC_MAINNET_CHAIN_ID }, config),
      ).toThrow('No pToken market for FAKECOIN')
    })

    it('throws for a chain with no markets configured', () => {
      expect(() =>
        buildHubSupplyIntent({ userAddress: USER, asset: 'USDC', amount: '1', chainId: 99999 }, config),
      ).toThrow('No pToken markets configured for chain 99999')
    })
  })
})
