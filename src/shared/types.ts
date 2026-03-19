import type { Address, Hex } from 'viem'
import type { z } from 'zod'

// ---------------------------------------------------------------------------
// SDK Configuration
// ---------------------------------------------------------------------------

export interface PeridotConfig {
  /** Peridot platform API base URL. Defaults to https://app.peridot.finance */
  apiBaseUrl?: string
  /** Required for cross-chain operations (Biconomy compose/status). */
  biconomyApiKey?: string
  /** Optional RPC URL overrides for direct contract reads. */
  rpcUrls?: Partial<Record<number, string>>
  /** Defaults to 'mainnet'. */
  network?: 'mainnet' | 'testnet'
}

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

/**
 * Feature categories — new feature modules (margin, liquidations) add their
 * own category here so the MCP server and adapters can filter by category.
 */
export type ToolCategory = 'lending' | 'margin' | 'liquidations' | 'info' | 'status'

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  /** Zod schema used for runtime validation and LLM schema generation. */
  inputSchema: z.ZodType<TInput>
  execute: (input: TInput, config: PeridotConfig) => Promise<TOutput> | TOutput
  category: ToolCategory
}

// ---------------------------------------------------------------------------
// Read tool outputs
// ---------------------------------------------------------------------------

export interface MarketRates {
  asset: string
  chainId: number
  /** Base lending supply APY from the interest rate model. */
  supplyApyPct: number
  /** Base lending borrow APY from the interest rate model. */
  borrowApyPct: number
  /** Additional supply APY paid in PERIDOT/ASTER rewards. */
  peridotSupplyApyPct: number
  /** PERIDOT/ASTER rewards that offset the borrow cost. */
  peridotBorrowApyPct: number
  /** Supply APY from an external boost source (Morpho vault, PancakeSwap LP fees, Magma staking). */
  boostSourceSupplyApyPct: number
  /** Additional reward APY for boosted markets (e.g. Morpho reward tokens). */
  boostRewardsSupplyApyPct: number
  /** Total supply APY = base + peridot + boost_source + boost_rewards. */
  totalSupplyApyPct: number
  /** Net borrow APY = base borrow APY − peridot borrow reward APY. */
  netBorrowApyPct: number
  tvlUsd: number
  utilizationPct: number
  liquidityUsd: number
  priceUsd: number
  collateralFactorPct: number
  updatedAt: string
  /** Seconds elapsed since updatedAt. Use this to detect stale market data. */
  dataAgeSeconds: number
  /**
   * False when the APY table has no entry for this asset/chain.
   * All APY fields will be 0 — do NOT present them as real rates.
   * Inform the user that yield data is not yet available.
   */
  apyDataAvailable: boolean
  /** Present when apyDataAvailable=false or data is unusually stale (>5 min). */
  warning?: string | undefined
}

export interface MarketSummary {
  asset: string
  chainId: number
  priceUsd: number
  tvlUsd: number
  utilizationPct: number
  liquidityUsd: number
  collateralFactorPct: number
  updatedAt: string
  /** Seconds elapsed since updatedAt. Values above 300 indicate a stale data feed. */
  dataAgeSeconds: number
}

export interface LeaderboardEntry {
  rank: number
  address: string
  totalPoints: number
  supplyCount: number
  borrowCount: number
  repayCount: number
  redeemCount: number
  updatedAt: string
}

export interface UserPosition {
  address: string
  totalSuppliedUsd: number
  totalBorrowedUsd: number
  netWorthUsd: number
  netApyPct: number
  /** Simplified ratio: totalSupplied / totalBorrowed. Null when no debt. */
  healthFactor: number | null
  assets: Array<{
    assetId: string
    suppliedUsd: number
    borrowedUsd: number
    netUsd: number
  }>
  transactions: {
    supplyCount: number
    borrowCount: number
    repayCount: number
    redeemCount: number
  }
  /** ISO timestamp of when this data was fetched. Portfolio data is indexed from chain events
   *  and may lag recent on-chain activity by up to ~60 seconds. */
  fetchedAt: string
}

