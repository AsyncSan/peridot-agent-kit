import { Hono } from 'hono'
import { sql } from '../db'

const app = new Hono()

/**
 * GET /health
 * Fast liveness probe — no DB round-trip.
 * Used by Docker HEALTHCHECK and load-balancer ping.
 */
app.get('/', (c) => c.json({ ok: true, ts: Date.now() }))

/**
 * GET /health/db
 * Deep readiness probe — runs SELECT 1 against Postgres.
 * Returns 503 if the DB is unreachable so orchestrators can pull the instance.
 */
app.get('/db', async (c) => {
  const start = Date.now()
  try {
    await sql`SELECT 1`
    return c.json({ ok: true, db: 'up', latencyMs: Date.now() - start })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('health/db check failed:', message)
    return c.json({ ok: false, db: 'down', error: message }, 503)
  }
})

export { app as healthRoute }
