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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lendingTools: ToolDefinition<any, any>[] = [
  // ── Read / Simulate ──────────────────────────────────────────────────────

  {
    name: 'get_market_rates',
    description:
      'Fetch current market data for a Peridot lending market: supply APY, borrow APY, ' +
      'PERIDOT reward APY, boost APY (Morpho/PancakeSwap/Magma), total supply APY, net borrow APY, ' +
      'TVL, utilization rate, available liquidity, asset price, and collateral factor. ' +
      'Call this when the user asks about rates, yields, APY, market conditions, or available liquidity.',
    inputSchema: getMarketRatesSchema,
    execute: getMarketRates,
    category: 'lending',
  },

  {
    name: 'get_user_position',
    description:
      "Fetch a user's complete Peridot portfolio: total supplied USD, total borrowed USD, " +
      'net APY, health factor (totalSupplied / totalBorrowed — above 1.5 is safe), and per-asset breakdown. ' +
      'ALWAYS call this before recommending or building any borrow, withdraw, or repay action ' +
      'so you know the user\'s current exposure and health factor.',
    inputSchema: getUserPositionSchema,
    execute: getUserPosition,
    category: 'lending',
  },

  {
    name: 'simulate_borrow',
    description:
      'Simulate the health factor impact of borrowing a specific amount. ' +
      'Returns projected health factor, risk level (safe/moderate/high/critical/liquidatable), ' +
      'and the maximum safe borrow amount in USD. ' +
      'ALWAYS call this before build_hub_borrow_intent or build_cross_chain_borrow_intent. ' +
      'Do not proceed with a borrow intent if isSafe=false or riskLevel is "high" or worse.',
    inputSchema: simulateBorrowSchema,
    execute: simulateBorrow,
    category: 'lending',
  },

  {
    name: 'get_account_liquidity',
    description:
      "Read the user's exact on-chain borrow capacity (liquidityUsd) and shortfall (shortfallUsd) " +
      'directly from the Peridot comptroller contract. ' +
      'Use this for precise liquidation threshold checks when simulate_borrow is not accurate enough, ' +
      'or to confirm a user is healthy before allowing a large withdrawal.',
    inputSchema: getAccountLiquiditySchema,
    execute: getAccountLiquidity,
    category: 'lending',
  },

  // ── Hub-chain intents (user on BSC / Monad / Somnia) ─────────────────────
  // Use hub tools when the user's wallet is already connected to a hub chain.
  // Hub chains: BSC (56), Monad (143), Somnia (1868).
  // If the user is on any other chain, use the cross-chain tools instead.

  {
    name: 'build_hub_supply_intent',
    description:
      'Build transaction calldata to supply an asset to Peridot when the user is on a hub chain. ' +
      'Hub chains are: BSC (chainId 56), Monad (chainId 143), Somnia (chainId 1868). ' +
      'ONLY use this tool when chainId is exactly 56, 143, or 1868. ' +
      'Returns an ordered list of calls the user must sign: approve → mint → enterMarkets. ' +
      'Tell the user to sign and submit each call in sequence with their wallet. ' +
      'If chainId is anything else (42161, 8453, 1, 137, 10, 43114, etc.) use build_cross_chain_supply_intent instead.',
    inputSchema: hubSupplySchema,
    execute: buildHubSupplyIntent,
    category: 'lending',
  },

  {
    name: 'build_hub_borrow_intent',
    description:
      'Build transaction calldata to borrow from Peridot on a hub chain (chainId 56, 143, or 1868). ' +
      'Returns calls: enterMarkets (activate collateral) → borrow. ' +
      'ALWAYS call simulate_borrow first and only proceed if isSafe=true. ' +
      'Tell the user to sign and submit each call in order with their wallet.',
    inputSchema: hubBorrowSchema,
    execute: buildHubBorrowIntent,
    category: 'lending',
  },

  {
    name: 'build_hub_repay_intent',
    description:
      'Build transaction calldata to repay a Peridot borrow on a hub chain. ' +
      'Returns calls: approve → repayBorrow. ' +
      'Pass amount="max" to repay the entire outstanding balance. ' +
      'Tell the user to sign and submit each call in order.',
    inputSchema: hubRepaySchema,
    execute: buildHubRepayIntent,
    category: 'lending',
  },

  {
    name: 'build_hub_withdraw_intent',
    description:
      'Build transaction calldata to withdraw (redeem) supplied assets from Peridot on a hub chain. ' +
      'Call get_user_position first to confirm the user has sufficient collateral after withdrawal. ' +
      'If the user has active borrows, call simulate_borrow or get_account_liquidity first to verify ' +
      'the withdrawal will not undercollateralize them — the transaction will revert on-chain if it does.',
    inputSchema: hubWithdrawSchema,
    execute: buildHubWithdrawIntent,
    category: 'lending',
  },

  {
    name: 'build_enable_collateral_intent',
    description:
      'Build the transaction call to enable supplied assets as collateral in Peridot. ' +
      'Required before borrowing against those assets. ' +
      'Note: build_hub_supply_intent already enables collateral by default (enableAsCollateral=true) — ' +
      'only use this separately if the user supplied previously without enabling collateral.',
    inputSchema: hubEnableCollateralSchema,
    execute: buildHubEnableCollateralIntent,
    category: 'lending',
  },

  {
    name: 'build_disable_collateral_intent',
    description:
      'Build the transaction call to stop using a supplied asset as collateral. ' +
      'ALWAYS call get_account_liquidity or get_user_position first to confirm the user has ' +
      'no active borrows relying on this asset — the transaction will revert on-chain if they do.',
    inputSchema: hubDisableCollateralSchema,
    execute: buildHubDisableCollateralIntent,
    category: 'lending',
  },

  // ── Cross-chain intents (user on a spoke chain) ───────────────────────────
  // Use these when the user is on Arbitrum (42161), Base (8453), Ethereum (1),
  // Polygon (137), Optimism (10), or Avalanche (43114).
  // These tools call Biconomy MEE to compose a single cross-chain payload.
  // The result contains biconomyInstructions — tell the user their dApp will
  // submit this to Biconomy /execute for a single wallet signature.

  {
    name: 'build_cross_chain_supply_intent',
    description:
      'Build a cross-chain supply intent for a user on a spoke chain. ' +
      'Spoke chains are: Arbitrum (42161), Base (8453), Ethereum (1), Polygon (137), Optimism (10), Avalanche (43114). ' +
      'Do NOT use this if chainId is 56 (BSC), 143 (Monad), or 1868 (Somnia) — those are hub chains, use build_hub_supply_intent instead. ' +
      'Bridges tokens from the spoke chain to BSC and supplies to Peridot in one atomic operation. ' +
      'Returns biconomyInstructions — the user signs a single transaction in their dApp, ' +
      'which submits the payload to Biconomy. Use check_transaction_status to track progress.',
    inputSchema: crossChainSupplySchema,
    execute: buildCrossChainSupplyIntent,
    category: 'lending',
  },

  {
    name: 'build_cross_chain_borrow_intent',
    description:
      'Borrow from Peridot on BSC and optionally bridge the borrowed tokens to a spoke chain, ' +
      'all in one cross-chain operation. ' +
      'ALWAYS call simulate_borrow first and only proceed if isSafe=true. ' +
      'Returns biconomyInstructions for a single user signature via their dApp.',
    inputSchema: crossChainBorrowSchema,
    execute: buildCrossChainBorrowIntent,
    category: 'lending',
  },

  {
    name: 'build_cross_chain_repay_intent',
    description:
      'Repay a Peridot borrow using tokens held on a spoke chain ' +
      '(e.g. repay a BSC USDC debt by paying with USDC on Arbitrum). ' +
      'Bridges and repays atomically in one operation. ' +
      'Returns biconomyInstructions for a single user signature via their dApp.',
    inputSchema: crossChainRepaySchema,
    execute: buildCrossChainRepayIntent,
    category: 'lending',
  },

  {
    name: 'build_cross_chain_withdraw_intent',
    description:
      'Withdraw supplied assets from Peridot on BSC and optionally bridge them to a spoke chain, ' +
      'all in one cross-chain operation. ' +
      'Call get_user_position first to verify the withdrawal is safe if the user has active borrows. ' +
      'Returns biconomyInstructions for a single user signature via their dApp.',
    inputSchema: crossChainWithdrawSchema,
    execute: buildCrossChainWithdrawIntent,
    category: 'lending',
  },

  // ── Status ───────────────────────────────────────────────────────────────

  {
    name: 'check_transaction_status',
    description:
      'Check the status of a submitted cross-chain Biconomy transaction by its superTxHash. ' +
      'Call this after the user has submitted a cross-chain intent to track whether it succeeded. ' +
      'Returns: pending | processing | success | failed | not_found.',
    inputSchema: checkTransactionStatusSchema,
    execute: checkTransactionStatus,
    category: 'status',
  },
]
