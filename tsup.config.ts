import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'adapters/langchain/index': 'src/adapters/langchain/index.ts',
    'adapters/vercel-ai/index': 'src/adapters/vercel-ai/index.ts',
    'adapters/mcp/server': 'src/adapters/mcp/server.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  // Peer deps must be external so consumers provide them
  external: ['@langchain/core', 'langchain', 'ai'],
  // The MCP server entry needs a shebang for use as a CLI
  banner: {
    'adapters/mcp/server': '#!/usr/bin/env node',
  },
})
