import { z } from 'zod'
import { encodeFunctionData, parseUnits } from 'viem'
import { PTOKEN_ABI } from '../../../../shared/abis'
import {
  BSC_MAINNET_CHAIN_ID,
  getAssetDecimals,
  getPTokenAddress,
  isHubChain,
} from '../../../../shared/constants'
import type { HubTransactionIntent, PeridotConfig } from '../../../../shared/types'
import { evmAddress, tokenAmount } from '../../../../shared/zod-utils'

export const hubWithdrawSchema = z.object({
  userAddress: evmAddress.describe('The wallet address withdrawing'),
  asset: z.string().describe('Asset to withdraw, e.g. "USDC", "WETH"'),
  amount: tokenAmount.describe('Human-readable underlying amount to withdraw, e.g. "100" for 100 USDC'),
  chainId: z
    .number()
    .int()
    .default(BSC_MAINNET_CHAIN_ID)
    .refine(isHubChain, { message: 'chainId must be a hub chain (56=BSC, 143=Monad, 1868=Somnia).' })
    .describe('Hub chain ID. Defaults to BSC (56).'),
})

export type HubWithdrawInput = z.infer<typeof hubWithdrawSchema>

/**
 * Builds the transaction call to withdraw (redeem) a supplied asset.
 * Uses redeemUnderlying so the user specifies the exact underlying amount to receive.
 *
 * Will revert on-chain if the withdrawal would cause the user's health factor
 * to drop below the liquidation threshold (i.e., they still have open borrows).
 */
export function buildHubWithdrawIntent(
  input: HubWithdrawInput,
  _config: PeridotConfig,
): HubTransactionIntent {
  const assetUpper = input.asset.toUpperCase()
  const decimals = getAssetDecimals(assetUpper)
  const amount = parseUnits(input.amount, decimals)

  const pToken = getPTokenAddress(input.chainId, assetUpper)

  return {
    type: 'hub',
    chainId: input.chainId,
    calls: [
      {
        to: pToken,
        data: encodeFunctionData({
          abi: PTOKEN_ABI,
          functionName: 'redeemUnderlying',
          args: [amount],
        }),
        value: 0n,
        description: `Withdraw ${input.amount} ${assetUpper} from Peridot`,
      },
    ],
    summary: `Withdraw ${input.amount} ${assetUpper} from Peridot (chain ${input.chainId})`,
    warning:
      'This will revert if withdrawing would make your outstanding borrows undercollateralized.',
  }
}
