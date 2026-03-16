import { z } from 'zod'
import { createPublicClient, http } from 'viem'
import { COMPTROLLER_ABI } from '../../../shared/abis'
import {
  BSC_MAINNET_CHAIN_ID,
  DEFAULT_RPC_URLS,
  getControllerAddress,
} from '../../../shared/constants'
import type { AccountLiquidity, PeridotConfig } from '../../../shared/types'

export const getAccountLiquiditySchema = z.object({
  address: z.string().describe('The wallet address to check'),
  chainId: z
    .number()
    .default(BSC_MAINNET_CHAIN_ID)
    .describe('Hub chain ID to query (must be a hub chain). Defaults to BSC (56).'),
})

export type GetAccountLiquidityInput = z.infer<typeof getAccountLiquiditySchema>

/**
 * Reads account liquidity directly from the Peridottroller contract.
 * Returns the precise USD liquidity (excess borrowing power) and shortfall.
 *
 * This is the authoritative source for liquidation risk — more accurate than
 * the portfolio-data API which uses a simplified health factor.
 *
 * Requires an RPC URL for the hub chain (uses public fallback if not configured).
 */
export async function getAccountLiquidity(
  input: GetAccountLiquidityInput,
  config: PeridotConfig,
): Promise<AccountLiquidity> {
  const rpcUrl =
    config.rpcUrls?.[input.chainId] ?? DEFAULT_RPC_URLS[input.chainId]

  if (!rpcUrl) {
    throw new Error(
      `No RPC URL available for chain ${input.chainId}. ` +
        `Provide one via config.rpcUrls[${input.chainId}].`,
    )
  }

  const controllerAddress = getControllerAddress(input.chainId)

  const client = createPublicClient({ transport: http(rpcUrl) })

  const [error, liquidity, shortfall] = await client.readContract({
    address: controllerAddress,
    abi: COMPTROLLER_ABI,
    functionName: 'getAccountLiquidity',
    args: [input.address as `0x${string}`],
  })

  if (error !== 0n) {
    throw new Error(`Comptroller getAccountLiquidity returned error code ${error.toString()}`)
  }

  // Values are in USD with 18 decimal mantissa
  const liquidityUsd = Number(liquidity) / 1e18
  const shortfallUsd = Number(shortfall) / 1e18

  return {
    address: input.address,
    chainId: input.chainId,
    liquidityUsd,
    shortfallUsd,
    isHealthy: shortfallUsd === 0,
  }
}
