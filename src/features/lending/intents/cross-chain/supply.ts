import { z } from 'zod'
import { parseUnits } from 'viem'
import { PeridotApiClient } from '../../../../shared/api-client'
import {
  ARBITRUM_CHAIN_ID,
  BSC_MAINNET_CHAIN_ID,
  getAssetDecimals,
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

export const crossChainSupplySchema = z.object({
  userAddress: z.string().describe('The wallet address on the source chain'),
  sourceChainId: z
    .number()
    .default(ARBITRUM_CHAIN_ID)
    .describe(
      'The spoke chain the user is on, e.g. 42161=Arbitrum, 8453=Base, 1=Ethereum. ' +
        'This is where the user holds the tokens they want to supply.',
    ),
  asset: z.string().describe('Asset to supply, e.g. "USDC", "WETH"'),
  amount: z.string().describe('Human-readable amount to supply, e.g. "100" for 100 USDC'),
  enableAsCollateral: z
    .boolean()
    .default(true)
    .describe('Whether to enable the supplied asset as collateral. Defaults to true.'),
  slippage: z
    .number()
    .default(0.01)
    .describe('Bridge slippage tolerance as a decimal (0.01 = 1%). Defaults to 1%.'),
})

export type CrossChainSupplyInput = z.input<typeof crossChainSupplySchema>

/**
 * Builds a cross-chain supply intent using Biconomy MEE.
 *
 * Biconomy orchestrates all steps atomically from a single user signature:
 * 1. Bridge asset from source chain → BSC (via Axelar/Squid internally)
 * 2. Approve p{Asset} to spend underlying on BSC
 * 3. mint(amount)      — supply to Peridot, receive pTokens
 * 4. enterMarkets([])  — (optional) enable as collateral
 * 5. transfer pTokens  — return pTokens to user's EOA on BSC
 *
 * Returns a CrossChainIntent — the user's dApp must pass biconomyInstructions
 * to POST /api/biconomy/execute (or directly to Biconomy's execute endpoint).
 */
export async function buildCrossChainSupplyIntent(
  input: CrossChainSupplyInput,
  config: PeridotConfig,
): Promise<CrossChainIntent> {
  const client = new PeridotApiClient(config)
  const assetUpper = input.asset.toUpperCase()
  const decimals = getAssetDecimals(assetUpper)
  const amount = parseUnits(input.amount, decimals)

  const sourceChainId = input.sourceChainId ?? ARBITRUM_CHAIN_ID
  const hubChainId = resolveHubChainId(sourceChainId, config.network ?? 'mainnet')
  const sourceToken = getUnderlyingTokenAddress(sourceChainId, assetUpper)
  const hubUnderlying = getUnderlyingTokenAddress(hubChainId, assetUpper)
  const pToken = getPTokenAddress(hubChainId, assetUpper)

  const runtimeBalance: RuntimeErc20Balance = {
    type: 'runtimeErc20Balance',
    tokenAddress: hubUnderlying,
  }

  const composeFlows: ComposeFlow[] = [
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
    // Step 2: Approve pToken to spend underlying
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
    // Step 3: Mint pTokens
    {
      type: '/instructions/build' as const,
      data: {
        functionSignature: 'function mint(uint256)',
        args: [runtimeBalance],
        to: pToken,
        chainId: hubChainId,
        value: '0',
      },
      batch: true,
    },
  ]

  // Step 4: Enable as collateral
  if (input.enableAsCollateral ?? true) {
    const { getControllerAddress } = await import('../../../../shared/constants')
    const controller = getControllerAddress(hubChainId)
    composeFlows.push({
      type: '/instructions/build' as const,
      data: {
        functionSignature: 'function enterMarkets(address[] memory)',
        args: [[pToken]],
        to: controller,
        chainId: hubChainId,
        value: '0',
      },
      batch: true,
    })
  }

  // Step 5: Return pTokens to user's EOA
  const pTokenRuntime: RuntimeErc20Balance = {
    type: 'runtimeErc20Balance',
    tokenAddress: pToken,
    constraints: { gte: '1' },
  }
  composeFlows.push({
    type: '/instructions/build' as const,
    data: {
      functionSignature: 'function transfer(address,uint256)',
      args: [input.userAddress, pTokenRuntime],
      to: pToken,
      chainId: hubChainId,
      value: '0',
    },
    batch: true,
  })

  const biconomyResponse = await client.biconomyCompose({
    ownerAddress: input.userAddress as `0x${string}`,
    mode: 'eoa',
    composeFlows,
  })

  const collateralNote = input.enableAsCollateral ? ' and enable as collateral' : ''
  const userSteps = [
    `Bridge ${input.amount} ${assetUpper} from chain ${sourceChainId} → hub (chain ${hubChainId})`,
    `Approve Peridot p${assetUpper} market to spend ${assetUpper}`,
    `Supply ${input.amount} ${assetUpper} to Peridot, receiving p${assetUpper}`,
    ...(input.enableAsCollateral ? [`Enable ${assetUpper} as collateral`] : []),
    `Return p${assetUpper} tokens to your wallet`,
  ]

  return {
    type: 'cross-chain',
    sourceChainId,
    destinationChainId: hubChainId,
    summary: `Cross-chain supply ${input.amount} ${assetUpper} from chain ${sourceChainId} to Peridot${collateralNote}`,
    userSteps,
    biconomyInstructions: biconomyResponse,
    estimatedGas: biconomyResponse.estimatedGas ?? 'unknown',
  }
}
