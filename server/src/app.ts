import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { requestId } from './middleware/request-id'
import { jsonLogger } from './middleware/logger'
import { rateLimit } from './middleware/rate-limit'
import { walletAuth } from './middleware/wallet-auth'
import { healthRoute } from './routes/health'
import { marketsRoute } from './routes/markets'
import { apyRoute } from './routes/apy'
import { portfolioRoute } from './routes/portfolio'
import { leaderboardRoute } from './routes/leaderboard'
import { metricsRoute } from './routes/metrics'

export const app = new Hono()

// Request ID first — every subsequent middleware and handler can read it
app.use('*', requestId())
app.use('*', jsonLogger())
app.use('*', secureHeaders())
app.use('/api/*', cors({ origin: process.env['CORS_ORIGIN'] ?? '*' }))
app.use('/api/*', rateLimit())

// Health probes and server metrics (not rate-limited)
app.route('/health', healthRoute)
app.route('/metrics', metricsRoute)       // /metrics — live request/memory stats

// API routes — paths match exactly what @peridot/agent-kit expects
app.route('/api/markets', marketsRoute)   // /api/markets/metrics
app.route('/api/apy', apyRoute)           // /api/apy
app.route('/api/leaderboard', leaderboardRoute) // /api/leaderboard
app.use('/api/user/*', walletAuth())
app.route('/api/user', portfolioRoute)    // /api/user/portfolio-data

app.onError((err, c) => {
  // c.error is set automatically by Hono — jsonLogger reads it for the log line
  return c.json({ ok: false, error: 'Internal server error' }, 500)
})

app.notFound((c) => c.json({ ok: false, error: 'Not found' }, 404))
