import { z } from 'zod'
import { PeridotApiClient } from '../../../shared/api-client'
import type { MarketSummary, PeridotConfig } from '../../../shared/types'

export const listMarketsSchema = z.object({
  chainId: z
    .number()
    .optional()
    .describe(
      'Filter by hub chain ID. 56=BSC, 143=Monad, 1868=Somnia. Omit to list all markets across all chains.',
    ),
})

export type ListMarketsInput = z.infer<typeof listMarketsSchema>

export async function listMarkets(
  input: ListMarketsInput,
  config: PeridotConfig,
): Promise<{ markets: MarketSummary[]; count: number }> {
  const client = new PeridotApiClient(config)
  const metrics = await client.getMarketMetrics()

  const markets: MarketSummary[] = Object.entries(metrics)
    .filter(([, m]) => input.chainId === undefined || m.chainId === input.chainId)
    .map(([key, m]) => {
      const [asset] = key.split(':')
      return {
        asset: asset ?? key,
        chainId: m.chainId,
        priceUsd: m.priceUsd,
        tvlUsd: m.tvlUsd,
        utilizationPct: m.utilizationPct,
        liquidityUsd: m.liquidityUsd,
        collateralFactorPct: m.collateral_factor_pct,
        updatedAt: m.updatedAt,
      }
    })
    .sort((a, b) => b.tvlUsd - a.tvlUsd)

  return { markets, count: markets.length }
}
