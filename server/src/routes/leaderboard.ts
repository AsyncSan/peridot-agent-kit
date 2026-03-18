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
 * GET /api/leaderboard?limit=50&chainId=56
 * Returns the top users ranked by total supplied USD.
 * limit: 1–100, default 50.
 * chainId: optional filter.
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
    const { limit, chainId } = c.req.valid('query')
    const cacheKey = `leaderboard:${chainId ?? 'all'}:${limit}`

    try {
      const data = await cache.getOrFetch(cacheKey, () => fetchLeaderboard(limit, chainId ?? null))
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
  totalSuppliedUsd: number
  totalBorrowedUsd: number
  netWorthUsd: number
  totalPoints: number
  chainId: number | null
  updatedAt: string
}

async function fetchLeaderboard(
  limit: number,
  chainId: string | null,
): Promise<{ entries: LeaderboardEntry[]; total: number }> {
  const rows = chainId
    ? await sql`
        SELECT wallet_address, rank, total_points,
               total_supplied_usd, total_borrowed_usd, chain_id, updated_at
        FROM ${sql(tables.leaderboardUsers)}
        WHERE chain_id = ${chainId}
        ORDER BY rank ASC
        LIMIT ${limit}
      `
    : await sql`
        SELECT wallet_address, rank, total_points,
               total_supplied_usd, total_borrowed_usd, chain_id, updated_at
        FROM ${sql(tables.leaderboardUsers)}
        ORDER BY rank ASC
        LIMIT ${limit}
      `

  const countRows = chainId
    ? await sql`
        SELECT COUNT(*)::int AS total
        FROM ${sql(tables.leaderboardUsers)}
        WHERE chain_id = ${chainId}
      `
    : await sql`
        SELECT COUNT(*)::int AS total
        FROM ${sql(tables.leaderboardUsers)}
      `

  const entries: LeaderboardEntry[] = rows.map((r) => {
    const supplied = Number(r.total_supplied_usd ?? 0)
    const borrowed = Number(r.total_borrow_usd ?? r.total_borrowed_usd ?? 0)
    return {
      rank: Number(r.rank ?? 0),
      address: String(r.wallet_address ?? ''),
      totalSuppliedUsd: supplied,
      totalBorrowedUsd: borrowed,
      netWorthUsd: supplied - borrowed,
      totalPoints: Number(r.total_points ?? 0),
      chainId: r.chain_id != null ? Number(r.chain_id) : null,
      updatedAt: r.updated_at ? new Date(r.updated_at as string).toISOString() : '',
    }
  })

  return {
    entries,
    total: Number(countRows[0]?.total ?? 0),
  }
}

export { app as leaderboardRoute }
