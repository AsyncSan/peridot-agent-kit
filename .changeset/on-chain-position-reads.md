---
"@peridot-agent/agent-kit": patch
---

Fix: read user positions directly on-chain instead of authenticated API

get_user_position, simulate_borrow, and get_portfolio now use viem multicall
to read pToken balances from the blockchain directly. This removes the dependency
on wallet-signature-protected API endpoints and makes the package work out of
the box — no auth, no API keys needed for read operations.

Also adds chainId parameter to get_user_position and get_portfolio (default: BSC 56).
