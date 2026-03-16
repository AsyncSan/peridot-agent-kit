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
  const metrics = await client.getMarketMetrics()

  const assetUpper = input.asset.toUpperCase()
  // API keys are formatted as `${ASSET}:${chainId}` with the asset in uppercase
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

  return {
    asset: assetUpper,
    chainId: input.chainId,
    // APY is not included in the metrics endpoint. For on-chain APY,
    // use getAccountLiquidity with a viem publicClient or check the platform UI.
    supplyApyPct: 0,
    borrowApyPct: 0,
    tvlUsd: metric.tvlUsd,
    utilizationPct: metric.utilizationPct,
    liquidityUsd: metric.liquidityUsd,
    priceUsd: metric.priceUsd,
    collateralFactorPct: metric.collateral_factor_pct ?? 0,
    updatedAt: metric.updatedAt,
  }
}
