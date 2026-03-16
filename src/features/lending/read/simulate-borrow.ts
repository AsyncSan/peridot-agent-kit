import { z } from 'zod'
import { PeridotApiClient } from '../../../shared/api-client'
import { BSC_MAINNET_CHAIN_ID } from '../../../shared/constants'
import type { PeridotConfig, SimulateBorrowResult } from '../../../shared/types'

export const simulateBorrowSchema = z.object({
  address: z.string().describe('The wallet address planning to borrow'),
  asset: z.string().describe('The asset to borrow, e.g. "USDC", "WETH"'),
  amount: z
    .string()
    .describe('Human-readable borrow amount, e.g. "500" for 500 USDC'),
  chainId: z
    .number()
    .default(BSC_MAINNET_CHAIN_ID)
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
  const client = new PeridotApiClient(config)

  // Fetch position and market price in parallel
  const [portfolioData, metricsData] = await Promise.all([
    client.getUserPortfolio(input.address),
    client.getMarketMetrics(),
  ])

  const assetUpper = input.asset.toUpperCase()
  const metricKey = `${assetUpper}:${input.chainId}`
  const metric = metricsData[metricKey]

  if (!metric) {
    throw new Error(`No market data for ${assetUpper} on chain ${input.chainId}`)
  }

  const borrowAmountHuman = parseFloat(input.amount)
  if (isNaN(borrowAmountHuman) || borrowAmountHuman <= 0) {
    throw new Error(`Invalid borrow amount: "${input.amount}"`)
  }

  const borrowAmountUsd = borrowAmountHuman * metric.priceUsd
  const { totalSupplied, totalBorrowed } = portfolioData.portfolio

  const currentHF = totalBorrowed > 0 ? totalSupplied / totalBorrowed : null
  const projectedBorrowedUsd = totalBorrowed + borrowAmountUsd

  if (totalSupplied === 0) {
    return {
      currentHealthFactor: null,
      projectedHealthFactor: null,
      borrowAmountUsd,
      isSafe: false,
      riskLevel: 'liquidatable',
      maxSafeBorrowUsd: 0,
      warning:
        'No collateral supplied. You must supply assets and enable them as collateral before borrowing.',
    }
  }

  const projectedHF = totalSupplied / projectedBorrowedUsd

  // Max safe borrow keeps projected HF at the "safe" threshold (2.0)
  const maxSafeBorrowUsd = Math.max(0, totalSupplied / RISK_THRESHOLDS.safe - totalBorrowed)

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
