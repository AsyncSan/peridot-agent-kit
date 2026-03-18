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

export const hubRepaySchema = z.object({
  userAddress: evmAddress.describe('The wallet address repaying the debt'),
  asset: z.string().describe('Asset to repay, e.g. "USDC", "WETH"'),
  amount: z
    .string()
    .refine((v) => v.toLowerCase() === 'max' || /^\d+(\.\d+)?$/.test(v), {
      message: 'Amount must be a positive decimal number (e.g. "500") or "max" to repay all.',
    })
    .describe(
      'Human-readable amount to repay, e.g. "500" for 500 USDC. ' +
        'Use "max" to repay the full outstanding balance (sets uint256 max).',
    ),
  chainId: z
    .number()
    .int()
    .default(BSC_MAINNET_CHAIN_ID)
    .refine(isHubChain, { message: 'chainId must be a hub chain (56=BSC, 143=Monad, 1868=Somnia).' })
    .describe('Hub chain ID. Defaults to BSC (56).'),
})

export type HubRepayInput = z.infer<typeof hubRepaySchema>

/**
 * Builds the transaction calls to repay a borrow on a Peridot hub-chain market.
 *
 * Call sequence:
 * 1. approve(pToken, amount)  — allow pToken to pull repayment tokens
 * 2. repayBorrow(amount)       — repay outstanding debt
 *
 * Use amount = "max" to repay the full debt (passes uint256 max to the contract,
 * which the pToken interprets as "repay all").
 */
export function buildHubRepayIntent(
  input: HubRepayInput,
  _config: PeridotConfig,
): HubTransactionIntent {
  const assetUpper = input.asset.toUpperCase()
  const decimals = getAssetDecimals(assetUpper)
  const isMax = input.amount.toLowerCase() === 'max'
  const amount = isMax ? maxUint256 : parseUnits(input.amount, decimals)

  const pToken = getPTokenAddress(input.chainId, assetUpper)
  const underlying = getUnderlyingTokenAddress(input.chainId, assetUpper)

  const displayAmount = isMax ? 'full balance' : `${input.amount} ${assetUpper}`

  return {
    type: 'hub',
    chainId: input.chainId,
    calls: [
      {
        to: underlying,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [pToken, amount],
        }),
        value: 0n,
        description: `Approve p${assetUpper} to pull repayment tokens`,
      },
      {
        to: pToken,
        data: encodeFunctionData({
          abi: PTOKEN_ABI,
          functionName: 'repayBorrow',
          args: [amount],
        }),
        value: 0n,
        description: `Repay ${displayAmount} of ${assetUpper} debt`,
      },
    ],
    summary: `Repay ${displayAmount} of ${assetUpper} on Peridot (chain ${input.chainId})`,
  }
}
