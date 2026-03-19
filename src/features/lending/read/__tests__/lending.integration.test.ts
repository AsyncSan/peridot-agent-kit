/**
 * Integration tests — Peridot platform API (live network).
 *
 * These tests make real HTTP requests against https://app.peridot.finance
 * (or PERIDOT_API_URL if set). No mocks. No wallet signing.
 *
 * Run:  pnpm test:integration
 *
 * What is tested:
 *   - /api/markets/metrics   → shape + sanity of market data
 *   - /api/apy               → shape + sanity of APY data
 *   - /api/user/portfolio-data → shape when address has no positions (404-safe)
 *   - getMarketRates (tool)  → full merged result with real APY values
 *   - simulateBorrow (tool)  → runs against real portfolio data
 *   - Hub intent builders    → correct calldata (no network, but run in this suite for completeness)
 *
 * What is NOT tested:
 *   - Transaction execution or signing
 *   - Biconomy compose (requires API key + live infra)
 *   - get_account_liquidity (requires RPC)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { PeridotApiClient } from '../../../../shared/api-client'
import { getMarketRates } from '../get-market-rates'
import { getUserPosition } from '../get-user-position'
import { simulateBorrow } from '../simulate-borrow'
import { buildHubSupplyIntent } from '../../intents/hub/supply'
import { buildHubBorrowIntent } from '../../intents/hub/borrow'
import { buildHubRepayIntent } from '../../intents/hub/repay'
import { buildHubWithdrawIntent } from '../../intents/hub/withdraw'
import type { PeridotConfig } from '../../../../shared/types'
import type { RawMarketApy } from '../../../../shared/api-client'
import { BSC_MAINNET_CHAIN_ID } from '../../../../shared/constants'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_URL = process.env['PERIDOT_API_URL'] ?? 'https://app.peridot.finance'
const config: PeridotConfig = { apiBaseUrl: API_URL }

// A known address used only for read calls — no funds needed, no signing
const TEST_ADDRESS = '0x0000000000000000000000000000000000000001'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPositiveNumber(v: unknown): boolean {
  return typeof v === 'number' && isFinite(v) && v >= 0
}

// ---------------------------------------------------------------------------
// /api/markets/metrics
// ---------------------------------------------------------------------------

describe('PeridotApiClient.getMarketMetrics [live]', () => {
  let metrics: Awaited<ReturnType<PeridotApiClient['getMarketMetrics']>>

  beforeAll(async () => {
    const client = new PeridotApiClient(config)
    metrics = await client.getMarketMetrics()
  })

  it('returns a non-empty record', () => {
    expect(Object.keys(metrics).length).toBeGreaterThan(0)
  })

  it('keys follow the ASSET:chainId format', () => {
    for (const key of Object.keys(metrics)) {
      expect(key).toMatch(/^[A-Z0-9-]+:\d+$/)
    }
  })

  it('USDC:56 (BSC) is present', () => {
    expect(metrics['USDC:56']).toBeDefined()
  })

  it('USDC:56 has valid numeric fields', () => {
    const m = metrics['USDC:56']!
    expect(isPositiveNumber(m.tvlUsd)).toBe(true)
    expect(isPositiveNumber(m.utilizationPct)).toBe(true)
    expect(isPositiveNumber(m.priceUsd)).toBe(true)
    expect(m.utilizationPct).toBeLessThanOrEqual(100)
    expect(m.priceUsd).toBeGreaterThan(0.9)   // USDC should be ~$1
    expect(m.priceUsd).toBeLessThan(1.1)
  })

  it('every entry has a non-empty updatedAt timestamp', () => {
    for (const [key, m] of Object.entries(metrics)) {
      expect(m.updatedAt, `Missing updatedAt on ${key}`).toBeTruthy()
      expect(() => new Date(m.updatedAt)).not.toThrow()
    }
  })

  it('collateral_factor_pct is between 0 and 100 for all entries', () => {
    for (const [key, m] of Object.entries(metrics)) {
      expect(m.collateral_factor_pct ?? 0, key).toBeGreaterThanOrEqual(0)
      expect(m.collateral_factor_pct ?? 0, key).toBeLessThanOrEqual(100)
    }
  })
})

// ---------------------------------------------------------------------------
// /api/apy
// ---------------------------------------------------------------------------

describe('PeridotApiClient.getMarketApy [live]', () => {
  let apyAll: Awaited<ReturnType<PeridotApiClient['getMarketApy']>>
  let apyBsc: Awaited<ReturnType<PeridotApiClient['getMarketApy']>>

  beforeAll(async () => {
    const client = new PeridotApiClient(config)
    ;[apyAll, apyBsc] = await Promise.all([
      client.getMarketApy(),
      client.getMarketApy(BSC_MAINNET_CHAIN_ID),
    ])
  })

  it('returns a non-empty record', () => {
    expect(Object.keys(apyAll).length).toBeGreaterThan(0)
  })

  it('keys are lowercase asset IDs', () => {
    for (const key of Object.keys(apyAll)) {
      expect(key).toBe(key.toLowerCase())
    }
  })

  it('usdc on BSC (56) is present', () => {
    expect(apyAll['usdc']?.[BSC_MAINNET_CHAIN_ID]).toBeDefined()
  })

  it('USDC:56 has all required APY fields', () => {
    const entry = apyAll['usdc']![BSC_MAINNET_CHAIN_ID] as RawMarketApy
    const fields: Array<keyof RawMarketApy> = [
      'supplyApy', 'borrowApy',
      'peridotSupplyApy', 'peridotBorrowApy',
      'boostSourceSupplyApy', 'boostRewardsSupplyApy',
      'totalSupplyApy', 'netBorrowApy',
    ]
    for (const f of fields) {
      expect(isPositiveNumber(entry[f]), `${f} should be a non-negative number`).toBe(true)
    }
  })

  it('totalSupplyApy >= supplyApy (base is a component of total)', () => {
    const entry = apyAll['usdc']![BSC_MAINNET_CHAIN_ID] as RawMarketApy
    expect(entry.totalSupplyApy).toBeGreaterThanOrEqual(entry.supplyApy - 0.001) // float tolerance
  })

  it('APY values are reasonable (< 1000% — sanity cap)', () => {
    for (const [asset, chains] of Object.entries(apyAll)) {
      for (const [chainId, entry] of Object.entries(chains)) {
        expect(entry.totalSupplyApy, `${asset}:${chainId} totalSupplyApy`).toBeLessThan(1000)
        expect(entry.borrowApy, `${asset}:${chainId} borrowApy`).toBeLessThan(1000)
      }
    }
  })

  it('chainId-filtered response only contains entries for BSC (56)', () => {
    for (const chains of Object.values(apyBsc)) {
      for (const chainId of Object.keys(chains)) {
        expect(Number(chainId)).toBe(BSC_MAINNET_CHAIN_ID)
      }
    }
  })

  it('timestamp is a parseable ISO string', () => {
    const entry = apyAll['usdc']![BSC_MAINNET_CHAIN_ID] as RawMarketApy
    expect(entry.timestamp).toBeTruthy()
    expect(new Date(entry.timestamp).getTime()).not.toBeNaN()
  })
})

// ---------------------------------------------------------------------------
// get_market_rates tool — merged result
// ---------------------------------------------------------------------------

describe('getMarketRates tool [live]', () => {
  it('returns real APY values for USDC on BSC', async () => {
    const result = await getMarketRates({ asset: 'USDC', chainId: BSC_MAINNET_CHAIN_ID }, config)

    expect(result.asset).toBe('USDC')
    expect(result.chainId).toBe(BSC_MAINNET_CHAIN_ID)

    // Market fields
    expect(result.tvlUsd).toBeGreaterThan(0)
    expect(result.priceUsd).toBeGreaterThan(0.9)
    expect(result.utilizationPct).toBeGreaterThanOrEqual(0)
    expect(result.utilizationPct).toBeLessThanOrEqual(100)

    // APY fields — should now be real numbers, not hardcoded 0
    expect(result.supplyApyPct).toBeGreaterThanOrEqual(0)
    expect(result.borrowApyPct).toBeGreaterThanOrEqual(0)
    expect(result.totalSupplyApyPct).toBeGreaterThanOrEqual(result.supplyApyPct - 0.001)

    // Explicitly confirm they're no longer the old placeholder 0
    // (at least one APY component should be > 0 for an active market)
    const hasAnyApy = result.supplyApyPct > 0 || result.peridotSupplyApyPct > 0 || result.totalSupplyApyPct > 0
    expect(hasAnyApy, 'All APY fields are 0 — live data may not be flowing').toBe(true)
  })

  it('returns data for WETH on BSC', async () => {
    const result = await getMarketRates({ asset: 'WETH', chainId: BSC_MAINNET_CHAIN_ID }, config)
    expect(result.asset).toBe('WETH')
    expect(result.priceUsd).toBeGreaterThan(100) // WETH >> $1
    expect(result.tvlUsd).toBeGreaterThanOrEqual(0)
  })

  it('throws a helpful error for an unknown asset', async () => {
    await expect(
      getMarketRates({ asset: 'NOTAREAL', chainId: BSC_MAINNET_CHAIN_ID }, config),
    ).rejects.toThrow(/NOTAREAL|chain 56/)
  })
})

// ---------------------------------------------------------------------------
// get_user_position tool
// ---------------------------------------------------------------------------

describe('getUserPosition tool [live]', () => {
  it('returns a structurally valid position for any address', async () => {
    const result = await getUserPosition({ address: TEST_ADDRESS, chainId: 56 }, config)

    expect(result.address).toBe(TEST_ADDRESS)
    expect(typeof result.totalSuppliedUsd).toBe('number')
    expect(typeof result.totalBorrowedUsd).toBe('number')
    expect(Array.isArray(result.assets)).toBe(true)
  })

  it('returns null healthFactor when there are no borrows', async () => {
    // TEST_ADDRESS is empty — should have no borrows
    const result = await getUserPosition({ address: TEST_ADDRESS, chainId: 56 }, config)
    if (result.totalBorrowedUsd === 0) {
      expect(result.healthFactor).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// simulateBorrow tool
// ---------------------------------------------------------------------------

describe('simulateBorrow tool [live]', () => {
  it('returns safe result for a tiny borrow on an empty account', async () => {
    // Empty account: no collateral → immediately liquidatable / no collateral warning
    const result = await simulateBorrow(
      { address: TEST_ADDRESS, asset: 'USDC', amount: '1', chainId: BSC_MAINNET_CHAIN_ID },
      config,
    )
    // No collateral → isSafe should be false and warning should mention collateral
    expect(result.borrowAmountUsd).toBeGreaterThan(0)
    expect(result.isSafe).toBe(false)
    expect(result.warning).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Hub intent builders [no network — run here as smoke tests]
// ---------------------------------------------------------------------------

describe('hub intent tools — calldata smoke tests [no network]', () => {
  const USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

  it('buildHubSupplyIntent produces valid hub intent for USDC', () => {
    const intent = buildHubSupplyIntent(
      { userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC_MAINNET_CHAIN_ID },
      config,
    )
    expect(intent.type).toBe('hub')
    expect(intent.chainId).toBe(BSC_MAINNET_CHAIN_ID)
    expect(intent.calls).toHaveLength(3) // approve + mint + enterMarkets
    expect(intent.calls.every((c) => c.to.startsWith('0x'))).toBe(true)
    expect(intent.calls.every((c) => c.data.startsWith('0x'))).toBe(true)
  })

  it('buildHubBorrowIntent produces valid calls for USDC with WETH collateral', () => {
    const intent = buildHubBorrowIntent(
      {
        userAddress: USER,
        borrowAsset: 'USDC',
        borrowAmount: '500',
        collateralAssets: ['WETH'],
        chainId: BSC_MAINNET_CHAIN_ID,
      },
      config,
    )
    expect(intent.type).toBe('hub')
    expect(intent.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('buildHubRepayIntent produces valid calls', () => {
    const intent = buildHubRepayIntent(
      { userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC_MAINNET_CHAIN_ID },
      config,
    )
    expect(intent.type).toBe('hub')
    expect(intent.summary).toMatch(/repay/i)
  })

  it('buildHubWithdrawIntent produces valid calls', () => {
    const intent = buildHubWithdrawIntent(
      { userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC_MAINNET_CHAIN_ID },
      config,
    )
    expect(intent.type).toBe('hub')
    expect(intent.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('bigint value fields are 0n in all calls', () => {
    const intent = buildHubSupplyIntent(
      { userAddress: USER, asset: 'USDC', amount: '100', chainId: BSC_MAINNET_CHAIN_ID },
      config,
    )
    for (const call of intent.calls) {
      expect(call.value).toBe(0n)
    }
  })
})
