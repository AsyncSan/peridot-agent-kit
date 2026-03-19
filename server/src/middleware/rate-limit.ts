import type { IncomingMessage } from 'http'
import type { MiddlewareHandler } from 'hono'

const MAX_RPM = parseInt(process.env['RATE_LIMIT_RPM'] ?? '120', 10)
const WINDOW_MS = parseInt(process.env['RATE_LIMIT_WINDOW_MS'] ?? '60000', 10)

// IP → sorted list of request timestamps within the current window
const windows = new Map<string, number[]>()

/** Clears all rate-limit state. Only for use in tests. */
export function _clearWindowsForTesting(): void { windows.clear() }

// Prune stale IPs once per window so the map doesn't grow forever
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS
  for (const [ip, hits] of windows) {
    const fresh = hits.filter((t) => t > cutoff)
    if (fresh.length === 0) windows.delete(ip)
    else windows.set(ip, fresh)
  }
}, WINDOW_MS).unref() // .unref() so this timer never keeps the process alive

/**
 * Sliding-window rate limiter.
 * Limits to `maxRpm` requests per IP per window (default: RATE_LIMIT_RPM env var or 120/min).
 * Adds X-RateLimit-* headers to every response so clients can self-throttle.
 *
 * Set TRUSTED_PROXY=true when the server sits behind a reverse proxy (Nginx, Cloudflare, etc.)
 * that injects trustworthy X-Forwarded-For / CF-Connecting-IP headers.
 * When false (default), those headers are ignored and the real TCP remote address is used —
 * preventing clients from spoofing IPs to bypass rate limiting.
 */
export function rateLimit(maxRpm = MAX_RPM): MiddlewareHandler {
  // Read at factory time so tests can set process.env before calling makeApp()
  const trustedProxy = process.env['TRUSTED_PROXY'] === 'true'

  return async (c, next) => {
    let ip: string
    if (trustedProxy) {
      // Behind a trusted proxy — use injected headers
      ip =
        c.req.header('cf-connecting-ip') ??
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
        c.req.header('x-real-ip') ??
        'unknown'
    } else {
      // Direct connection — use actual TCP remote address (not spoofable)
      const incoming = (c.env as { incoming?: IncomingMessage })?.incoming
      ip = incoming?.socket?.remoteAddress ?? 'unknown'
    }

    const now = Date.now()
    const cutoff = now - WINDOW_MS
    const hits = (windows.get(ip) ?? []).filter((t) => t > cutoff)
    const remaining = Math.max(0, maxRpm - hits.length)

    if (hits.length >= maxRpm) {
      // Oldest hit tells us when the window clears
      const retryAfter = Math.ceil((hits[0]! + WINDOW_MS - now) / 1000)
      c.header('X-RateLimit-Limit', String(maxRpm))
      c.header('X-RateLimit-Remaining', '0')
      c.header('Retry-After', String(retryAfter))
      return c.json({ ok: false, error: 'Too many requests' }, 429)
    }

    hits.push(now)
    windows.set(ip, hits)

    c.header('X-RateLimit-Limit', String(maxRpm))
    c.header('X-RateLimit-Remaining', String(remaining - 1))

    return next()
  }
}
