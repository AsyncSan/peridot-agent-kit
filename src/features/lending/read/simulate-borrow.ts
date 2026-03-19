import Decimal from 'decimal.js'
import { z } from 'zod'
import { PeridotApiClient } from '../../../shared/api-client'
import { BSC_MAINNET_CHAIN_ID, isHubChain } from '../../../shared/constants'
import { readOnChainPosition } from '../../../shared/on-chain-position'
import type { PeridotConfig, SimulateBorrowResult } from '../../../shared/types'
import { evmAddress, tokenAmount } from '../../../shared/zod-utils'

export const simulateBorrowSchema = z.object({
  address: evmAddress.describe('The wallet address planning to borrow'),
  asset: z.string().describe('The asset to borrow, e.g. "USDC", "WETH"'),
  amount: tokenAmount.describe('Human-readable borrow amount, e.g. "500" for 500 USDC'),
  chainId: z
    .number()
    .int()
    .default(BSC_MAINNET_CHAIN_ID)
    .refine(isHubChain, { message: 'chainId must be a hub chain (56=BSC, 143=Monad, 1868=Somnia).' })
    .describe('Hub chain ID. Defaults to BSC (56).'),
})

export type SimulateBorrowInput = z.infer<typeof simulateBorrowSchema>

/** Risk thresholds for the simplified health factor. */
const RISK_THRESHOLDS = {
  safe: 2.0,
  moderate: 1.5,
  high: 1.2,
  critical: 1.0,
} as const

function classifyRisk(hf: number): SimulateBorrowResult['riskLevel'] {
  if (hf >= RISK_THRESHOLDS.safe) return 'safe'
  if (hf >= RISK_THRESHOLDS.moderate) return 'moderate'
  if (hf >= RISK_THRESHOLDS.high) return 'high'
  if (hf >= RISK_THRESHOLDS.critical) return 'critical'
  return 'liquidatable'
}

export async function simulateBorrow(
  input: SimulateBorrowInput,
  config: PeridotConfig,
): Promise<SimulateBorrowResult> {
  const apiClient = new PeridotApiClient(config)

  // Read on-chain position and market prices in parallel — both public, no auth needed
  const [position, metricsData] = await Promise.all([
    readOnChainPosition(input.address, input.chainId, config),
    apiClient.getMarketMetrics(),
  ])

  const assetUpper = input.asset.toUpperCase()
  const metricKey = `${assetUpper}:${input.chainId}`
  const metric = metricsData[metricKey]

  if (!metric) {
    throw new Error(`No market data for ${assetUpper} on chain ${input.chainId}`)
  }

  const borrowAmountRaw = parseFloat(input.amount)
  if (isNaN(borrowAmountRaw) || borrowAmountRaw <= 0) {
    throw new Error(`Invalid borrow amount: "${input.amount}"`)
  }

  const borrowAmount = new Decimal(input.amount)
  const borrowAmountUsd = borrowAmount.mul(metric.priceUsd).toNumber()

  const { totalSuppliedUsd, totalBorrowedUsd } = position

  const currentHF =
    totalBorrowedUsd > 0
      ? new Decimal(totalSuppliedUsd).div(totalBorrowedUsd).toNumber()
      : null

  if (totalSuppliedUsd === 0) {
    return {
      currentHealthFactor: null,
      projectedHealthFactor: null,
      borrowAmountUsd,
      isSafe: false,
      riskLevel: 'liquidatable',
      maxSafeBorrowUsd: 0,
      warning:
        'No supplied collateral found on-chain for this address. ' +
        'Supply assets and enable them as collateral before borrowing.',
    }
  }

  const projectedBorrowedUsd = new Decimal(totalBorrowedUsd).add(borrowAmountUsd)
  const projectedHF = new Decimal(totalSuppliedUsd).div(projectedBorrowedUsd).toNumber()

  // Max safe borrow keeps projected HF at the "safe" threshold (2.0)
  const maxSafeBorrowUsd = Decimal.max(
    0,
    new Decimal(totalSuppliedUsd).div(RISK_THRESHOLDS.safe).sub(totalBorrowedUsd),
  ).toNumber()

  const riskLevel = classifyRisk(projectedHF)
  const isSafe = projectedHF >= RISK_THRESHOLDS.high

  const warnings: string[] = []
  if (riskLevel === 'liquidatable') {
    warnings.push('This borrow would immediately make you eligible for liquidation.')
  } else if (riskLevel === 'critical') {
    warnings.push('Health factor would drop critically low. Any price movement risks liquidation.')
  } else if (riskLevel === 'high') {
    warnings.push('Health factor would be dangerously low. Consider borrowing less.')
  }

  return {
    currentHealthFactor: currentHF,
    projectedHealthFactor: projectedHF,
    borrowAmountUsd,
    isSafe,
    riskLevel,
    maxSafeBorrowUsd,
    warning: warnings[0],
  }
}
