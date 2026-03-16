import { describe, it, expect } from 'vitest'
import { decodeFunctionData, parseUnits } from 'viem'
import { buildHubWithdrawIntent } from '../withdraw'
import { PTOKEN_ABI } from '../../../../../shared/abis'
import { BSC_MAINNET_CHAIN_ID, PERIDOT_MARKETS } from '../../../../../shared/constants'
import type { PeridotConfig } from '../../../../../shared/types'

const config: PeridotConfig = {}
const USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const BSC = BSC_MAINNET_CHAIN_ID

describe('buildHubWithdrawIntent', () => {
  describe('structure', () => {
    it('produces exactly 1 call (redeemUnderlying)', () => {
      const intent = buildHubWithdrawIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC }, config)
      expect(intent.type).toBe('hub')
      expect(intent.calls).toHaveLength(1)
    })

    it('includes a warning about health factor impact', () => {
      const intent = buildHubWithdrawIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC }, config)
      expect(intent.warning).toBeDefined()
      expect(intent.warning).toContain('revert')
    })
  })

  describe('call[0]: redeemUnderlying', () => {
    it('targets the correct pToken contract', () => {
      const intent = buildHubWithdrawIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC }, config)
      expect(intent.calls[0]!.to.toLowerCase()).toBe(PERIDOT_MARKETS[BSC]!['USDC']!.toLowerCase())
    })

    it('encodes redeemUnderlying(amount) for USDC (6 decimals)', () => {
      const intent = buildHubWithdrawIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC }, config)
      const decoded = decodeFunctionData({ abi: PTOKEN_ABI, data: intent.calls[0]!.data })
      expect(decoded.functionName).toBe('redeemUnderlying')
      expect(decoded.args[0]).toBe(parseUnits('100', 6))
    })

    it('encodes redeemUnderlying(amount) for WETH (18 decimals)', () => {
      const intent = buildHubWithdrawIntent({ userAddress: USER, asset: 'WETH', amount: '2.5', chainId: BSC }, config)
      const decoded = decodeFunctionData({ abi: PTOKEN_ABI, data: intent.calls[0]!.data })
      expect(decoded.functionName).toBe('redeemUnderlying')
      expect(decoded.args[0]).toBe(parseUnits('2.5', 18))
    })

    it('encodes redeemUnderlying(amount) for WBTC (8 decimals)', () => {
      const intent = buildHubWithdrawIntent({ userAddress: USER, asset: 'WBTC', amount: '0.1', chainId: BSC }, config)
      const decoded = decodeFunctionData({ abi: PTOKEN_ABI, data: intent.calls[0]!.data })
      expect(decoded.args[0]).toBe(parseUnits('0.1', 8))
    })

    it('uses value=0n (not a payable call)', () => {
      const intent = buildHubWithdrawIntent({ userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC }, config)
      expect(intent.calls[0]!.value).toBe(0n)
    })
  })

  describe('summary', () => {
    it('includes asset name and amount in summary', () => {
      const intent = buildHubWithdrawIntent({ userAddress: USER, asset: 'USDC', amount: '500', chainId: BSC }, config)
      expect(intent.summary).toContain('500')
      expect(intent.summary).toContain('USDC')
    })
  })
})
