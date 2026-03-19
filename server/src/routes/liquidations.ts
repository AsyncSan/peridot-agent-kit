import { Hono } from 'hono'
import { sql, tables } from '../db'

const app = new Hono()

const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

/**
 * GET /api/liquidations/at-risk
 *
 * Query params:
 *   chainId      — filter to a single chain (optional)
 *   minShortfall — minimum shortfall_usd (default: 0, i.e. any shortfall > 0)
 *   limit        — max rows returned (default 50, max 200)
 *
 * Returns accounts where shortfall_usd > 0, ordered by shortfall descending.
 * Data is written by scan_account_health.py running on cron.
 */
app.get('/at-risk', async (c) => {
  const chainIdParam = c.req.query('chainId')
  const minShortfallParam = c.req.query('minShortfall')
  const limitParam = c.req.query('limit')

  const chainId = chainIdParam ? parseInt(chainIdParam, 10) : null
  if (chainId !== null && (!Number.isInteger(chainId) || chainId <= 0)) {
    return c.json({ ok: false, error: 'Invalid chainId' }, 400)
  }

  const minShortfall = minShortfallParam ? parseFloat(minShortfallParam) : 0
  if (!Number.isFinite(minShortfall) || minShortfall < 0) {
    return c.json({ ok: false, error: 'Invalid minShortfall' }, 400)
  }

  const limitRaw = limitParam ? parseInt(limitParam, 10) : DEFAULT_LIMIT
  const limit = Math.min(Math.max(1, limitRaw), MAX_LIMIT)

  try {
    const rows = chainId !== null
      ? await sql`
          SELECT address, chain_id, liquidity_usd::float, shortfall_usd::float, checked_at
          FROM ${sql(tables.accountHealth)}
          WHERE shortfall_usd > ${minShortfall}
            AND chain_id = ${chainId}
          ORDER BY shortfall_usd DESC
          LIMIT ${limit}
        `
      : await sql`
          SELECT address, chain_id, liquidity_usd::float, shortfall_usd::float, checked_at
          FROM ${sql(tables.accountHealth)}
          WHERE shortfall_usd > ${minShortfall}
          ORDER BY shortfall_usd DESC
          LIMIT ${limit}
        `

    const accounts = rows.map((r) => ({
      address: String(r.address),
      chainId: Number(r.chain_id),
      liquidityUsd: Number(r.liquidity_usd ?? 0),
      shortfallUsd: Number(r.shortfall_usd ?? 0),
      checkedAt: new Date(r.checked_at as string).toISOString(),
    }))

    return c.json({ ok: true, data: { accounts, count: accounts.length } }, 200, {
      'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=20',
    })
  } catch (err) {
    console.error('liquidations/at-risk error:', err)
    return c.json({ ok: false, error: 'Failed to fetch at-risk accounts' }, 500)
  }
})

export { app as liquidationsRoute }
