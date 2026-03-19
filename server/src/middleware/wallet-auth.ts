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

export interface WalletAuthOptions {
  maxAgeSeconds?: number
  /**
   * When true, a valid `x-api-key` header (matching the `API_KEY` env var)
   * bypasses wallet signature verification. This allows server-side AI agents
   * to query any address without holding the user's private key.
   *
   * Only enable on deployments where the API key is kept server-side and not
   * exposed to end users — possession of the API key grants read access to any
   * address's portfolio and transaction data.
   */
  allowApiKey?: boolean
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
 *
 * When allowApiKey=true, a matching x-api-key header bypasses wallet auth
 * entirely — intended for server-side AI agents that cannot hold private keys.
 */
export function walletAuth(options: WalletAuthOptions | number = {}): MiddlewareHandler {
  // Support legacy walletAuth(maxAgeSeconds) call signature
  const opts: WalletAuthOptions = typeof options === 'number' ? { maxAgeSeconds: options } : options
  const maxAgeSeconds = opts.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS
  const allowApiKey = opts.allowApiKey ?? false

  return async (c, next) => {
    const address = c.req.query('address')

    // No address supplied — pass through; route returns 400 for missing address
    if (!address) return next()

    // API key bypass: if enabled and a valid key is presented, skip wallet auth
    if (allowApiKey) {
      const configuredKey = process.env['API_KEY']
      if (configuredKey && c.req.header('x-api-key') === configuredKey) {
        return next()
      }
    }

    const sig = c.req.header('x-wallet-signature')
    const tsRaw = c.req.header('x-wallet-timestamp')

    if (!sig || !tsRaw) {
      return c.json(
        { ok: false, error: 'x-wallet-signature and x-wallet-timestamp headers are required' },
        401,
      )
    }

    const ts = Number(tsRaw)
    if (!Number.isInteger(ts) || ts <= 0) {
      return c.json({ ok: false, error: 'x-wallet-timestamp must be a positive integer (Unix seconds)' }, 401)
    }

    const ageSecs = Math.abs(Date.now() / 1000 - ts)
    if (ageSecs > maxAgeSeconds) {
      return c.json(
        { ok: false, error: `Signature expired (age ${Math.round(ageSecs)}s, max ${maxAgeSeconds}s)` },
        401,
      )
    }

    const message = buildAuthMessage(address, ts)

    let recovered: string
    try {
      recovered = await recoverMessageAddress({ message, signature: sig as `0x${string}` })
    } catch {
      return c.json({ ok: false, error: 'Invalid signature' }, 401)
    }

    if (recovered.toLowerCase() !== address.toLowerCase()) {
      return c.json({ ok: false, error: 'Signature does not match address' }, 401)
    }

    return next()
  }
}
