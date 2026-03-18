import { z } from 'zod'
import { encodeFunctionData } from 'viem'
import { COMPTROLLER_ABI } from '../../../../shared/abis'
import {
  BSC_MAINNET_CHAIN_ID,
  getControllerAddress,
  getPTokenAddress,
  isHubChain,
} from '../../../../shared/constants'
import type { HubTransactionIntent, PeridotConfig } from '../../../../shared/types'
import { evmAddress } from '../../../../shared/zod-utils'

export const hubEnableCollateralSchema = z.object({
  userAddress: evmAddress.describe('The wallet address enabling collateral'),
  assets: z
    .array(z.string())
    .min(1)
    .describe('Assets to enable as collateral, e.g. ["WETH", "USDC"]'),
  chainId: z
    .number()
    .int()
    .default(BSC_MAINNET_CHAIN_ID)
    .refine(isHubChain, { message: 'chainId must be a hub chain (56=BSC, 143=Monad, 1868=Somnia).' })
    .describe('Hub chain ID. Defaults to BSC (56).'),
})

export type HubEnableCollateralInput = z.infer<typeof hubEnableCollateralSchema>

/**
 * Builds the enterMarkets call to enable one or more supplied assets as collateral.
 * Must be called after supplying assets if they were not enabled during supply.
 * Enabling collateral is required before borrowing against that asset.
 */
export function buildHubEnableCollateralIntent(
  input: HubEnableCollateralInput,
  _config: PeridotConfig,
): HubTransactionIntent {
  const controller = getControllerAddress(input.chainId)
  const pTokens = input.assets.map((a) => getPTokenAddress(input.chainId, a.toUpperCase()))
  const assetsDisplay = input.assets.map((a) => a.toUpperCase()).join(', ')

  return {
    type: 'hub',
    chainId: input.chainId,
    calls: [
      {
        to: controller,
        data: encodeFunctionData({
          abi: COMPTROLLER_ABI,
          functionName: 'enterMarkets',
          args: [pTokens],
        }),
        value: 0n,
        description: `Enable ${assetsDisplay} as collateral on Peridot`,
      },
    ],
    summary: `Enable ${assetsDisplay} as collateral on chain ${input.chainId}`,
  }
}
