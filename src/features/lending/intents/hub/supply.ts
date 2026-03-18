import { z } from 'zod'
import { encodeFunctionData, parseUnits } from 'viem'
import { ERC20_ABI, PTOKEN_ABI, COMPTROLLER_ABI } from '../../../../shared/abis'
import {
  BSC_MAINNET_CHAIN_ID,
  getAssetDecimals,
  getControllerAddress,
  getPTokenAddress,
  getUnderlyingTokenAddress,
} from '../../../../shared/constants'
import type { HubTransactionIntent, PeridotConfig } from '../../../../shared/types'

export const hubSupplySchema = z.object({
  userAddress: z.string().describe('The wallet address supplying assets'),
  asset: z.string().describe('Asset to supply, e.g. "USDC", "WETH"'),
  amount: z.string().describe('Human-readable amount to supply, e.g. "100" for 100 USDC'),
  chainId: z
    .number()
    .default(BSC_MAINNET_CHAIN_ID)
    .describe('Hub chain ID. Must be a chain with native Peridot markets. Defaults to BSC (56).'),
  enableAsCollateral: z
    .boolean()
    .default(true)
    .describe('Whether to enable the supplied asset as collateral. Defaults to true.'),
})

export type HubSupplyInput = z.input<typeof hubSupplySchema>

/**
 * Builds the transaction calls to supply an asset to a Peridot hub-chain market.
 *
 * Call sequence:
 * 1. approve(pToken, amount)   — allow pToken to spend your underlying
 * 2. mint(amount)              — supply underlying, receive pTokens
 * 3. enterMarkets([pToken])    — (optional) enable as collateral
 */
export function buildHubSupplyIntent(
  input: HubSupplyInput,
  _config: PeridotConfig,
): HubTransactionIntent {
  const chainId = input.chainId ?? BSC_MAINNET_CHAIN_ID
  const enableAsCollateral = input.enableAsCollateral ?? true
  const assetUpper = input.asset.toUpperCase()
  const decimals = getAssetDecimals(assetUpper)
  const amount = parseUnits(input.amount, decimals)

  const pToken = getPTokenAddress(chainId, assetUpper)
  const underlying = getUnderlyingTokenAddress(chainId, assetUpper)
  const controller = getControllerAddress(chainId)

  const calls: HubTransactionIntent['calls'] = [
    {
      to: underlying,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [pToken, amount],
      }),
      value: 0n,
      description: `Approve p${assetUpper} contract to spend ${input.amount} ${assetUpper}`,
    },
    {
      to: pToken,
      data: encodeFunctionData({
        abi: PTOKEN_ABI,
        functionName: 'mint',
        args: [amount],
      }),
      value: 0n,
      description: `Supply ${input.amount} ${assetUpper} to Peridot and receive p${assetUpper} tokens`,
    },
  ]

  if (enableAsCollateral) {
    calls.push({
      to: controller,
      data: encodeFunctionData({
        abi: COMPTROLLER_ABI,
        functionName: 'enterMarkets',
        args: [[pToken]],
      }),
      value: 0n,
      description: `Enable ${assetUpper} position as collateral for borrowing`,
    })
  }

  const collateralNote = enableAsCollateral ? ' and enable as collateral' : ''
  return {
    type: 'hub',
    chainId,
    calls,
    summary: `Supply ${input.amount} ${assetUpper} to Peridot on chain ${input.chainId}${collateralNote}`,
  }
}
