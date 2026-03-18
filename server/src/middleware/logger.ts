import type { MiddlewareHandler } from 'hono'
import { recordRequest } from '../metrics'

interface LogLine {
  ts: string
  method: string
  path: string
  status: number
  latencyMs: number
  requestId?: string
  error?: string
}

/**
 * Structured JSON request logger.
 * Writes one newline-delimited JSON object to stdout per request.
 * Compatible with DigitalOcean Logs, Datadog, Logtail, and any
 * log aggregator that expects NDJSON.
 *
 * On 5xx responses the log line also includes an `error` field
 * sourced from `c.error` (set automatically by Hono's onError handler).
 */
export function jsonLogger(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now()

    await next()

    const line: LogLine = {
      ts: new Date().toISOString(),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      latencyMs: Date.now() - start,
      requestId: c.get('requestId'),
    }

    // c.error is set by Hono when onError handled an unhandled exception
    if (c.error) {
      line.error = c.error instanceof Error ? c.error.message : String(c.error)
    }

    process.stdout.write(JSON.stringify(line) + '\n')

    recordRequest(line.path, line.status, line.latencyMs)
  }
}
