import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { sql, tables } from '../db'
import { Cache } from '../cache'

const cache = new Cache<unknown>(15_000) // 15s — changes with each new verified block

const app = new Hono()

const ACTION_TYPES = ['supply', 'borrow', 'repay', 'redeem'] as const

const txQuery = z.object({
  address: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'address must be a valid EIP-55 hex address (0x + 40 hex chars)'),
  limit: z
    .string()
    .regex(/^\d+$/, 'limit must be a positive integer')
    .optional()
    .transform((v) => Math.min(Number(v ?? '50'), 100)),
  chainId: z
    .string()
    .regex(/^\d+$/, 'chainId must be a positive integer')
    .optional(),
  actionType: z
    .enum(ACTION_TYPES)
    .optional(),
})

interface Transaction {
  txHash: string
  chainId: number
  blockNumber: number
  actionType: string
  tokenSymbol: string | null
  amount: number
  usdValue: number
  pointsAwarded: number
  verifiedAt: string
  contractAddress: string
}

/**
 * GET /api/user/transactions?address=0x...
 *
 * Query params:
 *   address    — wallet address (required, EIP-55 hex)
 *   limit      — max rows returned (default 50, max 100)
 *   chainId    — filter to a single chain (optional)
 *   actionType — filter to a single action: supply | borrow | repay | redeem (optional)
 *
 * Returns transactions ordered by verified_at DESC (most recent first).
 * Protected by walletAuth() — requires x-wallet-signature + x-wallet-timestamp headers.
 */
app.get(
  '/transactions',
  zValidator('query', txQuery, (result, c) => {
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? 'Invalid query parameters'
      return c.json({ ok: false, error: message }, 400)
    }
  }),
  async (c) => {
    const { address, limit, chainId, actionType } = c.req.valid('query')
    const cacheKey = `transactions:${address.toLowerCase()}:${chainId ?? 'all'}:${actionType ?? 'all'}:${limit}`

    try {
      const data = await cache.getOrFetch(cacheKey, () =>
        fetchTransactions(address, limit, chainId ?? null, actionType ?? null),
      )
      return c.json({ ok: true, data }, 200, {
        'Cache-Control': 'private, max-age=15',
      })
    } catch (err) {
      console.error('user/transactions error:', err)
      return c.json({ ok: false, error: 'Failed to fetch transactions' }, 500)
    }
  },
)

async function fetchTransactions(
  address: string,
  limit: number,
  chainId: string | null,
  actionType: string | null,
): Promise<{ transactions: Transaction[]; total: number }> {
  const addr = address.toLowerCase()

  // postgres.js tagged templates require static structure — branch on optional filters.
  // All 4 paths are equivalent except for the WHERE clauses.
  const [rows, countRows] = await Promise.all([
    chainId !== null && actionType !== null
      ? sql`
          SELECT tx_hash, chain_id, block_number, action_type,
                 token_symbol, amount::float, usd_value::float,
                 points_awarded, verified_at, contract_address
          FROM ${sql(tables.verifiedTransactions)}
          WHERE wallet_address = ${addr}
            AND is_valid = true
            AND chain_id = ${chainId}
            AND action_type = ${actionType}
          ORDER BY verified_at DESC, block_number DESC
          LIMIT ${limit}
        `
      : chainId !== null
      ? sql`
          SELECT tx_hash, chain_id, block_number, action_type,
                 token_symbol, amount::float, usd_value::float,
                 points_awarded, verified_at, contract_address
          FROM ${sql(tables.verifiedTransactions)}
          WHERE wallet_address = ${addr}
            AND is_valid = true
            AND chain_id = ${chainId}
          ORDER BY verified_at DESC, block_number DESC
          LIMIT ${limit}
        `
      : actionType !== null
      ? sql`
          SELECT tx_hash, chain_id, block_number, action_type,
                 token_symbol, amount::float, usd_value::float,
                 points_awarded, verified_at, contract_address
          FROM ${sql(tables.verifiedTransactions)}
          WHERE wallet_address = ${addr}
            AND is_valid = true
            AND action_type = ${actionType}
          ORDER BY verified_at DESC, block_number DESC
          LIMIT ${limit}
        `
      : sql`
          SELECT tx_hash, chain_id, block_number, action_type,
                 token_symbol, amount::float, usd_value::float,
                 points_awarded, verified_at, contract_address
          FROM ${sql(tables.verifiedTransactions)}
          WHERE wallet_address = ${addr}
            AND is_valid = true
          ORDER BY verified_at DESC, block_number DESC
          LIMIT ${limit}
        `,

    chainId !== null && actionType !== null
      ? sql`
          SELECT COUNT(*)::int AS total
          FROM ${sql(tables.verifiedTransactions)}
          WHERE wallet_address = ${addr}
            AND is_valid = true
            AND chain_id = ${chainId}
            AND action_type = ${actionType}
        `
      : chainId !== null
      ? sql`
          SELECT COUNT(*)::int AS total
          FROM ${sql(tables.verifiedTransactions)}
          WHERE wallet_address = ${addr}
            AND is_valid = true
            AND chain_id = ${chainId}
        `
      : actionType !== null
      ? sql`
          SELECT COUNT(*)::int AS total
          FROM ${sql(tables.verifiedTransactions)}
          WHERE wallet_address = ${addr}
            AND is_valid = true
            AND action_type = ${actionType}
        `
      : sql`
          SELECT COUNT(*)::int AS total
          FROM ${sql(tables.verifiedTransactions)}
          WHERE wallet_address = ${addr}
            AND is_valid = true
        `,
  ])

  const transactions: Transaction[] = rows.map((r) => ({
    txHash: String(r.tx_hash),
    chainId: Number(r.chain_id),
    blockNumber: Number(r.block_number),
    actionType: String(r.action_type),
    tokenSymbol: r.token_symbol != null ? String(r.token_symbol) : null,
    amount: Number(r.amount ?? 0),
    usdValue: Number(r.usd_value ?? 0),
    pointsAwarded: Number(r.points_awarded ?? 0),
    verifiedAt: new Date(r.verified_at as string).toISOString(),
    contractAddress: String(r.contract_address),
  }))

  return {
    transactions,
    total: Number(countRows[0]?.total ?? 0),
  }
}

export { app as transactionsRoute }
