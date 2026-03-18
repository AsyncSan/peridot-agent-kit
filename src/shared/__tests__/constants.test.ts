import { describe, it, expect } from 'vitest'
import {
  isHubChain,
  resolveHubChainId,
  getPTokenAddress,
  getUnderlyingTokenAddress,
  getControllerAddress,
  getAssetDecimals,
  BSC_MAINNET_CHAIN_ID,
  BSC_TESTNET_CHAIN_ID,
  MONAD_MAINNET_CHAIN_ID,
  SOMNIA_MAINNET_CHAIN_ID,
  ARBITRUM_CHAIN_ID,
  BASE_CHAIN_ID,
  ETHEREUM_CHAIN_ID,
  PERIDOT_MARKETS,
  BSC_UNDERLYING_TOKENS,
} from '../constants'

describe('isHubChain', () => {
  it('returns true for all hub chain IDs', () => {
    expect(isHubChain(BSC_MAINNET_CHAIN_ID)).toBe(true)
    expect(isHubChain(BSC_TESTNET_CHAIN_ID)).toBe(true)
    expect(isHubChain(MONAD_MAINNET_CHAIN_ID)).toBe(true)
    expect(isHubChain(SOMNIA_MAINNET_CHAIN_ID)).toBe(true)
  })

  it('returns false for spoke chain IDs', () => {
    expect(isHubChain(ARBITRUM_CHAIN_ID)).toBe(false)
    expect(isHubChain(BASE_CHAIN_ID)).toBe(false)
    expect(isHubChain(ETHEREUM_CHAIN_ID)).toBe(false)
    expect(isHubChain(137)).toBe(false)   // Polygon
    expect(isHubChain(10)).toBe(false)    // Optimism
    expect(isHubChain(43114)).toBe(false) // Avalanche
  })

  it('returns false for unknown chain IDs', () => {
    expect(isHubChain(99999)).toBe(false)
    expect(isHubChain(0)).toBe(false)
  })
})

describe('resolveHubChainId', () => {
  it('returns the same chain ID for hub chains', () => {
    expect(resolveHubChainId(BSC_MAINNET_CHAIN_ID)).toBe(BSC_MAINNET_CHAIN_ID)
    expect(resolveHubChainId(MONAD_MAINNET_CHAIN_ID)).toBe(MONAD_MAINNET_CHAIN_ID)
  })

  it('maps all mainnet spoke chains to BSC mainnet by default', () => {
    expect(resolveHubChainId(ARBITRUM_CHAIN_ID)).toBe(BSC_MAINNET_CHAIN_ID)
    expect(resolveHubChainId(BASE_CHAIN_ID)).toBe(BSC_MAINNET_CHAIN_ID)
    expect(resolveHubChainId(ETHEREUM_CHAIN_ID)).toBe(BSC_MAINNET_CHAIN_ID)
    expect(resolveHubChainId(137)).toBe(BSC_MAINNET_CHAIN_ID)
  })

  it('maps testnet spoke chains to BSC testnet when network=testnet', () => {
    expect(resolveHubChainId(ARBITRUM_CHAIN_ID, 'testnet')).toBe(BSC_TESTNET_CHAIN_ID)
  })
})

