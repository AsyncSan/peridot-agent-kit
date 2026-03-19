import type { MiddlewareHandler } from 'hono'

const CONFIGURED_KEY = process.env['API_KEY']

/**
 * Optional API key guard.
 *
 * When the `API_KEY` environment variable is set, every request must supply a
 * matching value via the `x-api-key` header. Requests without a valid key get
 * a 401 response.
 *
 * When `API_KEY` is not configured the middleware is a no-op — the server
 * remains open, which is safe behind Cloudflare with rate limiting in place.
 *
 * Applied to all `/api/*` routes and `/metrics` in app.ts.
 */
export function apiKeyAuth(): MiddlewareHandler {
  return async (c, next) => {
    if (!CONFIGURED_KEY) return next()

    const provided = c.req.header('x-api-key')
    if (!provided || provided !== CONFIGURED_KEY) {
      return c.json({ ok: false, error: 'Missing or invalid API key' }, 401)
    }

    return next()
  }
}
