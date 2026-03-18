import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { sql, tables } from '../db'
import { Cache } from '../cache'

const cache = new Cache<unknown>(60_000) // 60s — leaderboard is less time-sensitive

const app = new Hono()

const leaderboardQuery = z.object({
  limit: z
    .string()
    .regex(/^\d+$/, 'limit must be a positive integer')
    .optional()
    .transform((v) => Math.min(Number(v ?? '50'), 100)),
  chainId: z
    .string()
    .regex(/^\d+$/, 'chainId must be a positive integer')
    .optional(),
})

/**
 * GET /api/leaderboard?limit=50
 * Returns the top users ranked by total points earned.
 * limit: 1–100, default 50.
 * chainId: accepted for validation but not applied — leaderboard_users has no
 *          chain_id column; rankings are global across all chains.
 */
app.get(
  '/',
  zValidator('query', leaderboardQuery, (result, c) => {
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? 'Invalid query parameters'
      return c.json({ ok: false, error: message }, 400)
    }
  }),
  async (c) => {
    const { limit } = c.req.valid('query')
    const cacheKey = `leaderboard:${limit}`

    try {
      const data = await cache.getOrFetch(cacheKey, () => fetchLeaderboard(limit))
      return c.json({ ok: true, data }, 200, {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      })
    } catch (err) {
      console.error('leaderboard error:', err)
      return c.json({ ok: false, error: 'Failed to fetch leaderboard' }, 500)
    }
  },
)

interface LeaderboardEntry {
  rank: number
  address: string
  totalPoints: number
  supplyCount: number
  borrowCount: number
  repayCount: number
  redeemCount: number
  updatedAt: string
}

async function fetchLeaderboard(
  limit: number,
): Promise<{ entries: LeaderboardEntry[]; total: number }> {
  // Rank is computed via ROW_NUMBER — leaderboard_users has no pre-computed rank column.
  // The materialized view leaderboard_ranks_mainnet may exist but we use the fallback
  // query here for portability across DB states.
  const rows = await sql`
    SELECT
      wallet_address,
      ROW_NUMBER() OVER (ORDER BY COALESCE(total_points, 0) DESC) AS rank,
      COALESCE(total_points, 0)  AS total_points,
      COALESCE(supply_count, 0)  AS supply_count,
      COALESCE(borrow_count, 0)  AS borrow_count,
      COALESCE(repay_count, 0)   AS repay_count,
      COALESCE(redeem_count, 0)  AS redeem_count,
      COALESCE(last_updated, created_at) AS updated_at
    FROM ${sql(tables.leaderboardUsers)}
    WHERE COALESCE(total_points, 0) > 0
    ORDER BY rank ASC
    LIMIT ${limit}
  `

  const countRows = await sql`
    SELECT COUNT(*)::int AS total
    FROM ${sql(tables.leaderboardUsers)}
    WHERE COALESCE(total_points, 0) > 0
  `

  const entries: LeaderboardEntry[] = rows.map((r) => ({
    rank: Number(r.rank ?? 0),
    address: String(r.wallet_address ?? ''),
    totalPoints: Number(r.total_points ?? 0),
    supplyCount: Number(r.supply_count ?? 0),
    borrowCount: Number(r.borrow_count ?? 0),
    repayCount: Number(r.repay_count ?? 0),
    redeemCount: Number(r.redeem_count ?? 0),
    updatedAt: r.updated_at ? new Date(r.updated_at as string).toISOString() : '',
  }))

  return {
    entries,
    total: Number(countRows[0]?.total ?? 0),
  }
}

export { app as leaderboardRoute }
