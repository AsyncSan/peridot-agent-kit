import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['**/*.integration.test.ts', '**/node_modules/**', '**/dist/**', 'server/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['src/adapters/**', 'scripts/**', 'dist/**'],
    },
  },
})
