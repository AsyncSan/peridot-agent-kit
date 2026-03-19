import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { sql, tables } from '../db'
import { Cache } from '../cache'

const cache = new Cache<Record<string, unknown>>(30_000) // 30s

const app = new Hono()

const apyQuery = z.object({
  chainId: z
    .string()
    .regex(/^\d+$/, 'chainId must be a positive integer')
    .optional(),
})

/** GET /api/apy?chainId=56 */
app.get(
  '/',
  zValidator('query', apyQuery, (result, c) => {
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? 'Invalid query parameters'
      return c.json({ ok: false, error: message }, 400)
    }
  }),
  async (c) => {
    const { chainId } = c.req.valid('query')
    const cacheKey = `apy:${chainId ?? 'all'}`

    try {
      const data = await cache.getOrFetch(cacheKey, () => fetchApy(chainId ?? null))
      return c.json({ ok: true, data }, 200, {
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      })
    } catch (err) {
      console.error('apy error:', err)
      return c.json({ ok: false, error: 'Failed to fetch APY data' }, 500)
    }
  },
)

async function fetchApy(chainId: string | null): Promise<Record<string, unknown>> {
  const rows = chainId
    ? await sql`
        SELECT asset_id, chain_id, supply_apy, borrow_apy,
               peridot_supply_apy, peridot_borrow_apy,
               boost_source_supply_apy, boost_rewards_supply_apy,
               total_supply_apy, net_borrow_apy, timestamp
        FROM ${sql(tables.apyLatest)}
        WHERE chain_id = ${chainId}
      `
    : await sql`
        SELECT asset_id, chain_id, supply_apy, borrow_apy,
               peridot_supply_apy, peridot_borrow_apy,
               boost_source_supply_apy, boost_rewards_supply_apy,
               total_supply_apy, net_borrow_apy, timestamp
        FROM ${sql(tables.apyLatest)}
      `

  const apyData: Record<string, Record<number, unknown>> = {}
  for (const row of rows) {
    const aId = String(row.asset_id ?? '').toLowerCase()
    const cId = Number(row.chain_id)
    if (!apyData[aId]) apyData[aId] = {}
    apyData[aId][cId] = {
      supplyApy: Number(row.supply_apy ?? 0),
      borrowApy: Number(row.borrow_apy ?? 0),
      peridotSupplyApy: Number(row.peridot_supply_apy ?? 0),
      peridotBorrowApy: Number(row.peridot_borrow_apy ?? 0),
      boostSourceSupplyApy: Number(row.boost_source_supply_apy ?? 0),
      boostRewardsSupplyApy: Number(row.boost_rewards_supply_apy ?? 0),
      totalSupplyApy: Number(row.total_supply_apy ?? 0),
      netBorrowApy: Number(row.net_borrow_apy ?? 0),
      timestamp: row.timestamp,
    }
  }
  return apyData
}

export { app as apyRoute }
