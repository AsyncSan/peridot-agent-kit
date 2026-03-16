import { z } from 'zod'
import { encodeFunctionData, parseUnits } from 'viem'
import { PTOKEN_ABI, COMPTROLLER_ABI } from '../../../../shared/abis'
import {
  BSC_MAINNET_CHAIN_ID,
  getAssetDecimals,
  getControllerAddress,
  getPTokenAddress,
} from '../../../../shared/constants'
import type { HubTransactionIntent, PeridotConfig } from '../../../../shared/types'

export const hubBorrowSchema = z.object({
  userAddress: z.string().describe('The wallet address that will borrow'),
  borrowAsset: z.string().describe('Asset to borrow, e.g. "USDC", "WETH"'),
  borrowAmount: z.string().describe('Human-readable amount to borrow, e.g. "500" for 500 USDC'),
  collateralAssets: z
    .array(z.string())
    .min(1)
    .describe(
      'Assets already supplied that will act as collateral, e.g. ["WETH"]. ' +
        'These will have enterMarkets called to ensure they are active collateral.',
    ),
  chainId: z
    .number()
    .default(BSC_MAINNET_CHAIN_ID)
    .describe('Hub chain ID. Defaults to BSC (56).'),
})

export type HubBorrowInput = z.infer<typeof hubBorrowSchema>

/**
 * Builds the transaction calls to borrow from a Peridot hub-chain market.
 *
 * Call sequence:
 * 1. enterMarkets(collateralPTokens) — ensure collateral is active
 * 2. borrow(amount)                   — borrow from the market
 *
 * Prerequisites:
 * - Collateral must already be supplied (use build_hub_supply_intent first)
 * - Borrow amount must not exceed borrowing capacity (use simulate_borrow first)
 */
export function buildHubBorrowIntent(
  input: HubBorrowInput,
  _config: PeridotConfig,
): HubTransactionIntent {
  const borrowAssetUpper = input.borrowAsset.toUpperCase()
  const decimals = getAssetDecimals(borrowAssetUpper)
  const amount = parseUnits(input.borrowAmount, decimals)

  const borrowPToken = getPTokenAddress(input.chainId, borrowAssetUpper)
  const controller = getControllerAddress(input.chainId)
  const collateralPTokens = input.collateralAssets.map((a) =>
    getPTokenAddress(input.chainId, a.toUpperCase()),
  )

  return {
    type: 'hub',
    chainId: input.chainId,
    calls: [
      {
        to: controller,
        data: encodeFunctionData({
          abi: COMPTROLLER_ABI,
          functionName: 'enterMarkets',
          args: [collateralPTokens],
        }),
        value: 0n,
        description: `Enable ${input.collateralAssets.join(', ')} as active collateral`,
      },
      {
        to: borrowPToken,
        data: encodeFunctionData({
          abi: PTOKEN_ABI,
          functionName: 'borrow',
          args: [amount],
        }),
        value: 0n,
        description: `Borrow ${input.borrowAmount} ${borrowAssetUpper} from Peridot`,
      },
    ],
    summary: `Borrow ${input.borrowAmount} ${borrowAssetUpper} using ${input.collateralAssets.join(', ')} as collateral`,
    warning:
      'Ensure your health factor stays above 1.2 after borrowing. Use simulate_borrow to verify.',
  }
}
