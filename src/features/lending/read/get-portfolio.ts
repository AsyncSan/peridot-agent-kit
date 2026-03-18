import { z } from 'zod'
import { PeridotApiClient } from '../../../shared/api-client'
import type { PeridotConfig, PortfolioOverview } from '../../../shared/types'
import { evmAddress } from '../../../shared/zod-utils'
import { Cache } from '../../../shared/cache'

/**
 * Module-level cache: 30 s TTL matches the backend's Cache-Control header.
 * In-flight coalescing ensures that a burst of concurrent calls for the same
 * address (e.g. an agent calling the tool multiple times in one turn) results
 * in exactly one upstream request.
 *
 * Exported as `portfolioCache` so tests can call `.clear()` between runs.
 */
export const portfolioCache = new Cache<PortfolioOverview>(30_000)

export const getPortfolioSchema = z.object({
  address: evmAddress.describe('The wallet address (0x...) to look up'),
})

export type GetPortfolioInput = z.infer<typeof getPortfolioSchema>

export async function getPortfolio(
  input: GetPortfolioInput,
  config: PeridotConfig,
): Promise<PortfolioOverview> {
  // Normalise to lowercase so 0xABCD… and 0xabcd… share the same cache slot.
  const key = input.address.toLowerCase()

  return portfolioCache.getOrFetch(key, async () => {
    const client = new PeridotApiClient(config)
    const data = await client.getUserPortfolio(input.address)

    return {
      address: input.address,
      portfolio: {
        currentValue: data.portfolio.currentValue,
        totalSupplied: data.portfolio.totalSupplied,
        totalBorrowed: data.portfolio.totalBorrowed,
        netApy: data.portfolio.netApy,
        healthFactor:
          data.portfolio.totalBorrowed > 0
            ? data.portfolio.totalSupplied / data.portfolio.totalBorrowed
            : null,
      },
      assets: data.assets,
      transactions: data.transactions,
      earnings: data.earnings,
    }
  })
}
