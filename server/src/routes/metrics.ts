import { Hono } from 'hono'
import { getMetrics } from '../metrics'

const app = new Hono()

/**
 * GET /metrics
 * Returns a JSON snapshot of live server health and request metrics.
 * Not rate-limited — intended for internal monitoring and health dashboards.
 *
 * Fields:
 *   uptime_seconds    — seconds since process start
 *   requests_total    — total HTTP requests handled
 *   errors_4xx_total  — total client errors
 *   errors_5xx_total  — total server errors
 *   memory            — RSS, heap used, heap total in MB
 *   routes            — per-route: count, error breakdown, avg/p50/p95 latency
 */
app.get('/', (c) => {
  return c.json({ ok: true, data: getMetrics() }, 200, {
    'Cache-Control': 'no-store',
  })
})

export { app as metricsRoute }
