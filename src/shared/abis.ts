import { parseAbi } from 'viem'

/**
 * Minimal ABI for pToken (Compound V2-style cToken) markets.
 * Only includes functions used by the agent-kit.
 */
export const PTOKEN_ABI = parseAbi([
  'function mint(uint256 mintAmount) returns (uint256)',
  'function redeem(uint256 redeemTokens) returns (uint256)',
  'function redeemUnderlying(uint256 redeemAmount) returns (uint256)',
  'function borrow(uint256 borrowAmount) returns (uint256)',
  'function repayBorrow(uint256 repayAmount) returns (uint256)',
  'function repayBorrowBehalf(address borrower, uint256 repayAmount) returns (uint256)',
  'function liquidateBorrow(address borrower, uint256 repayAmount, address pTokenCollateral) returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function borrowBalanceStored(address account) view returns (uint256)',
  'function supplyRatePerBlock() view returns (uint256)',
  'function borrowRatePerBlock() view returns (uint256)',
  'function exchangeRateStored() view returns (uint256)',
  'function underlying() view returns (address)',
])

/**
 * Minimal ABI for the Peridottroller (Compound V2-style Comptroller).
 */
export const COMPTROLLER_ABI = parseAbi([
  'function enterMarkets(address[] calldata pTokens) returns (uint256[] memory)',
  'function exitMarket(address pTokenAddress) returns (uint256)',
  'function getAccountLiquidity(address account) view returns (uint256 errorCode, uint256 liquidity, uint256 shortfall)',
  'function getAllMarkets() view returns (address[] memory)',
  'function markets(address pToken) view returns (bool isListed, uint256 collateralFactorMantissa, bool isComped)',
  'function checkMembership(address account, address pToken) view returns (bool)',
])

/**
 * Standard ERC-20 ABI subset used for approvals and balance checks.
 */
export const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
])
