import { BICONOMY_API_URL, DEFAULT_API_BASE_URL } from './constants'

/** Default timeout for Peridot platform API reads (ms). */
const PLATFORM_TIMEOUT_MS = 10_000
/** Longer timeout for Biconomy compose — builds a full cross-chain route (ms). */
const BICONOMY_COMPOSE_TIMEOUT_MS = 30_000
import type {
  BiconomyResponse,
  ComposeRequest,
  PeridotConfig,
  TransactionStatus,
} from './types'

// ---------------------------------------------------------------------------
// Raw API response shapes (internal — not exported from package root)
// ---------------------------------------------------------------------------

export interface RawMarketMetric {
  utilizationPct: number
  tvlUsd: number
  liquidityUnderlying: number
  liquidityUsd: number
  priceUsd: number
  collateral_factor_pct: number
  updatedAt: string
  chainId: number
}

/** Shape of one entry from `/api/apy` (from `apy_latest_mainnet` table). */
export interface RawMarketApy {
  supplyApy: number
  borrowApy: number
  peridotSupplyApy: number
  peridotBorrowApy: number
  boostSourceSupplyApy: number
  boostRewardsSupplyApy: number
  totalSupplyApy: number
  netBorrowApy: number
  timestamp: string
}

/**
 * Full response from `/api/apy`.
 * Keys are lowercase asset IDs (e.g. "usdc"), values are a map of chainId → APY data.
 */
export type RawApyResponse = Record<string, Record<number, RawMarketApy>>

/** Shape of one leaderboard entry from `/api/leaderboard`. */
export interface RawLeaderboardEntry {
  rank: number
  address: string
  totalPoints: number
  supplyCount: number
  borrowCount: number
  repayCount: number
  redeemCount: number
  updatedAt: string
}

export interface RawLeaderboardResponse {
  entries: RawLeaderboardEntry[]
  total: number
}

