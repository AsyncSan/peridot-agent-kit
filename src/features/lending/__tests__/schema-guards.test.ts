/**
 * Schema-guard tests: verify that Zod schemas on all intent/read functions
 * reject invalid inputs before any business logic or network call is made.
 *
 * These tests exercise .safeParse() directly so they are fast and network-free.
 */
import { describe, it, expect } from 'vitest'

// Hub intents
import { hubSupplySchema } from '../intents/hub/supply'
import { hubBorrowSchema } from '../intents/hub/borrow'
import { hubRepaySchema } from '../intents/hub/repay'
import { hubWithdrawSchema } from '../intents/hub/withdraw'
import { hubEnableCollateralSchema } from '../intents/hub/enable-collateral'
import { hubDisableCollateralSchema } from '../intents/hub/disable-collateral'

// Cross-chain intents
import { crossChainSupplySchema } from '../intents/cross-chain/supply'
import { crossChainBorrowSchema } from '../intents/cross-chain/borrow'
import { crossChainRepaySchema } from '../intents/cross-chain/repay'
import { crossChainWithdrawSchema } from '../intents/cross-chain/withdraw'

// Read schemas
import { simulateBorrowSchema } from '../read/simulate-borrow'
import { getAccountLiquiditySchema } from '../read/get-account-liquidity'
import { getUserPositionSchema } from '../read/get-user-position'

// Chain ID fixtures
const HUB = 56 // BSC — hub chain
const SPOKE = 42161 // Arbitrum — spoke chain
const VALID_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const BAD_ADDR = '0xabc' // too short

// ---------------------------------------------------------------------------
// Hub intent schemas — must reject spoke chains and bad addresses/amounts
// ---------------------------------------------------------------------------

describe('hubSupplySchema', () => {
  const base = { userAddress: VALID_ADDR, asset: 'USDC', amount: '100', chainId: HUB }

  it('accepts a valid hub chainId', () => {
    expect(hubSupplySchema.safeParse(base).success).toBe(true)
  })

  it('rejects a spoke chainId', () => {
    const result = hubSupplySchema.safeParse({ ...base, chainId: SPOKE })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).toContain('hub chain')
  })

  it('rejects an invalid userAddress', () => {
    expect(hubSupplySchema.safeParse({ ...base, userAddress: BAD_ADDR }).success).toBe(false)
  })

  it('rejects a negative amount', () => {
    expect(hubSupplySchema.safeParse({ ...base, amount: '-1' }).success).toBe(false)
  })

  it('rejects a non-numeric amount', () => {
    expect(hubSupplySchema.safeParse({ ...base, amount: 'abc' }).success).toBe(false)
  })
})

describe('hubBorrowSchema', () => {
  const base = { userAddress: VALID_ADDR, borrowAsset: 'USDC', borrowAmount: '100', collateralAssets: ['WETH'], chainId: HUB }

  it('accepts a valid hub chainId', () => {
    expect(hubBorrowSchema.safeParse(base).success).toBe(true)
  })

  it('rejects a spoke chainId', () => {
    expect(hubBorrowSchema.safeParse({ ...base, chainId: SPOKE }).success).toBe(false)
  })

  it('rejects an invalid userAddress', () => {
    expect(hubBorrowSchema.safeParse({ ...base, userAddress: BAD_ADDR }).success).toBe(false)
  })

  it('rejects a negative borrowAmount', () => {
    expect(hubBorrowSchema.safeParse({ ...base, borrowAmount: '-50' }).success).toBe(false)
  })
})

