# 💎 Peridot Agent Kit

**Enable AI Agents to seamlessly and safely interact with Peridot's Money Markets.**

The Peridot Agent Kit provides LLM-ready tools (Skills) that allow AI agents to fetch market data, simulate lending positions, and prepare transaction intents for users. It is designed to bridge the gap between natural language and deterministic DeFi execution, without compromising user safety.

---

## Table of Contents

1. [Why use the Peridot Agent Kit?](#-why-use-the-peridot-agent-kit)
2. [Supported Frameworks](#️-supported-frameworks)
3. [Installation](#-installation)
4. [Running the MCP Server](#-running-the-mcp-server)
5. [Available Tools](#-available-tools-lend--borrow)
6. [Quick Start](#-quick-start-langchain-example)
7. [Adding a New Adapter](#-adding-a-new-adapter)
8. [Roadmap](#️-roadmap)
9. [Security](#️-security)
10. [Contributing](#-contributing)

---

## 🧠 Why use the Peridot Agent Kit?

LLMs are great at conversation but notoriously bad at calculating blockchain decimals, predicting liquidation thresholds, or formatting raw smart contract calldata.

This toolkit solves that by providing **AI-optimized wrappers** around the Peridot API.

**Our Core Philosophy: AI Proposes, User Disposes**
1. **Zero Math for AI:** Agents rely on the Peridot backend for precise `Health Factor` and decimal calculations.
2. **Read & Simulate First:** Agents simulate borrowing actions to warn users about liquidation risks *before* generating transactions.
3. **Intent-Based Execution:** Agents never hold private keys. They generate standardized transaction payloads (intents) that the user reviews and signs in their wallet or dApp frontend.

---

## 🛠️ Supported Frameworks

The core tools are framework-agnostic, but we provide ready-to-use wrappers for:
- [x] LangChain (`@peridot/agent-kit/langchain`)
- [x] Vercel AI SDK (`@peridot/agent-kit/vercel-ai`)
- [x] MCP Server - works with Claude Desktop, Cursor, and any MCP client (`@peridot/agent-kit/mcp`)
- [ ] ElizaOS plugin *(Coming soon)*

---

## 📦 Installation

```bash
npm install @peridot/agent-kit
# or
pnpm add @peridot/agent-kit
```

If you're using the LangChain or Vercel AI adapters, install the corresponding peer dependency:

```bash
# LangChain
npm install @langchain/core

# Vercel AI SDK
npm install ai
```

---

## 🖥️ Running the MCP Server

The MCP server exposes all Peridot tools over [Model Context Protocol](https://modelcontextprotocol.io), letting you connect directly from Claude Desktop, Cursor, or any MCP-compatible client - no code required.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `BICONOMY_API_KEY` | Yes (cross-chain tools) | Biconomy MEE API key |
| `PERIDOT_API_URL` | No | Defaults to `https://app.peridot.finance` |
| `PERIDOT_NETWORK` | No | `mainnet` (default) or `testnet` |
| `PERIDOT_RPC_BSC` | No | Custom BSC RPC URL (falls back to public endpoint) |
| `PERIDOT_RPC_ARB` | No | Custom Arbitrum RPC URL |

### Option 1 - Claude Desktop (recommended for personal use)

Add this to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "peridot": {
      "command": "npx",
      "args": ["-y", "-p", "@peridot/agent-kit", "peridot-mcp"],
      "env": {
        "BICONOMY_API_KEY": "your-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. The Peridot tools will appear automatically.

### Option 2 - Run locally from source

```bash
git clone https://github.com/AsyncSan/peridot-agent-kit
cd peridot-agent-kit
pnpm install
pnpm build

BICONOMY_API_KEY=your-key node dist/adapters/mcp/server.js
```

Or during development (no build step):

```bash
BICONOMY_API_KEY=your-key pnpm tsx src/adapters/mcp/server.ts
```

### Option 3 - Production / self-hosted

Build the package and run the compiled output with a process manager:

```bash
pnpm build

# With pm2
BICONOMY_API_KEY=your-key pm2 start dist/adapters/mcp/server.js --name peridot-mcp

# Or with a .env file
BICONOMY_API_KEY=your-key \
PERIDOT_RPC_BSC=https://your-bsc-rpc.com \
node dist/adapters/mcp/server.js
```

The server communicates over **stdio** (standard MCP transport), so it is meant to be spawned by an MCP host process, not accessed over HTTP directly.

---

## 🧰 Available Tools (Lend & Borrow)

These tools are formatted with clear descriptions and strict JSON schemas so your LLM knows exactly when and how to use them.

### 🔍 Read & Simulate (Risk-Free)

`list_markets` - Discover all available Peridot lending markets across all chains, sorted by TVL. Call this first when the user asks "what can I lend or borrow?".

`get_leaderboard` - Ranked list of top Peridot users by points earned. Supports limit and chainId filters.

`get_market_rates` - Full rate breakdown for an asset: base supply/borrow APY, PERIDOT reward APY, boost APY (Morpho/PancakeSwap/Magma), total supply APY, net borrow APY, TVL, utilization, liquidity, price, and collateral factor.

`get_user_position` - Total collateral, total debt, and health factor for a wallet.

`simulate_borrow` - Projects the new health factor and liquidation risk before a borrow is submitted.

`get_account_liquidity` - On-chain authoritative liquidity and shortfall from the Peridot Comptroller contract.

### ✍️ Transaction Intents (Require User Signature)

These tools return calldata payloads. Nothing is sent to the chain until the user signs.

**Hub chain (direct, single-chain):**

`build_hub_supply_intent` · `build_hub_borrow_intent` · `build_hub_repay_intent` · `build_hub_withdraw_intent` · `build_enable_collateral_intent` · `build_disable_collateral_intent`

**Cross-chain (via Biconomy MEE):**

`build_cross_chain_supply_intent` · `build_cross_chain_borrow_intent` · `build_cross_chain_repay_intent` · `build_cross_chain_withdraw_intent`

**Status:**

`check_transaction_status` - Poll a Biconomy super-transaction hash for completion.

---

## 🚀 Quick Start (LangChain Example)

```typescript
import { ChatOpenAI } from "@langchain/openai"
import { createReactAgent } from "langchain/agents"
import { createLangChainTools } from "@peridot/agent-kit/langchain"

const tools = createLangChainTools({
  biconomyApiKey: process.env.BICONOMY_API_KEY,
})

const agent = await createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-4o", temperature: 0 }),
  tools,
})

const result = await agent.invoke({
  input: "I want to borrow 500 USDC against my existing collateral. Is it safe?"
})

console.log(result.output)
```

**Vercel AI SDK:**

```typescript
import { generateText } from "ai"
import { openai } from "@ai-sdk/openai"
import { createVercelAITools } from "@peridot/agent-kit/vercel-ai"

const { text } = await generateText({
  model: openai("gpt-4o"),
  tools: createVercelAITools({ biconomyApiKey: process.env.BICONOMY_API_KEY }),
  prompt: "What is the USDC borrow APY on Peridot right now?",
})
```

---

## 🔌 Adding a New Adapter

An adapter's only job: iterate over the tool registry and wrap each `execute` function in whatever calling convention your framework expects.

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

Use `src/adapters/langchain/index.ts` and `src/adapters/vercel-ai/index.ts` as canonical examples. Both are under 65 lines.

### Implementation

**1. Create `src/adapters/my-framework/index.ts`**

Copy the pattern used by the existing adapters. The key difference between frameworks is their return shape:

- **LangChain** expects `StructuredTool[]` (an array of class instances)
- **Vercel AI SDK** expects `Record<string, Tool>` (an object keyed by tool name)

Check your framework's docs and pick the right shape. The internals are identical:

```typescript
import { lendingTools } from '../../features/lending/tools'
import type { PeridotConfig, ToolDefinition } from '../../shared/types'
import type { z } from 'zod'

// List which feature modules this adapter includes.
// Explicit opt-in is intentional: adapters control their own scope.
function allTools(config: PeridotConfig): ToolDefinition[] {
  return [
    ...lendingTools,
    // ...marginTools,     // Phase 2 — uncomment when released
  ]
}

export function createMyFrameworkTools(config: PeridotConfig = {}) {
  return allTools(config).map((tool) =>
    myFramework.register({
      name: tool.name,
      description: tool.description,
      // Pass Zod schema directly if the framework supports it:
      schema: tool.inputSchema as z.ZodObject<z.ZodRawShape>,
      // Or convert to JSON Schema if it doesn't:
      // schema: zodToJsonSchema(tool.inputSchema),
      execute: (input: unknown) => tool.execute(input, config),
    })
  )
}
```

Optionally support category filtering (LangChain adapter does this):

```typescript
export function createMyFrameworkTools(
  config: PeridotConfig = {},
  options?: { categories?: string[] },
) {
  const tools = options?.categories
    ? allTools(config).filter((t) => options.categories!.includes(t.category))
    : allTools(config)
  // ...map over tools
}
```

**2. Register in `src/adapters/mcp/server.ts`**

The MCP server has its own `allTools` array. Add new feature modules there too so they appear in Claude Desktop and other MCP clients:

```typescript
const allTools: ToolDefinition[] = [
  ...lendingTools,
  // ...marginTools,  // add here when Phase 2 ships
]
```

**3. Wire up the three config files**

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

That's it. The new adapter automatically exposes every tool in its `allTools` list, including future features when they're spread in.

---

## 🗺️ Roadmap

Phase 1: Core Money Market (✅ Active) - Lend, Borrow, Repay, Withdraw, Cross-chain.

Phase 2: Margin & Leverage (🚧 In Development) - 1-click looping strategies, leverage intents, and advanced swap routing.

Phase 3: Automated Liquidations - Tools for specialized keeper bots.

---

## 🛡️ Security

This SDK provides data and transaction preparation only. It does not execute transactions automatically. Always ensure your application interface clearly displays the intent data (especially health factor changes) before prompting the user to sign with their wallet.

---

## 🤝 Contributing

We welcome contributions! Please see our Contributing Guidelines to get started.
