---
name: peridot-agent-kit structure
description: Full implemented structure of the peridot-agent-kit npm package as of March 2026
type: project
---

Implemented the full @peridot/agent-kit package structure.

**Why:** User wants to ship an AI agent toolkit for Peridot DeFi — lending skills first, then MCP server, with extensibility for margin/liquidations.

**How to apply:** When making additions or changes, follow the established patterns:
- New features go in `src/features/<name>/tools.ts` with a `ToolDefinition[]` export
- MCP server in `src/adapters/mcp/server.ts` is where new tool arrays are registered
- Hub intents = pure encodeFunctionData (no network calls)
- Cross-chain intents = Biconomy compose API call (needs biconomyApiKey)
- Biconomy execute is never called by the SDK — that's the user's job

Key decisions made:
- tsup for build (ESM + CJS dual)
- vitest for tests
- changesets for versioning/releases
- GitHub Actions CI/CD: ci.yml (PR checks) + release.yml (changesets publish)
- `scripts/execute-intent.ts` is the opt-in private-key execution script for devs/bots