export interface PortfolioOverview {
  address: string
  /** ISO timestamp of when this data was fetched. Portfolio data is indexed from chain events
   *  and may lag recent on-chain activity by up to ~60 seconds. */
  fetchedAt: string
  portfolio: {
    currentValue: number
    totalSupplied: number
    totalBorrowed: number
    netApy: number
    /** Simplified ratio: totalSupplied / totalBorrowed. Null when no debt. */
    healthFactor: number | null
  }
  assets: Array<{
    assetId: string
    supplied: number
    borrowed: number
    net: number
    /** Percentage of net portfolio value this asset represents. */
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
    /** Estimated lifetime earnings in USD based on supply history and net APY. */
    totalLifetimeEarnings: number
  }
}

export interface SimulateBorrowResult {
  currentHealthFactor: number | null
  projectedHealthFactor: number | null
  borrowAmountUsd: number
  isSafe: boolean
  riskLevel: 'safe' | 'moderate' | 'high' | 'critical' | 'liquidatable'
  /** Maximum additional safe borrow in USD before health factor drops below 1.5 */
  maxSafeBorrowUsd: number
  warning?: string | undefined
}

export interface AccountLiquidity {
  address: string
  chainId: number
  /** Excess borrowing capacity in USD (0 means at limit). */
  liquidityUsd: number
  /** How far underwater in USD (0 means healthy). */
  shortfallUsd: number
  isHealthy: boolean
}

export interface LiquidatableAccount {
  address: string
  chainId: number
  /** Remaining borrow capacity (0 when underwater). */
  liquidityUsd: number
  /** How far underwater in USD — positive means liquidatable. */
  shortfallUsd: number
  /** When this account was last health-checked by the scanner. */
  checkedAt: string
}

export interface LiquidatablePositions {
  accounts: LiquidatableAccount[]
  count: number
}

// ---------------------------------------------------------------------------
// Intent outputs
// ---------------------------------------------------------------------------

/** A single on-chain call within an intent. */
export interface TransactionCall {
  to: Address
  data: Hex
  value: bigint
  description: string
}

/**
 * Hub-chain intent — same-chain actions (user is already on BSC/Monad/Somnia).
 * The `calls` array must be executed in order. User signs each with their wallet.
 */
export interface HubTransactionIntent {
  type: 'hub'
  chainId: number
  calls: TransactionCall[]
  summary: string
  /** Present when the action carries liquidation risk. */
  warning?: string
}

/**
 * Cross-chain intent — user is on a spoke chain (Arbitrum, Base, etc.).
 * Built via Biconomy MEE compose. The user does NOT sign individual calls;
 * they sign the single Biconomy execute payload in their wallet/dApp.
 */
export interface CrossChainIntent {
  type: 'cross-chain'
  sourceChainId: number
  destinationChainId: number
  summary: string
  /** Human-readable steps shown to the user before they sign. */
  userSteps: string[]
  /** The raw response from Biconomy /compose — pass this to /execute. */
  biconomyInstructions: BiconomyResponse
  estimatedGas: string
}

export type TransactionIntent = HubTransactionIntent | CrossChainIntent

// ---------------------------------------------------------------------------
// Transaction status
// ---------------------------------------------------------------------------

export interface TransactionStatus {
  superTxHash: string
  status: 'pending' | 'processing' | 'success' | 'failed' | 'not_found'
  chainTxHashes?: string[]
  error?: string
}

// ---------------------------------------------------------------------------
// Biconomy internal types (ported from defi-platform/biconomy/constants.ts)
// ---------------------------------------------------------------------------

export type ExecutionMode = 'eoa' | 'smart-account' | 'eoa-7702'

export interface RuntimeErc20Balance {
  type: 'runtimeErc20Balance'
  tokenAddress: Address
  targetAddress?: Address
  constraints?: {
    gte?: string
    lte?: string
    eq?: string
  }
}

export interface ComposeFlow {
  type: '/instructions/build' | '/instructions/intent-simple' | '/instructions/intent'
  data: Record<string, unknown>
  batch?: boolean
}

export interface ComposeRequest {
  ownerAddress: Address
  mode: ExecutionMode
  composeFlows: ComposeFlow[]
}

export interface BiconomyResponse {
  instructions: Array<{
    calls: Array<{
      to: Address
      value: string
      functionSig: string
      inputParams: unknown[]
      outputParams: unknown[]
    }>
    chainId: number
    isComposable: boolean
  }>
  returnedData?: unknown[]
  route?: unknown
  estimatedGas?: string
}
