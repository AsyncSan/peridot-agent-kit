import { z } from 'zod'
import { PeridotApiClient } from '../../../shared/api-client'
import type { LiquidatablePositions, PeridotConfig } from '../../../shared/types'

export const getLiquidatablePositionsSchema = z.object({
  chainId: z
    .number()
    .int()
    .optional()
    .describe(
      'Filter to a single hub chain (56=BSC, 143=Monad, 1868=Somnia). ' +
        'Omit to return at-risk accounts across all chains.',
    ),
  minShortfall: z
    .number()
    .min(0)
    .optional()
    .describe(
      'Minimum shortfall_usd threshold in USD (default: 0 — returns all underwater accounts). ' +
        'Use e.g. 100 to focus only on meaningfully undercollateralised positions.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Maximum number of results (default: 50, max: 200). Results are ordered by shortfall descending.'),
})

export type GetLiquidatablePositionsInput = z.infer<typeof getLiquidatablePositionsSchema>

/**
 * Fetch accounts currently eligible for liquidation from the platform's
 * health scanner endpoint.
 *
 * Returns the accounts ordered by shortfall_usd descending — the most
 * underwater positions appear first.
 */
export async function getLiquidatablePositions(
  input: GetLiquidatablePositionsInput,
  config: PeridotConfig,
): Promise<LiquidatablePositions> {
  const client = new PeridotApiClient(config)
  const opts: { chainId?: number; minShortfall?: number; limit?: number } = {}
  if (input.chainId !== undefined) opts.chainId = input.chainId
  if (input.minShortfall !== undefined) opts.minShortfall = input.minShortfall
  if (input.limit !== undefined) opts.limit = input.limit
  return client.getLiquidatablePositions(opts)
}
