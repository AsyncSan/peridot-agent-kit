/**
 * Server-side request metrics — in-memory singleton.
 *
 * Tracked per normalized route path:
 *   - request count
 *   - 4xx and 5xx error counts
 *   - last 200 latency samples (for p50/p95 calculation)
 *
 * Designed to be recorded from the jsonLogger middleware so every request
 * is captured without duplicating logic across routes.
 */

const startTimeMs = Date.now()

interface RouteStats {
  requests: number
  errors4xx: number
  errors5xx: number
  /** Circular buffer — last MAX_SAMPLES latency values in ms. */
  latencies: number[]
}

const MAX_SAMPLES = 200

const routes = new Map<string, RouteStats>()

let requestsTotal = 0
let errors4xxTotal = 0
let errors5xxTotal = 0

function getOrCreate(route: string): RouteStats {
  let s = routes.get(route)
  if (!s) {
    s = { requests: 0, errors4xx: 0, errors5xx: 0, latencies: [] }
    routes.set(route, s)
  }
  return s
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)] ?? 0
}

/** Called by the logger middleware once per completed request. */
export function recordRequest(route: string, status: number, latencyMs: number): void {
  requestsTotal++

  const s = getOrCreate(route)
  s.requests++

  if (status >= 500) { s.errors5xx++; errors5xxTotal++ }
  else if (status >= 400) { s.errors4xx++; errors4xxTotal++ }

  if (s.latencies.length >= MAX_SAMPLES) s.latencies.shift()
  s.latencies.push(latencyMs)
}

/** Returns a snapshot of all metrics. */
export function getMetrics() {
  const mem = process.memoryUsage()

  const routeStats: Record<string, {
    requests: number
    errors4xx: number
    errors5xx: number
    avgLatencyMs: number
    p50LatencyMs: number
    p95LatencyMs: number
  }> = {}

  for (const [route, s] of routes) {
    const sorted = [...s.latencies].sort((a, b) => a - b)
    const avg = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0
    routeStats[route] = {
      requests: s.requests,
      errors4xx: s.errors4xx,
      errors5xx: s.errors5xx,
      avgLatencyMs: Math.round(avg * 10) / 10,
      p50LatencyMs: percentile(sorted, 50),
      p95LatencyMs: percentile(sorted, 95),
    }
  }

  return {
    uptime_seconds: Math.floor((Date.now() - startTimeMs) / 1000),
    requests_total: requestsTotal,
    errors_4xx_total: errors4xxTotal,
    errors_5xx_total: errors5xxTotal,
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
    },
    routes: routeStats,
  }
}

/** Reset all counters — used in tests. */
export function resetMetrics(): void {
  routes.clear()
  requestsTotal = 0
  errors4xxTotal = 0
  errors5xxTotal = 0
}
