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
- [x] MCP Server — works with Claude Desktop, Cursor, and any MCP client (`@peridot/agent-kit/mcp`)
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

The MCP server exposes all Peridot tools over [Model Context Protocol](https://modelcontextprotocol.io), letting you connect directly from Claude Desktop, Cursor, or any MCP-compatible client — no code required.

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `BICONOMY_API_KEY` | Yes (cross-chain tools) | Biconomy MEE API key |
| `PERIDOT_API_URL` | No | Defaults to `https://app.peridot.finance` |
| `PERIDOT_NETWORK` | No | `mainnet` (default) or `testnet` |
| `PERIDOT_RPC_BSC` | No | Custom BSC RPC URL (falls back to public endpoint) |
| `PERIDOT_RPC_ARB` | No | Custom Arbitrum RPC URL |

### Option 1 — Claude Desktop (recommended for personal use)

Add this to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "peridot": {
      "command": "npx",
      "args": ["@peridot/agent-kit/mcp"],
      "env": {
        "BICONOMY_API_KEY": "your-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. The Peridot tools will appear automatically.

### Option 2 — Run locally from source

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

### Option 3 — Production / self-hosted

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

`get_market_rates` — Current supply/borrow APY and TVL for a given asset.

`get_user_position` — Total collateral, total debt, and health factor for a wallet.

`simulate_borrow` — Projects the new health factor and liquidation risk before a borrow is submitted.

`get_account_liquidity` — On-chain authoritative liquidity and shortfall from the Peridottroller contract.

### ✍️ Transaction Intents (Require User Signature)

These tools return calldata payloads. Nothing is sent to the chain until the user signs.

**Hub chain (direct, single-chain):**

`build_hub_supply_intent` · `build_hub_borrow_intent` · `build_hub_repay_intent` · `build_hub_withdraw_intent` · `build_enable_collateral_intent` · `build_disable_collateral_intent`

**Cross-chain (via Biconomy MEE):**

`build_cross_chain_supply_intent` · `build_cross_chain_borrow_intent` · `build_cross_chain_repay_intent` · `build_cross_chain_withdraw_intent`

**Status:**

`check_transaction_status` — Poll a Biconomy super-transaction hash for completion.

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

All tools share a common `ToolDefinition` interface. Adding support for a new framework means writing one function that maps that interface to whatever the framework expects.

### How it works

Every tool is a plain object:

```typescript
interface ToolDefinition<TInput, TOutput> {
  name: string           // snake_case identifier
  description: string    // shown to the LLM
  category: ToolCategory // 'lending' | 'margin' | ...
  inputSchema: ZodType   // Zod schema — validates input and generates JSON Schema
  execute: (input: TInput, config: PeridotConfig) => Promise<TOutput>
}
```

An adapter's only job is to wrap `execute` in whatever calling convention the framework requires, and pass the `inputSchema` to whatever type system the framework uses.

### Step-by-step

**1. Create the adapter file**

```
src/adapters/<framework>/index.ts
```

**2. Import the tool registry and map over it**

```typescript
import { lendingTools } from '../../features/lending/tools'
import type { PeridotConfig, ToolDefinition } from '../../shared/types'

export function createMyFrameworkTools(config: PeridotConfig = {}) {
  const tools = [...lendingTools] // add ...marginTools etc. as features are released

  return tools.map((tool) => {
    return myFramework.defineTool({
      name: tool.name,
      description: tool.description,
      // Most frameworks accept a Zod schema or its JSON Schema equivalent:
      schema: tool.inputSchema,
      // jsonSchema: zodToJsonSchema(tool.inputSchema),  // if the framework needs raw JSON Schema
      handler: (input: unknown) => tool.execute(input, config),
    })
  })
}
```

**3. Add the export to `package.json`**

```json
"exports": {
  "./my-framework": {
    "import": "./dist/adapters/my-framework/index.js",
    "require": "./dist/adapters/my-framework/index.cjs",
    "types": "./dist/adapters/my-framework/index.d.ts"
  }
}
```

**4. Add the entry point to `tsup.config.ts`**

```typescript
entry: [
  'src/index.ts',
  'src/adapters/langchain/index.ts',
  'src/adapters/vercel-ai/index.ts',
  'src/adapters/my-framework/index.ts',  // add this
  'src/adapters/mcp/server.ts',
],
```

**5. Add the peer dependency** (if the framework requires one)

```json
"peerDependencies": {
  "my-framework-sdk": ">=1.0.0"
},
"peerDependenciesMeta": {
  "my-framework-sdk": { "optional": true }
}
```

That's it. The new adapter will automatically expose every tool from the registry, including any future features added by the Peridot team.

### Notes

- If the framework needs **JSON Schema** instead of Zod, use `zodToJsonSchema(tool.inputSchema)` from `zod-to-json-schema` (already a dependency).
- New feature modules (e.g. `marginTools`) are not auto-included — you must explicitly spread them into your tools array. This is intentional so adapters can opt in per-feature.

---

## 🗺️ Roadmap

Phase 1: Core Money Market (✅ Active) — Lend, Borrow, Repay, Withdraw, Cross-chain.

Phase 2: Margin & Leverage (🚧 In Development) — 1-click looping strategies, leverage intents, and advanced swap routing.

Phase 3: Automated Liquidations — Tools for specialized keeper bots.

---

## 🛡️ Security

This SDK provides data and transaction preparation only. It does not execute transactions automatically. Always ensure your application interface clearly displays the intent data (especially health factor changes) before prompting the user to sign with their wallet.

---

## 🤝 Contributing

We welcome contributions! Please see our Contributing Guidelines to get started.
