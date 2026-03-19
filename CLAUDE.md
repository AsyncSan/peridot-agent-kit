# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Peridot Agent Kit** (`@peridot-agent/agent-kit`) — A TypeScript npm package that enables AI agents to safely interact with Peridot's DeFi money markets. Published as an npm package; consumed by LLM applications.

**Core philosophy: "AI Proposes, User Disposes"**
- Agents never hold private keys or execute transactions
- All blockchain math (decimals, health factor, calldata encoding) is handled by the SDK, not the AI
- Agents simulate before acting, then return transaction intents for user signature
- Biconomy MEE `/compose` is used to build cross-chain payloads — `/execute` always stays with the user

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Compile to dist/ (tsup — ESM + CJS + .d.ts)
pnpm dev              # Build in watch mode
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
pnpm test             # vitest run
pnpm test:watch       # vitest (interactive)
pnpm changeset        # Create a changeset for a release
```

Run a single test file:
```bash
pnpm vitest run src/features/lending/read/__tests__/get-market-rates.test.ts
```

Execute a cross-chain intent from CLI (developer utility):
```bash
echo '<CrossChainIntent JSON>' | PRIVATE_KEY=0x... BICONOMY_API_KEY=... npx tsx scripts/execute-intent.ts
```

## Architecture

### Package structure

```
src/
├── shared/             # Foundation — no feature-specific logic
│   ├── types.ts        # All shared TypeScript types (ToolDefinition, intents, config)
│   ├── constants.ts    # Contract addresses, chain IDs, address helpers
│   ├── abis.ts         # Minimal viem parseAbi() definitions (pToken, Comptroller, ERC20)
│   └── api-client.ts   # PeridotApiClient (platform API + Biconomy API)
│
├── features/
│   └── lending/        # All lending/borrowing tools
│       ├── read/       # No side effects — API reads and simulations
│       ├── intents/
│       │   ├── hub/    # Same-chain (user on BSC/Monad/Somnia) → raw calldata via encodeFunctionData
│       │   └── cross-chain/  # Spoke→hub via Biconomy MEE compose
│       ├── status/     # check-transaction.ts (polls Biconomy)
│       └── tools.ts    # ToolDefinition[] array — the single registration point for all lending tools
│
└── adapters/
    ├── langchain/      # StructuredTool wrappers
    ├── vercel-ai/      # tool() wrappers for Vercel AI SDK
    └── mcp/server.ts   # MCP server (stdio) — the single file to add new feature tool arrays
```

### Hub vs. spoke chain distinction

**Hub chains** (BSC 56, Monad 143, Somnia 1868) host the pToken lending pools natively. Hub-chain intents return raw calldata (`HubTransactionIntent`) — user signs each call directly.

**Spoke chains** (Arbitrum 42161, Base 8453, Ethereum 1, Polygon 137, Optimism 10, Avalanche 43114) require cross-chain bridging. Spoke intents call Biconomy MEE `/compose` and return a `CrossChainIntent` with the composed payload. User submits to `/execute` in their dApp.

The helper `resolveHubChainId(spokeChainId)` maps any spoke chain → its hub (BSC for mainnet).

### Adding a new feature (margin, liquidations, etc.)

1. Create `src/features/<feature>/tools.ts` with a `featureTools: ToolDefinition[]` export, following the lending pattern
2. In `src/adapters/mcp/server.ts`, import and spread the new tools into `allTools`
3. In `src/adapters/langchain/index.ts` and `vercel-ai/index.ts`, spread the new tools into `toolsForConfig()`
4. New constants (addresses, ABIs) go in `src/shared/constants.ts` and `src/shared/abis.ts`

### Tool registration pattern

Each feature's `tools.ts` is the only place that wires together: Zod input schema + execute function + name/description for LLMs. The MCP server, LangChain, and Vercel AI adapters all consume `ToolDefinition[]` arrays — they never reference individual functions directly.

### Biconomy integration

- **Compose** (`/v1/instructions/compose`): Called in cross-chain intent builders. Safe to call server-side — only needs API key + user address, not private key.
- **Execute** (`/v1/execute`): Never called by the SDK. Called by the user's dApp or by `scripts/execute-intent.ts` (opt-in developer utility).
- **Status** (`/v1/explorer/transaction/:hash`): Called by `checkTransactionStatus` tool.

### CI/CD

- **CI** (`.github/workflows/ci.yml`): Runs on every PR — typecheck → lint → test → build
- **Release** (`.github/workflows/release.yml`): Uses `changesets/action`. When a changeset PR is merged to `main`, automatically publishes to npm.
- To release: run `pnpm changeset`, commit, push → CI creates a "Version Packages" PR → merge it → publishes.

## Key files reference

| File | Purpose |
|------|---------|
| `src/shared/types.ts` | All types including `PeridotConfig`, `ToolDefinition`, `HubTransactionIntent`, `CrossChainIntent` |
| `src/shared/constants.ts` | All contract addresses and chain helpers |
| `src/features/lending/tools.ts` | Tool definitions with LLM-optimized descriptions |
| `src/adapters/mcp/server.ts` | MCP server entry + the place to add new feature modules |
| `scripts/execute-intent.ts` | Developer CLI for executing cross-chain intents with a private key |

## Environment variables (MCP server)

| Variable | Required | Purpose |
|----------|----------|---------|
| `BICONOMY_API_KEY` | For cross-chain tools | Biconomy MEE API key |
| `PERIDOT_API_URL` | No | Override platform API (default: https://app.peridot.finance) |
| `PERIDOT_NETWORK` | No | `mainnet` or `testnet` (default: mainnet) |
| `PERIDOT_RPC_BSC` | No | Custom BSC RPC URL |
| `PERIDOT_RPC_ARB` | No | Custom Arbitrum RPC URL |
