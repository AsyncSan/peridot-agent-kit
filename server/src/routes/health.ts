import { Hono } from 'hono'
import { sql, tables } from '../db'

const app = new Hono()

/** Stale threshold in seconds — warn when ingest hasn't run within this window. */
const STALE_THRESHOLD_SECS = 300

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

/**
 * GET /health/data
 * Reports the freshness of the two key ingest tables.
 * Returns 200 with stale: true when data is older than STALE_THRESHOLD_SECS.
 * Useful for monitoring dashboards and alerting.
 */
app.get('/data', async (c) => {
  const nowMs = Date.now()
  try {
    const [metricsRow] = await sql<[{ updated_at: Date | null }]>`
      SELECT MAX(updated_at) AS updated_at
      FROM ${sql(tables.assetMetricsLatest)}
    `
    const [apyRow] = await sql<[{ ts: Date | null }]>`
      SELECT MAX(timestamp) AS ts
      FROM ${sql(tables.apyLatest)}
    `

    const metricsAgeMs = metricsRow.updated_at ? nowMs - metricsRow.updated_at.getTime() : null
    const apyAgeMs = apyRow.ts ? nowMs - apyRow.ts.getTime() : null
    const metricsAgeSecs = metricsAgeMs !== null ? Math.round(metricsAgeMs / 1000) : null
    const apyAgeSecs = apyAgeMs !== null ? Math.round(apyAgeMs / 1000) : null

    const isStale =
      metricsAgeSecs === null ||
      apyAgeSecs === null ||
      metricsAgeSecs > STALE_THRESHOLD_SECS ||
      apyAgeSecs > STALE_THRESHOLD_SECS

    return c.json({
      ok: true,
      stale: isStale,
      thresholdSecs: STALE_THRESHOLD_SECS,
      metrics: {
        updatedAt: metricsRow.updated_at?.toISOString() ?? null,
        ageSeconds: metricsAgeSecs,
        fresh: metricsAgeSecs !== null && metricsAgeSecs <= STALE_THRESHOLD_SECS,
      },
      apy: {
        updatedAt: apyRow.ts?.toISOString() ?? null,
        ageSeconds: apyAgeSecs,
        fresh: apyAgeSecs !== null && apyAgeSecs <= STALE_THRESHOLD_SECS,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('health/data check failed:', message)
    return c.json({ ok: false, error: message }, 503)
  }
})

export { app as healthRoute }
