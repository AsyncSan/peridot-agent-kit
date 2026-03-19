/**
 * MCP Server — unit + integration tests.
 *
 * Unit tests:  verify the tool registry (names, schemas, categories).
 * Integration: execute tools through the same handler pattern the MCP server
 *              uses, with fetch mocked so no real network calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { lendingTools } from '../../../features/lending/tools'
import type { PeridotConfig, ToolDefinition } from '../../../shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const allTools: ToolDefinition[] = [...lendingTools]

const config: PeridotConfig = {
  apiBaseUrl: 'https://app.peridot.finance',
  biconomyApiKey: 'test-key',
}

/** Mirrors the BigInt replacer used in server.ts. */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

/** Simulates the MCP server's try/catch handler around t.execute(). */
async function mcpExecute(tool: ToolDefinition, input: unknown) {
  try {
    const result = await tool.execute(input, config)
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, bigintReplacer, 2) }],
      isError: false,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
      isError: true,
    }
  }
}

function findTool(name: string) {
  const t = allTools.find((x) => x.name === name)
  if (!t) throw new Error(`Tool not found: ${name}`)
  return t
}

// ---------------------------------------------------------------------------
// Mock payloads
// ---------------------------------------------------------------------------

const MOCK_METRICS = {
  ok: true,
  data: {
    'USDC:56': { utilizationPct: 72.5, tvlUsd: 5_000_000, liquidityUnderlying: 100_000, liquidityUsd: 100_000, priceUsd: 1.0, collateral_factor_pct: 80, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
    'WETH:56': { utilizationPct: 55.0, tvlUsd: 10_000_000, liquidityUnderlying: 500, liquidityUsd: 1_500_000, priceUsd: 3000, collateral_factor_pct: 75, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
  },
}

const MOCK_APY = {
  ok: true,
  data: {
    usdc: {
      56: {
        supplyApy: 3.21, borrowApy: 5.67,
        peridotSupplyApy: 1.10, peridotBorrowApy: 0.80,
        boostSourceSupplyApy: 0.50, boostRewardsSupplyApy: 0.20,
        totalSupplyApy: 5.01, netBorrowApy: 4.87,
        timestamp: '2024-01-01T00:00:00Z',
      },
    },
  },
}

const MOCK_PORTFOLIO = {
  ok: true,
  data: {
    portfolio: { currentValue: 10_000, totalSupplied: 12_000, totalBorrowed: 5_000, netApy: 2.5, healthFactor: 2.4 },
    assets: [{ assetId: 'usdc', supplied: 12_000, borrowed: 5_000, net: 7_000, percentage: 100 }],
    transactions: { totalCount: 5, supplyCount: 2, borrowCount: 1, repayCount: 1, redeemCount: 1 },
    earnings: { effectiveApy: 2.5, totalLifetimeEarnings: 250 },
  },
}

const MOCK_LEADERBOARD = {
  ok: true,
  data: {
    entries: [
      { rank: 1, address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', totalPoints: 1500, supplyCount: 5, borrowCount: 2, repayCount: 1, redeemCount: 0, updatedAt: '2024-03-01T00:00:00.000Z' },
      { rank: 2, address: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8', totalPoints: 900, supplyCount: 3, borrowCount: 1, repayCount: 1, redeemCount: 1, updatedAt: '2024-03-01T00:00:00.000Z' },
    ],
    total: 2,
  },
}

const MOCK_LIQUIDATABLE = {
  ok: true,
  data: {
    accounts: [
      {
        address: '0x1234567890123456789012345678901234567890',
        chainId: 56,
        liquidityUsd: 0,
        shortfallUsd: 1500.5,
        checkedAt: '2024-01-01T00:01:00Z',
      },
      {
        address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        chainId: 56,
        liquidityUsd: 0,
        shortfallUsd: 250.0,
        checkedAt: '2024-01-01T00:01:00Z',
      },
    ],
    count: 2,
  },
}

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/apy'))                   return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_APY) })
      if (url.includes('/api/markets/metrics'))       return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_METRICS) })
      if (url.includes('/api/user/portfolio'))        return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_PORTFOLIO) })
      if (url.includes('/api/leaderboard'))           return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_LEADERBOARD) })
      if (url.includes('/api/liquidations/at-risk'))  return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_LIQUIDATABLE) })
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`))
    }),
  )
}

beforeEach(() => { mockFetch() })
afterEach(() => { vi.unstubAllGlobals() })

// ---------------------------------------------------------------------------
// Unit — tool registry
// ---------------------------------------------------------------------------

describe('tool registry', () => {
  const EXPECTED_TOOLS = [
    'list_markets',
    'get_leaderboard',
    'get_market_rates',
    'get_portfolio',
    'get_user_position',
    'simulate_borrow',
    'get_account_liquidity',
    'get_liquidatable_positions',
    'build_hub_supply_intent',
    'build_hub_borrow_intent',
    'build_hub_repay_intent',
    'build_hub_withdraw_intent',
    'build_enable_collateral_intent',
    'build_disable_collateral_intent',
    'build_liquidation_intent',
    'build_cross_chain_supply_intent',
    'build_cross_chain_borrow_intent',
    'build_cross_chain_repay_intent',
    'build_cross_chain_withdraw_intent',
    'check_transaction_status',
  ]

  it('registers all expected tools', () => {
    const names = allTools.map((t) => t.name)
    for (const expected of EXPECTED_TOOLS) {
      expect(names, `Missing tool: ${expected}`).toContain(expected)
    }
  })

  it('has no duplicate tool names', () => {
    const names = allTools.map((t) => t.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  it('every tool has a non-empty description', () => {
    for (const t of allTools) {
      expect(t.description.trim(), `Empty description on ${t.name}`).not.toBe('')
    }
  })

  it('every tool has a category', () => {
    for (const t of allTools) {
      expect(t.category, `Missing category on ${t.name}`).toBeTruthy()
    }
  })

  it('every tool has an inputSchema with a .parse method (Zod schema)', () => {
    for (const t of allTools) {
      expect(typeof (t.inputSchema as any).parse, `Bad schema on ${t.name}`).toBe('function')
    }
  })

  it('every tool has an execute function', () => {
    for (const t of allTools) {
      expect(typeof t.execute, `Missing execute on ${t.name}`).toBe('function')
    }
  })

  it('lending tools are categorised correctly', () => {
    const lendingNames = [
      'list_markets', 'get_leaderboard', 'get_market_rates', 'get_portfolio', 'get_user_position',
      'simulate_borrow', 'get_account_liquidity',
      'build_hub_supply_intent', 'build_hub_borrow_intent', 'build_hub_repay_intent',
      'build_hub_withdraw_intent', 'build_enable_collateral_intent', 'build_disable_collateral_intent',
      'build_cross_chain_supply_intent', 'build_cross_chain_borrow_intent',
      'build_cross_chain_repay_intent', 'build_cross_chain_withdraw_intent',
    ]
    for (const name of lendingNames) {
      expect(findTool(name).category).toBe('lending')
    }
  })

  it('liquidation tools are categorised as "liquidations"', () => {
    expect(findTool('get_liquidatable_positions').category).toBe('liquidations')
    expect(findTool('build_liquidation_intent').category).toBe('liquidations')
  })

  it('check_transaction_status is categorised as "status"', () => {
    expect(findTool('check_transaction_status').category).toBe('status')
  })
})

// ---------------------------------------------------------------------------
// Unit — description content (safety-critical routing rules)
//
// These tests pin the key phrases that steer an LLM agent toward safe behaviour.
// If a description is rewritten and a safety precondition is quietly dropped,
// the test breaks — making the problem visible before it reaches production.
// ---------------------------------------------------------------------------

describe('tool descriptions — safety preconditions', () => {
  it('get_user_position flags that healthFactor is a simplified estimate', () => {
    const desc = findTool('get_user_position').description.toLowerCase()
    // Must communicate overestimation so agents don't treat it as authoritative
    expect(desc).toMatch(/simplified|estimate/)
  })

  it('get_user_position directs agents to get_account_liquidity for precision', () => {
    const desc = findTool('get_user_position').description
    expect(desc).toContain('get_account_liquidity')
  })

  it('simulate_borrow requires calling it before borrow intents (ALWAYS directive)', () => {
    const desc = findTool('simulate_borrow').description
    expect(desc).toContain('ALWAYS')
  })

  it('simulate_borrow gates on isSafe=false / high-risk levels', () => {
    const desc = findTool('simulate_borrow').description
    expect(desc).toContain('isSafe')
  })

  it('build_hub_borrow_intent requires simulate_borrow pre-check', () => {
    const desc = findTool('build_hub_borrow_intent').description
    expect(desc).toContain('simulate_borrow')
  })

  it('build_cross_chain_borrow_intent requires simulate_borrow pre-check', () => {
    const desc = findTool('build_cross_chain_borrow_intent').description
    expect(desc).toContain('simulate_borrow')
  })

  it('build_hub_supply_intent names the valid hub chain IDs', () => {
    const desc = findTool('build_hub_supply_intent').description
    // All three hub chains must be named so the agent routes correctly
    expect(desc).toContain('56')
    expect(desc).toContain('143')
    expect(desc).toContain('1868')
  })

  it('build_hub_supply_intent directs non-hub chains to cross-chain tool', () => {
    const desc = findTool('build_hub_supply_intent').description
    expect(desc).toContain('build_cross_chain_supply_intent')
  })

  it('build_cross_chain_supply_intent names the hub chain IDs it must NOT be used for', () => {
    const desc = findTool('build_cross_chain_supply_intent').description
    // Must explicitly exclude hub chains so agents don't misroute
    expect(desc).toContain('56')
    expect(desc).toContain('143')
    expect(desc).toContain('1868')
  })

  it('build_disable_collateral_intent gates on a position check first', () => {
    const desc = findTool('build_disable_collateral_intent').description.toLowerCase()
    expect(desc).toMatch(/get_account_liquidity|get_user_position/)
  })

  it('get_user_position has ALWAYS call-before directive for borrow/withdraw/repay', () => {
    const desc = findTool('get_user_position').description
    expect(desc).toContain('ALWAYS')
  })

  it('build_liquidation_intent requires confirming shortfall > 0 before building', () => {
    const desc = findTool('build_liquidation_intent').description
    expect(desc).toContain('shortfallUsd')
    expect(desc).toContain('get_account_liquidity')
  })

  it('build_liquidation_intent names the REQUIRED pre-checks', () => {
    const desc = findTool('build_liquidation_intent').description
    expect(desc).toContain('REQUIRED')
  })

  it('get_liquidatable_positions directs agents to re-confirm with get_account_liquidity', () => {
    const desc = findTool('get_liquidatable_positions').description
    expect(desc).toContain('get_account_liquidity')
  })
})

// ---------------------------------------------------------------------------
// Unit — schema validation (Zod rejects bad input)
// ---------------------------------------------------------------------------

describe('input schema validation', () => {
  it('get_market_rates rejects missing asset', () => {
    const schema = findTool('get_market_rates').inputSchema as any
    expect(() => schema.parse({ chainId: 56 })).toThrow()
  })

  it('get_user_position rejects missing address', () => {
    const schema = findTool('get_user_position').inputSchema as any
    expect(() => schema.parse({})).toThrow()
  })

  it('build_hub_supply_intent rejects missing amount', () => {
    const schema = findTool('build_hub_supply_intent').inputSchema as any
    expect(() => schema.parse({ userAddress: '0xabc', asset: 'USDC' })).toThrow()
  })

  it('check_transaction_status rejects missing superTxHash', () => {
    const schema = findTool('check_transaction_status').inputSchema as any
    expect(() => schema.parse({})).toThrow()
  })

  it('build_hub_supply_intent accepts valid minimal input (chainId and enableAsCollateral default)', () => {
    const schema = findTool('build_hub_supply_intent').inputSchema as any
    expect(() =>
      schema.parse({ userAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', asset: 'USDC', amount: '100' }),
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Integration — MCP handler pattern (execute via the server wrapper)
// ---------------------------------------------------------------------------

describe('MCP handler — list_markets', () => {
  it('returns a list of markets with count', async () => {
    const tool = findTool('list_markets')
    const response = await mcpExecute(tool, {})
    expect(response.isError).toBe(false)
    const parsed = JSON.parse(response.content[0]!.text)
    expect(typeof parsed.count).toBe('number')
    expect(Array.isArray(parsed.markets)).toBe(true)
  })

  it('each market has all expected fields', async () => {
    const tool = findTool('list_markets')
    const response = await mcpExecute(tool, {})
    const parsed = JSON.parse(response.content[0]!.text)
    const market = parsed.markets[0]
    expect(typeof market.asset).toBe('string')
    expect(typeof market.chainId).toBe('number')
    expect(typeof market.tvlUsd).toBe('number')
    expect(typeof market.priceUsd).toBe('number')
    expect(typeof market.utilizationPct).toBe('number')
    expect(typeof market.liquidityUsd).toBe('number')
    expect(typeof market.collateralFactorPct).toBe('number')
  })

  it('filters by chainId when provided', async () => {
    const tool = findTool('list_markets')
    const response = await mcpExecute(tool, { chainId: 56 })
    const parsed = JSON.parse(response.content[0]!.text)
    expect(parsed.markets.every((m: any) => m.chainId === 56)).toBe(true)
  })
})

describe('MCP handler — get_leaderboard', () => {
  it('returns entries and total', async () => {
    const tool = findTool('get_leaderboard')
    const response = await mcpExecute(tool, {})
    expect(response.isError).toBe(false)
    const parsed = JSON.parse(response.content[0]!.text)
    expect(Array.isArray(parsed.entries)).toBe(true)
    expect(typeof parsed.total).toBe('number')
  })

  it('each entry has all expected fields', async () => {
    const tool = findTool('get_leaderboard')
    const response = await mcpExecute(tool, {})
    const parsed = JSON.parse(response.content[0]!.text)
    const e = parsed.entries[0]
    expect(typeof e.rank).toBe('number')
    expect(typeof e.address).toBe('string')
    expect(typeof e.totalPoints).toBe('number')
    expect(typeof e.supplyCount).toBe('number')
    expect(typeof e.borrowCount).toBe('number')
    expect(typeof e.repayCount).toBe('number')
    expect(typeof e.redeemCount).toBe('number')
    expect(typeof e.updatedAt).toBe('string')
  })

  it('accepts limit and chainId filters without error', async () => {
    const tool = findTool('get_leaderboard')
    const response = await mcpExecute(tool, { limit: 10, chainId: 56 })
    expect(response.isError).toBe(false)
    const parsed = JSON.parse(response.content[0]!.text)
    expect(Array.isArray(parsed.entries)).toBe(true)
  })
})

describe('MCP handler — get_market_rates', () => {
  it('returns a text content block with JSON', async () => {
    const tool = findTool('get_market_rates')
    const response = await mcpExecute(tool, { asset: 'USDC', chainId: 56 })
    expect(response.isError).toBe(false)
    expect(response.content[0]!.type).toBe('text')
    const parsed = JSON.parse(response.content[0]!.text)
    expect(parsed.asset).toBe('USDC')
  })

  it('result contains all APY fields', async () => {
    const tool = findTool('get_market_rates')
    const response = await mcpExecute(tool, { asset: 'USDC', chainId: 56 })
    const parsed = JSON.parse(response.content[0]!.text)
    expect(typeof parsed.supplyApyPct).toBe('number')
    expect(typeof parsed.borrowApyPct).toBe('number')
    expect(typeof parsed.totalSupplyApyPct).toBe('number')
    expect(typeof parsed.netBorrowApyPct).toBe('number')
    expect(typeof parsed.peridotSupplyApyPct).toBe('number')
    expect(parsed.supplyApyPct).toBe(3.21)
    expect(parsed.totalSupplyApyPct).toBe(5.01)
  })

  it('returns isError=true and an error message for an unknown asset', async () => {
    const tool = findTool('get_market_rates')
    const response = await mcpExecute(tool, { asset: 'FAKECOIN', chainId: 56 })
    expect(response.isError).toBe(true)
    expect(response.content[0]!.text).toContain('Error:')
    expect(response.content[0]!.text).toContain('FAKECOIN')
  })

  it('uses config.apiBaseUrl when fetching', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/apy'))             return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_APY) })
      if (url.includes('/api/markets/metrics')) return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_METRICS) })
      return Promise.reject(new Error(`Unexpected: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    const customConfig = { ...config, apiBaseUrl: 'https://custom.example.com' }
    const tool = findTool('get_market_rates')
    await tool.execute({ asset: 'USDC', chainId: 56 }, customConfig)

    const urls = (fetchMock.mock.calls as [string][]).map(([u]) => u)
    expect(urls.every((u) => u.startsWith('https://custom.example.com'))).toBe(true)
  })
})

