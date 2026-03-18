/**
 * Vercel AI adapter — unit tests.
 *
 * Verifies that createVercelAITools():
 *  - returns one entry per registered tool definition
 *  - keys are the tool names
 *  - each entry has the expected Vercel AI tool shape (description, parameters, execute)
 *  - execute delegates to the underlying ToolDefinition.execute()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createVercelAITools } from '../index'
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

describe('createVercelAITools', () => {
  it('returns one entry per registered ToolDefinition', () => {
    const tools = createVercelAITools()
    expect(Object.keys(tools)).toHaveLength(lendingTools.length)
  })

  it('keys match the tool names', () => {
    const tools = createVercelAITools()
    for (const def of lendingTools) {
      expect(tools, `Missing key: ${def.name}`).toHaveProperty(def.name)
    }
  })

  it('has no duplicate keys', () => {
    const tools = createVercelAITools()
    const keys = Object.keys(tools)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('each entry has a description string', () => {
    const tools = createVercelAITools()
    for (const [name, t] of Object.entries(tools)) {
      expect(typeof (t as any).description, `No description on ${name}`).toBe('string')
      expect((t as any).description.trim(), `Empty description on ${name}`).not.toBe('')
    }
  })

  it('each entry has a parameters object with a .parse method (Zod schema)', () => {
    const tools = createVercelAITools()
    for (const [name, t] of Object.entries(tools)) {
      expect(typeof (t as any).parameters?.parse, `No .parse on ${name} parameters`).toBe('function')
    }
  })

  it('each entry has an execute function', () => {
    const tools = createVercelAITools()
    for (const [name, t] of Object.entries(tools)) {
      expect(typeof (t as any).execute, `No execute on ${name}`).toBe('function')
    }
  })

  it('descriptions match the source ToolDefinition', () => {
    const tools = createVercelAITools()
    for (const def of lendingTools) {
      expect((tools[def.name] as any).description).toBe(def.description)
    }
  })

  describe('tool execution', () => {
    it('list_markets execute returns the underlying result', async () => {
      const tools = createVercelAITools({ apiBaseUrl: 'https://app.peridot.finance' })
      const result = await (tools['list_markets'] as any).execute({}) as { markets: unknown[]; count: number }
      expect(Array.isArray(result.markets)).toBe(true)
      expect(typeof result.count).toBe('number')
    })

    it('propagates errors from the underlying execute', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
      const tools = createVercelAITools()
      await expect((tools['list_markets'] as any).execute({})).rejects.toThrow('network down')
    })

    it('passes config to the underlying execute', async () => {
      const customUrl = 'https://custom.peridot.finance'
      const tools = createVercelAITools({ apiBaseUrl: customUrl })
      // The fetch mock captures the URL — verify the custom base was used
      await (tools['list_markets'] as any).execute({})
      const calls = vi.mocked(fetch).mock.calls
      const usedUrl = calls[0][0] as string
      expect(usedUrl).toContain(customUrl)
    })
  })
})
