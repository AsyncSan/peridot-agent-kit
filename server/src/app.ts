import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { requestId } from './middleware/request-id'
import { jsonLogger } from './middleware/logger'
import { rateLimit } from './middleware/rate-limit'
import { walletAuth } from './middleware/wallet-auth'
import { apiKeyAuth } from './middleware/api-key'
import { healthRoute } from './routes/health'
import { marketsRoute } from './routes/markets'
import { apyRoute } from './routes/apy'
import { portfolioRoute } from './routes/portfolio'
import { transactionsRoute } from './routes/transactions'
import { leaderboardRoute } from './routes/leaderboard'
import { metricsRoute } from './routes/metrics'
import { liquidationsRoute } from './routes/liquidations'

export const app = new Hono()

// Request ID first — every subsequent middleware and handler can read it
app.use('*', requestId())
app.use('*', jsonLogger())
app.use('*', secureHeaders())
app.use('/api/*', cors({ origin: process.env['CORS_ORIGIN'] ?? '*' }))
app.use('/api/*', rateLimit())

// Health probes — always public (used by Docker/load balancer)
app.route('/health', healthRoute)

// Server metrics — API key required when API_KEY env var is set
app.use('/metrics', apiKeyAuth())
app.route('/metrics', metricsRoute)       // /metrics — live request/memory stats

// API routes — API key guard + rate limiter apply to all /api/* routes
app.use('/api/*', apiKeyAuth())
app.route('/api/markets', marketsRoute)   // /api/markets/metrics
app.route('/api/apy', apyRoute)           // /api/apy
app.route('/api/leaderboard', leaderboardRoute) // /api/leaderboard
app.use('/api/user/*', walletAuth({ allowApiKey: true }))
app.route('/api/user', portfolioRoute)       // /api/user/portfolio-data
app.route('/api/user', transactionsRoute)    // /api/user/transactions
app.route('/api/liquidations', liquidationsRoute)  // /api/liquidations/at-risk

app.onError((err, c) => {
  // c.error is set automatically by Hono — jsonLogger reads it for the log line
  return c.json({ ok: false, error: 'Internal server error' }, 500)
})

app.notFound((c) => c.json({ ok: false, error: 'Not found' }, 404))
