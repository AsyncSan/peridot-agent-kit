/**
 * Lending feature tool registry.
 *
 * Adding a new tool:
 * 1. Implement the function in the appropriate read/ or intents/ subdirectory
 * 2. Add an entry to the `lendingTools` array below
 * 3. It will automatically appear in the MCP server and all framework adapters
 *
 * Adding a new feature (e.g. margin):
 * Create src/features/margin/tools.ts with the same pattern, then add it to
 * src/adapters/mcp/server.ts's `allTools` array.
 */

import type { ToolDefinition } from '../../shared/types'

import { listMarketsSchema, listMarkets } from './read/list-markets'
import { getPortfolioSchema, getPortfolio } from './read/get-portfolio'
import { getLeaderboardSchema, getLeaderboard } from './read/get-leaderboard'
import { getMarketRatesSchema, getMarketRates } from './read/get-market-rates'
import { getUserPositionSchema, getUserPosition } from './read/get-user-position'
import { simulateBorrowSchema, simulateBorrow } from './read/simulate-borrow'
import { getAccountLiquiditySchema, getAccountLiquidity } from './read/get-account-liquidity'
import { hubSupplySchema, buildHubSupplyIntent } from './intents/hub/supply'
import { hubBorrowSchema, buildHubBorrowIntent } from './intents/hub/borrow'
import { hubRepaySchema, buildHubRepayIntent } from './intents/hub/repay'
import { hubWithdrawSchema, buildHubWithdrawIntent } from './intents/hub/withdraw'
import { hubEnableCollateralSchema, buildHubEnableCollateralIntent } from './intents/hub/enable-collateral'
import { hubDisableCollateralSchema, buildHubDisableCollateralIntent } from './intents/hub/disable-collateral'
import { crossChainSupplySchema, buildCrossChainSupplyIntent } from './intents/cross-chain/supply'
import { crossChainBorrowSchema, buildCrossChainBorrowIntent } from './intents/cross-chain/borrow'
import { crossChainRepaySchema, buildCrossChainRepayIntent } from './intents/cross-chain/repay'
import { crossChainWithdrawSchema, buildCrossChainWithdrawIntent } from './intents/cross-chain/withdraw'
import { checkTransactionStatusSchema, checkTransactionStatus } from './status/check-transaction'
import { getLiquidatablePositionsSchema, getLiquidatablePositions } from './read/get-liquidatable-positions'
import { hubLiquidateSchema, buildHubLiquidateIntent } from './intents/hub/liquidate'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lendingTools: ToolDefinition<any, any>[] = [
  // ── Read / Simulate ──────────────────────────────────────────────────────

  {
    name: 'list_markets',
    description:
      'List all Peridot lending markets across all chains with key metrics: asset symbol, chainId, ' +
      'price (USD), TVL (USD), utilization %, available liquidity (USD), and collateral factor %. ' +
      'Results are sorted by TVL descending — the deepest, most liquid markets appear first. ' +
      'Call this when the user asks "what can I lend or borrow?", "which assets are available?", ' +
      'or before recommending a specific market when you do not already know what is available. ' +
      'Optionally pass chainId (56=BSC, 143=Monad, 1868=Somnia) to restrict results to one chain.',
    inputSchema: listMarketsSchema,
    execute: listMarkets,
    category: 'lending',
  },

  {
    name: 'get_leaderboard',
    description:
      'Fetch the Peridot points leaderboard: ranked list of top users by total protocol points earned. ' +
      'Each entry contains: rank, wallet address, totalPoints, supplyCount, borrowCount, repayCount, ' +
      'redeemCount, and last-updated timestamp. Points reflect on-chain DeFi activity and daily logins. ' +
      'Call this when the user asks "who are the top users?", "show me the leaderboard", ' +
      '"how many points does address X have?", or "where do I rank?". ' +
      'Use limit (default 50, max 100) to control result size.',
    inputSchema: getLeaderboardSchema,
    execute: getLeaderboard,
    category: 'lending',
  },

  {
    name: 'get_market_rates',
    description:
      'Fetch the full rate breakdown for a specific Peridot market (asset + chainId). ' +
      'Returns: base supply APY, base borrow APY, PERIDOT token reward APY (supply and borrow), ' +
      'boost source APY (Morpho vault / PancakeSwap LP / Magma staking), boost reward APY, ' +
      'total supply APY (= base + peridot + boost_source + boost_rewards), ' +
      'net borrow APY (= base borrow − peridot borrow reward), ' +
      'TVL (USD), utilization %, available liquidity (USD), asset price (USD), collateral factor %. ' +
      'Call this when the user asks about APY, yields, borrow rates, or liquidity for a specific asset. ' +
      'If you do not know which chainId the asset is on, call list_markets first.',
    inputSchema: getMarketRatesSchema,
    execute: getMarketRates,
    category: 'lending',
  },

  {
    name: 'get_portfolio',
    description:
      "Fetch a wallet's full Peridot portfolio overview: portfolio summary (currentValue, " +
      'totalSupplied, totalBorrowed, netApy, simplified healthFactor), per-asset breakdown ' +
      'with allocation percentages (supplied, borrowed, net, % of portfolio), all transaction ' +
      'counts (totalCount, supply/borrow/repay/redeem), and lifetime earnings ' +
      '(effectiveApy, totalLifetimeEarnings in USD). ' +
      'Call this when the user asks "how is my portfolio performing?", "what are my earnings?", ' +
      '"show me my full breakdown", "what percentage of my portfolio is in X?", or any question ' +
      'about lifetime yield or activity history. ' +
      'Results are cached for 30 s — concurrent calls for the same address share one request. ' +
      'For a quick pre-action exposure check before borrowing or withdrawing, ' +
      'use get_user_position instead (lighter, returns simplified health factor).',
    inputSchema: getPortfolioSchema,
    execute: getPortfolio,
    category: 'lending',
  },

  {
    name: 'get_user_position',
    description:
      "Fetch a user's current Peridot portfolio snapshot: totalSuppliedUsd, totalBorrowedUsd, " +
      'netWorthUsd, netApyPct, per-asset breakdown, and transaction counts (supply/borrow/repay/redeem). ' +
      'Also returns a simplified healthFactor estimate (totalSupplied / totalBorrowed). ' +
      'IMPORTANT: this estimate ignores per-asset collateral factors and will OVERSTATE the real ' +
      'on-chain health — treat it as a quick indicator only. ' +
      'Rule of thumb: above 2.0 = low near-term risk; below 2.0 = call get_account_liquidity before ' +
      'recommending further borrows or large withdrawals. ' +
      'ALWAYS call this before building any borrow, withdraw, or repay intent so you know the ' +
      "user's current exposure and can explain the risk to them.",
    inputSchema: getUserPositionSchema,
    execute: getUserPosition,
    category: 'lending',
  },

  {
    name: 'simulate_borrow',
    description:
      "Simulate the health factor impact of a proposed borrow before submitting any transaction. " +
      'Returns: currentHealthFactor, projectedHealthFactor, borrowAmountUsd, isSafe (bool), ' +
      'riskLevel (safe | moderate | high | critical | liquidatable), and maxSafeBorrowUsd. ' +
      'ALWAYS call this before build_hub_borrow_intent or build_cross_chain_borrow_intent. ' +
      'Rules: if isSafe=false → explain the risk and do NOT build the intent. ' +
      'If riskLevel is "high" or worse → warn the user and confirm before proceeding. ' +
      'If riskLevel is "moderate" → note the risk, suggest a smaller amount or adding more collateral. ' +
      'Never skip this step even if the user sounds confident — you cannot predict the liquidation ' +
      'threshold without it.',
    inputSchema: simulateBorrowSchema,
    execute: simulateBorrow,
    category: 'lending',
  },

  {
    name: 'get_account_liquidity',
    description:
      "Read the authoritative on-chain borrow capacity and health directly from Peridot's " +
      'Comptroller contract. Returns: liquidityUsd (how much more the user can safely borrow), ' +
      'shortfallUsd (how much underwater — non-zero means they are at risk of liquidation), ' +
      'and isHealthy (true when shortfall = 0). ' +
      'Use this instead of get_user_position when precision matters: before large withdrawals, ' +
      'when the simplified health factor is near 1.5, or when the user asks whether they are ' +
      'at risk of liquidation. This is the same value the protocol uses on-chain.',
    inputSchema: getAccountLiquiditySchema,
    execute: getAccountLiquidity,
    category: 'lending',
  },

  {
    name: 'get_liquidatable_positions',
    description:
      'Fetch a list of borrowers currently underwater (shortfallUsd > 0) and eligible for liquidation ' +
      'on Peridot hub chains. Data is sourced from the on-chain health scanner that indexes borrow events ' +
      'and recomputes account health periodically. ' +
      'IMPORTANT: if this returns an empty list, the scanner pipeline (scan_borrow_events + ' +
      'scan_account_health) may not have run yet — the data table could be empty rather than meaning ' +
      'no positions are underwater. In that case, inform the user that liquidation data is not yet ' +
      'available and suggest checking back later. ' +
      'Each result contains: address, chainId, shortfallUsd (how far underwater in USD), ' +
      'liquidityUsd (0 when underwater), and checkedAt (when last scanned). ' +
      'Results are ordered by shortfallUsd descending — the most undercollateralised positions first. ' +
      'Use minShortfall to filter out dust positions (e.g. minShortfall=100 for $100+ shortfall). ' +
      'Always call get_account_liquidity to re-confirm a position is still underwater immediately ' +
      'before building a liquidation intent — health can change between scanner runs.',
    inputSchema: getLiquidatablePositionsSchema,
    execute: getLiquidatablePositions,
    category: 'liquidations',
  },

  // ── Hub-chain intents (user on BSC / Monad / Somnia) ─────────────────────
  // Hub chains host Peridot lending pools natively.
  // Hub chainIds: BSC (56), Monad (143), Somnia (1868).
  // If the user is on any other chain, use the cross-chain tools instead.

  {
    name: 'build_hub_supply_intent',
    description:
      'Build signed-ready calldata to supply an asset to Peridot on a hub chain. ' +
      'USE THIS TOOL ONLY when the user is already on a hub chain: BSC (56), Monad (143), or Somnia (1868). ' +
      'If the user is on Arbitrum (42161), Base (8453), Ethereum (1), Polygon (137), Optimism (10), ' +
      'or Avalanche (43114), use build_cross_chain_supply_intent instead. ' +
      'Returns an ordered `calls` array: approve ERC-20 → mint pToken → enterMarkets (enable collateral). ' +
      'Tell the user to sign and submit each call in sequence using their wallet.',
    inputSchema: hubSupplySchema,
    execute: buildHubSupplyIntent,
    category: 'lending',
  },

  {
    name: 'build_hub_borrow_intent',
    description:
      'Build calldata to borrow from Peridot on a hub chain (BSC 56, Monad 143, or Somnia 1868). ' +
      'Returns ordered calls: enterMarkets (activate collateral if needed) → borrow. ' +
      'REQUIRED BEFORE CALLING THIS: run simulate_borrow and confirm isSafe=true. ' +
      'If the user is on a spoke chain (Arbitrum, Base, Ethereum, etc.), use ' +
      'build_cross_chain_borrow_intent instead. ' +
      'Tell the user to sign and submit each call in order.',
    inputSchema: hubBorrowSchema,
    execute: buildHubBorrowIntent,
    category: 'lending',
  },

  {
    name: 'build_hub_repay_intent',
    description:
      'Build calldata to repay an outstanding Peridot borrow on a hub chain (BSC 56, Monad 143, Somnia 1868). ' +
      'Returns ordered calls: approve ERC-20 → repayBorrow. ' +
      'Pass amount="max" to repay the entire outstanding debt (recommended to avoid dust). ' +
      'If the user is on a spoke chain, use build_cross_chain_repay_intent instead. ' +
      'Tell the user to sign and submit each call in order.',
    inputSchema: hubRepaySchema,
    execute: buildHubRepayIntent,
    category: 'lending',
  },

  {
    name: 'build_hub_withdraw_intent',
    description:
      'Build calldata to withdraw (redeem) supplied assets from Peridot on a hub chain. ' +
      'ALWAYS call get_user_position first to check for active borrows. ' +
      'If the user has outstanding debt, also call get_account_liquidity to verify the ' +
      'withdrawal will not cause a shortfall — the contract will revert on-chain if it does. ' +
      'If the user is on a spoke chain, use build_cross_chain_withdraw_intent instead.',
    inputSchema: hubWithdrawSchema,
    execute: buildHubWithdrawIntent,
    category: 'lending',
  },

  {
    name: 'build_enable_collateral_intent',
    description:
      'Build the transaction call to enable a supplied asset as collateral in Peridot (enterMarkets). ' +
      'This is required before you can borrow against a supplied asset. ' +
      'NOTE: build_hub_supply_intent already calls enterMarkets by default — only call this ' +
      'separately if the user supplied an asset previously without enabling collateral, ' +
      'or if they disabled it and want to re-enable it.',
    inputSchema: hubEnableCollateralSchema,
    execute: buildHubEnableCollateralIntent,
    category: 'lending',
  },

  {
    name: 'build_disable_collateral_intent',
    description:
      'Build the transaction call to stop using a supplied asset as collateral (exitMarket). ' +
      'ALWAYS call get_account_liquidity first and confirm shortfallUsd=0 after the removal — ' +
      'the contract will revert if any active borrow relies on this asset as collateral. ' +
      'Explain to the user that disabling collateral reduces their borrow capacity.',
    inputSchema: hubDisableCollateralSchema,
    execute: buildHubDisableCollateralIntent,
    category: 'lending',
  },

  {
    name: 'build_liquidation_intent',
    description:
      'Build calldata to liquidate an underwater Peridot borrower on a hub chain. ' +
      'The liquidator repays part of the borrower\'s debt (up to 50% per call — the protocol close factor) ' +
      'and in return seizes an equivalent value of the borrower\'s collateral plus the liquidation bonus. ' +
      'Seized collateral is received as pToken shares — call redeem on the collateral pToken afterward ' +
      'to convert pTokens back to the underlying asset. ' +
      'REQUIRED BEFORE CALLING THIS: ' +
      '1. Call get_liquidatable_positions or get_account_liquidity to confirm shortfallUsd > 0. ' +
      '2. Verify the borrower has borrowed repayAsset and supplied collateralAsset as collateral. ' +
      '3. Never build a liquidation intent without confirming the position is still underwater. ' +
      'Returns ordered calls: approve underlying → liquidateBorrow. ' +
      'Only works on hub chains (BSC 56, Monad 143, Somnia 1868).',
    inputSchema: hubLiquidateSchema,
    execute: buildHubLiquidateIntent,
    category: 'liquidations',
  },

  // ── Cross-chain intents (user on a spoke chain) ───────────────────────────
  // Spoke chains: Arbitrum (42161), Base (8453), Ethereum (1),
  // Polygon (137), Optimism (10), Avalanche (43114).
  // These call Biconomy MEE /compose to produce a single cross-chain payload.
  // The user signs ONE transaction in their dApp; Biconomy executes the bridge + action.
  // Use check_transaction_status to track completion.

  {
    name: 'build_cross_chain_supply_intent',
    description:
      'Build a cross-chain supply intent for a user whose tokens are on a spoke chain. ' +
      'USE THIS when the user is on Arbitrum (42161), Base (8453), Ethereum (1), Polygon (137), ' +
      'Optimism (10), or Avalanche (43114). ' +
      'Do NOT use this for BSC (56), Monad (143), or Somnia (1868) — those are hub chains, ' +
      'use build_hub_supply_intent instead. ' +
      'REQUIRES: biconomyApiKey must be set in config (BICONOMY_API_KEY env var on the MCP server). ' +
      'If it is not set, this tool will fail — inform the user that cross-chain operations are not ' +
      'available in this deployment. ' +
      'Bridges tokens from the spoke chain to BSC and deposits into Peridot atomically. ' +
      'Returns biconomyInstructions — the user signs one transaction in their dApp, which submits ' +
      'the payload to Biconomy /execute. ' +
      'After the user submits, call check_transaction_status with the returned superTxHash to track it.',
    inputSchema: crossChainSupplySchema,
    execute: buildCrossChainSupplyIntent,
    category: 'lending',
  },

  {
    name: 'build_cross_chain_borrow_intent',
    description:
      'Borrow from Peridot on BSC and optionally bridge the borrowed amount back to a spoke chain, ' +
      'all in a single atomic cross-chain operation via Biconomy MEE. ' +
      'REQUIRED BEFORE CALLING THIS: run simulate_borrow and confirm isSafe=true. ' +
      'REQUIRES: biconomyApiKey must be set in config (BICONOMY_API_KEY env var on the MCP server). ' +
      'If it is not set, this tool will fail — inform the user that cross-chain operations are not ' +
      'available in this deployment. ' +
      'Returns biconomyInstructions for a single user signature in their dApp. ' +
      'Use check_transaction_status to track the cross-chain execution.',
    inputSchema: crossChainBorrowSchema,
    execute: buildCrossChainBorrowIntent,
    category: 'lending',
  },

  {
    name: 'build_cross_chain_repay_intent',
    description:
      'Repay a Peridot borrow using tokens held on a spoke chain — for example, repay a ' +
      'BSC USDC debt by spending USDC on Arbitrum. Bridges and repays in one atomic operation. ' +
      'Useful when the user wants to repay but their tokens are not on BSC. ' +
      'REQUIRES: biconomyApiKey must be set in config (BICONOMY_API_KEY env var on the MCP server). ' +
      'If it is not set, this tool will fail — inform the user that cross-chain operations are not ' +
      'available in this deployment. ' +
      'Returns biconomyInstructions for a single user signature in their dApp.',
    inputSchema: crossChainRepaySchema,
    execute: buildCrossChainRepayIntent,
    category: 'lending',
  },

  {
    name: 'build_cross_chain_withdraw_intent',
    description:
      'Withdraw supplied assets from Peridot on BSC and optionally bridge them to a spoke chain, ' +
      'all in one atomic cross-chain operation. ' +
      'ALWAYS call get_user_position first to check for active borrows; ' +
      'if present, also call get_account_liquidity to verify the withdrawal will not cause a shortfall. ' +
      'REQUIRES: biconomyApiKey must be set in config (BICONOMY_API_KEY env var on the MCP server). ' +
      'If it is not set, this tool will fail — inform the user that cross-chain operations are not ' +
      'available in this deployment. ' +
      'Returns biconomyInstructions for a single user signature in their dApp.',
    inputSchema: crossChainWithdrawSchema,
    execute: buildCrossChainWithdrawIntent,
    category: 'lending',
  },

  // ── Status ───────────────────────────────────────────────────────────────

  {
    name: 'check_transaction_status',
    description:
      'Check the execution status of a submitted cross-chain Biconomy transaction by its superTxHash. ' +
      'Returns one of: pending (not yet picked up), processing (bridge/relay in progress), ' +
      'success (all cross-chain steps completed), failed (reverted or timed out), ' +
      'not_found (hash unknown — may not have been submitted yet). ' +
      'Call this after the user submits a cross-chain intent and poll every ~10s until ' +
      'status is "success" or "failed". Only cross-chain intents produce a superTxHash — ' +
      'hub-chain intents give standard on-chain tx hashes that can be checked on a block explorer.',
    inputSchema: checkTransactionStatusSchema,
    execute: checkTransactionStatus,
    category: 'status',
  },
]
