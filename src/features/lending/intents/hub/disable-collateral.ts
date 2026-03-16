import { z } from 'zod'
import { encodeFunctionData } from 'viem'
import { COMPTROLLER_ABI } from '../../../../shared/abis'
import {
  BSC_MAINNET_CHAIN_ID,
  getControllerAddress,
  getPTokenAddress,
} from '../../../../shared/constants'
import type { HubTransactionIntent, PeridotConfig } from '../../../../shared/types'

export const hubDisableCollateralSchema = z.object({
  userAddress: z.string().describe('The wallet address disabling collateral'),
  asset: z.string().describe('Asset to disable as collateral, e.g. "USDC"'),
  chainId: z
    .number()
    .default(BSC_MAINNET_CHAIN_ID)
    .describe('Hub chain ID. Defaults to BSC (56).'),
})

export type HubDisableCollateralInput = z.infer<typeof hubDisableCollateralSchema>

/**
 * Builds the exitMarket call to disable a supplied asset as collateral.
 *
 * Will revert on-chain if disabling this collateral would make existing borrows
 * undercollateralized. Repay borrows or add more collateral first.
 */
export function buildHubDisableCollateralIntent(
  input: HubDisableCollateralInput,
  _config: PeridotConfig,
): HubTransactionIntent {
  const assetUpper = input.asset.toUpperCase()
  const controller = getControllerAddress(input.chainId)
  const pToken = getPTokenAddress(input.chainId, assetUpper)

  return {
    type: 'hub',
    chainId: input.chainId,
    calls: [
      {
        to: controller,
        data: encodeFunctionData({
          abi: COMPTROLLER_ABI,
          functionName: 'exitMarket',
          args: [pToken],
        }),
        value: 0n,
        description: `Disable ${assetUpper} as collateral on Peridot`,
      },
    ],
    summary: `Disable ${assetUpper} as collateral on chain ${input.chainId}`,
    warning:
      'This will revert if you have outstanding borrows that rely on this collateral.',
  }
}
