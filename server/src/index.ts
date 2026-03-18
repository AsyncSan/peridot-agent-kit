import { serve } from '@hono/node-server'
import { loadEnv } from './env'
import { app } from './app'
import { sql } from './db'

// Validate all env vars before binding to a port — throws with a clear message
// if anything is wrong so the process exits immediately instead of crashing on
// the first request.
const env = loadEnv()

console.log(`peridot-mcp-server starting on ${env.HOST}:${env.PORT}`)
console.log(`network: ${env.NETWORK_PRESET}`)

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, () => {
  console.log(`peridot-mcp-server running on http://${env.HOST}:${env.PORT}`)
})

// ── Graceful shutdown ─────────────────────────────────────────────────────────

let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true

  console.log(`\n${signal} received — shutting down gracefully`)

  // Force-exit if drain takes too long (e.g. a stuck DB query)
  const forceExit = setTimeout(() => {
    console.error('Graceful shutdown timed out after 10s — forcing exit')
    process.exit(1)
  }, 10_000)
  forceExit.unref()

  // Stop accepting new HTTP connections; wait for in-flight requests to finish
  server.close(async () => {
    console.log('HTTP server closed')

    try {
      await sql.end({ timeout: 5 })
      console.log('DB pool closed')
    } catch (err) {
      console.error('Error closing DB pool:', err)
    }

    clearTimeout(forceExit)
    process.exit(0)
  })
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT',  () => void shutdown('SIGINT'))
