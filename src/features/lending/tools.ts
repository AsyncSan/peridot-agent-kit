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
      'Fetch current TVL, utilization, liquidity, and price for a Peridot market. ' +
      'Use this when the user asks about market conditions, available liquidity, or asset prices.',
    inputSchema: getMarketRatesSchema,
    execute: getMarketRates,
    category: 'lending',
  },

  {
    name: 'get_user_position',
    description:
      "Fetch a user's complete Peridot portfolio: total supplied, total borrowed, net APY, " +
      'simplified health factor, and per-asset breakdown. ' +
      'Always call this before recommending any borrow or withdraw action.',
    inputSchema: getUserPositionSchema,
    execute: getUserPosition,
    category: 'lending',
  },

  {
    name: 'simulate_borrow',
    description:
      'Simulate what would happen to the health factor if the user borrows a specific amount. ' +
      'Returns projected HF, risk level, and the maximum safe borrow amount. ' +
      'ALWAYS call this before building a borrow intent to prevent liquidation risk.',
    inputSchema: simulateBorrowSchema,
    execute: simulateBorrow,
    category: 'lending',
  },

  {
    name: 'get_account_liquidity',
    description:
      "Read the user's precise borrow capacity and shortfall directly from the Peridottroller " +
      'smart contract. More accurate than simulate_borrow for exact liquidation threshold checks. ' +
      'Requires an RPC URL to be configured.',
    inputSchema: getAccountLiquiditySchema,
    execute: getAccountLiquidity,
    category: 'lending',
  },

  // ── Hub-chain intents (user on BSC / Monad / Somnia) ─────────────────────

  {
    name: 'build_hub_supply_intent',
    description:
      'Build the transaction calls to supply an asset to Peridot on a hub chain (BSC, Monad, Somnia). ' +
      'Returns approve + mint + enterMarkets calldata. The user signs each call with their wallet. ' +
      'Use when the user is already on the hub chain.',
    inputSchema: hubSupplySchema,
    execute: buildHubSupplyIntent,
    category: 'lending',
  },

  {
    name: 'build_hub_borrow_intent',
    description:
      'Build the transaction calls to borrow from Peridot on a hub chain. ' +
      'Returns enterMarkets + borrow calldata. ' +
      'ALWAYS call simulate_borrow first to verify the action is safe.',
    inputSchema: hubBorrowSchema,
    execute: buildHubBorrowIntent,
    category: 'lending',
  },

  {
    name: 'build_hub_repay_intent',
    description:
      'Build the transaction calls to repay a Peridot borrow on a hub chain. ' +
      'Returns approve + repayBorrow calldata. Use amount = "max" to repay the full balance.',
    inputSchema: hubRepaySchema,
    execute: buildHubRepayIntent,
    category: 'lending',
  },

  {
    name: 'build_hub_withdraw_intent',
    description:
      'Build the transaction call to withdraw (redeem) supplied assets from Peridot on a hub chain. ' +
      'Will revert on-chain if withdrawal would undercollateralize existing borrows.',
    inputSchema: hubWithdrawSchema,
    execute: buildHubWithdrawIntent,
    category: 'lending',
  },

  {
    name: 'build_enable_collateral_intent',
    description:
      'Build the enterMarkets call to enable one or more supplied assets as collateral. ' +
      'Must be done before borrowing against those assets. ' +
      'Note: build_hub_supply_intent already includes this when enableAsCollateral=true.',
    inputSchema: hubEnableCollateralSchema,
    execute: buildHubEnableCollateralIntent,
    category: 'lending',
  },

  {
    name: 'build_disable_collateral_intent',
    description:
      'Build the exitMarket call to stop using a supplied asset as collateral. ' +
      'Will revert if existing borrows rely on this collateral.',
    inputSchema: hubDisableCollateralSchema,
    execute: buildHubDisableCollateralIntent,
    category: 'lending',
  },

  // ── Cross-chain intents (user on a spoke chain like Arbitrum) ────────────

  {
    name: 'build_cross_chain_supply_intent',
    description:
      'Build a cross-chain supply intent for a user on a spoke chain (Arbitrum, Base, Ethereum, etc.). ' +
      'Uses Biconomy MEE to atomically bridge tokens to BSC and supply to Peridot in one user signature. ' +
      'Requires biconomyApiKey in config.',
    inputSchema: crossChainSupplySchema,
    execute: buildCrossChainSupplyIntent,
    category: 'lending',
  },

  {
    name: 'build_cross_chain_borrow_intent',
    description:
      'Borrow from Peridot hub (BSC) and optionally bridge the proceeds to a target spoke chain. ' +
      'Uses Biconomy MEE. Requires biconomyApiKey in config. ' +
      'ALWAYS call simulate_borrow first.',
    inputSchema: crossChainBorrowSchema,
    execute: buildCrossChainBorrowIntent,
    category: 'lending',
  },

  {
    name: 'build_cross_chain_repay_intent',
    description:
      'Repay a Peridot borrow from a spoke chain (e.g., pay with USDC on Arbitrum to repay a BSC debt). ' +
      'Uses Biconomy MEE to bridge and repay atomically. Requires biconomyApiKey in config.',
    inputSchema: crossChainRepaySchema,
    execute: buildCrossChainRepayIntent,
    category: 'lending',
  },

  {
    name: 'build_cross_chain_withdraw_intent',
    description:
      'Withdraw supplied assets from Peridot and optionally bridge them to a target spoke chain. ' +
      'Uses Biconomy MEE. Requires biconomyApiKey in config.',
    inputSchema: crossChainWithdrawSchema,
    execute: buildCrossChainWithdrawIntent,
    category: 'lending',
  },

  // ── Status ───────────────────────────────────────────────────────────────

  {
    name: 'check_transaction_status',
    description:
      'Check the status of a cross-chain Biconomy super-transaction. ' +
      'Returns: pending | processing | success | failed | not_found.',
    inputSchema: checkTransactionStatusSchema,
    execute: checkTransactionStatus,
    category: 'status',
  },
]
