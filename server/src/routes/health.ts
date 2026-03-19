import { Hono } from 'hono'
import { sql, tables } from '../db'

const app = new Hono()

/**
 * Stale thresholds per table.
 * - assetMetrics: on-chain RPC scrape, typically every 10–20 min → 30 min threshold
 * - apy: computed from on-chain rates, similar cadence → 30 min threshold
 * Override via env: STALE_METRICS_SECS / STALE_APY_SECS
 */
const STALE_METRICS_SECS = Number(process.env['STALE_METRICS_SECS'] ?? '1800')
const STALE_APY_SECS     = Number(process.env['STALE_APY_SECS']     ?? '1800')

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
      metricsAgeSecs > STALE_METRICS_SECS ||
      apyAgeSecs > STALE_APY_SECS

    return c.json({
      ok: true,
      stale: isStale,
      metrics: {
        updatedAt: metricsRow.updated_at?.toISOString() ?? null,
        ageSeconds: metricsAgeSecs,
        thresholdSecs: STALE_METRICS_SECS,
        fresh: metricsAgeSecs !== null && metricsAgeSecs <= STALE_METRICS_SECS,
      },
      apy: {
        updatedAt: apyRow.ts?.toISOString() ?? null,
        ageSeconds: apyAgeSecs,
        thresholdSecs: STALE_APY_SECS,
        fresh: apyAgeSecs !== null && apyAgeSecs <= STALE_APY_SECS,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('health/data check failed:', message)
    return c.json({ ok: false, error: message }, 503)
  }
})

export { app as healthRoute }
