# 💎 Peridot Agent Kit

**Give AI agents safe, structured access to Peridot's DeFi money markets.**

The Peridot Agent Kit is a TypeScript SDK that wraps Peridot's lending protocol in LLM-ready tools (Skills). Agents can read live market data, simulate positions, and build transaction intents — all without ever touching a private key. Users review and sign every transaction themselves.

---

## Get started in 3 steps

### Step 1 — Install

```bash
npm install @peridot-agent/agent-kit
```

### Step 2 — Pick your setup

**Use with Claude Desktop or Cursor (no code needed)**

Add this to `~/.claude/claude_desktop_config.json` (or your Cursor MCP config):

```json
{
  "mcpServers": {
    "peridot": {
      "command": "npx",
      "args": ["-y", "-p", "@peridot-agent/agent-kit", "peridot-mcp"],
      "env": {
        "BICONOMY_API_KEY": "your-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. Ask it *"What can I lend on Peridot?"* — it just works.

**Use in your own agent (LangChain)**

```typescript
import { createLangChainTools } from "@peridot-agent/agent-kit/langchain"

const tools = createLangChainTools({
  biconomyApiKey: process.env.BICONOMY_API_KEY,
})
// pass tools to your agent as usual
```

**Use in your own agent (Vercel AI SDK)**

```typescript
import { createVercelAITools } from "@peridot-agent/agent-kit/vercel-ai"

const tools = createVercelAITools({
  biconomyApiKey: process.env.BICONOMY_API_KEY,
})
// pass tools to generateText / streamText
```

### Step 3 — Get a Biconomy API key

Cross-chain tools (Arbitrum, Base, Ethereum, Polygon, Optimism, Avalanche) require a [Biconomy MEE API key](https://dashboard.biconomy.io). Same-chain tools on BSC, Monad, and Somnia work without one.

---

## Table of Contents

1. [Why this exists](#-why-this-exists)
2. [Core safety model](#-core-safety-model)
3. [Supported frameworks](#️-supported-frameworks)
4. [Installation](#-installation)
5. [Running the MCP Server](#-running-the-mcp-server)
6. [Available tools](#-available-tools)
7. [Agent workflow guide](#-agent-workflow-guide)
8. [Quick start examples](#-quick-start-examples)
9. [Adding a new adapter](#-adding-a-new-adapter)
10. [Roadmap](#️-roadmap)
11. [Security](#️-security)
12. [Contributing](#-contributing)

---

## 🧠 Why this exists

LLMs are excellent at understanding intent ("I want to earn yield on my USDC") but unreliable at the precision work DeFi requires — calculating liquidation thresholds, applying per-asset collateral factors, encoding smart contract calldata, or handling cross-chain bridging logic.

This kit bridges that gap. Every tool handles the math and encoding; the agent handles the conversation.

---

## 🛡️ Core safety model

**AI Proposes, User Disposes** — three non-negotiable rules:

1. **Agents never hold keys.** All tools produce *intents* (structured calldata) that the user reviews and signs in their own wallet or dApp.
2. **Simulate before act.** `simulate_borrow` must be called before any borrow intent. `get_user_position` or `get_account_liquidity` must be called before withdrawals. Tools enforce this in their descriptions.
3. **Backend handles the math.** Health factors, decimal conversions, and ABI encoding live in the SDK — not in the LLM's context window.

---

## 🛠️ Supported frameworks

| Framework | Import path | Status |
|---|---|---|
| MCP (Claude Desktop, Cursor, any MCP client) | `@peridot-agent/agent-kit/mcp` | ✅ |
| LangChain | `@peridot-agent/agent-kit/langchain` | ✅ |
| Vercel AI SDK | `@peridot-agent/agent-kit/vercel-ai` | ✅ |
| ElizaOS | — | Coming soon |

---

## 📦 Installation

```bash
npm install @peridot-agent/agent-kit
# or
pnpm add @peridot-agent/agent-kit
```

Install the peer dependency for your framework:

```bash
npm install @langchain/core   # LangChain
npm install ai                # Vercel AI SDK
```

---

## 🖥️ Running the MCP Server

The MCP server exposes all Peridot tools over [Model Context Protocol](https://modelcontextprotocol.io), letting you connect directly from Claude Desktop, Cursor, or any MCP-compatible client — no code required.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `BICONOMY_API_KEY` | Yes (cross-chain tools) | Biconomy MEE API key |
| `PERIDOT_API_URL` | No | Override platform API (default: `https://app.peridot.finance`) |
| `PERIDOT_NETWORK` | No | `mainnet` (default) or `testnet` |
| `PERIDOT_RPC_BSC` | No | Custom BSC RPC URL |
| `PERIDOT_RPC_ARB` | No | Custom Arbitrum RPC URL |

