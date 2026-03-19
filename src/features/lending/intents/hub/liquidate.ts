import { z } from 'zod'
import { encodeFunctionData, parseUnits, maxUint256 } from 'viem'
import { ERC20_ABI, PTOKEN_ABI } from '../../../../shared/abis'
import {
  BSC_MAINNET_CHAIN_ID,
  getAssetDecimals,
  getPTokenAddress,
  getUnderlyingTokenAddress,
  isHubChain,
} from '../../../../shared/constants'
import type { HubTransactionIntent, PeridotConfig } from '../../../../shared/types'
import { evmAddress } from '../../../../shared/zod-utils'

export const hubLiquidateSchema = z.object({
  liquidatorAddress: evmAddress.describe('The wallet address executing the liquidation (your address)'),
  borrowerAddress: evmAddress.describe('The underwater borrower address to liquidate'),
  repayAsset: z
    .string()
    .describe(
      'The asset you will repay on behalf of the borrower, e.g. "USDC". ' +
        'This must be an asset the borrower has borrowed.',
    ),
  repayAmount: z
    .string()
    .refine((v) => v.toLowerCase() === 'max' || /^\d+(\.\d+)?$/.test(v), {
      message: 'Amount must be a positive decimal number (e.g. "500") or "max" for uint256 max.',
    })
    .describe(
      'Amount of repayAsset to repay (human-readable, e.g. "500" for 500 USDC). ' +
        'A liquidator may repay at most 50% of the borrower\'s outstanding debt per call (close factor). ' +
        'Use "max" to pass uint256 max — the protocol will cap it at the close factor automatically.',
    ),
  collateralAsset: z
    .string()
    .describe(
      'The collateral asset you want to seize in return, e.g. "WETH". ' +
        'This must be an asset the borrower has supplied as collateral. ' +
        'You receive the equivalent value in pTokens (+ liquidation incentive bonus).',
    ),
  chainId: z
    .number()
    .int()
    .default(BSC_MAINNET_CHAIN_ID)
    .refine(isHubChain, { message: 'chainId must be a hub chain (56=BSC, 143=Monad, 1868=Somnia).' })
    .describe('Hub chain where the underwater position exists. Defaults to BSC (56).'),
})

export type HubLiquidateInput = z.infer<typeof hubLiquidateSchema>

/**
 * Builds the transaction calls to liquidate an underwater Peridot borrower
 * on a hub chain.
 *
 * Compound V2 liquidation flow:
 * 1. approve(pRepayToken, repayAmount)       — allow the repay pToken to pull funds
 * 2. liquidateBorrow(borrower, repayAmount,  — repay debt, seize collateral pTokens
 *                    pCollateralToken)
 *
 * The liquidator receives pToken shares of the collateral asset.
 * To receive the underlying, call redeem() on the collateral pToken afterward.
 *
 * IMPORTANT: verify the borrower is still underwater immediately before
 * submitting — health can change between blocks. Use get_liquidatable_positions
 * or get_account_liquidity to confirm shortfallUsd > 0.
 */
export function buildHubLiquidateIntent(
  input: HubLiquidateInput,
  _config: PeridotConfig,
): HubTransactionIntent {
  const repayAsset = input.repayAsset.toUpperCase()
  const collateralAsset = input.collateralAsset.toUpperCase()

  const repayDecimals = getAssetDecimals(repayAsset)
  const isMax = input.repayAmount.toLowerCase() === 'max'
  const repayAmount = isMax ? maxUint256 : parseUnits(input.repayAmount, repayDecimals)

  const pRepayToken = getPTokenAddress(input.chainId, repayAsset)
  const pCollateralToken = getPTokenAddress(input.chainId, collateralAsset)
  const underlyingRepay = getUnderlyingTokenAddress(input.chainId, repayAsset)

  const displayAmount = isMax ? 'max (capped at close factor)' : `${input.repayAmount} ${repayAsset}`

  return {
    type: 'hub',
    chainId: input.chainId,
    calls: [
      {
        to: underlyingRepay,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [pRepayToken, repayAmount],
        }),
        value: 0n,
        description: `Approve p${repayAsset} to pull ${displayAmount} for liquidation`,
      },
      {
        to: pRepayToken,
        data: encodeFunctionData({
          abi: PTOKEN_ABI,
          functionName: 'liquidateBorrow',
          args: [input.borrowerAddress as `0x${string}`, repayAmount, pCollateralToken],
        }),
        value: 0n,
        description:
          `Liquidate ${input.borrowerAddress}: repay ${displayAmount} of ${repayAsset}, ` +
          `seize p${collateralAsset} collateral`,
      },
    ],
    summary:
      `Liquidate ${input.borrowerAddress} on chain ${input.chainId}: ` +
      `repay ${displayAmount} of ${repayAsset}, receive p${collateralAsset}`,
    warning:
      'Verify the borrower is still underwater (shortfallUsd > 0) immediately before submitting. ' +
      'The transaction will revert if the position has been partially repaid between blocks.',
  }
}
