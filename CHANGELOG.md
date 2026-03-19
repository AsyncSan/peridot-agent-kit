# @peridot-agent/agent-kit

## 0.2.1

### Patch Changes

- d4321f7: Fix: read user positions directly on-chain instead of authenticated API

  get_user_position, simulate_borrow, and get_portfolio now use viem multicall
  to read pToken balances from the blockchain directly. This removes the dependency
  on wallet-signature-protected API endpoints and makes the package work out of
  the box — no auth, no API keys needed for read operations.

  Also adds chainId parameter to get_user_position and get_portfolio (default: BSC 56).

## 0.2.0

### Minor Changes

- 2b43dda: Add full APY breakdown to `get_market_rates`

  - `getMarketApy()` method on `PeridotApiClient` — fetches `/api/apy` with optional chainId filter
  - `get_market_rates` tool now returns `supplyApyPct`, `borrowApyPct`, `peridotSupplyApyPct`, `peridotBorrowApyPct`, `boostSourceSupplyApyPct`, `boostRewardsSupplyApyPct`, `totalSupplyApyPct`, `netBorrowApyPct` — all real values from the platform, no longer hardcoded 0
  - Fix BigInt serialization crash in MCP server when hub intent tools return `value: 0n`
  - Improve all 15 tool descriptions with hub/spoke routing guidance for LLMs
  - Add `pnpm test:integration` suite (25 live tests against `app.peridot.finance`)
  - Add `pnpm test:routing` script — validates tool descriptions with `gpt-4o-mini`
