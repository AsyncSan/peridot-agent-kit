/**
 * @peridot/agent-kit — main entry point
 *
 * For framework-specific adapters:
 *   import { createLangChainTools } from "@peridot/agent-kit/langchain"
 *   import { createVercelAITools }  from "@peridot/agent-kit/vercel-ai"
 *   // MCP server: npx peridot-mcp (or import "@peridot/agent-kit/mcp")
 */

// Types
export type {
  PeridotConfig,
  ToolDefinition,
  ToolCategory,
  MarketRates,
  UserPosition,
  SimulateBorrowResult,
  AccountLiquidity,
  HubTransactionIntent,
  CrossChainIntent,
  TransactionIntent,
  TransactionCall,
  TransactionStatus,
  BiconomyResponse,
  ComposeRequest,
  ComposeFlow,
} from './shared/types'

// Tool registry (all lending tools as ToolDefinition[])
export { lendingTools } from './features/lending/tools'

// API client (for direct use or custom tool building)
export { PeridotApiClient } from './shared/api-client'

// Constants and address helpers
export {
  PERIDOT_CONTROLLER,
  PERIDOT_MARKETS,
  BSC_UNDERLYING_TOKENS,
  SPOKE_TOKENS,
  ASSET_DECIMALS,
  getPTokenAddress,
  getUnderlyingTokenAddress,
  getControllerAddress,
  getAssetDecimals,
  isHubChain,
  resolveHubChainId,
  BSC_MAINNET_CHAIN_ID,
  BSC_TESTNET_CHAIN_ID,
  MONAD_MAINNET_CHAIN_ID,
  SOMNIA_MAINNET_CHAIN_ID,
  ARBITRUM_CHAIN_ID,
  BASE_CHAIN_ID,
  ETHEREUM_CHAIN_ID,
} from './shared/constants'

// ABIs (for consumers building custom contract interactions)
export { PTOKEN_ABI, COMPTROLLER_ABI, ERC20_ABI } from './shared/abis'

// Core functions — read tools
export { getMarketRates } from './features/lending/read/get-market-rates'
export { getUserPosition } from './features/lending/read/get-user-position'
export { simulateBorrow } from './features/lending/read/simulate-borrow'
export { getAccountLiquidity } from './features/lending/read/get-account-liquidity'

// Core functions — hub intents
export { buildHubSupplyIntent } from './features/lending/intents/hub/supply'
export { buildHubBorrowIntent } from './features/lending/intents/hub/borrow'
export { buildHubRepayIntent } from './features/lending/intents/hub/repay'
export { buildHubWithdrawIntent } from './features/lending/intents/hub/withdraw'
export { buildHubEnableCollateralIntent } from './features/lending/intents/hub/enable-collateral'
export { buildHubDisableCollateralIntent } from './features/lending/intents/hub/disable-collateral'

// Core functions — cross-chain intents
export { buildCrossChainSupplyIntent } from './features/lending/intents/cross-chain/supply'
export { buildCrossChainBorrowIntent } from './features/lending/intents/cross-chain/borrow'
export { buildCrossChainRepayIntent } from './features/lending/intents/cross-chain/repay'
export { buildCrossChainWithdrawIntent } from './features/lending/intents/cross-chain/withdraw'

// Core functions — status
export { checkTransactionStatus } from './features/lending/status/check-transaction'
