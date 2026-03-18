#!/usr/bin/env node
/**
 * Peridot MCP Server
 *
 * Exposes all Peridot Agent Kit tools via the Model Context Protocol.
 * Works with Claude Desktop, Claude API (tool_use), Cursor, and any MCP client.
 *
 * Run:
 *   npx peridot-mcp
 *   # or after build:
 *   node dist/adapters/mcp/server.js
 *
 * Environment variables:
 *   PERIDOT_API_URL      — Peridot platform URL (default: https://app.peridot.finance)
 *   BICONOMY_API_KEY     — Required for cross-chain intent tools
 *   PERIDOT_NETWORK      — "mainnet" | "testnet" (default: "mainnet")
 *   PERIDOT_RPC_BSC      — Custom BSC RPC URL (optional)
 *   PERIDOT_RPC_ARB      — Custom Arbitrum RPC URL (optional)
 *
 * Claude Desktop config (~/.claude/claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "peridot": {
 *       "command": "npx",
 *       "args": ["@peridot/agent-kit/mcp"],
 *       "env": { "BICONOMY_API_KEY": "your-key-here" }
 *     }
 *   }
 * }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { z } from 'zod'
import { lendingTools } from '../../features/lending/tools'
import type { PeridotConfig, ToolDefinition } from '../../shared/types'
import { BSC_MAINNET_CHAIN_ID, ARBITRUM_CHAIN_ID } from '../../shared/constants'

// ---------------------------------------------------------------------------
// Future feature modules are imported and spread here — not in tools.ts —
// so the MCP server is the single place to opt-in to new capabilities.
// ---------------------------------------------------------------------------
// import { marginTools } from '../../features/margin/tools'     // Phase 2
// import { liquidationTools } from '../../features/liquidations/tools' // Phase 3

const allTools: ToolDefinition[] = [
  ...lendingTools,
  // ...marginTools,
  // ...liquidationTools,
]

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

const config: PeridotConfig = {
  apiBaseUrl: process.env['PERIDOT_API_URL'] ?? 'https://app.peridot.finance',
  network: (process.env['PERIDOT_NETWORK'] as 'mainnet' | 'testnet' | undefined) ?? 'mainnet',
  rpcUrls: {
    ...(process.env['PERIDOT_RPC_BSC'] ? { [BSC_MAINNET_CHAIN_ID]: process.env['PERIDOT_RPC_BSC'] } : {}),
    ...(process.env['PERIDOT_RPC_ARB'] ? { [ARBITRUM_CHAIN_ID]: process.env['PERIDOT_RPC_ARB'] } : {}),
  },
}

if (process.env['BICONOMY_API_KEY']) {
  config.biconomyApiKey = process.env['BICONOMY_API_KEY']
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'peridot-agent-kit',
  version: '0.1.0',
})

/** JSON replacer that serialises BigInt values as decimal strings. */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

for (const t of allTools) {
  // McpServer.tool() accepts a ZodRawShape (the .shape of a ZodObject)
  const schema = (t.inputSchema as z.ZodObject<z.ZodRawShape>).shape

  server.tool(
    t.name,
    t.description,
    schema,
    async (input: unknown) => {
      try {
        const result = await t.execute(input, config)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, bigintReplacer, 2) }],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        }
      }
    },
  )
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport()

// Top-level await is fine for ESM, but for the CJS bundle we wrap in
// an async IIFE so esbuild/tsup don't complain.
void (async () => {
  await server.connect(transport)
})()
