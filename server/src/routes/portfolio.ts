import { Hono } from 'hono'
import { sql, tables } from '../db'
import { Cache } from '../cache'

const cache = new Cache<unknown>(30_000) // 30s per address

const app = new Hono()

/** GET /api/user/portfolio-data?address=0x... */
app.get('/portfolio-data', async (c) => {
  const address = c.req.query('address')
  if (!address) {
    return c.json({ success: false, error: 'Missing address' }, 400)
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return c.json({ success: false, error: 'Invalid address format' }, 400)
  }

  try {
    const data = await cache.getOrFetch(`portfolio:${address.toLowerCase()}`, () =>
      fetchPortfolio(address),
    )
    return c.json({ success: true, data }, 200, {
      'Cache-Control': 'private, s-maxage=30, stale-while-revalidate=60',
    })
  } catch (err) {
    console.error('portfolio-data error:', err)
    return c.json({ success: false, error: 'Failed to fetch portfolio data' }, 500)
  }
})

async function fetchPortfolio(address: string) {
  const addr = address.toLowerCase()

  const [transactionRows, balanceRows, portfolioApyRows] = await Promise.all([
    sql`
      SELECT action_type, usd_value, verified_at, token_symbol, chain_id
      FROM ${sql(tables.verifiedTransactions)}
      WHERE wallet_address = ${addr}
        AND is_valid = true
        AND usd_value > 0
        AND action_type IN ('supply','borrow','repay','redeem',
                            'cross-chain_supply','cross-chain_borrow',
                            'cross-chain_repay','cross-chain_redeem')
      ORDER BY verified_at DESC
      LIMIT 100
    `,
    sql`
      SELECT supplied_usd, borrowed_usd, observed_at, chain_id, asset_id
      FROM ${sql(tables.userBalanceSnapshots)}
      WHERE address = ${addr}
      ORDER BY observed_at DESC
      LIMIT 200
    `,
    sql`
      SELECT AVG(net_apy_pct)::float       AS net_apy_pct,
             SUM(total_supply_usd)::float  AS total_supply_usd,
             SUM(total_borrow_usd)::float  AS total_borrow_usd
      FROM ${sql(tables.userPortfolioApySnapshots)}
      WHERE address = ${addr}
    `,
  ])

  const transactions = transactionRows
  const balanceHistory = balanceRows
  const portfolio = portfolioApyRows[0]

  const totalSupplied = Number(portfolio?.total_supply_usd ?? 0)
  const totalBorrowed = Number(portfolio?.total_borrow_usd ?? 0)
  const currentValue = totalSupplied - totalBorrowed
  const netApy = Number(portfolio?.net_apy_pct ?? 0)

  const supplyTxs = transactions.filter((t) =>
    String(t.action_type).includes('supply'),
  )
  const borrowTxs = transactions.filter((t) =>
    String(t.action_type).includes('borrow'),
  )
  const repayTxs = transactions.filter((t) =>
    String(t.action_type).includes('repay'),
  )
  const redeemTxs = transactions.filter((t) =>
    String(t.action_type).includes('redeem'),
  )

  // Lifetime earnings estimate (simple accrual over supply duration)
  let totalLifetimeEarnings = 0
  const now = Date.now()
  for (const tx of supplyTxs) {
    const value = Number(tx.usd_value ?? 0)
    const days = Math.max(
      1,
      (now - new Date(tx.verified_at as string).getTime()) / 86_400_000,
    )
    totalLifetimeEarnings += value * (netApy / 100) * (days / 365)
  }

  // Asset breakdown from most-recent balance snapshot per asset
  const assetMap = new Map<string, { supplied: number; borrowed: number }>()
  for (const snap of balanceHistory) {
    const id = String(snap.asset_id)
    const cur = assetMap.get(id) ?? { supplied: 0, borrowed: 0 }
    assetMap.set(id, {
      supplied: Math.max(cur.supplied, Number(snap.supplied_usd ?? 0)),
      borrowed: Math.max(cur.borrowed, Number(snap.borrowed_usd ?? 0)),
    })
  }

  const assets = [...assetMap.entries()].map(([assetId, { supplied, borrowed }]) => ({
    assetId,
    supplied,
    borrowed,
    net: supplied - borrowed,
    percentage: currentValue > 0 ? ((supplied - borrowed) / currentValue) * 100 : 0,
  }))

  return {
    portfolio: {
      currentValue,
      totalSupplied,
      totalBorrowed,
      netApy,
      healthFactor: totalBorrowed > 0 ? totalSupplied / totalBorrowed : 0,
    },
    assets: assets.sort((a, b) => b.net - a.net),
    transactions: {
      totalCount: transactions.length,
      supplyCount: supplyTxs.length,
      borrowCount: borrowTxs.length,
      repayCount: repayTxs.length,
      redeemCount: redeemTxs.length,
    },
    earnings: {
      effectiveApy: netApy,
      totalLifetimeEarnings,
    },
  }
}

export { app as portfolioRoute }
