import type { MiddlewareHandler } from 'hono'

// Extend Hono's context variable map so c.get/set('requestId') is fully typed
declare module 'hono' {
  interface ContextVariableMap {
    requestId: string
  }
}

const MAX_ID_LENGTH = 128

function generateId(): string {
  // 8 random hex characters — enough to correlate logs within a single deploy
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0')
}

/**
 * Assigns a request ID to every incoming request.
 *
 * - If the client sends `x-request-id`, that value is used (up to 128 chars).
 *   Empty strings and values exceeding the limit are treated as absent.
 * - Otherwise an 8-char hex ID is generated.
 * - The ID is stored on the Hono context (`c.get('requestId')`) and echoed
 *   in the `x-request-id` response header so clients can correlate logs.
 */
export function requestId(): MiddlewareHandler {
  return async (c, next) => {
    const incoming = c.req.header('x-request-id')?.trim() ?? ''
    const id =
      incoming.length > 0 && incoming.length <= MAX_ID_LENGTH
        ? incoming
        : generateId()

    c.set('requestId', id)
    c.header('x-request-id', id)

    return next()
  }
}
