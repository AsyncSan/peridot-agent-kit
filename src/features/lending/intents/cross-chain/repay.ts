import { z } from 'zod'
import { parseUnits } from 'viem'
import { PeridotApiClient } from '../../../../shared/api-client'
import {
  ARBITRUM_CHAIN_ID,
  BSC_MAINNET_CHAIN_ID,
  getAssetDecimals,
  getPTokenAddress,
  getUnderlyingTokenAddress,
  isHubChain,
} from '../../../../shared/constants'
import type {
  CrossChainIntent,
  PeridotConfig,
  RuntimeErc20Balance,
} from '../../../../shared/types'
import { evmAddress, tokenAmount } from '../../../../shared/zod-utils'

export const crossChainRepaySchema = z.object({
  userAddress: evmAddress.describe('The wallet address repaying the debt'),
  sourceChainId: z
    .number()
    .int()
    .default(ARBITRUM_CHAIN_ID)
    .refine((id) => !isHubChain(id), {
      message:
        'sourceChainId must be a spoke chain (e.g. 42161=Arbitrum, 8453=Base). Use build_hub_repay_intent for hub chains (56, 143, 1868).',
    })
    .describe('Spoke chain the user holds repayment tokens on, e.g. 42161=Arbitrum, 8453=Base'),
  asset: z.string().describe('Asset to repay, e.g. "USDC", "USDT"'),
  amount: tokenAmount.describe('Human-readable amount to repay, e.g. "500" for 500 USDC'),
  repayForAddress: evmAddress
    .optional()
    .describe('Repay on behalf of another address. Defaults to userAddress.'),
  slippage: z.number().default(0.01).describe('Bridge slippage tolerance. Defaults to 1%.'),
})

export type CrossChainRepayInput = z.input<typeof crossChainRepaySchema>

/**
 * Repays a Peridot borrow from a spoke chain using Biconomy MEE.
 *
 * Call sequence:
 * 1. Bridge repayment tokens from source chain → BSC hub
 * 2. Approve p{Asset} to pull repayment tokens
 * 3. repayBorrow(amount)  — or repayBorrowBehalf if repayForAddress set
 * 4. Return any excess tokens to user's EOA on BSC
 */
export async function buildCrossChainRepayIntent(
  input: CrossChainRepayInput,
  config: PeridotConfig,
): Promise<CrossChainIntent> {
  const client = new PeridotApiClient(config)
  const assetUpper = input.asset.toUpperCase()
  const decimals = getAssetDecimals(assetUpper)
  const amount = parseUnits(input.amount, decimals)

  const hubChainId = BSC_MAINNET_CHAIN_ID
  const sourceChainId = input.sourceChainId ?? ARBITRUM_CHAIN_ID
  const sourceToken = getUnderlyingTokenAddress(sourceChainId, assetUpper)
  const hubUnderlying = getUnderlyingTokenAddress(hubChainId, assetUpper)
  const pToken = getPTokenAddress(hubChainId, assetUpper)

  const runtimeBalance: RuntimeErc20Balance = {
    type: 'runtimeErc20Balance',
    tokenAddress: hubUnderlying,
  }

  const repayForAddress = input.repayForAddress ?? input.userAddress
  const isBehalf = input.repayForAddress !== undefined && input.repayForAddress !== input.userAddress

  const composeFlows = [
    // Step 1: Bridge from spoke → hub
    {
      type: '/instructions/intent-simple' as const,
      data: {
        srcToken: sourceToken,
        dstToken: hubUnderlying,
        srcChainId: sourceChainId,
        dstChainId: hubChainId,
        amount: amount.toString(),
        slippage: input.slippage ?? 0.01,
      },
      batch: false,
    },
    // Step 2: Approve pToken to pull repayment
    {
      type: '/instructions/build' as const,
      data: {
        functionSignature: 'function approve(address,uint256)',
        args: [pToken, runtimeBalance],
        to: hubUnderlying,
        chainId: hubChainId,
        value: '0',
      },
      batch: true,
    },
    // Step 3: Repay borrow
    {
      type: '/instructions/build' as const,
      data: {
        functionSignature: isBehalf
          ? 'function repayBorrowBehalf(address,uint256)'
          : 'function repayBorrow(uint256)',
        args: isBehalf ? [repayForAddress, runtimeBalance] : [runtimeBalance],
        to: pToken,
        chainId: hubChainId,
        value: '0',
      },
      batch: true,
    },
    // Step 4: Return excess to EOA
    {
      type: '/instructions/build' as const,
      data: {
        functionSignature: 'function transfer(address,uint256)',
        args: [
          input.userAddress,
          { type: 'runtimeErc20Balance', tokenAddress: hubUnderlying, constraints: { gte: '0' } } satisfies RuntimeErc20Balance,
        ],
        to: hubUnderlying,
        chainId: hubChainId,
        value: '0',
      },
      batch: true,
    },
  ]

  const biconomyResponse = await client.biconomyCompose({
    ownerAddress: input.userAddress as `0x${string}`,
    mode: 'eoa',
    composeFlows,
  })

  const behalfNote = isBehalf ? ` on behalf of ${repayForAddress}` : ''

  return {
    type: 'cross-chain',
    sourceChainId,
    destinationChainId: hubChainId,
    summary: `Repay ${input.amount} ${assetUpper}${behalfNote} from chain ${sourceChainId} to Peridot`,
    userSteps: [
      `Bridge ${input.amount} ${assetUpper} from chain ${sourceChainId} → BSC`,
      `Approve Peridot p${assetUpper} to pull repayment tokens`,
      `Repay ${input.amount} ${assetUpper} debt${behalfNote}`,
      `Return any excess ${assetUpper} to your BSC wallet`,
    ],
    biconomyInstructions: biconomyResponse,
    estimatedGas: biconomyResponse.estimatedGas ?? 'unknown',
  }
}