### Option 1 — Claude Desktop (recommended for personal use)

Add this to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "peridot": {
      "command": "npx",
      "args": ["-y", "-p", "@peridot-agent/agent-kit", "peridot-mcp"],
      "env": {
        "BICONOMY_API_KEY": "your-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. The Peridot tools appear automatically.

### Option 2 — Run locally from source

```bash
git clone https://github.com/AsyncSan/peridot-agent-kit
cd peridot-agent-kit
pnpm install && pnpm build

BICONOMY_API_KEY=your-key node dist/adapters/mcp/server.js
```

Or during development (no build step):

```bash
BICONOMY_API_KEY=your-key pnpm tsx src/adapters/mcp/server.ts
```

### Option 3 — Production / self-hosted

```bash
pnpm build

# With pm2
BICONOMY_API_KEY=your-key pm2 start dist/adapters/mcp/server.js --name peridot-mcp

# Or with a .env file
BICONOMY_API_KEY=your-key \
PERIDOT_RPC_BSC=https://your-bsc-rpc.com \
node dist/adapters/mcp/server.js
```

The server communicates over **stdio** (standard MCP transport) and is spawned by an MCP host — not accessed over HTTP.

---

## 🧰 Available tools

### 🔍 Read & Simulate (no side effects)

| Tool | When to call it | Key outputs |
|---|---|---|
| `list_markets` | User asks what they can lend/borrow, or you need to discover available assets | asset, chainId, priceUsd, tvlUsd, utilizationPct, liquidityUsd, collateralFactorPct |
| `get_market_rates` | User asks about APY, yield, or borrow rates for a specific asset | supplyApyPct, borrowApyPct, PERIDOT reward APY, boost APY, netBorrowApyPct, TVL, liquidity |
| `get_user_position` | Before any borrow, withdraw, or repay — to know the user's current exposure | totalSuppliedUsd, totalBorrowedUsd, netApyPct, simplified healthFactor, per-asset breakdown |
| `simulate_borrow` | **Required** before every borrow intent | projectedHealthFactor, isSafe, riskLevel, maxSafeBorrowUsd |
| `get_account_liquidity` | When precision matters: near-liquidation, large withdrawal, or health factor < 1.5 | liquidityUsd (borrow headroom), shortfallUsd (underwater amount), isHealthy |
| `get_leaderboard` | User asks about top users, their own rank, or activity leaderboard | rank, address, totalPoints, supplyCount, borrowCount, repayCount, redeemCount |

### ✍️ Transaction Intents (require user signature)

These tools return calldata. Nothing touches the chain until the user signs.

**Chain selection rule:**
- User on **BSC (56), Monad (143), or Somnia (1868)** → use `build_hub_*` tools
- User on **Arbitrum (42161), Base (8453), Ethereum (1), Polygon (137), Optimism (10), or Avalanche (43114)** → use `build_cross_chain_*` tools

| Tool | Returns | User action |
|---|---|---|
| `build_hub_supply_intent` | `calls[]`: approve → mint → enterMarkets | Sign each call in sequence |
| `build_hub_borrow_intent` | `calls[]`: enterMarkets → borrow | Sign each call in sequence |
| `build_hub_repay_intent` | `calls[]`: approve → repayBorrow | Sign each call in sequence |
| `build_hub_withdraw_intent` | `calls[]`: redeem | Sign each call in sequence |
| `build_enable_collateral_intent` | `calls[]`: enterMarkets | Sign the call |
| `build_disable_collateral_intent` | `calls[]`: exitMarket | Sign the call |
| `build_cross_chain_supply_intent` | `biconomyInstructions` | Sign once in dApp → Biconomy executes |
| `build_cross_chain_borrow_intent` | `biconomyInstructions` | Sign once in dApp → Biconomy executes |
| `build_cross_chain_repay_intent` | `biconomyInstructions` | Sign once in dApp → Biconomy executes |
| `build_cross_chain_withdraw_intent` | `biconomyInstructions` | Sign once in dApp → Biconomy executes |

### 🔄 Status

| Tool | When to call it |
|---|---|
| `check_transaction_status` | After a cross-chain intent is submitted. Poll every ~10s until `success` or `failed`. |

---

## 🗺️ Agent workflow guide

### Workflow 1: User wants to lend

```
1. list_markets          → show available assets + TVL
2. get_market_rates      → show APY for chosen asset
3. build_hub_supply_intent (or build_cross_chain_supply_intent)
4. Present calls to user → user signs
```

### Workflow 2: User wants to borrow

```
1. get_user_position     → understand current collateral + exposure
2. simulate_borrow       → project health factor for requested amount
   ↳ isSafe=false?       → explain risk, suggest smaller amount, STOP
   ↳ riskLevel=high?     → warn clearly before proceeding
3. build_hub_borrow_intent (or build_cross_chain_borrow_intent)
4. Present calls to user → user signs
```

### Workflow 3: User wants to withdraw

```
1. get_user_position     → check for active borrows
   ↳ no borrows?         → safe to proceed
   ↳ has borrows?        → call get_account_liquidity first
2. get_account_liquidity → verify withdrawal won't cause shortfall
3. build_hub_withdraw_intent (or build_cross_chain_withdraw_intent)
4. Present calls to user → user signs
```

### Workflow 4: Track a cross-chain transaction

```
After user submits biconomyInstructions in their dApp:
1. check_transaction_status(superTxHash)  → poll every ~10s
   ↳ "pending" / "processing" → keep polling
   ↳ "success"               → confirm to user
   ↳ "failed"                → explain and offer to retry
```

---

### Suggested system prompt

Include this in your agent's system prompt to set the right expectations:

```
You are a DeFi assistant with access to Peridot's money market protocol.

Rules you must follow:
- ALWAYS call simulate_borrow before building any borrow intent. Never skip this.
- ALWAYS call get_user_position before building withdraw or repay intents.
- If simulate_borrow returns isSafe=false, explain the risk and do not proceed.
- Never claim to execute transactions — you build intents that the user signs.
- Hub chains are BSC (56), Monad (143), Somnia (1868). All others are spoke chains.
- For spoke-chain users, use build_cross_chain_* tools, not build_hub_* tools.
- After a cross-chain transaction is submitted, offer to track it with check_transaction_status.
- Quote specific numbers (APY, health factor, USD values) — don't be vague.
```

---

## 🚀 Quick start examples

### LangChain

```typescript
import { ChatOpenAI } from "@langchain/openai"
import { createReactAgent } from "langchain/agents"
import { createLangChainTools } from "@peridot-agent/agent-kit/langchain"

const tools = createLangChainTools({
  biconomyApiKey: process.env.BICONOMY_API_KEY,
})

const agent = await createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-4o", temperature: 0 }),
  tools,
})

const result = await agent.invoke({
  input: "I want to borrow 500 USDC on BSC. My address is 0x... Is it safe?",
})

console.log(result.output)
// Agent will: get_user_position → simulate_borrow → report risk level
// → if safe, build_hub_borrow_intent → present calldata to user
```

Filter to a specific category if you only want read tools:

```typescript
const readOnlyTools = createLangChainTools({}, { categories: ['lending'] })
```

### Vercel AI SDK

```typescript
import { generateText } from "ai"
import { openai } from "@ai-sdk/openai"
import { createVercelAITools } from "@peridot-agent/agent-kit/vercel-ai"

const { text } = await generateText({
  model: openai("gpt-4o"),
  tools: createVercelAITools({
    biconomyApiKey: process.env.BICONOMY_API_KEY,
  }),
  prompt: "What is the current USDC supply APY on Peridot? Show me all boosted yields.",
})
```

### Direct SDK usage (no LLM)

Import any tool function directly for use in your own code:

```typescript
import { listMarkets, getMarketRates, simulateBorrow } from "@peridot-agent/agent-kit"

const { markets } = await listMarkets({}, { apiBaseUrl: "https://app.peridot.finance" })
const rates = await getMarketRates({ asset: "usdc", chainId: 56 }, config)

const sim = await simulateBorrow({
  address: "0x...",
  asset: "usdc",
  chainId: 56,
  amount: "500",
}, config)

if (!sim.isSafe) {
  console.log(`Too risky — max safe borrow: $${sim.maxSafeBorrowUsd}`)
}
```

---

## 🔌 Adding a new adapter

An adapter's only job is to wrap each `execute` function in the calling convention your framework expects. Both existing adapters are under 65 lines.

### The contract

```typescript
interface ToolDefinition<TInput, TOutput> {
  name: string           // snake_case tool identifier
  description: string    // shown to the LLM — do not truncate
  category: ToolCategory // 'lending' | 'margin' | 'status' | ...
  inputSchema: ZodType   // Zod schema — handles validation and JSON Schema generation
  execute: (input: TInput, config: PeridotConfig) => Promise<TOutput>
}
```

### Implementation

**1. Create `src/adapters/my-framework/index.ts`**

Use `src/adapters/langchain/index.ts` or `src/adapters/vercel-ai/index.ts` as your template.
The only framework-specific part is the return shape:

```typescript
import { lendingTools } from '../../features/lending/tools'
import type { PeridotConfig, ToolDefinition } from '../../shared/types'
import type { z } from 'zod'

function allTools(_config: PeridotConfig): ToolDefinition[] {
  return [
    ...lendingTools,
    // ...marginTools,  // Phase 2 — uncomment when released
  ]
}

export function createMyFrameworkTools(config: PeridotConfig = {}) {
  return allTools(config).map((tool) =>
    myFramework.register({
      name: tool.name,
      description: tool.description,
      schema: tool.inputSchema as z.ZodObject<z.ZodRawShape>,
      execute: (input: unknown) => tool.execute(input, config),
    })
  )
}
```

**2. Wire up the three config files**

```json
// package.json — add export
"./my-framework": {
  "import": "./dist/adapters/my-framework/index.js",
  "require": "./dist/adapters/my-framework/index.cjs",
  "types":   "./dist/adapters/my-framework/index.d.ts"
}
```

```typescript
// tsup.config.ts — add entry point
'src/adapters/my-framework/index': 'src/adapters/my-framework/index.ts',
```

```json
// package.json — add optional peer dep if the framework SDK is external
"peerDependencies": { "my-framework-sdk": ">=1.0.0" },
"peerDependenciesMeta": { "my-framework-sdk": { "optional": true } }
```

The new adapter automatically gets every tool in `allTools`, including future features when they're spread in.

---

## 🗺️ Roadmap

**Phase 1: Core Money Market** ✅ Active
Lend, Borrow, Repay, Withdraw, Cross-chain via Biconomy MEE.

**Phase 2: Margin & Leverage** 🚧 In Development
One-click looping strategies, leverage intents, advanced swap routing.

**Phase 3: Automated Liquidations**
Tools for specialized keeper bots to identify and liquidate underwater positions.

---

## 🛡️ Security

This SDK produces transaction intents only. It never executes transactions, holds private keys, or calls Biconomy `/execute`. Always ensure your UI shows the full intent (especially projected health factor changes) before prompting the user to sign.

---

## 🤝 Contributing

We welcome contributions. Please see our Contributing Guidelines to get started.
