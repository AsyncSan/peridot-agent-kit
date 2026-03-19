import type { Address } from 'viem'

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------

export const DEFAULT_API_BASE_URL = 'https://app.peridot.finance'
export const BICONOMY_API_URL = 'https://api.biconomy.io'

// ---------------------------------------------------------------------------
// Chain IDs
// ---------------------------------------------------------------------------

/** Hub chains host the pToken lending pools natively. */
export const HUB_CHAIN_IDS = [56, 97, 143, 10143, 1868, 50312] as const
export type HubChainId = (typeof HUB_CHAIN_IDS)[number]

export const BSC_MAINNET_CHAIN_ID = 56
export const BSC_TESTNET_CHAIN_ID = 97
export const MONAD_MAINNET_CHAIN_ID = 143
export const MONAD_TESTNET_CHAIN_ID = 10143
export const SOMNIA_MAINNET_CHAIN_ID = 1868
export const SOMNIA_TESTNET_CHAIN_ID = 50312

/** Spoke chains — users bridge to the hub to interact with the protocol. */
export const ARBITRUM_CHAIN_ID = 42161
export const BASE_CHAIN_ID = 8453
export const ETHEREUM_CHAIN_ID = 1
export const POLYGON_CHAIN_ID = 137
export const OPTIMISM_CHAIN_ID = 10
export const AVALANCHE_CHAIN_ID = 43114

/** Map of human-readable chain names for error messages. */
export const CHAIN_NAMES: Record<number, string> = {
  [BSC_MAINNET_CHAIN_ID]: 'BSC Mainnet',
  [BSC_TESTNET_CHAIN_ID]: 'BSC Testnet',
  [MONAD_MAINNET_CHAIN_ID]: 'Monad Mainnet',
  [MONAD_TESTNET_CHAIN_ID]: 'Monad Testnet',
  [SOMNIA_MAINNET_CHAIN_ID]: 'Somnia Mainnet',
  [SOMNIA_TESTNET_CHAIN_ID]: 'Somnia Testnet',
  [ARBITRUM_CHAIN_ID]: 'Arbitrum',
  [BASE_CHAIN_ID]: 'Base',
  [ETHEREUM_CHAIN_ID]: 'Ethereum',
  [POLYGON_CHAIN_ID]: 'Polygon',
  [OPTIMISM_CHAIN_ID]: 'Optimism',
  [AVALANCHE_CHAIN_ID]: 'Avalanche',
}

export function isHubChain(chainId: number): boolean {
  return (HUB_CHAIN_IDS as readonly number[]).includes(chainId)
}

/** For spoke chains, returns the hub chain that hosts the markets. */
export function resolveHubChainId(chainId: number, network: 'mainnet' | 'testnet' = 'mainnet'): number {
  if (isHubChain(chainId)) return chainId
  return network === 'testnet' ? BSC_TESTNET_CHAIN_ID : BSC_MAINNET_CHAIN_ID
}

// ---------------------------------------------------------------------------
// Contract addresses — Hub chains
// ---------------------------------------------------------------------------

export const PERIDOT_CONTROLLER: Partial<Record<number, Address>> = {
  [BSC_MAINNET_CHAIN_ID]: '0x6fC0c15531CB5901ac72aB3CFCd9dF6E99552e14',
  // [MONAD_MAINNET_CHAIN_ID]: '0x...',  // TODO: add when deployed
  // [SOMNIA_MAINNET_CHAIN_ID]: '0x...',  // TODO: add when deployed
}

/** pToken market addresses per hub chain, keyed by asset symbol (uppercase). */
export const PERIDOT_MARKETS: Partial<Record<number, Partial<Record<string, Address>>>> = {
  [BSC_MAINNET_CHAIN_ID]: {
    WETH: '0x28E4F2Bb64ac79500ec3CAa074A3C30721B6bC84',
    USDC: '0x1A726369Bfc60198A0ce19C66726C8046c0eC17e',
    WBNB: '0xD9fDF5E2c7a2e7916E7f10Da276D95d4daC5a3c3',
    USDT: '0xc37f3869720B672addFE5F9E22a9459e0E851372',
    WBTC: '0xdCAbDc1F0B5e603b9191be044a912A8A2949e212',
    AUSD: '0x7A9940B77c0B6DFCcA2028b9F3CCa88E5DC36ebb',
  },
  // [MONAD_MAINNET_CHAIN_ID]: { ... },  // TODO: add when deployed
  // [SOMNIA_MAINNET_CHAIN_ID]: { ... },  // TODO: add when deployed
}

/** Underlying ERC-20 token addresses on BSC Mainnet. */
export const BSC_UNDERLYING_TOKENS: Partial<Record<string, Address>> = {
  WETH: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
  WBTC: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c',
  USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  AUSD: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a',
  WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  USDT: '0x55d398326f99059fF775485246999027B3197955',
}

/**
 * Underlying ERC-20 token addresses for all hub chains.
 * Add Monad/Somnia entries here when contracts are deployed.
 */
