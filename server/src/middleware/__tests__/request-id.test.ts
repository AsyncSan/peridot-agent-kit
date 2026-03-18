import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { requestId } from '../request-id'

function makeApp() {
  const app = new Hono()
  app.use('*', requestId())
  app.get('/test', (c) => c.json({ id: c.get('requestId') }))
  return app
}

describe('requestId middleware', () => {
  it('echoes a provided x-request-id back in the response header', async () => {
    const res = await makeApp().request('/test', {
      headers: { 'x-request-id': 'abc123' },
    })
    expect(res.headers.get('x-request-id')).toBe('abc123')
  })

  it('makes the provided ID available on the context', async () => {
    const res = await makeApp().request('/test', {
      headers: { 'x-request-id': 'my-trace-id' },
    })
    const body = await res.json()
    expect(body.id).toBe('my-trace-id')
  })

  it('generates an ID when x-request-id is absent', async () => {
    const res = await makeApp().request('/test')
    const id = res.headers.get('x-request-id')
    expect(id).not.toBeNull()
    expect(id!.length).toBeGreaterThan(0)
  })

  it('generated ID matches 8-char hex format', async () => {
    const res = await makeApp().request('/test')
    const id = res.headers.get('x-request-id')!
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('generates a different ID for each request', async () => {
    const app = makeApp()
    const r1 = await app.request('/test')
    const r2 = await app.request('/test')
    expect(r1.headers.get('x-request-id')).not.toBe(r2.headers.get('x-request-id'))
  })

  it('generates an ID when x-request-id is an empty string', async () => {
    const res = await makeApp().request('/test', {
      headers: { 'x-request-id': '' },
    })
    const id = res.headers.get('x-request-id')!
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('generates an ID when x-request-id is only whitespace', async () => {
    const res = await makeApp().request('/test', {
      headers: { 'x-request-id': '   ' },
    })
    const id = res.headers.get('x-request-id')!
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('generates a new ID when x-request-id exceeds 128 characters', async () => {
    const longId = 'a'.repeat(129)
    const res = await makeApp().request('/test', {
      headers: { 'x-request-id': longId },
    })
    const id = res.headers.get('x-request-id')!
    expect(id).not.toBe(longId)
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('accepts a 128-character ID (at the limit)', async () => {
    const maxId = 'b'.repeat(128)
    const res = await makeApp().request('/test', {
      headers: { 'x-request-id': maxId },
    })
    expect(res.headers.get('x-request-id')).toBe(maxId)
  })

  it('x-request-id is present on every response regardless of route', async () => {
    const app = new Hono()
    app.use('*', requestId())
    app.get('/a', (c) => c.json({}))
    app.get('/b', (c) => c.text('ok'))

    const ra = await app.request('/a')
    const rb = await app.request('/b')
    expect(ra.headers.has('x-request-id')).toBe(true)
    expect(rb.headers.has('x-request-id')).toBe(true)
  })
})
