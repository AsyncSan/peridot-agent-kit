export interface Env {
  DATABASE_URL: string
  PORT: number
  HOST: string
  CORS_ORIGIN: string
  NETWORK_PRESET: 'mainnet' | 'testnet'
  RATE_LIMIT_RPM: number
  RATE_LIMIT_WINDOW_MS: number
  DB_SSL_REJECT_UNAUTHORIZED: boolean
  DB_QUERY_TIMEOUT_MS: number
  /** When set, all /api/* and /metrics requests must supply a matching x-api-key header. */
  API_KEY: string | undefined
  /**
   * Set to "true" when the server sits behind a trusted reverse proxy
   * (Nginx, Cloudflare, etc.) that injects X-Forwarded-For / CF-Connecting-IP.
   * When false (default), those headers are ignored and the real TCP remote
   * address is used — preventing clients from spoofing IPs to bypass rate limiting.
   */
  TRUSTED_PROXY: boolean
}

/**
 * Validates and returns all environment variables as a typed object.
 * Throws a descriptive Error on the first invalid value so the process
 * exits immediately at startup with a clear message — not silently at
 * the first request.
 *
 * Accepts an optional `env` argument (defaults to `process.env`) so the
 * function is fully testable without touching the real environment.
 */
export function loadEnv(env: Record<string, string | undefined> = process.env): Env {
  // ── DATABASE_URL ──────────────────────────────────────────────────────────
  const DATABASE_URL = env['DATABASE_URL']
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required (e.g. postgres://user:pass@host:5432/db)')
  }
  if (!DATABASE_URL.startsWith('postgres')) {
    throw new Error(`DATABASE_URL must start with "postgres", got "${DATABASE_URL.slice(0, 20)}…"`)
  }

  // ── PORT ──────────────────────────────────────────────────────────────────
  const portRaw = env['PORT'] ?? '3001'
  const PORT = Number(portRaw)
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${portRaw}"`)
  }

  // ── HOST ─────────────────────────────────────────────────────────────────
  const HOST = env['HOST'] ?? '0.0.0.0'

  // ── CORS_ORIGIN ───────────────────────────────────────────────────────────
  const CORS_ORIGIN = env['CORS_ORIGIN'] ?? '*'

  // ── NETWORK_PRESET ────────────────────────────────────────────────────────
  const networkRaw = env['NETWORK_PRESET'] ?? 'mainnet'
  if (networkRaw !== 'mainnet' && networkRaw !== 'testnet') {
    throw new Error(`NETWORK_PRESET must be "mainnet" or "testnet", got "${networkRaw}"`)
  }
  const NETWORK_PRESET = networkRaw

  // ── RATE_LIMIT_RPM ────────────────────────────────────────────────────────
  const rpmRaw = env['RATE_LIMIT_RPM'] ?? '120'
  const RATE_LIMIT_RPM = Number(rpmRaw)
  if (!Number.isInteger(RATE_LIMIT_RPM) || RATE_LIMIT_RPM <= 0) {
    throw new Error(`RATE_LIMIT_RPM must be a positive integer, got "${rpmRaw}"`)
  }

  // ── RATE_LIMIT_WINDOW_MS ─────────────────────────────────────────────────
  const windowRaw = env['RATE_LIMIT_WINDOW_MS'] ?? '60000'
  const RATE_LIMIT_WINDOW_MS = Number(windowRaw)
  if (!Number.isInteger(RATE_LIMIT_WINDOW_MS) || RATE_LIMIT_WINDOW_MS <= 0) {
    throw new Error(`RATE_LIMIT_WINDOW_MS must be a positive integer, got "${windowRaw}"`)
  }

  // ── DB_SSL_REJECT_UNAUTHORIZED ────────────────────────────────────────────
  const DB_SSL_REJECT_UNAUTHORIZED = env['DB_SSL_REJECT_UNAUTHORIZED'] !== 'false'

  // ── DB_QUERY_TIMEOUT_MS ───────────────────────────────────────────────────
  const queryTimeoutRaw = env['DB_QUERY_TIMEOUT_MS'] ?? '8000'
  const DB_QUERY_TIMEOUT_MS = Number(queryTimeoutRaw)
  if (!Number.isInteger(DB_QUERY_TIMEOUT_MS) || DB_QUERY_TIMEOUT_MS <= 0) {
    throw new Error(`DB_QUERY_TIMEOUT_MS must be a positive integer, got "${queryTimeoutRaw}"`)
  }

  const API_KEY = env['API_KEY'] || undefined
  const TRUSTED_PROXY = env['TRUSTED_PROXY'] === 'true'

  return {
    DATABASE_URL,
    PORT,
    HOST,
    CORS_ORIGIN,
    NETWORK_PRESET,
    RATE_LIMIT_RPM,
    RATE_LIMIT_WINDOW_MS,
    DB_SSL_REJECT_UNAUTHORIZED,
    DB_QUERY_TIMEOUT_MS,
    API_KEY,
    TRUSTED_PROXY,
  }
}