export const HUB_UNDERLYING_TOKENS: Partial<Record<number, Partial<Record<string, Address>>>> = {
  [BSC_MAINNET_CHAIN_ID]: BSC_UNDERLYING_TOKENS,
  // [MONAD_MAINNET_CHAIN_ID]: { USDC: '0x...', WETH: '0x...', ... },  // TODO
  // [SOMNIA_MAINNET_CHAIN_ID]: { USDC: '0x...', WETH: '0x...', ... },  // TODO
}

/** Token addresses on spoke chains, keyed by chainId then asset symbol. */
export const SPOKE_TOKENS: Partial<Record<number, Partial<Record<string, Address>>>> = {
  [ARBITRUM_CHAIN_ID]: {
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    AUSD: '0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a',
    WBTC: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
  },
  [BASE_CHAIN_ID]: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    WETH: '0x4200000000000000000000000000000000000006',
    USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    WBTC: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c',
  },
  [ETHEREUM_CHAIN_ID]: {
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    WBTC: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
  },
  [POLYGON_CHAIN_ID]: {
    USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    WBTC: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
  },
  [OPTIMISM_CHAIN_ID]: {
    USDC: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
    USDT: '0x94b008aA00579c1307B0eF2c499aD98a8ce58e58',
    WETH: '0x4200000000000000000000000000000000000006',
  },
  [AVALANCHE_CHAIN_ID]: {
    USDC: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    USDT: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    WETH: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB',
    WBTC: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c',
  },
}

/** ERC-20 decimal places by asset symbol. */
export const ASSET_DECIMALS: Record<string, number> = {
  USDC: 6,
  USDT: 6,
  WBTC: 8,
  WETH: 18,
  WBNB: 18,
  AUSD: 18,
}

// ---------------------------------------------------------------------------
// Address helpers
// ---------------------------------------------------------------------------

export function getPTokenAddress(chainId: number, asset: string): Address {
  const markets = PERIDOT_MARKETS[chainId]
  if (!markets) {
    throw new Error(`No pToken markets configured for chain ${chainId} (${CHAIN_NAMES[chainId] ?? 'unknown'})`)
  }
  const address = markets[asset.toUpperCase()]
  if (!address) {
    const available = Object.keys(markets).join(', ')
    throw new Error(`No pToken market for ${asset.toUpperCase()} on chain ${chainId}. Available: ${available}`)
  }
  return address
}

export function getUnderlyingTokenAddress(chainId: number, asset: string): Address {
  const symbol = asset.toUpperCase()
  const chainName = CHAIN_NAMES[chainId] ?? `chain ${chainId}`

  // Hub chains use HUB_UNDERLYING_TOKENS
  if (isHubChain(chainId)) {
    const hubTokens = HUB_UNDERLYING_TOKENS[chainId]
    if (!hubTokens) throw new Error(`No underlying token config for hub chain ${chainName} — contracts may not be deployed yet`)
    const address = hubTokens[symbol]
    if (!address) throw new Error(`No underlying token for ${symbol} on ${chainName}`)
    return address
  }

  // Spoke chains use SPOKE_TOKENS
  const spokeTokens = SPOKE_TOKENS[chainId]
  if (!spokeTokens) throw new Error(`No token config for chain ${chainName}`)
  const address = spokeTokens[symbol]
  if (!address) throw new Error(`No token address for ${symbol} on ${chainName}`)
  return address
}

export function getControllerAddress(chainId: number): Address {
  const address = PERIDOT_CONTROLLER[chainId]
  if (!address) throw new Error(`No Peridot controller for chain ${chainId}`)
  return address
}

export function getAssetDecimals(asset: string): number {
  const symbol = asset.toUpperCase()
  const decimals = ASSET_DECIMALS[symbol]
  if (decimals === undefined) {
    throw new Error(
      `Unknown asset "${symbol}": decimal precision not configured. ` +
        `Add it to ASSET_DECIMALS in constants.ts before use.`,
    )
  }
  return decimals
}

/** Default public RPC endpoints (no API key required). */
export const DEFAULT_RPC_URLS: Partial<Record<number, string>> = {
  [BSC_MAINNET_CHAIN_ID]: 'https://bsc-dataseed.binance.org',
  [BSC_TESTNET_CHAIN_ID]: 'https://data-seed-prebsc-1-s1.binance.org:8545',
  [MONAD_MAINNET_CHAIN_ID]: 'https://rpc.monad.xyz',
  [MONAD_TESTNET_CHAIN_ID]: 'https://testnet-rpc.monad.xyz',
  [SOMNIA_MAINNET_CHAIN_ID]: 'https://dream-rpc.somnia.network',
  [SOMNIA_TESTNET_CHAIN_ID]: 'https://testnet.rpc.somnia.network',
  [ARBITRUM_CHAIN_ID]: 'https://arb1.arbitrum.io/rpc',
  [BASE_CHAIN_ID]: 'https://mainnet.base.org',
  [ETHEREUM_CHAIN_ID]: 'https://eth.llamarpc.com',
}
