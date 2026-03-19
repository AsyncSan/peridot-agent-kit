# @peridot/agent-kit

## 0.2.0

### Minor Changes

- 2b43dda: Add full APY breakdown to `get_market_rates`

  - `getMarketApy()` method on `PeridotApiClient` — fetches `/api/apy` with optional chainId filter
  - `get_market_rates` tool now returns `supplyApyPct`, `borrowApyPct`, `peridotSupplyApyPct`, `peridotBorrowApyPct`, `boostSourceSupplyApyPct`, `boostRewardsSupplyApyPct`, `totalSupplyApyPct`, `netBorrowApyPct` — all real values from the platform, no longer hardcoded 0
  - Fix BigInt serialization crash in MCP server when hub intent tools return `value: 0n`
  - Improve all 15 tool descriptions with hub/spoke routing guidance for LLMs
  - Add `pnpm test:integration` suite (25 live tests against `app.peridot.finance`)
  - Add `pnpm test:routing` script — validates tool descriptions with `gpt-4o-mini`
