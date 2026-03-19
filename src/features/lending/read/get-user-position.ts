import { z } from 'zod'
import { PeridotApiClient } from '../../../shared/api-client'
import { BSC_MAINNET_CHAIN_ID, isHubChain } from '../../../shared/constants'
import { readOnChainPosition } from '../../../shared/on-chain-position'
import type { PeridotConfig, UserPosition } from '../../../shared/types'
import { evmAddress } from '../../../shared/zod-utils'

export const getUserPositionSchema = z.object({
  address: evmAddress.describe('The wallet address (0x...) to look up'),
  chainId: z
    .number()
    .int()
    .default(BSC_MAINNET_CHAIN_ID)
    .refine(isHubChain, { message: 'chainId must be a hub chain (56=BSC, 143=Monad, 1868=Somnia).' })
    .describe('Hub chain ID to query. Defaults to BSC (56).'),
})

export type GetUserPositionInput = z.infer<typeof getUserPositionSchema>

export async function getUserPosition(
  input: GetUserPositionInput,
  config: PeridotConfig,
): Promise<UserPosition> {
  const apiClient = new PeridotApiClient(config)

  // Read position on-chain and APY data in parallel — both are public, no auth needed
  const [position, apyData] = await Promise.all([
    readOnChainPosition(input.address, input.chainId, config),
    apiClient.getMarketApy(input.chainId),
  ])

  const { totalSuppliedUsd, totalBorrowedUsd, assets } = position

  const healthFactor =
    totalBorrowedUsd > 0 ? totalSuppliedUsd / totalBorrowedUsd : null

  // Net APY: weighted by position size across all active markets
  let netApyPct = 0
  if (totalSuppliedUsd > 0) {
    let weightedApy = 0
    for (const asset of assets) {
      const apyEntry = apyData[asset.assetId.toLowerCase()]?.[input.chainId]
      if (apyEntry) {
        weightedApy += asset.suppliedUsd * (apyEntry.totalSupplyApy ?? 0)
        weightedApy -= asset.borrowedUsd * (apyEntry.netBorrowApy ?? 0)
      }
    }
    netApyPct = weightedApy / totalSuppliedUsd
  }

  return {
    address: input.address,
    totalSuppliedUsd,
    totalBorrowedUsd,
    netWorthUsd: totalSuppliedUsd - totalBorrowedUsd,
    netApyPct,
    healthFactor,
    assets: assets.map((a) => ({
      assetId: a.assetId,
      suppliedUsd: a.suppliedUsd,
      borrowedUsd: a.borrowedUsd,
      netUsd: a.suppliedUsd - a.borrowedUsd,
    })),
    fetchedAt: new Date().toISOString(),
  }
}