describe('hubRepaySchema', () => {
  const base = { userAddress: VALID_ADDR, asset: 'USDC', amount: '100', chainId: HUB }

  it('accepts a numeric amount', () => {
    expect(hubRepaySchema.safeParse(base).success).toBe(true)
  })

  it('accepts "max" as amount', () => {
    expect(hubRepaySchema.safeParse({ ...base, amount: 'max' }).success).toBe(true)
  })

  it('rejects a spoke chainId', () => {
    expect(hubRepaySchema.safeParse({ ...base, chainId: SPOKE }).success).toBe(false)
  })

  it('rejects an invalid userAddress', () => {
    expect(hubRepaySchema.safeParse({ ...base, userAddress: BAD_ADDR }).success).toBe(false)
  })

  it('rejects a negative amount', () => {
    expect(hubRepaySchema.safeParse({ ...base, amount: '-1' }).success).toBe(false)
  })
})

describe('hubWithdrawSchema', () => {
  const base = { userAddress: VALID_ADDR, asset: 'USDC', amount: '100', chainId: HUB }

  it('rejects a spoke chainId', () => {
    expect(hubWithdrawSchema.safeParse({ ...base, chainId: SPOKE }).success).toBe(false)
  })

  it('rejects an invalid userAddress', () => {
    expect(hubWithdrawSchema.safeParse({ ...base, userAddress: BAD_ADDR }).success).toBe(false)
  })

  it('rejects a negative amount', () => {
    expect(hubWithdrawSchema.safeParse({ ...base, amount: '-5' }).success).toBe(false)
  })
})

describe('hubEnableCollateralSchema', () => {
  const base = { userAddress: VALID_ADDR, assets: ['USDC'], chainId: HUB }

  it('rejects a spoke chainId', () => {
    expect(hubEnableCollateralSchema.safeParse({ ...base, chainId: SPOKE }).success).toBe(false)
  })

  it('rejects an invalid userAddress', () => {
    expect(hubEnableCollateralSchema.safeParse({ ...base, userAddress: BAD_ADDR }).success).toBe(false)
  })
})

