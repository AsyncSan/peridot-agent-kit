import Decimal from 'decimal.js'
import { createPublicClient, http } from 'viem'
import { PTOKEN_ABI } from './abis'
import { ASSET_DECIMALS, DEFAULT_RPC_URLS, PERIDOT_MARKETS } from './constants'
import { PeridotApiClient } from './api-client'
import type { PeridotConfig } from './types'

export interface OnChainAssetPosition {
  assetId: string
  suppliedUsd: number
  borrowedUsd: number
  suppliedTokens: number
  borrowedTokens: number
  priceUsd: number
}

export interface OnChainPosition {
  totalSuppliedUsd: number
  totalBorrowedUsd: number
  assets: OnChainAssetPosition[]
}

/**
 * Reads a wallet's lending position directly from on-chain pToken contracts.
 * No auth required — uses public RPC + the platform's public market metrics API for prices.
 *
 * For each pToken market on the given hub chain:
 *   - balanceOf(address)          → cToken balance (8 decimals)
 *   - exchangeRateStored()        → cToken → underlying conversion rate
 *   - borrowBalanceStored(address) → borrow in underlying smallest units
 *
 * Conversion: underlyingAmount = cTokenBalance * exchangeRate / 1e18
 * Then USD value = underlyingAmount / 10^assetDecimals * priceUsd
 */
export async function readOnChainPosition(
  address: string,
  chainId: number,
  config: PeridotConfig,
): Promise<OnChainPosition> {
  const markets = PERIDOT_MARKETS[chainId]
  if (!markets) {
    throw new Error(`No markets configured for chain ${chainId}`)
  }

  const marketEntries = Object.entries(markets).filter(
    (entry): entry is [string, `0x${string}`] => entry[1] !== undefined,
  )

  if (marketEntries.length === 0) {
    return { totalSuppliedUsd: 0, totalBorrowedUsd: 0, assets: [] }
  }

  const rpcUrl = config.rpcUrls?.[chainId] ?? DEFAULT_RPC_URLS[chainId]
  if (!rpcUrl) {
    throw new Error(
      `No RPC URL available for chain ${chainId}. ` +
        `Provide one via config.rpcUrls[${chainId}].`,
    )
  }

  const viemClient = createPublicClient({ transport: http(rpcUrl) })
  const apiClient = new PeridotApiClient(config)

  // Fetch prices and on-chain balances in parallel — both are public, no auth needed
  const [metricsData, multicallResults] = await Promise.all([
    apiClient.getMarketMetrics(),
    viemClient.multicall({
      contracts: marketEntries.flatMap(([, pTokenAddress]) => [
        {
          address: pTokenAddress,
          abi: PTOKEN_ABI,
          functionName: 'balanceOf',
          args: [address as `0x${string}`],
        },
        {
          address: pTokenAddress,
          abi: PTOKEN_ABI,
          functionName: 'exchangeRateStored',
        },
        {
          address: pTokenAddress,
          abi: PTOKEN_ABI,
          functionName: 'borrowBalanceStored',
          args: [address as `0x${string}`],
        },
      ]),
      allowFailure: true,
    }),
  ])

  const assets: OnChainAssetPosition[] = []
  let totalSuppliedUsd = 0
  let totalBorrowedUsd = 0

  for (let i = 0; i < marketEntries.length; i++) {
    const entry = marketEntries[i]
    if (!entry) continue
    const [symbol] = entry
    const base = i * 3

    const balanceResult = multicallResults[base]
    const exchangeRateResult = multicallResults[base + 1]
    const borrowResult = multicallResults[base + 2]

    // Skip markets where any call failed (e.g. not yet deployed) or result is missing
    if (
      !balanceResult || !exchangeRateResult || !borrowResult ||
      balanceResult.status === 'failure' ||
      exchangeRateResult.status === 'failure' ||
      borrowResult.status === 'failure'
    ) {
      continue
    }

    const cTokenBalance = balanceResult.result as bigint
    const exchangeRate = exchangeRateResult.result as bigint
    const borrowBalance = borrowResult.result as bigint

    const underlyingDecimals = ASSET_DECIMALS[symbol] ?? 18
    const priceUsd = metricsData[`${symbol}:${chainId}`]?.priceUsd ?? 0

    // Supplied: cTokenBalance * exchangeRate / 1e18 → underlying in smallest units
    // then divide by 10^underlyingDecimals to get whole tokens
    const suppliedTokens = new Decimal(cTokenBalance.toString())
      .mul(exchangeRate.toString())
      .div('1e18')
      .div(new Decimal(10).pow(underlyingDecimals))
      .toNumber()

    // Borrowed: borrowBalanceStored returns underlying in smallest units directly
    const borrowedTokens = new Decimal(borrowBalance.toString())
      .div(new Decimal(10).pow(underlyingDecimals))
      .toNumber()

    const suppliedUsd = suppliedTokens * priceUsd
    const borrowedUsd = borrowedTokens * priceUsd

    // Only include assets with a meaningful position (>$0.001) to keep output clean
    if (suppliedUsd > 0.001 || borrowedUsd > 0.001) {
      assets.push({ assetId: symbol, suppliedUsd, borrowedUsd, suppliedTokens, borrowedTokens, priceUsd })
      totalSuppliedUsd += suppliedUsd
      totalBorrowedUsd += borrowedUsd
    }
  }

  return { totalSuppliedUsd, totalBorrowedUsd, assets }
}
