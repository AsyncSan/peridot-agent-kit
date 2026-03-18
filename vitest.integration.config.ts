import { defineConfig } from 'vitest/config'

/**
 * Integration test config — hits the real Peridot platform API.
 *
 * Run:
 *   pnpm test:integration
 *
 * Optional env vars:
 *   PERIDOT_API_URL   Override the platform base URL (default: https://app.peridot.finance)
 *   BICONOMY_API_KEY  Required only for cross-chain compose tests
 *
 * These tests make real HTTP requests and require network access.
 * They are excluded from the standard `pnpm test` run.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 15_000,
    // Sequential — avoid thundering-herd against the live API
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
})
