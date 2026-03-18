import { z } from 'zod'
import { PeridotApiClient } from '../../../shared/api-client'
import type { LeaderboardEntry, PeridotConfig } from '../../../shared/types'

export const getLeaderboardSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Number of entries to return (1–100, default 50).'),
  chainId: z
    .number()
    .optional()
    .describe('Filter by hub chain ID. 56=BSC, 143=Monad, 1868=Somnia. Omit to show all chains.'),
})

export type GetLeaderboardInput = z.infer<typeof getLeaderboardSchema>

export async function getLeaderboard(
  input: GetLeaderboardInput,
  config: PeridotConfig,
): Promise<{ entries: LeaderboardEntry[]; total: number }> {
  const client = new PeridotApiClient(config)
  const opts: { limit?: number; chainId?: number } = {}
  if (input.limit !== undefined) opts.limit = input.limit
  if (input.chainId !== undefined) opts.chainId = input.chainId
  const data = await client.getLeaderboard(opts)
  return {
    entries: data.entries,
    total: data.total,
  }
}
