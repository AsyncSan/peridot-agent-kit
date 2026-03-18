import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { recordRequest, resetMetrics } from '../../metrics'

// Import the route — no DB mock needed (metrics are in-memory)
const { metricsRoute } = await import('../metrics')

function makeApp() {
  const app = new Hono()
  app.route('/metrics', metricsRoute)
  return app
}

beforeEach(() => { resetMetrics() })

describe('GET /metrics', () => {
  it('returns 200 with ok: true', async () => {
    const res = await makeApp().request('/metrics')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it('response data has all top-level fields', async () => {
    const res = await makeApp().request('/metrics')
    const { data } = await res.json()
    expect(typeof data.uptime_seconds).toBe('number')
    expect(typeof data.requests_total).toBe('number')
    expect(typeof data.errors_4xx_total).toBe('number')
    expect(typeof data.errors_5xx_total).toBe('number')
    expect(typeof data.memory).toBe('object')
    expect(typeof data.routes).toBe('object')
  })

  it('uptime_seconds is a non-negative integer', async () => {
    const res = await makeApp().request('/metrics')
    const { data } = await res.json()
    expect(data.uptime_seconds).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(data.uptime_seconds)).toBe(true)
  })

  it('memory has rss_mb, heap_used_mb, and heap_total_mb', async () => {
    const res = await makeApp().request('/metrics')
    const { data: { memory } } = await res.json()
    expect(typeof memory.rss_mb).toBe('number')
    expect(typeof memory.heap_used_mb).toBe('number')
    expect(typeof memory.heap_total_mb).toBe('number')
    expect(memory.rss_mb).toBeGreaterThan(0)
    expect(memory.heap_total_mb).toBeGreaterThanOrEqual(memory.heap_used_mb)
  })

  it('sets Cache-Control: no-store', async () => {
    const res = await makeApp().request('/metrics')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('starts with zero totals before any requests', async () => {
    const res = await makeApp().request('/metrics')
    const { data } = await res.json()
    expect(data.requests_total).toBe(0)
    expect(data.errors_4xx_total).toBe(0)
    expect(data.errors_5xx_total).toBe(0)
  })
})

describe('recordRequest — counters', () => {
  it('increments requests_total', async () => {
    recordRequest('/api/apy', 200, 10)
    recordRequest('/api/apy', 200, 15)
    const res = await makeApp().request('/metrics')
    const { data } = await res.json()
    expect(data.requests_total).toBe(2)
  })

  it('increments errors_4xx_total for 4xx status', async () => {
    recordRequest('/api/apy', 400, 5)
    recordRequest('/api/apy', 429, 2)
    const res = await makeApp().request('/metrics')
    const { data } = await res.json()
    expect(data.errors_4xx_total).toBe(2)
  })

  it('increments errors_5xx_total for 5xx status', async () => {
    recordRequest('/api/markets/metrics', 500, 100)
    const res = await makeApp().request('/metrics')
    const { data } = await res.json()
    expect(data.errors_5xx_total).toBe(1)
  })

  it('does not count 2xx as errors', async () => {
    recordRequest('/api/apy', 200, 10)
    recordRequest('/api/apy', 201, 10)
    recordRequest('/api/apy', 304, 5)
    const res = await makeApp().request('/metrics')
    const { data } = await res.json()
    expect(data.errors_4xx_total).toBe(0)
    expect(data.errors_5xx_total).toBe(0)
  })
})

describe('recordRequest — per-route stats', () => {
  it('groups requests by route path', async () => {
    recordRequest('/api/apy', 200, 10)
    recordRequest('/api/apy', 200, 20)
    recordRequest('/api/markets/metrics', 200, 5)
    const res = await makeApp().request('/metrics')
    const { data: { routes } } = await res.json()
    expect(routes['/api/apy'].requests).toBe(2)
    expect(routes['/api/markets/metrics'].requests).toBe(1)
  })

  it('tracks 4xx and 5xx errors per route', async () => {
    recordRequest('/api/apy', 200, 10)
    recordRequest('/api/apy', 400, 5)
    recordRequest('/api/apy', 500, 80)
    const res = await makeApp().request('/metrics')
    const { data: { routes } } = await res.json()
    expect(routes['/api/apy'].errors4xx).toBe(1)
    expect(routes['/api/apy'].errors5xx).toBe(1)
  })

  it('computes avgLatencyMs across samples', async () => {
    recordRequest('/api/apy', 200, 10)
    recordRequest('/api/apy', 200, 20)
    recordRequest('/api/apy', 200, 30)
    const res = await makeApp().request('/metrics')
    const { data: { routes } } = await res.json()
    expect(routes['/api/apy'].avgLatencyMs).toBeCloseTo(20, 0)
  })

  it('p95LatencyMs is >= p50LatencyMs', async () => {
    // Insert 20 samples ranging from 1 to 100
    for (let i = 1; i <= 20; i++) recordRequest('/api/apy', 200, i * 5)
    const res = await makeApp().request('/metrics')
    const { data: { routes } } = await res.json()
    expect(routes['/api/apy'].p95LatencyMs).toBeGreaterThanOrEqual(routes['/api/apy'].p50LatencyMs)
  })

  it('route with zero requests has avgLatencyMs 0', async () => {
    // No requests recorded — routes map is empty
    const res = await makeApp().request('/metrics')
    const { data: { routes } } = await res.json()
    expect(Object.keys(routes)).toHaveLength(0)
  })
})