describe('getPTokenAddress', () => {
  it('returns correct pToken address for BSC mainnet USDC', () => {
    const addr = getPTokenAddress(BSC_MAINNET_CHAIN_ID, 'USDC')
    expect(addr).toBe(PERIDOT_MARKETS[BSC_MAINNET_CHAIN_ID]?.['USDC'])
    expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  it('normalizes asset symbol to uppercase', () => {
    const lower = getPTokenAddress(BSC_MAINNET_CHAIN_ID, 'usdc')
    const upper = getPTokenAddress(BSC_MAINNET_CHAIN_ID, 'USDC')
    expect(lower).toBe(upper)
  })

  it('returns distinct addresses for different assets', () => {
    const usdc = getPTokenAddress(BSC_MAINNET_CHAIN_ID, 'USDC')
    const weth = getPTokenAddress(BSC_MAINNET_CHAIN_ID, 'WETH')
    const wbtc = getPTokenAddress(BSC_MAINNET_CHAIN_ID, 'WBTC')
    expect(usdc).not.toBe(weth)
    expect(weth).not.toBe(wbtc)
  })

  it('throws a descriptive error for unknown chain', () => {
    expect(() => getPTokenAddress(999, 'USDC')).toThrow('No pToken markets configured for chain 999')
  })

  it('throws a descriptive error for unknown asset on a known chain', () => {
    expect(() => getPTokenAddress(BSC_MAINNET_CHAIN_ID, 'FAKECOIN')).toThrow(
      'No pToken market for FAKECOIN',
    )
  })
})

describe('getUnderlyingTokenAddress', () => {
  it('returns correct underlying for BSC', () => {
    const addr = getUnderlyingTokenAddress(BSC_MAINNET_CHAIN_ID, 'USDC')
    expect(addr).toBe(BSC_UNDERLYING_TOKENS['USDC'])
  })

  it('returns correct underlying for Arbitrum (spoke)', () => {
    const addr = getUnderlyingTokenAddress(ARBITRUM_CHAIN_ID, 'USDC')
    expect(addr).toBe('0xaf88d065e77c8cC2239327C5EDb3A432268e5831')
  })

  it('is case-insensitive for BSC assets', () => {
    expect(getUnderlyingTokenAddress(BSC_MAINNET_CHAIN_ID, 'usdc')).toBe(
      getUnderlyingTokenAddress(BSC_MAINNET_CHAIN_ID, 'USDC'),
    )
  })

  it('throws for a hub chain with no token config (contracts not yet deployed)', () => {
    // Monad / Somnia are hub chains but have no token config until contracts deploy
    expect(() => getUnderlyingTokenAddress(MONAD_MAINNET_CHAIN_ID, 'USDC')).toThrow(
      /contracts may not be deployed yet/,
    )
    expect(() => getUnderlyingTokenAddress(SOMNIA_MAINNET_CHAIN_ID, 'USDC')).toThrow(
      /contracts may not be deployed yet/,
    )
  })

  it('throws for unknown asset on a hub chain that has token config', () => {
    // BSC has token config but FAKECOIN is not listed
    expect(() => getUnderlyingTokenAddress(BSC_MAINNET_CHAIN_ID, 'FAKECOIN')).toThrow(
      /No underlying token for FAKECOIN/,
    )
  })

  it('throws for unknown spoke chain', () => {
    expect(() => getUnderlyingTokenAddress(999, 'USDC')).toThrow()
  })

  it('throws for unknown asset on a known spoke chain', () => {
    expect(() => getUnderlyingTokenAddress(ARBITRUM_CHAIN_ID, 'FAKECOIN')).toThrow()
  })
})

describe('getControllerAddress', () => {
  it('returns the BSC mainnet controller address', () => {
    const addr = getControllerAddress(BSC_MAINNET_CHAIN_ID)
    expect(addr).toBe('0x6fC0c15531CB5901ac72aB3CFCd9dF6E99552e14')
  })

  it('throws for a chain with no controller configured', () => {
    expect(() => getControllerAddress(999)).toThrow('No Peridot controller for chain 999')
  })
})

describe('getAssetDecimals', () => {
  it('returns 6 for USDC and USDT', () => {
    expect(getAssetDecimals('USDC')).toBe(6)
    expect(getAssetDecimals('USDT')).toBe(6)
  })

  it('returns 8 for WBTC', () => {
    expect(getAssetDecimals('WBTC')).toBe(8)
  })

  it('returns 18 for WETH, WBNB, AUSD', () => {
    expect(getAssetDecimals('WETH')).toBe(18)
    expect(getAssetDecimals('WBNB')).toBe(18)
    expect(getAssetDecimals('AUSD')).toBe(18)
  })

  it('defaults to 18 for unknown assets', () => {
    expect(getAssetDecimals('UNKNOWN')).toBe(18)
  })

  it('is case-insensitive', () => {
    expect(getAssetDecimals('usdc')).toBe(6)
    expect(getAssetDecimals('Wbtc')).toBe(8)
  })
})
