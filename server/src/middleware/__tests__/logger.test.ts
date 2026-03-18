import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'

// Mock metrics so logger tests don't accumulate state in the global singleton
vi.mock('../../metrics', () => ({ recordRequest: vi.fn() }))

import { jsonLogger } from '../logger'
import { requestId } from '../request-id'

function makeApp(handler?: (c: any) => Response | Promise<Response>) {
  const app = new Hono()
  app.use('*', requestId())
  app.use('*', jsonLogger())
  app.get('/test', handler ?? ((c) => c.json({ ok: true })))
  app.onError((err, c) => c.json({ ok: false }, 500))
  return app
}

function captureStdout(): { lines: () => string[]; restore: () => void } {
  const written: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    written.push(String(chunk))
    return true
  })
  return {
    lines: () => written,
    restore: () => spy.mockRestore(),
  }
}

describe('jsonLogger middleware', () => {
  afterEach(() => vi.restoreAllMocks())

  it('writes one line to stdout per request', async () => {
    const cap = captureStdout()
    await makeApp().request('/test')
    cap.restore()
    expect(cap.lines()).toHaveLength(1)
  })

  it('output is valid JSON', async () => {
    const cap = captureStdout()
    await makeApp().request('/test')
    cap.restore()
    expect(() => JSON.parse(cap.lines()[0]!)).not.toThrow()
  })

  it('log line ends with a newline', async () => {
    const cap = captureStdout()
    await makeApp().request('/test')
    cap.restore()
    expect(cap.lines()[0]).toMatch(/\n$/)
  })

  it('includes method, path, status, latencyMs, ts, requestId', async () => {
    const cap = captureStdout()
    await makeApp().request('/test', { headers: { 'x-request-id': 'test-id' } })
    cap.restore()
    const line = JSON.parse(cap.lines()[0]!)
    expect(line.method).toBe('GET')
    expect(line.path).toBe('/test')
    expect(line.status).toBe(200)
    expect(typeof line.latencyMs).toBe('number')
    expect(typeof line.ts).toBe('string')
    expect(line.requestId).toBe('test-id')
  })

  it('ts is a valid ISO-8601 string', async () => {
    const cap = captureStdout()
    await makeApp().request('/test')
    cap.restore()
    const { ts } = JSON.parse(cap.lines()[0]!)
    expect(new Date(ts).toISOString()).toBe(ts)
  })

  it('latencyMs is a finite non-negative number', async () => {
    const cap = captureStdout()
    await makeApp().request('/test')
    cap.restore()
    const { latencyMs } = JSON.parse(cap.lines()[0]!)
    expect(Number.isFinite(latencyMs)).toBe(true)
    expect(latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('status matches the actual HTTP response code', async () => {
    const app = new Hono()
    app.use('*', requestId())
    app.use('*', jsonLogger())
    app.get('/not-found', (c) => c.json({ ok: false }, 404))

    const cap = captureStdout()
    await app.request('/not-found')
    cap.restore()
    const line = JSON.parse(cap.lines()[0]!)
    expect(line.status).toBe(404)
  })

  it('requestId in log matches x-request-id header sent by client', async () => {
    const cap = captureStdout()
    await makeApp().request('/test', { headers: { 'x-request-id': 'corr-123' } })
    cap.restore()
    expect(JSON.parse(cap.lines()[0]!).requestId).toBe('corr-123')
  })

  it('requestId is present even when client sends no x-request-id', async () => {
    const cap = captureStdout()
    await makeApp().request('/test')
    cap.restore()
    const { requestId } = JSON.parse(cap.lines()[0]!)
    expect(typeof requestId).toBe('string')
    expect(requestId.length).toBeGreaterThan(0)
  })

  it('does not include error field on 2xx responses', async () => {
    const cap = captureStdout()
    await makeApp().request('/test')
    cap.restore()
    const line = JSON.parse(cap.lines()[0]!)
    expect(line.error).toBeUndefined()
  })

  it('includes error field on 5xx responses', async () => {
    const app = new Hono()
    app.use('*', requestId())
    app.use('*', jsonLogger())
    app.get('/boom', () => { throw new Error('something exploded') })
    app.onError((err, c) => c.json({ ok: false }, 500))

    const cap = captureStdout()
    await app.request('/boom')
    cap.restore()
    const line = JSON.parse(cap.lines()[0]!)
    expect(line.status).toBe(500)
    expect(typeof line.error).toBe('string')
    expect(line.error).toContain('something exploded')
  })

  it('writes independent lines for concurrent requests', async () => {
    const app = makeApp()
    const cap = captureStdout()
    await Promise.all([
      app.request('/test', { headers: { 'x-request-id': 'r1' } }),
      app.request('/test', { headers: { 'x-request-id': 'r2' } }),
    ])
    cap.restore()
    expect(cap.lines()).toHaveLength(2)
    const ids = cap.lines().map((l) => JSON.parse(l).requestId)
    expect(ids).toContain('r1')
    expect(ids).toContain('r2')
  })
})
