import { Hono } from 'hono'
import { sql, tables } from '../db'
import { Cache } from '../cache'

const cache = new Cache<Record<string, unknown>>(30_000) // 30s

const app = new Hono()

/** GET /api/apy?chainId=56 */
app.get('/', async (c) => {
  const chainId = c.req.query('chainId')
  const cacheKey = `apy:${chainId ?? 'all'}`

  try {
    const data = await cache.getOrFetch(cacheKey, () => fetchApy(chainId ?? null))
    return c.json({ success: true, data }, 200, {
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    })
  } catch (err) {
    console.error('apy error:', err)
    return c.json({ success: false, error: 'Failed to fetch APY data', data: {} }, 500)
  }
})

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
    const aId = String(row.asset_id ?? '').toUpperCase()
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
