#!/usr/bin/env node
/**
 * test-tool-routing.ts
 *
 * Verifies that tool descriptions are LLM-friendly by sending test prompts to
 * GPT-4o-mini and checking that it selects the correct tool for each scenario.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx scripts/test-tool-routing.ts
 *
 * Exit code:
 *   0 — all routing checks pass
 *   1 — one or more routing checks failed
 */

import OpenAI from 'openai'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { lendingTools } from '../src/features/lending/tools'

// ---------------------------------------------------------------------------
// Build OpenAI-compatible function definitions from our Zod schemas
// ---------------------------------------------------------------------------

const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = lendingTools.map((t) => ({
  type: 'function' as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: zodToJsonSchema(t.inputSchema, { target: 'openApi3' }) as Record<string, unknown>,
  },
}))

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

interface RoutingCase {
  label: string
  prompt: string
  /** Tool name(s) Claude should pick — any match = pass */
  expectedTools: string[]
  /** Tool names that must NOT be chosen */
  forbiddenTools?: string[]
}

const cases: RoutingCase[] = [
  // ── Read / information ───────────────────────────────────────────────────
  {
    label: 'APY query → get_market_rates',
    prompt: 'What is the current USDC supply APY on BSC?',
    expectedTools: ['get_market_rates'],
  },
  {
    label: 'Market rates query → get_market_rates',
    prompt: 'Show me the borrow rate and utilization for WETH on BSC (chain 56)',
    expectedTools: ['get_market_rates'],
  },
  {
    label: 'User portfolio check → get_user_position',
    prompt: 'Show me my current Peridot position for address 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    expectedTools: ['get_user_position'],
  },
  {
    label: 'Health factor check → get_user_position',
    prompt: 'What is my health factor on Peridot? My address is 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    expectedTools: ['get_user_position'],
  },

  // ── Hub chain intents (BSC / Monad / Somnia) ─────────────────────────────
  {
    label: 'Hub supply (BSC) → build_hub_supply_intent',
    prompt: 'I am connected to BSC (chainId 56) and want to supply 500 USDC to Peridot. My address is 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    expectedTools: ['build_hub_supply_intent'],
  },
  {
    label: 'Hub withdraw (BSC) → build_hub_withdraw_intent or get_user_position',
    prompt: 'I am on BSC and want to withdraw 200 USDC from Peridot. Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    expectedTools: ['build_hub_withdraw_intent', 'get_user_position'],
  },
  {
    label: 'Hub repay (BSC) → build_hub_repay_intent',
    prompt: 'I want to repay my USDC borrow on Peridot. I am on BSC. Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266, amount: 100',
    expectedTools: ['build_hub_repay_intent'],
  },

  // ── Borrow safety flow ───────────────────────────────────────────────────
  {
    label: 'Borrow request → simulate_borrow or get_user_position first',
    prompt: 'I want to borrow 1000 USDC on BSC. Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    expectedTools: ['simulate_borrow', 'get_user_position', 'build_hub_borrow_intent'],
  },
  {
    label: 'Explicit simulate borrow → simulate_borrow',
    prompt: 'Simulate what happens if I borrow 500 USDC on BSC. Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    expectedTools: ['simulate_borrow'],
  },

  // ── Cross-chain intents (spoke chains) ───────────────────────────────────
  {
    label: 'Arbitrum supply → build_cross_chain_supply_intent',
    prompt: 'I am on Arbitrum (chainId 42161) and want to supply 100 USDC to Peridot. My address is 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    expectedTools: ['build_cross_chain_supply_intent'],
  },
  {
    label: 'Base supply → build_cross_chain_supply_intent',
    prompt: 'My wallet is on Base (chainId 8453). I want to supply 50 WETH to Peridot. Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    expectedTools: ['build_cross_chain_supply_intent'],
  },

  // ── Status ───────────────────────────────────────────────────────────────
  {
    label: 'Transaction status → check_transaction_status',
    prompt: 'Check the status of my cross-chain transaction with hash 0xabc123def456',
    expectedTools: ['check_transaction_status'],
  },

  // ── Routing discrimination (hub ≠ cross-chain) ──────────────────────────
  {
    label: 'Monad (hub) supply → hub, NOT cross-chain',
    prompt: 'I am on Monad testnet (chainId 143) and want to supply 200 USDC. Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    expectedTools: ['build_hub_supply_intent'],
    forbiddenTools: ['build_cross_chain_supply_intent'],
  },
]

// ---------------------------------------------------------------------------
// Run a single test case
// ---------------------------------------------------------------------------

const client = new OpenAI()

interface CaseResult {
  label: string
  passed: boolean
  chosenTool: string | null
  expectedTools: string[]
  note: string | null
}

async function runCase(c: RoutingCase): Promise<CaseResult> {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    tool_choice: 'required',
    tools: openaiTools,
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful Peridot DeFi assistant. ' +
          'Use the available tools to help the user. ' +
          'Pick the most appropriate tool based on the user request and the chain they are on.',
      },
      { role: 'user', content: c.prompt },
    ],
  })

  const toolCall = response.choices[0]?.message?.tool_calls?.[0]
  const chosenTool = toolCall?.type === 'function' ? toolCall.function.name : null

  const passed = chosenTool !== null && c.expectedTools.includes(chosenTool)

  const forbiddenPicked =
    c.forbiddenTools !== undefined && chosenTool !== null && c.forbiddenTools.includes(chosenTool)

  return {
    label: c.label,
    passed: passed && !forbiddenPicked,
    chosenTool,
    expectedTools: c.expectedTools,
    note: forbiddenPicked ? `picked forbidden tool: ${chosenTool}` : null,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!process.env['OPENAI_API_KEY']) {
    console.error('Error: OPENAI_API_KEY environment variable is required')
    process.exit(1)
  }

  console.log(`\nPeridot Tool Routing Test`)
  console.log(`Model: gpt-4o-mini`)
  console.log(`Tools: ${openaiTools.length} registered`)
  console.log(`Cases: ${cases.length}\n`)
  console.log('─'.repeat(70))

  const results: CaseResult[] = []
  let passed = 0
  let failed = 0

  for (const c of cases) {
    process.stdout.write(`  ${c.label} ... `)
    try {
      const result = await runCase(c)
      results.push(result)
      if (result.passed) {
        passed++
        console.log(`✓  (${result.chosenTool})`)
      } else {
        failed++
        const expected = result.expectedTools.join(' | ')
        const note = result.note ? ` [${result.note}]` : ''
        console.log(`✗  chose: ${result.chosenTool ?? 'none'}  expected: ${expected}${note}`)
      }
    } catch (err) {
      failed++
      results.push({ label: c.label, passed: false, chosenTool: null, expectedTools: c.expectedTools, note: String(err) })
      console.log(`✗  ERROR: ${String(err)}`)
    }
  }

  console.log('─'.repeat(70))
  console.log(`\nResults: ${passed}/${cases.length} passed\n`)

  if (failed > 0) {
    console.log('Failed cases:')
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  • ${r.label}`)
        console.log(`    chose: ${r.chosenTool ?? 'none'}`)
        console.log(`    expected one of: ${r.expectedTools.join(', ')}`)
        if (r.note) console.log(`    note: ${r.note}`)
      })
    console.log()
    process.exit(1)
  }

  console.log('All routing checks passed.')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
