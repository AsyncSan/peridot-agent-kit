import { z } from 'zod'
import { PeridotApiClient } from '../../../shared/api-client'
import { BSC_MAINNET_CHAIN_ID } from '../../../shared/constants'
import type { MarketRates, PeridotConfig } from '../../../shared/types'

export const getMarketRatesSchema = z.object({
  asset: z.string().describe('Asset symbol, e.g. "USDC", "WETH", "WBTC", "WBNB", "USDT", "AUSD"'),
  chainId: z
    .number()
    .default(BSC_MAINNET_CHAIN_ID)
    .describe('Hub chain ID where the market lives. 56=BSC (default), 143=Monad, 1868=Somnia'),
})

export type GetMarketRatesInput = z.infer<typeof getMarketRatesSchema>

export async function getMarketRates(
  input: GetMarketRatesInput,
  config: PeridotConfig,
): Promise<MarketRates> {
  const client = new PeridotApiClient(config)
  const assetUpper = input.asset.toUpperCase()

  // Fetch market metrics and APY data in parallel
  const [metrics, apyData] = await Promise.all([
    client.getMarketMetrics(),
    client.getMarketApy(input.chainId),
  ])

  // Metrics are keyed as `${ASSET}:${chainId}` (uppercase asset)
  const key = `${assetUpper}:${input.chainId}`
  const metric = metrics[key]

  if (!metric) {
    const available = Object.keys(metrics)
      .filter((k) => k.endsWith(`:${input.chainId}`))
      .map((k) => k.split(':')[0])
    throw new Error(
      `No market data found for "${assetUpper}" on chain ${input.chainId}. ` +
        `Available assets on this chain: ${available.join(', ')}`,
    )
  }

  // APY data is keyed by lowercase asset ID, then by chainId
  const apy = apyData[assetUpper.toLowerCase()]?.[input.chainId]

  return {
    asset: assetUpper,
    chainId: input.chainId,
    supplyApyPct: apy?.supplyApy ?? 0,
    borrowApyPct: apy?.borrowApy ?? 0,
    peridotSupplyApyPct: apy?.peridotSupplyApy ?? 0,
    peridotBorrowApyPct: apy?.peridotBorrowApy ?? 0,
    boostSourceSupplyApyPct: apy?.boostSourceSupplyApy ?? 0,
    boostRewardsSupplyApyPct: apy?.boostRewardsSupplyApy ?? 0,
    totalSupplyApyPct: apy?.totalSupplyApy ?? 0,
    netBorrowApyPct: apy?.netBorrowApy ?? 0,
    tvlUsd: metric.tvlUsd,
    utilizationPct: metric.utilizationPct,
    liquidityUsd: metric.liquidityUsd,
    priceUsd: metric.priceUsd,
    collateralFactorPct: metric.collateral_factor_pct ?? 0,
    updatedAt: metric.updatedAt,
  }
}