describe('hubDisableCollateralSchema', () => {
  const base = { userAddress: VALID_ADDR, asset: 'USDC', chainId: HUB }

  it('rejects a spoke chainId', () => {
    expect(hubDisableCollateralSchema.safeParse({ ...base, chainId: SPOKE }).success).toBe(false)
  })

  it('rejects an invalid userAddress', () => {
    expect(hubDisableCollateralSchema.safeParse({ ...base, userAddress: BAD_ADDR }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Cross-chain intent schemas — must reject hub sourceChainId/targetChainId
// ---------------------------------------------------------------------------

describe('crossChainSupplySchema', () => {
  const base = { userAddress: VALID_ADDR, sourceChainId: SPOKE, asset: 'USDC', amount: '100' }

  it('accepts a valid spoke sourceChainId', () => {
    expect(crossChainSupplySchema.safeParse(base).success).toBe(true)
  })

  it('rejects a hub sourceChainId', () => {
    const result = crossChainSupplySchema.safeParse({ ...base, sourceChainId: HUB })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).toContain('spoke chain')
  })

  it('rejects an invalid userAddress', () => {
    expect(crossChainSupplySchema.safeParse({ ...base, userAddress: BAD_ADDR }).success).toBe(false)
  })

  it('rejects a negative amount', () => {
    expect(crossChainSupplySchema.safeParse({ ...base, amount: '-1' }).success).toBe(false)
  })
})

describe('crossChainBorrowSchema', () => {
  const base = { userAddress: VALID_ADDR, collateralAssets: ['WETH'], borrowAsset: 'USDC', borrowAmount: '500' }

  it('accepts without a targetChainId (stay on hub)', () => {
    expect(crossChainBorrowSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a spoke targetChainId', () => {
    expect(crossChainBorrowSchema.safeParse({ ...base, targetChainId: SPOKE }).success).toBe(true)
  })

  it('rejects a hub targetChainId', () => {
    const result = crossChainBorrowSchema.safeParse({ ...base, targetChainId: HUB })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).toContain('spoke chain')
  })

  it('rejects an invalid userAddress', () => {
    expect(crossChainBorrowSchema.safeParse({ ...base, userAddress: BAD_ADDR }).success).toBe(false)
  })

  it('rejects a negative borrowAmount', () => {
    expect(crossChainBorrowSchema.safeParse({ ...base, borrowAmount: '-5' }).success).toBe(false)
  })
})

describe('crossChainRepaySchema', () => {
  const base = { userAddress: VALID_ADDR, sourceChainId: SPOKE, asset: 'USDC', amount: '200' }

  it('accepts a valid spoke sourceChainId', () => {
    expect(crossChainRepaySchema.safeParse(base).success).toBe(true)
  })

  it('rejects a hub sourceChainId', () => {
    const result = crossChainRepaySchema.safeParse({ ...base, sourceChainId: HUB })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).toContain('spoke chain')
  })

  it('rejects an invalid userAddress', () => {
    expect(crossChainRepaySchema.safeParse({ ...base, userAddress: BAD_ADDR }).success).toBe(false)
  })

  it('rejects an invalid repayForAddress', () => {
    expect(
      crossChainRepaySchema.safeParse({ ...base, repayForAddress: BAD_ADDR }).success,
    ).toBe(false)
  })

  it('accepts a valid repayForAddress', () => {
    expect(
      crossChainRepaySchema.safeParse({ ...base, repayForAddress: VALID_ADDR }).success,
    ).toBe(true)
  })
})

describe('crossChainWithdrawSchema', () => {
  const base = { userAddress: VALID_ADDR, asset: 'USDC', amount: '100' }

  it('accepts without a targetChainId (stay on hub)', () => {
    expect(crossChainWithdrawSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a spoke targetChainId', () => {
    expect(crossChainWithdrawSchema.safeParse({ ...base, targetChainId: SPOKE }).success).toBe(true)
  })

  it('rejects a hub targetChainId', () => {
    const result = crossChainWithdrawSchema.safeParse({ ...base, targetChainId: HUB })
    expect(result.success).toBe(false)
    expect(JSON.stringify(result)).toContain('spoke chain')
  })

  it('rejects an invalid userAddress', () => {
    expect(crossChainWithdrawSchema.safeParse({ ...base, userAddress: BAD_ADDR }).success).toBe(false)
  })

  it('rejects a negative amount', () => {
    expect(crossChainWithdrawSchema.safeParse({ ...base, amount: '-10' }).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Read schemas
// ---------------------------------------------------------------------------

describe('simulateBorrowSchema', () => {
  const base = { address: VALID_ADDR, asset: 'USDC', amount: '500', chainId: HUB }

  it('accepts valid input', () => {
    expect(simulateBorrowSchema.safeParse(base).success).toBe(true)
  })

  it('rejects a spoke chainId', () => {
    expect(simulateBorrowSchema.safeParse({ ...base, chainId: SPOKE }).success).toBe(false)
  })

  it('rejects an invalid address', () => {
    expect(simulateBorrowSchema.safeParse({ ...base, address: BAD_ADDR }).success).toBe(false)
  })

  it('rejects a negative amount', () => {
    expect(simulateBorrowSchema.safeParse({ ...base, amount: '-100' }).success).toBe(false)
  })
})

describe('getAccountLiquiditySchema', () => {
  const base = { address: VALID_ADDR, chainId: HUB }

  it('accepts valid input', () => {
    expect(getAccountLiquiditySchema.safeParse(base).success).toBe(true)
  })

  it('rejects a spoke chainId', () => {
    expect(getAccountLiquiditySchema.safeParse({ ...base, chainId: SPOKE }).success).toBe(false)
  })

  it('rejects an invalid address', () => {
    expect(getAccountLiquiditySchema.safeParse({ ...base, address: BAD_ADDR }).success).toBe(false)
  })
})

describe('getUserPositionSchema', () => {
  it('accepts a valid address', () => {
    expect(getUserPositionSchema.safeParse({ address: VALID_ADDR }).success).toBe(true)
  })

  it('rejects an invalid address', () => {
    expect(getUserPositionSchema.safeParse({ address: BAD_ADDR }).success).toBe(false)
  })
})
