import { Hono } from 'hono'
import { sql, tables } from '../db'
import { Cache } from '../cache'

const cache = new Cache<Record<string, unknown>>(30_000) // 30s

const app = new Hono()

/** GET /api/markets/metrics */
app.get('/metrics', async (c) => {
  try {
    const data = await cache.getOrFetch('metrics', fetchMetrics)
    return c.json({ ok: true, data }, 200, {
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    })
  } catch (err) {
    console.error('markets/metrics error:', err)
    return c.json({ ok: false, error: 'failed_to_fetch_metrics' }, 500)
  }
})

async function fetchMetrics(): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = {}

  // Try mainnet table first, then fall back to the non-suffixed table.
  // A table-not-found error is silently skipped; only when every attempt
  // fails with a real DB error do we surface it (so the route returns 500
  // instead of silently returning empty data to the agent-kit).
  const tablesToTry = [tables.assetMetricsLatest, 'asset_metrics_latest']
  let lastError: unknown

  for (const tableName of tablesToTry) {
    try {
      const rows = await sql`
        SELECT
          asset_id,
          chain_id,
          utilization_pct::float    AS utilization_pct,
          tvl_usd::float            AS tvl_usd,
          liquidity_underlying::float AS liquidity_underlying,
          liquidity_usd::float      AS liquidity_usd,
          price_usd::float          AS price_usd,
          collateral_factor_pct::float AS collateral_factor_pct,
          updated_at
        FROM ${sql(tableName)}
      `
      for (const r of rows) {
        const assetId = String(r.asset_id ?? '').toUpperCase()
        const key = `${assetId}:${Number(r.chain_id)}`
        data[key] = {
          utilizationPct: Number(r.utilization_pct ?? 0),
          tvlUsd: Number(r.tvl_usd ?? 0),
          liquidityUnderlying: Number(r.liquidity_underlying ?? 0),
          liquidityUsd: Number(r.liquidity_usd ?? 0),
          priceUsd: Number(r.price_usd ?? 0),
          collateral_factor_pct: Number(r.collateral_factor_pct ?? 0),
          updatedAt: new Date(r.updated_at as string).toISOString(),
          chainId: Number(r.chain_id ?? 0),
        }
      }
      // Query succeeded — stop trying fallback tables
      lastError = undefined
      break
    } catch (err) {
      lastError = err
      // table may not exist in this environment — try next
    }
  }

  // If every table attempt threw a real error, surface it so the route
  // handler returns 500 instead of { ok: true, data: {} }
  if (lastError !== undefined) throw lastError

  return data
}

export { app as marketsRoute }
