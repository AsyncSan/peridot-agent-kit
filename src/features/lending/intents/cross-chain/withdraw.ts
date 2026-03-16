import { z } from 'zod'
import { parseUnits } from 'viem'
import { PeridotApiClient } from '../../../../shared/api-client'
import {
  BSC_MAINNET_CHAIN_ID,
  getAssetDecimals,
  getPTokenAddress,
  getUnderlyingTokenAddress,
} from '../../../../shared/constants'
import type {
  CrossChainIntent,
  PeridotConfig,
  RuntimeErc20Balance,
  ComposeFlow,
} from '../../../../shared/types'

export const crossChainWithdrawSchema = z.object({
  userAddress: z.string().describe('The wallet address withdrawing'),
  asset: z.string().describe('Asset to withdraw, e.g. "USDC", "WETH"'),
  amount: z.string().describe('Human-readable underlying amount to withdraw, e.g. "100"'),
  targetChainId: z
    .number()
    .optional()
    .describe(
      'Spoke chain to receive the withdrawn funds, e.g. 42161=Arbitrum. ' +
        'If omitted, funds remain on the hub chain (BSC).',
    ),
  slippage: z.number().default(0.01).describe('Bridge slippage tolerance. Defaults to 1%.'),
})

export type CrossChainWithdrawInput = z.input<typeof crossChainWithdrawSchema>

/**
 * Withdraws from Peridot hub and optionally bridges proceeds to a spoke chain.
 *
 * Call sequence (via Biconomy MEE):
 * 1. redeemUnderlying(amount)    — redeem pTokens for underlying on hub
 * 2a. Bridge underlying → target spoke chain (if targetChainId set), OR
 * 2b. Transfer to user's EOA on hub chain
 */
export async function buildCrossChainWithdrawIntent(
  input: CrossChainWithdrawInput,
  config: PeridotConfig,
): Promise<CrossChainIntent> {
  const client = new PeridotApiClient(config)
  const assetUpper = input.asset.toUpperCase()
  const decimals = getAssetDecimals(assetUpper)
  const amount = parseUnits(input.amount, decimals)

  const hubChainId = BSC_MAINNET_CHAIN_ID
  const pToken = getPTokenAddress(hubChainId, assetUpper)
  const hubUnderlying = getUnderlyingTokenAddress(hubChainId, assetUpper)

  const runtimeBalance: RuntimeErc20Balance = {
    type: 'runtimeErc20Balance',
    tokenAddress: hubUnderlying,
    constraints: { gte: '1' },
  }

  const composeFlows: ComposeFlow[] = [
    // Step 1: Redeem from Peridot
    {
      type: '/instructions/build' as const,
      data: {
        functionSignature: 'function redeemUnderlying(uint256)',
        args: [amount.toString()],
        to: pToken,
        chainId: hubChainId,
        value: '0',
      },
      batch: true,
    },
  ]

  const userSteps = [`Redeem ${input.amount} ${assetUpper} from Peridot (p${assetUpper} → ${assetUpper})`]

  // Step 2: Deliver funds
  if (input.targetChainId && input.targetChainId !== hubChainId) {
    const targetToken = getUnderlyingTokenAddress(input.targetChainId, assetUpper)
    composeFlows.push({
      type: '/instructions/intent-simple',
      data: {
        srcToken: hubUnderlying,
        dstToken: targetToken,
        srcChainId: hubChainId,
        dstChainId: input.targetChainId,
        amount: runtimeBalance,
        slippage: input.slippage ?? 0.01,
      },
      batch: false,
    } as ComposeFlow)
    userSteps.push(`Bridge ${assetUpper} from hub → chain ${input.targetChainId}`)
  } else {
    composeFlows.push({
      type: '/instructions/build' as const,
      data: {
        functionSignature: 'function transfer(address,uint256)',
        args: [input.userAddress, runtimeBalance],
        to: hubUnderlying,
        chainId: hubChainId,
        value: '0',
      },
      batch: true,
    })
    userSteps.push(`Receive ${assetUpper} in your wallet on BSC`)
  }

  const biconomyResponse = await client.biconomyCompose({
    ownerAddress: input.userAddress as `0x${string}`,
    mode: 'eoa',
    composeFlows,
  })

  const destination = input.targetChainId ?? hubChainId

  return {
    type: 'cross-chain',
    sourceChainId: hubChainId,
    destinationChainId: destination,
    summary: `Withdraw ${input.amount} ${assetUpper} from Peridot, receive on chain ${destination}`,
    userSteps,
    biconomyInstructions: biconomyResponse,
    estimatedGas: biconomyResponse.estimatedGas ?? 'unknown',
  }
}
