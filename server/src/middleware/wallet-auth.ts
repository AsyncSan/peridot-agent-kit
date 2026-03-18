import type { MiddlewareHandler } from 'hono'
import { recoverMessageAddress } from 'viem'

/** Default freshness window: 5 minutes either side of `Date.now()`. */
const DEFAULT_MAX_AGE_SECONDS = 300

/**
 * Builds the canonical EIP-191 message a wallet must sign to prove ownership
 * of `address`. Export so client dApps can use the exact same format.
 *
 * Format (human-readable in MetaMask):
 *   Peridot: Access portfolio for {lowercase address} at {unix seconds}
 */
export function buildAuthMessage(address: string, timestamp: number): string {
  return `Peridot: Access portfolio for ${address.toLowerCase()} at ${timestamp}`
}

/**
 * Wallet-signature authentication middleware for portfolio endpoints.
 *
 * Required request headers:
 *   x-wallet-signature  — EIP-191 hex signature of buildAuthMessage(address, timestamp)
 *   x-wallet-timestamp  — Unix timestamp (seconds) at time of signing
 *
 * The recovered signer must match the `?address` query parameter and the
 * timestamp must be within `maxAgeSeconds` of the current server time.
 *
 * Short-circuits to next() if no `address` query param is present so the
 * route handler can return its own 400 for missing address.
 */
export function walletAuth(maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS): MiddlewareHandler {
  return async (c, next) => {
    const address = c.req.query('address')

    // No address supplied — pass through; route returns 400 for missing address
    if (!address) return next()

    const sig = c.req.header('x-wallet-signature')
    const tsRaw = c.req.header('x-wallet-timestamp')

    if (!sig || !tsRaw) {
      return c.json(
        { success: false, error: 'x-wallet-signature and x-wallet-timestamp headers are required' },
        401,
      )
    }

    const ts = Number(tsRaw)
    if (!Number.isInteger(ts) || ts <= 0) {
      return c.json({ success: false, error: 'x-wallet-timestamp must be a positive integer (Unix seconds)' }, 401)
    }

    const ageSecs = Math.abs(Date.now() / 1000 - ts)
    if (ageSecs > maxAgeSeconds) {
      return c.json(
        { success: false, error: `Signature expired (age ${Math.round(ageSecs)}s, max ${maxAgeSeconds}s)` },
        401,
      )
    }

    const message = buildAuthMessage(address, ts)

    let recovered: string
    try {
      recovered = await recoverMessageAddress({ message, signature: sig as `0x${string}` })
    } catch {
      return c.json({ success: false, error: 'Invalid signature' }, 401)
    }

    if (recovered.toLowerCase() !== address.toLowerCase()) {
      return c.json({ success: false, error: 'Signature does not match address' }, 401)
    }

    return next()
  }
}
