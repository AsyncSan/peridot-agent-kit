/**
 * LangChain adapter — unit tests.
 *
 * Verifies that createLangChainTools():
 *  - returns one StructuredTool per registered tool definition
 *  - preserves name, description, and Zod schema from the source ToolDefinition
 *  - executes tools by delegating to the underlying execute() function
 *  - supports optional category filtering
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLangChainTools } from '../index'
import { lendingTools } from '../../../features/lending/tools'

// ---------------------------------------------------------------------------
// Mock fetch so no real network calls escape
// ---------------------------------------------------------------------------

const MOCK_METRICS = {
  ok: true,
  data: {
    'USDC:56': { utilizationPct: 72.5, tvlUsd: 5_000_000, liquidityUnderlying: 100_000, liquidityUsd: 100_000, priceUsd: 1.0, collateral_factor_pct: 80, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
  },
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/markets/metrics')) return Promise.resolve({ ok: true, json: () => Promise.resolve(MOCK_METRICS) })
      if (url.includes('/api/apy'))             return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: {} }) })
      if (url.includes('/api/leaderboard'))     return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: { entries: [], total: 0 } }) })
      if (url.includes('/api/user/portfolio'))  return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: {} }) })
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`))
    }),
  )
})

afterEach(() => { vi.unstubAllGlobals() })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createLangChainTools', () => {
  it('returns one tool per registered ToolDefinition', () => {
    const tools = createLangChainTools()
    expect(tools).toHaveLength(lendingTools.length)
  })

  it('preserves tool names', () => {
    const tools = createLangChainTools()
    const toolNames = tools.map((t) => t.name)
    for (const def of lendingTools) {
      expect(toolNames, `Missing: ${def.name}`).toContain(def.name)
    }
  })

  it('preserves tool descriptions', () => {
    const tools = createLangChainTools()
    for (const lc of tools) {
      const source = lendingTools.find((d) => d.name === lc.name)!
      expect(lc.description).toBe(source.description)
    }
  })

  it('preserves the Zod schema (schema.parse exists)', () => {
    const tools = createLangChainTools()
    for (const lc of tools) {
      expect(typeof (lc.schema as any).parse, `No .parse on ${lc.name} schema`).toBe('function')
    }
  })

  it('returns no duplicate tool names', () => {
    const tools = createLangChainTools()
    const names = tools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('each tool has a non-empty description', () => {
    const tools = createLangChainTools()
    for (const t of tools) {
      expect(t.description.trim(), `Empty description on ${t.name}`).not.toBe('')
    }
  })

  describe('category filtering', () => {
    it('returns only lending tools when categories: ["lending"]', () => {
      const tools = createLangChainTools({}, { categories: ['lending'] })
      const lendingCount = lendingTools.filter((t) => t.category === 'lending').length
      expect(tools).toHaveLength(lendingCount)
      for (const t of tools) {
        expect(t.name).not.toBe('check_transaction_status')
      }
    })

    it('returns only status tools when categories: ["status"]', () => {
      const tools = createLangChainTools({}, { categories: ['status'] })
      expect(tools).toHaveLength(1)
      expect(tools[0]!.name).toBe('check_transaction_status')
    })

    it('returns all tools when no categories filter is supplied', () => {
      const tools = createLangChainTools({}, {})
      expect(tools).toHaveLength(lendingTools.length)
    })

    it('returns empty array for an unknown category', () => {
      const tools = createLangChainTools({}, { categories: ['nonexistent'] })
      expect(tools).toHaveLength(0)
    })
  })

  describe('tool execution (integration via _call)', () => {
    it('list_markets delegates to the underlying execute and returns JSON string', async () => {
      const tools = createLangChainTools({ apiBaseUrl: 'https://app.peridot.finance' })
      const tool = tools.find((t) => t.name === 'list_markets')!
      const raw = await (tool as any)._call({})
      const parsed = JSON.parse(raw) as { markets: unknown[]; count: number }
      expect(Array.isArray(parsed.markets)).toBe(true)
      expect(typeof parsed.count).toBe('number')
    })

    it('propagates errors from the underlying execute as thrown exceptions', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
      const tools = createLangChainTools()
      const tool = tools.find((t) => t.name === 'list_markets')!
      await expect((tool as any)._call({})).rejects.toThrow('network down')
    })
  })
})
