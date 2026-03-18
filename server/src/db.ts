import postgres from 'postgres'
import fs from 'fs'

const url = process.env['DATABASE_URL']
if (!url) throw new Error('DATABASE_URL is required')

const sslCertPath = process.env['PGSSLROOTCERT']
const sslServername = process.env['PGSSLSERVERNAME']
// DB_SSL_REJECT_UNAUTHORIZED=false disables cert verification — use when tunneling
// through localhost (e.g. `ssh -L 5433:...`) where the server cert won't match.
// Never set this in production; pass PGSSLROOTCERT with the DO CA cert instead.
const rejectUnauthorized = process.env['DB_SSL_REJECT_UNAUTHORIZED'] !== 'false'

const ssl: postgres.Options<{}>['ssl'] =
  sslCertPath && fs.existsSync(sslCertPath)
    ? { rejectUnauthorized: true, ca: fs.readFileSync(sslCertPath, 'utf8'), servername: sslServername }
    : { rejectUnauthorized, servername: sslServername }

// DB_QUERY_TIMEOUT_MS caps individual query execution time. 8 seconds is
// generous for our read-only queries; prevents pool exhaustion from stuck
// queries during DB degradation. Set higher for analytics, lower for SLA-
// sensitive endpoints if needed.
const queryTimeoutRaw = Number(process.env['DB_QUERY_TIMEOUT_MS'] ?? '8000')
const queryTimeout = Number.isInteger(queryTimeoutRaw) && queryTimeoutRaw > 0 ? queryTimeoutRaw : 8_000

export const sql = postgres(url, {
  max: 5,
  idle_timeout: 10,
  connect_timeout: 10,
  // statement_timeout is a PostgreSQL server-side timeout (milliseconds).
  // postgres.js sends it as a SET command at connection startup so it applies
  // to every query on that connection without any per-query plumbing.
  connection: { statement_timeout: queryTimeout },
  prepare: false, // required for DigitalOcean PgBouncer in transaction mode
  ssl,
})

/** Table names — switch between mainnet and testnet schema. */
const isMainnet = (process.env['NETWORK_PRESET'] ?? 'mainnet').toLowerCase().startsWith('mainnet')

export const tables = isMainnet
  ? {
      apyLatest: 'apy_latest_mainnet',
      assetMetricsLatest: 'asset_metrics_latest_mainnet',
      userBalanceSnapshots: 'user_balance_snapshots_mainnet',
      userPortfolioApySnapshots: 'user_portfolio_apy_snapshots_mainnet',
      verifiedTransactions: 'verified_transactions_mainnet',
      leaderboardUsers: 'leaderboard_users_mainnet',
    }
  : {
      apyLatest: 'apy_latest',
      assetMetricsLatest: 'asset_metrics_latest',
      userBalanceSnapshots: 'user_balance_snapshots',
      userPortfolioApySnapshots: 'user_portfolio_apy_snapshots',
      verifiedTransactions: 'verified_transactions',
      leaderboardUsers: 'leaderboard_users',
    }