export interface RawUserPortfolio {
  portfolio: {
    currentValue: number
    totalSupplied: number
    totalBorrowed: number
    netApy: number
    /** Note: simplified ratio (totalSupplied / totalBorrowed), not liquidation HF */
    healthFactor: number
  }
  assets: Array<{
    assetId: string
    supplied: number
    borrowed: number
    net: number
    percentage: number
  }>
  transactions: {
    totalCount: number
    supplyCount: number
    borrowCount: number
    repayCount: number
    redeemCount: number
  }
  earnings: {
    effectiveApy: number
    totalLifetimeEarnings: number
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class PeridotApiClient {
  private readonly baseUrl: string
  private readonly biconomyApiKey: string | undefined

  constructor(config: PeridotConfig) {
    this.baseUrl = config.apiBaseUrl ?? DEFAULT_API_BASE_URL
    this.biconomyApiKey = config.biconomyApiKey
  }

  /**
   * Fetches all market metrics. Returns a record keyed by `${ASSET}:${chainId}`.
   * Example key: `USDC:56`
   */
  async getMarketMetrics(): Promise<Record<string, RawMarketMetric>> {
    const res = await fetch(`${this.baseUrl}/api/markets/metrics`, { signal: AbortSignal.timeout(PLATFORM_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`Failed to fetch market metrics: ${res.status} ${res.statusText}`)
    const json = (await res.json()) as { ok: boolean; data: Record<string, RawMarketMetric>; error?: string }
    if (!json.ok) throw new Error(`Market metrics API error: ${json.error ?? 'unknown'}`)
    return json.data
  }

  /**
   * Fetches the portfolio overview for a wallet address.
   * Uses the platform's portfolio-data endpoint which aggregates DB snapshots.
   */
  async getUserPortfolio(address: string): Promise<RawUserPortfolio> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new Error(`Invalid address format: "${address}". Expected 0x followed by 40 hex characters.`)
    }
    const res = await fetch(`${this.baseUrl}/api/user/portfolio-data?address=${address}`, { signal: AbortSignal.timeout(PLATFORM_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`Failed to fetch portfolio: ${res.status} ${res.statusText}`)
    const json = (await res.json()) as { ok: boolean; data: RawUserPortfolio; error?: string }
    if (!json.ok) throw new Error(`Portfolio API error: ${json.error ?? 'unknown'}`)
    return json.data
  }

  /**
   * Fetches the latest APY snapshot for all markets (or a specific chain).
   * Calls `/api/apy` — backed by the `apy_latest_mainnet` DB table.
   *
   * Returns a record keyed by lowercase asset ID, then by chainId.
   * Example: `data["usdc"][56].totalSupplyApy`
   */
  async getMarketApy(chainId?: number): Promise<RawApyResponse> {
    const url = chainId
      ? `${this.baseUrl}/api/apy?chainId=${chainId}`
      : `${this.baseUrl}/api/apy`
    const res = await fetch(url, { signal: AbortSignal.timeout(PLATFORM_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`Failed to fetch APY data: ${res.status} ${res.statusText}`)
    const json = (await res.json()) as { ok: boolean; data: RawApyResponse; error?: string }
    if (!json.ok) throw new Error(`APY API error: ${json.error ?? 'unknown'}`)
    return json.data
  }

  /**
   * Fetches the Peridot leaderboard (top users by points).
   * Optionally filters by chainId and limits the result set.
   */
  async getLeaderboard(options?: { limit?: number; chainId?: number }): Promise<RawLeaderboardResponse> {
    const params = new URLSearchParams()
    if (options?.limit !== undefined) params.set('limit', String(options.limit))
    if (options?.chainId !== undefined) params.set('chainId', String(options.chainId))
    const query = params.toString() ? `?${params.toString()}` : ''
    const res = await fetch(`${this.baseUrl}/api/leaderboard${query}`, { signal: AbortSignal.timeout(PLATFORM_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`Failed to fetch leaderboard: ${res.status} ${res.statusText}`)
    const json = (await res.json()) as { ok: boolean; data: RawLeaderboardResponse; error?: string }
    if (!json.ok) throw new Error(`Leaderboard API error: ${json.error ?? 'unknown'}`)
    return json.data
  }

  /**
   * Calls Biconomy MEE /compose to build a cross-chain transaction payload.
   * Does NOT execute — the returned instructions must be signed by the user.
   */
  async biconomyCompose(request: ComposeRequest): Promise<BiconomyResponse> {
    if (!this.biconomyApiKey) {
      throw new Error('biconomyApiKey is required in PeridotConfig for cross-chain operations')
    }
    const res = await fetch(`${BICONOMY_API_URL}/v1/instructions/compose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.biconomyApiKey,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(BICONOMY_COMPOSE_TIMEOUT_MS),
    })
    if (!res.ok) {
      const error: unknown = await res.json().catch(() => ({}))
      throw new Error(`Biconomy compose error: ${JSON.stringify(error)}`)
    }
    return res.json() as Promise<BiconomyResponse>
  }

  /** Polls Biconomy for the status of a submitted super-transaction. */
  async biconomyGetStatus(superTxHash: string): Promise<TransactionStatus> {
    const res = await fetch(`${BICONOMY_API_URL}/v1/explorer/transaction/${superTxHash}`, { signal: AbortSignal.timeout(PLATFORM_TIMEOUT_MS) })
    if (res.status === 404) return { superTxHash, status: 'not_found' }
    if (!res.ok) throw new Error(`Biconomy status error: ${res.status}`)
    const data = (await res.json()) as Record<string, unknown>
    return parseBiconomyStatus(superTxHash, data)
  }
}

function parseBiconomyStatus(superTxHash: string, data: Record<string, unknown>): TransactionStatus {
  const status = String(data['status'] ?? '').toLowerCase()
  const txHashes = (data['txHashes'] as string[] | undefined) ?? []

  if (status.includes('success') || status.includes('completed')) {
    return { superTxHash, status: 'success', chainTxHashes: txHashes }
  }
  if (status.includes('fail') || status.includes('error')) {
    return { superTxHash, status: 'failed', error: String(data['message'] ?? 'Unknown error') }
  }
  if (status.includes('process')) {
    return { superTxHash, status: 'processing', chainTxHashes: txHashes }
  }
  return { superTxHash, status: 'pending' }
}
