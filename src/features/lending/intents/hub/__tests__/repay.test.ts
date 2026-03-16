import { describe, it, expect } from 'vitest'
import { decodeFunctionData, parseUnits, maxUint256 } from 'viem'
import { buildHubRepayIntent } from '../repay'
import { ERC20_ABI, PTOKEN_ABI } from '../../../../../shared/abis'
import { BSC_MAINNET_CHAIN_ID, PERIDOT_MARKETS, BSC_UNDERLYING_TOKENS } from '../../../../../shared/constants'
import type { PeridotConfig } from '../../../../../shared/types'

const config: PeridotConfig = {}
const USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const BSC = BSC_MAINNET_CHAIN_ID

describe('buildHubRepayIntent', () => {
  describe('structure', () => {
    it('produces exactly 2 calls: approve + repayBorrow', () => {
      const intent = buildHubRepayIntent({ userAddress: USER, asset: 'USDC', amount: '200', chainId: BSC }, config)
      expect(intent.type).toBe('hub')
      expect(intent.calls).toHaveLength(2)
    })

    it('has no warning (repay is always safe)', () => {
      const intent = buildHubRepayIntent({ userAddress: USER, asset: 'USDC', amount: '200', chainId: BSC }, config)
      expect(intent.warning).toBeUndefined()
    })
  })

  describe('call[0]: ERC-20 approve', () => {
    it('targets the underlying token (not the pToken)', () => {
      const intent = buildHubRepayIntent({ userAddress: USER, asset: 'USDC', amount: '200', chainId: BSC }, config)
      expect(intent.calls[0]!.to.toLowerCase()).toBe(BSC_UNDERLYING_TOKENS['USDC']!.toLowerCase())
    })

    it('approves the pToken to spend the underlying', () => {
      const intent = buildHubRepayIntent({ userAddress: USER, asset: 'USDC', amount: '200', chainId: BSC }, config)
      const decoded = decodeFunctionData({ abi: ERC20_ABI, data: intent.calls[0]!.data })
      expect(decoded.functionName).toBe('approve')
      expect((decoded.args[0] as string).toLowerCase()).toBe(PERIDOT_MARKETS[BSC]!['USDC']!.toLowerCase())
    })

    it('approves the exact repay amount (200 USDC = 200_000_000)', () => {
      const intent = buildHubRepayIntent({ userAddress: USER, asset: 'USDC', amount: '200', chainId: BSC }, config)
      const decoded = decodeFunctionData({ abi: ERC20_ABI, data: intent.calls[0]!.data })
      expect(decoded.args[1]).toBe(parseUnits('200', 6))
    })
  })

  describe('call[1]: repayBorrow', () => {
    it('targets the correct pToken', () => {
      const intent = buildHubRepayIntent({ userAddress: USER, asset: 'USDC', amount: '200', chainId: BSC }, config)
      expect(intent.calls[1]!.to.toLowerCase()).toBe(PERIDOT_MARKETS[BSC]!['USDC']!.toLowerCase())
    })

    it('encodes repayBorrow(amount) with correct USDC amount', () => {
      const intent = buildHubRepayIntent({ userAddress: USER, asset: 'USDC', amount: '200', chainId: BSC }, config)
      const decoded = decodeFunctionData({ abi: PTOKEN_ABI, data: intent.calls[1]!.data })
      expect(decoded.functionName).toBe('repayBorrow')
      expect(decoded.args[0]).toBe(parseUnits('200', 6))
    })

    it('encodes repayBorrow(amount) for WETH with 18 decimals', () => {
      const intent = buildHubRepayIntent({ userAddress: USER, asset: 'WETH', amount: '0.1', chainId: BSC }, config)
      const decoded = decodeFunctionData({ abi: PTOKEN_ABI, data: intent.calls[1]!.data })
      expect(decoded.args[0]).toBe(parseUnits('0.1', 18))
    })
  })

  describe('max repay', () => {
    it('uses maxUint256 when amount is "max"', () => {
      const intent = buildHubRepayIntent({ userAddress: USER, asset: 'USDC', amount: 'max', chainId: BSC }, config)
      const approveDecoded = decodeFunctionData({ abi: ERC20_ABI, data: intent.calls[0]!.data })
      const repayDecoded = decodeFunctionData({ abi: PTOKEN_ABI, data: intent.calls[1]!.data })
      expect(approveDecoded.args[1]).toBe(maxUint256)
      expect(repayDecoded.args[0]).toBe(maxUint256)
    })

    it('uses maxUint256 when amount is "MAX" (case-insensitive)', () => {
      const intent = buildHubRepayIntent({ userAddress: USER, asset: 'USDC', amount: 'MAX', chainId: BSC }, config)
      const decoded = decodeFunctionData({ abi: PTOKEN_ABI, data: intent.calls[1]!.data })
      expect(decoded.args[0]).toBe(maxUint256)
    })

    it('approve and repayBorrow always use the same amount', () => {
      const intent = buildHubRepayIntent({ userAddress: USER, asset: 'USDC', amount: '750', chainId: BSC }, config)
      const approve = decodeFunctionData({ abi: ERC20_ABI, data: intent.calls[0]!.data })
      const repay = decodeFunctionData({ abi: PTOKEN_ABI, data: intent.calls[1]!.data })
      expect(approve.args[1]).toBe(repay.args[0])
    })
  })
})
