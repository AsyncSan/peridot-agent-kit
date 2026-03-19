import { z } from 'zod'
import { PeridotApiClient } from '../../../shared/api-client'
import { BSC_MAINNET_CHAIN_ID, isHubChain } from '../../../shared/constants'
import { readOnChainPosition } from '../../../shared/on-chain-position'
import type { PeridotConfig, PortfolioOverview } from '../../../shared/types'
import { evmAddress } from '../../../shared/zod-utils'
import { Cache } from '../../../shared/cache'

export const portfolioCache = new Cache<PortfolioOverview>(30_000)

export const getPortfolioSchema = z.object({
  address: evmAddress.describe('The wallet address (0x...) to look up'),
  chainId: z
    .number()
    .int()
    .default(BSC_MAINNET_CHAIN_ID)
    .refine(isHubChain, { message: 'chainId must be a hub chain (56=BSC, 143=Monad, 1868=Somnia).' })
    .describe('Hub chain ID to query. Defaults to BSC (56).'),
})

export type GetPortfolioInput = z.infer<typeof getPortfolioSchema>

export async function getPortfolio(
  input: GetPortfolioInput,
  config: PeridotConfig,
): Promise<PortfolioOverview> {
  const key = `${input.address.toLowerCase()}:${input.chainId}`

  return portfolioCache.getOrFetch(key, async () => {
    const apiClient = new PeridotApiClient(config)

    const [position, apyData] = await Promise.all([
      readOnChainPosition(input.address, input.chainId, config),
      apiClient.getMarketApy(input.chainId),
    ])

    const { totalSuppliedUsd, totalBorrowedUsd, assets } = position

    // Net APY: weighted by position size across all active markets
    let netApy = 0
    if (totalSuppliedUsd > 0) {
      let weighted = 0
      for (const asset of assets) {
        const apyEntry = apyData[asset.assetId.toLowerCase()]?.[input.chainId]
        if (apyEntry) {
          weighted += asset.suppliedUsd * (apyEntry.totalSupplyApy ?? 0)
          weighted -= asset.borrowedUsd * (apyEntry.netBorrowApy ?? 0)
        }
      }
      netApy = weighted / totalSuppliedUsd
    }

    return {
      address: input.address,
      fetchedAt: new Date().toISOString(),
      portfolio: {
        currentValue: totalSuppliedUsd - totalBorrowedUsd,
        totalSupplied: totalSuppliedUsd,
        totalBorrowed: totalBorrowedUsd,
        netApy,
        healthFactor: totalBorrowedUsd > 0 ? totalSuppliedUsd / totalBorrowedUsd : null,
      },
      assets: assets.map((a) => ({
        assetId: a.assetId,
        supplied: a.suppliedUsd,
        borrowed: a.borrowedUsd,
        net: a.suppliedUsd - a.borrowedUsd,
        percentage:
          totalSuppliedUsd > 0 ? ((a.suppliedUsd - a.borrowedUsd) / totalSuppliedUsd) * 100 : 0,
      })),
    }
  })
}
