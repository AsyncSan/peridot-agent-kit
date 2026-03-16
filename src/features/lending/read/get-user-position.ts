import { z } from 'zod'
import { PeridotApiClient } from '../../../shared/api-client'
import type { PeridotConfig, UserPosition } from '../../../shared/types'

export const getUserPositionSchema = z.object({
  address: z.string().describe('The wallet address (0x...) to look up'),
})

export type GetUserPositionInput = z.infer<typeof getUserPositionSchema>

export async function getUserPosition(
  input: GetUserPositionInput,
  config: PeridotConfig,
): Promise<UserPosition> {
  const client = new PeridotApiClient(config)
  const data = await client.getUserPortfolio(input.address)

  const { portfolio, assets, transactions } = data

  const healthFactor =
    portfolio.totalBorrowed > 0
      ? portfolio.totalSupplied / portfolio.totalBorrowed
      : null

  return {
    address: input.address,
    totalSuppliedUsd: portfolio.totalSupplied,
    totalBorrowedUsd: portfolio.totalBorrowed,
    netWorthUsd: portfolio.currentValue,
    netApyPct: portfolio.netApy,
    healthFactor,
    assets: assets.map((a) => ({
      assetId: a.assetId,
      suppliedUsd: a.supplied,
      borrowedUsd: a.borrowed,
      netUsd: a.net,
    })),
    transactions: {
      supplyCount: transactions.supplyCount,
      borrowCount: transactions.borrowCount,
      repayCount: transactions.repayCount,
      redeemCount: transactions.redeemCount,
    },
  }
}
