import { z } from 'zod'
import { parseUnits } from 'viem'
import { PeridotApiClient } from '../../../../shared/api-client'
import {
  ARBITRUM_CHAIN_ID,
  BSC_MAINNET_CHAIN_ID,
  getAssetDecimals,
  getControllerAddress,
  getPTokenAddress,
  getUnderlyingTokenAddress,
  resolveHubChainId,
} from '../../../../shared/constants'
import type {
  CrossChainIntent,
  PeridotConfig,
  RuntimeErc20Balance,
  ComposeFlow,
} from '../../../../shared/types'

export const crossChainBorrowSchema = z.object({
  userAddress: z.string().describe('The wallet address borrowing'),
  collateralAssets: z
    .array(z.string())
    .min(1)
    .describe('Assets already supplied as collateral, e.g. ["WETH"]'),
  borrowAsset: z.string().describe('Asset to borrow, e.g. "USDC"'),
  borrowAmount: z.string().describe('Human-readable amount, e.g. "500" for 500 USDC'),
  targetChainId: z
    .number()
    .optional()
    .describe(
      'Spoke chain to receive borrowed funds, e.g. 42161=Arbitrum. ' +
        'If omitted, borrowed funds remain on the hub chain (BSC).',
    ),
  slippage: z.number().default(0.01).describe('Bridge slippage tolerance. Defaults to 1%.'),
})

export type CrossChainBorrowInput = z.input<typeof crossChainBorrowSchema>

/**
 * Borrows from Peridot hub and optionally bridges the proceeds to a spoke chain.
 *
 * Call sequence (via Biconomy MEE):
 * 1. enterMarkets(collateralPTokens)  — ensure collateral is active
 * 2. borrow(amount)                    — borrow from pToken market on hub
 * 3a. Bridge borrowed tokens → target chain  (if targetChainId provided), OR
 * 3b. Transfer borrowed tokens to user's EOA on hub chain
 */
export async function buildCrossChainBorrowIntent(
  input: CrossChainBorrowInput,
  config: PeridotConfig,
): Promise<CrossChainIntent> {
  const client = new PeridotApiClient(config)
  const borrowAssetUpper = input.borrowAsset.toUpperCase()
  const decimals = getAssetDecimals(borrowAssetUpper)
  const amount = parseUnits(input.borrowAmount, decimals)

  const hubChainId = resolveHubChainId(
    input.targetChainId ?? BSC_MAINNET_CHAIN_ID,
    config.network ?? 'mainnet',
  )
  // Hub chain is always BSC for mainnet
  const actualHubChainId = BSC_MAINNET_CHAIN_ID

  const borrowPToken = getPTokenAddress(actualHubChainId, borrowAssetUpper)
  const controller = getControllerAddress(actualHubChainId)
  const hubUnderlying = getUnderlyingTokenAddress(actualHubChainId, borrowAssetUpper)
  const collateralPTokens = input.collateralAssets.map((a) =>
    getPTokenAddress(actualHubChainId, a.toUpperCase()),
  )

  const composeFlows: ComposeFlow[] = [
    // Step 1: Enable collateral
    {
      type: '/instructions/build' as const,
      data: {
        functionSignature: 'function enterMarkets(address[] memory)',
        args: [collateralPTokens],
        to: controller,
        chainId: actualHubChainId,
        value: '0',
      },
      batch: true,
    },
    // Step 2: Borrow
    {
      type: '/instructions/build' as const,
      data: {
        functionSignature: 'function borrow(uint256)',
        args: [amount.toString()],
        to: borrowPToken,
        chainId: actualHubChainId,
        value: '0',
      },
      batch: true,
    },
  ]

  const runtimeBalance: RuntimeErc20Balance = {
    type: 'runtimeErc20Balance',
    tokenAddress: hubUnderlying,
    constraints: { gte: '1' },
  }

  const userSteps = [
    `Enable ${input.collateralAssets.join(', ')} as active collateral`,
    `Borrow ${input.borrowAmount} ${borrowAssetUpper} from Peridot`,
  ]

  // Step 3: Deliver borrowed funds
  if (input.targetChainId && input.targetChainId !== actualHubChainId) {
    const targetToken = getUnderlyingTokenAddress(input.targetChainId, borrowAssetUpper)
    composeFlows.push({
      type: '/instructions/intent-simple',
      data: {
        srcToken: hubUnderlying,
        dstToken: targetToken,
        srcChainId: actualHubChainId,
        dstChainId: input.targetChainId,
        amount: runtimeBalance,
        slippage: input.slippage ?? 0.01,
      },
      batch: false,
    } as ComposeFlow)
    userSteps.push(`Bridge ${borrowAssetUpper} from hub → chain ${input.targetChainId}`)
  } else {
    composeFlows.push({
      type: '/instructions/build' as const,
      data: {
        functionSignature: 'function transfer(address,uint256)',
        args: [input.userAddress, runtimeBalance],
        to: hubUnderlying,
        chainId: actualHubChainId,
        value: '0',
      },
      batch: true,
    })
    userSteps.push(`Receive ${borrowAssetUpper} in your wallet on chain ${actualHubChainId}`)
  }

  const biconomyResponse = await client.biconomyCompose({
    ownerAddress: input.userAddress as `0x${string}`,
    mode: 'eoa',
    composeFlows,
  })

  const destination = input.targetChainId ?? actualHubChainId

  return {
    type: 'cross-chain',
    sourceChainId: actualHubChainId,
    destinationChainId: destination,
    summary: `Borrow ${input.borrowAmount} ${borrowAssetUpper} from Peridot, receive on chain ${destination}`,
    userSteps,
    biconomyInstructions: biconomyResponse,
    estimatedGas: biconomyResponse.estimatedGas ?? 'unknown',
  }
}