describe('MCP handler — get_user_position', () => {
  it('returns a portfolio summary', async () => {
    const tool = findTool('get_user_position')
    const response = await mcpExecute(tool, { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' })
    expect(response.isError).toBe(false)
    const parsed = JSON.parse(response.content[0]!.text)
    expect(typeof parsed.totalSuppliedUsd).toBe('number')
    expect(typeof parsed.healthFactor).toBe('number')
    expect(Array.isArray(parsed.assets)).toBe(true)
  })

  it('computes healthFactor as totalSupplied / totalBorrowed', async () => {
    const tool = findTool('get_user_position')
    const response = await mcpExecute(tool, { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' })
    const parsed = JSON.parse(response.content[0]!.text)
    // 12000 / 5000 = 2.4
    expect(parsed.healthFactor).toBeCloseTo(2.4)
  })
})

describe('MCP handler — hub intent tools (no network calls)', () => {
  it('build_hub_supply_intent returns a hub intent with 3 calls', async () => {
    const tool = findTool('build_hub_supply_intent')
    const response = await mcpExecute(tool, {
      userAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      asset: 'USDC',
      amount: '100',
      chainId: 56,
    })
    expect(response.isError).toBe(false)
    const parsed = JSON.parse(response.content[0]!.text)
    expect(parsed.type).toBe('hub')
    expect(parsed.calls).toHaveLength(3)
  })

  it('build_hub_borrow_intent returns a hub intent with calls', async () => {
    const tool = findTool('build_hub_borrow_intent')
    const response = await mcpExecute(tool, {
      userAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      borrowAsset: 'USDC',
      borrowAmount: '50',
      collateralAssets: ['WETH'],
      chainId: 56,
    })
    expect(response.isError).toBe(false)
    const parsed = JSON.parse(response.content[0]!.text)
    expect(parsed.type).toBe('hub')
    expect(parsed.calls.length).toBeGreaterThan(0)
  })

  it('build_hub_repay_intent encodes approve + repayBorrow', async () => {
    const tool = findTool('build_hub_repay_intent')
    const response = await mcpExecute(tool, {
      userAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      asset: 'USDC',
      amount: '50',
      chainId: 56,
    })
    expect(response.isError).toBe(false)
    const parsed = JSON.parse(response.content[0]!.text)
    expect(parsed.type).toBe('hub')
    expect(parsed.summary).toMatch(/repay/i)
  })

  it('build_hub_withdraw_intent returns a hub intent', async () => {
    const tool = findTool('build_hub_withdraw_intent')
    const response = await mcpExecute(tool, {
      userAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      asset: 'USDC',
      amount: '100',
      chainId: 56,
    })
    expect(response.isError).toBe(false)
    const parsed = JSON.parse(response.content[0]!.text)
    expect(parsed.type).toBe('hub')
  })

  it('build_enable_collateral_intent encodes enterMarkets', async () => {
    const tool = findTool('build_enable_collateral_intent')
    const response = await mcpExecute(tool, {
      userAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      assets: ['USDC'],
      chainId: 56,
    })
    expect(response.isError).toBe(false)
    const parsed = JSON.parse(response.content[0]!.text)
    expect(parsed.type).toBe('hub')
    expect(parsed.calls[0]!.description).toMatch(/enterMarkets|collateral/i)
  })

  it('build_disable_collateral_intent encodes exitMarket', async () => {
    const tool = findTool('build_disable_collateral_intent')
    const response = await mcpExecute(tool, {
      userAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      asset: 'USDC',
      chainId: 56,
    })
    expect(response.isError).toBe(false)
    const parsed = JSON.parse(response.content[0]!.text)
    expect(parsed.type).toBe('hub')
  })

  it('hub intent tools return isError=true for unknown assets', async () => {
    const tool = findTool('build_hub_supply_intent')
    const response = await mcpExecute(tool, {
      userAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      asset: 'FAKECOIN',
      amount: '1',
      chainId: 56,
    })
    expect(response.isError).toBe(true)
    expect(response.content[0]!.text).toContain('Error:')
  })
})

describe('MCP handler — get_liquidatable_positions', () => {
  it('returns accounts and count', async () => {
    const tool = findTool('get_liquidatable_positions')
    const response = await mcpExecute(tool, {})
    expect(response.isError).toBe(false)
    const parsed = JSON.parse(response.content[0]!.text)
    expect(Array.isArray(parsed.accounts)).toBe(true)
    expect(typeof parsed.count).toBe('number')
    expect(parsed.count).toBe(2)
  })

  it('each account has all expected fields', async () => {
    const tool = findTool('get_liquidatable_positions')
    const response = await mcpExecute(tool, {})
    const parsed = JSON.parse(response.content[0]!.text)
    const acct = parsed.accounts[0]
    expect(typeof acct.address).toBe('string')
    expect(typeof acct.chainId).toBe('number')
    expect(typeof acct.shortfallUsd).toBe('number')
    expect(typeof acct.liquidityUsd).toBe('number')
    expect(typeof acct.checkedAt).toBe('string')
  })

  it('accounts are ordered by shortfallUsd descending', async () => {
    const tool = findTool('get_liquidatable_positions')
    const response = await mcpExecute(tool, {})
    const parsed = JSON.parse(response.content[0]!.text)
    expect(parsed.accounts[0]!.shortfallUsd).toBeGreaterThanOrEqual(parsed.accounts[1]!.shortfallUsd)
  })

  it('passes chainId filter to the API URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(MOCK_LIQUIDATABLE) })
    vi.stubGlobal('fetch', fetchMock)
    const tool = findTool('get_liquidatable_positions')
    await tool.execute({ chainId: 56 }, config)
    const url = (fetchMock.mock.calls[0] as [string])[0]
    expect(url).toContain('chainId=56')
  })

  it('accepts optional minShortfall and limit filters without error', async () => {
    const tool = findTool('get_liquidatable_positions')
    const response = await mcpExecute(tool, { minShortfall: 100, limit: 10 })
    expect(response.isError).toBe(false)
  })

  it('returns isError=true when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    const tool = findTool('get_liquidatable_positions')
    const response = await mcpExecute(tool, {})
    expect(response.isError).toBe(true)
    expect(response.content[0]!.text).toContain('Error:')
  })
})

describe('MCP handler — build_liquidation_intent', () => {
  it('returns a hub intent with 2 calls (approve + liquidateBorrow)', async () => {
    const tool = findTool('build_liquidation_intent')
    const response = await mcpExecute(tool, {
      liquidatorAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      borrowerAddress: '0x1234567890123456789012345678901234567890',
      repayAsset: 'USDC',
      repayAmount: '500',
      collateralAsset: 'WETH',
      chainId: 56,
    })
    expect(response.isError).toBe(false)
    const parsed = JSON.parse(response.content[0]!.text)
    expect(parsed.type).toBe('hub')
    expect(parsed.chainId).toBe(56)
    expect(parsed.calls).toHaveLength(2)
  })

  it('first call is the ERC-20 approve', async () => {
    const tool = findTool('build_liquidation_intent')
    const response = await mcpExecute(tool, {
      liquidatorAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      borrowerAddress: '0x1234567890123456789012345678901234567890',
      repayAsset: 'USDC',
      repayAmount: '500',
      collateralAsset: 'WETH',
      chainId: 56,
    })
    const parsed = JSON.parse(response.content[0]!.text)
    expect(parsed.calls[0]!.description).toMatch(/approve/i)
  })

  it('second call is the liquidateBorrow', async () => {
    const tool = findTool('build_liquidation_intent')
    const response = await mcpExecute(tool, {
      liquidatorAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      borrowerAddress: '0x1234567890123456789012345678901234567890',
      repayAsset: 'USDC',
      repayAmount: '500',
      collateralAsset: 'WETH',
      chainId: 56,
    })
    const parsed = JSON.parse(response.content[0]!.text)
    expect(parsed.calls[1]!.description).toMatch(/liquidate/i)
  })

  it('includes a warning about confirming position is still underwater', async () => {
    const tool = findTool('build_liquidation_intent')
    const response = await mcpExecute(tool, {
      liquidatorAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      borrowerAddress: '0x1234567890123456789012345678901234567890',
      repayAsset: 'USDC',
      repayAmount: '500',
      collateralAsset: 'WETH',
      chainId: 56,
    })
    const parsed = JSON.parse(response.content[0]!.text)
    expect(typeof parsed.warning).toBe('string')
    expect(parsed.warning).toMatch(/underwater/i)
  })

  it('accepts "max" repayAmount', async () => {
    const tool = findTool('build_liquidation_intent')
    const response = await mcpExecute(tool, {
      liquidatorAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      borrowerAddress: '0x1234567890123456789012345678901234567890',
      repayAsset: 'USDC',
      repayAmount: 'max',
      collateralAsset: 'WETH',
      chainId: 56,
    })
    expect(response.isError).toBe(false)
    const parsed = JSON.parse(response.content[0]!.text)
    expect(parsed.type).toBe('hub')
    expect(parsed.calls[0]!.description).toMatch(/max/i)
  })

  it('returns isError=true for unknown repay asset', async () => {
    const tool = findTool('build_liquidation_intent')
    const response = await mcpExecute(tool, {
      liquidatorAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      borrowerAddress: '0x1234567890123456789012345678901234567890',
      repayAsset: 'FAKECOIN',
      repayAmount: '100',
      collateralAsset: 'WETH',
      chainId: 56,
    })
    expect(response.isError).toBe(true)
    expect(response.content[0]!.text).toContain('Error:')
  })

  it('returns isError=true for spoke chain (non-hub)', async () => {
    const tool = findTool('build_liquidation_intent')
    const response = await mcpExecute(tool, {
      liquidatorAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      borrowerAddress: '0x1234567890123456789012345678901234567890',
      repayAsset: 'USDC',
      repayAmount: '500',
      collateralAsset: 'WETH',
      chainId: 42161,  // Arbitrum — spoke chain, must be rejected
    })
    expect(response.isError).toBe(true)
  })
})

describe('MCP handler — error wrapping', () => {
  it('wraps thrown strings as Error messages', async () => {
    const brokenTool: ToolDefinition = {
      name: 'broken',
      description: 'test',
      category: 'lending',
      inputSchema: { parse: (x: unknown) => x } as any,
      execute: () => { throw 'string error' },
    }
    const response = await mcpExecute(brokenTool, {})
    expect(response.isError).toBe(true)
    expect(response.content[0]!.text).toBe('Error: string error')
  })

  it('wraps Error instances with their message', async () => {
    const brokenTool: ToolDefinition = {
      name: 'broken',
      description: 'test',
      category: 'lending',
      inputSchema: { parse: (x: unknown) => x } as any,
      execute: () => { throw new Error('something went wrong') },
    }
    const response = await mcpExecute(brokenTool, {})
    expect(response.isError).toBe(true)
    expect(response.content[0]!.text).toBe('Error: something went wrong')
  })

  it('successful execute always returns isError=false', async () => {
    const goodTool: ToolDefinition = {
      name: 'good',
      description: 'test',
      category: 'lending',
      inputSchema: { parse: (x: unknown) => x } as any,
      execute: () => ({ ok: true }),
    }
    const response = await mcpExecute(goodTool, {})
    expect(response.isError).toBe(false)
  })

  it('serialises the result to JSON in the text block', async () => {
    const goodTool: ToolDefinition = {
      name: 'good',
      description: 'test',
      category: 'lending',
      inputSchema: { parse: (x: unknown) => x } as any,
      execute: () => ({ value: 42, name: 'foo' }),
    }
    const response = await mcpExecute(goodTool, {})
    const parsed = JSON.parse(response.content[0]!.text)
    expect(parsed.value).toBe(42)
    expect(parsed.name).toBe('foo')
  })
})
