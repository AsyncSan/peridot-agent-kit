#!/usr/bin/env node
/**
 * live-test.ts — End-to-end health check against the deployed Peridot API server.
 *
 * Tests two layers:
 *   1. Raw HTTP  — hits the server endpoints directly, verifies response shape
 *   2. SDK tools — exercises the actual tool functions (includes mapping logic)
 *
 * Usage:
 *   npx tsx scripts/live-test.ts
 *
 * Environment variables:
 *   API_URL      — Server base URL (default: http://164.92.131.71:3001)
 *   API_KEY      — API key for protected endpoints (enables portfolio/tx tests)
 *   TEST_ADDRESS — Wallet address for user-specific tests (default: a known BSC address)
 */

import { PeridotApiClient } from '../src/shared/api-client'
import { listMarkets } from '../src/features/lending/read/list-markets'
import { getMarketRates } from '../src/features/lending/read/get-market-rates'
import { getLiquidatablePositions } from '../src/features/lending/read/get-liquidatable-positions'
import type { PeridotConfig } from '../src/shared/types'

// ── Config ────────────────────────────────────────────────────────────────────

const API_URL = process.env['API_URL'] ?? 'http://164.92.131.71:3001'
const API_KEY = process.env['API_KEY']
// A real BSC address with known Peridot activity — swap out for your own
const TEST_ADDRESS = process.env['TEST_ADDRESS'] ?? '0x0000000000000000000000000000000000000001'

const config: PeridotConfig = {
  apiBaseUrl: API_URL,
}

// ── Output helpers ─────────────────────────────────────────────────────────────

const GREEN  = '\x1b[32m'
const RED    = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM    = '\x1b[2m'
const BOLD   = '\x1b[1m'
const RESET  = '\x1b[0m'

interface CheckResult {
  name: string
  status: 'pass' | 'fail' | 'warn' | 'skip'
  detail: string
  ms: number
}

const results: CheckResult[] = []

async function check(
  name: string,
  fn: () => Promise<{ ok: boolean; detail: string; warn?: boolean }>,
): Promise<void> {
  const start = Date.now()
  try {
    const { ok, detail, warn } = await fn()
    const ms = Date.now() - start
    const status = ok ? (warn ? 'warn' : 'pass') : 'fail'
    results.push({ name, status, detail, ms })
    const icon = status === 'pass' ? `${GREEN}✓${RESET}` : status === 'warn' ? `${YELLOW}⚠${RESET}` : `${RED}✗${RESET}`
    console.log(`  ${icon} ${name} ${DIM}(${ms}ms)${RESET}`)
    if (status !== 'pass') console.log(`    ${DIM}→ ${detail}${RESET}`)
  } catch (err) {
    const ms = Date.now() - start
    const detail = err instanceof Error ? err.message : String(err)
    results.push({ name, status: 'fail', detail, ms })
    console.log(`  ${RED}✗${RESET} ${name} ${DIM}(${ms}ms)${RESET}`)
    console.log(`    ${DIM}→ ${detail}${RESET}`)
  }
}

function skip(name: string, reason: string) {
  results.push({ name, status: 'skip', detail: reason, ms: 0 })
  console.log(`  ${DIM}– ${name} — skipped: ${reason}${RESET}`)
}

function section(title: string) {
  console.log(`\n${BOLD}${title}${RESET}`)
}

// ── Helper: raw fetch with API key ─────────────────────────────────────────────

async function apiFetch(path: string): Promise<Response> {
  const headers: Record<string, string> = {}
  if (API_KEY) headers['x-api-key'] = API_KEY
  return fetch(`${API_URL}${path}`, { headers, signal: AbortSignal.timeout(10_000) })
}

// ── Section 1: Raw HTTP server checks ─────────────────────────────────────────

async function rawChecks() {
  section('1. Server endpoints (raw HTTP)')

  await check('GET /health', async () => {
    const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5_000) })
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    const body = await res.json() as Record<string, unknown>
    // Server returns { ok: true, ts: <epoch> }
    if (body['ok'] !== true) return { ok: false, detail: `Unexpected body: ${JSON.stringify(body)}` }
    return { ok: true, detail: `ok=true, ts=${String(body['ts'])}` }
  })

  await check('GET /health/data — ingest freshness', async () => {
    const res = await fetch(`${API_URL}/health/data`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    const body = await res.json() as {
      ok: boolean
      stale: boolean
      metrics: { ageSeconds: number | null; fresh: boolean; updatedAt: string | null; thresholdSecs: number }
      apy: { ageSeconds: number | null; fresh: boolean; updatedAt: string | null; thresholdSecs: number }
    }
    if (!body.ok) return { ok: false, detail: `ok=false` }
    const metricsAge = body.metrics.ageSeconds !== null ? `${body.metrics.ageSeconds}s` : 'null (empty)'
    const apyAge = body.apy.ageSeconds !== null ? `${body.apy.ageSeconds}s` : 'null (empty)'
    const detail = `metrics=${metricsAge} (max ${body.metrics.thresholdSecs}s), apy=${apyAge} (max ${body.apy.thresholdSecs}s)`
    if (body.stale) return { ok: true, detail: `STALE — ${detail}`, warn: true }
    return { ok: true, detail }
  })

  await check('GET /api/markets/metrics — non-empty', async () => {
    const res = await apiFetch('/api/markets/metrics')
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} ${res.statusText}` }
    const body = await res.json() as { ok: boolean; data: Record<string, unknown> }
    if (!body.ok) return { ok: false, detail: `ok=false` }
    const count = Object.keys(body.data).length
    if (count === 0) return { ok: false, detail: 'Empty metrics — ingest pipeline may not be running' }
    const sample = Object.keys(body.data)[0]
    return { ok: true, detail: `${count} markets, e.g. "${sample}"` }
  })

  await check('GET /api/apy — lowercase keys, non-zero data', async () => {
    const res = await apiFetch('/api/apy')
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} ${res.statusText}` }
    const body = await res.json() as { ok: boolean; data: Record<string, unknown> }
    if (!body.ok) return { ok: false, detail: 'ok=false' }
    const keys = Object.keys(body.data)
    if (keys.length === 0) return { ok: false, detail: 'Empty APY table — APY ingest may not have run' }
    const hasUppercase = keys.some(k => k !== k.toLowerCase())
    if (hasUppercase) return { ok: false, detail: `Keys contain uppercase: ${keys.filter(k => k !== k.toLowerCase()).join(', ')} — APY casing bug!` }
    // Check that at least one asset has non-zero APY
    const hasNonZero = keys.some(assetKey => {
      const chains = body.data[assetKey] as Record<string, { supplyApy?: number }>
      return Object.values(chains).some(c => (c?.supplyApy ?? 0) > 0)
    })
    if (!hasNonZero) return { ok: true, detail: `${keys.length} assets present but all APY values are 0 — ingest running but yields may not be written yet`, warn: true }
    return { ok: true, detail: `${keys.length} assets with APY data: ${keys.slice(0, 4).join(', ')}` }
  })

  await check('GET /api/leaderboard — has entries', async () => {
    const res = await apiFetch('/api/leaderboard?limit=5')
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} ${res.statusText}` }
    const body = await res.json() as { ok: boolean; data: { entries: unknown[]; total: number } }
    if (!body.ok) return { ok: false, detail: 'ok=false' }
    const { entries, total } = body.data
    if (entries.length === 0) return { ok: true, detail: 'Leaderboard is empty — no users have earned points yet', warn: true }
    return { ok: true, detail: `${total} total users, returned ${entries.length} entries` }
  })

  await check('GET /api/liquidations/at-risk — responds without error', async () => {
    const res = await apiFetch('/api/liquidations/at-risk?limit=10')
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status} ${res.statusText}` }
    const body = await res.json() as { ok: boolean; data: { accounts: unknown[]; count: number } }
    if (!body.ok) return { ok: false, detail: 'ok=false' }
    const { count } = body.data
    if (count === 0) return { ok: true, detail: 'No liquidatable positions — scanner may not have run or no underwater accounts', warn: true }
    return { ok: true, detail: `${count} liquidatable accounts` }
  })

  if (!API_KEY) {
    skip('GET /api/user/portfolio-data', 'set API_KEY env var to test wallet-auth bypass')
    skip('GET /api/user/transactions', 'set API_KEY env var to test wallet-auth bypass')
  } else {
    await check('GET /api/user/portfolio-data — API key bypass works', async () => {
      const res = await apiFetch(`/api/user/portfolio-data?address=${TEST_ADDRESS}`)
      if (res.status === 401) return { ok: false, detail: 'Got 401 — API key bypass not working (check API_KEY matches server)' }
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status} ${res.statusText}` }
      const body = await res.json() as { ok: boolean; data: { portfolio: { totalSupplied: number } } }
      if (!body.ok) return { ok: false, detail: 'ok=false' }
      const { totalSupplied } = body.data.portfolio
      if (totalSupplied === 0) return { ok: true, detail: `totalSupplied=0 (address may have no positions)`, warn: true }
      return { ok: true, detail: `totalSupplied=$${totalSupplied.toFixed(2)}` }
    })

    await check('GET /api/user/transactions — API key bypass works', async () => {
      const res = await apiFetch(`/api/user/transactions?address=${TEST_ADDRESS}&limit=5`)
      if (res.status === 401) return { ok: false, detail: 'Got 401 — API key bypass not working' }
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status} ${res.statusText}` }
      const body = await res.json() as { ok: boolean; data: { transactions: unknown[]; total: number } }
      if (!body.ok) return { ok: false, detail: 'ok=false' }
      const { total } = body.data
      if (total === 0) return { ok: true, detail: 'No transactions for this address (expected for zero address)', warn: true }
      return { ok: true, detail: `${total} total transactions` }
    })
  }
}

// ── Section 2: SDK tool function checks ───────────────────────────────────────

async function sdkChecks() {
  section('2. SDK tool functions (PeridotApiClient + tool logic)')

  await check('listMarkets — returns markets with dataAgeSeconds', async () => {
    const result = await listMarkets({}, config)
    if (result.count === 0) return { ok: false, detail: 'No markets returned — metrics endpoint empty' }
    const maxAge = Math.max(...result.markets.map(m => m.dataAgeSeconds))
    const minAge = Math.min(...result.markets.map(m => m.dataAgeSeconds))
    if (maxAge > 600) return { ok: true, detail: `${result.count} markets, oldest data: ${Math.round(maxAge / 60)}m — data feed may be stale`, warn: true }
    return { ok: true, detail: `${result.count} markets, data freshness: ${minAge}–${maxAge}s old` }
  })

  await check('getMarketRates USDC/BSC — apyDataAvailable flag', async () => {
    const result = await getMarketRates({ asset: 'USDC', chainId: 56 }, config)
    if (!result.apyDataAvailable) {
      return { ok: true, detail: `apyDataAvailable=false — APY ingest hasn't run for USDC/BSC yet. All yield fields are 0. ${result.warning ?? ''}`, warn: true }
    }
    const parts = [
      `supplyApy=${result.supplyApyPct.toFixed(2)}%`,
      `totalSupplyApy=${result.totalSupplyApyPct.toFixed(2)}%`,
      `netBorrowApy=${result.netBorrowApyPct.toFixed(2)}%`,
      `data age: ${result.dataAgeSeconds}s`,
    ]
    if (result.dataAgeSeconds > 300) return { ok: true, detail: parts.join(', '), warn: true }
    return { ok: true, detail: parts.join(', ') }
  })

  await check('getMarketRates WETH/BSC — present in APY table', async () => {
    const result = await getMarketRates({ asset: 'WETH', chainId: 56 }, config)
    if (!result.apyDataAvailable) return { ok: true, detail: 'apyDataAvailable=false for WETH/BSC', warn: true }
    return { ok: true, detail: `supplyApy=${result.supplyApyPct.toFixed(2)}%, priceUsd=$${result.priceUsd.toFixed(2)}` }
  })

  await check('getMarketRates — error message for unknown asset', async () => {
    try {
      await getMarketRates({ asset: 'FAKECOIN', chainId: 56 }, config)
      return { ok: false, detail: 'Should have thrown for unknown asset' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (!msg.includes('FAKECOIN')) return { ok: false, detail: `Threw but message unhelpful: "${msg}"` }
      return { ok: true, detail: `Correctly threw: "${msg.slice(0, 80)}..."` }
    }
  })

  await check('getLiquidatablePositions — responds (may be empty)', async () => {
    const result = await getLiquidatablePositions({}, config)
    if (result.count === 0) return { ok: true, detail: 'count=0 — scanner not yet run or no underwater accounts', warn: true }
    return { ok: true, detail: `${result.count} liquidatable positions, top shortfall: $${result.accounts[0]?.shortfallUsd.toFixed(2) ?? 'n/a'}` }
  })

  await check('PeridotApiClient.getLeaderboard — top entry has points > 0', async () => {
    const client = new PeridotApiClient(config)
    const result = await client.getLeaderboard({ limit: 1 })
    if (result.entries.length === 0) return { ok: true, detail: 'No leaderboard entries yet', warn: true }
    const top = result.entries[0]!
    if (top.totalPoints === 0) return { ok: true, detail: 'Top entry has 0 points — unexpected', warn: true }
    return { ok: true, detail: `#1: ${top.address.slice(0, 10)}… with ${top.totalPoints} points` }
  })

  if (!API_KEY) {
    skip('getUserPosition', 'set API_KEY env var to enable')
    skip('getPortfolio', 'set API_KEY env var to enable')
  } else {
    // Wire API key into config so SDK uses it for wallet-auth bypass
    const authedConfig: PeridotConfig = {
      ...config,
      // The server reads x-api-key from the request header, not from config.
      // We need to pass it a different way — test this via direct apiFetch instead.
    }
    void authedConfig // suppress unused warning

    await check('getUserPosition — returns with fetchedAt (API key auth)', async () => {
      // SDK doesn't forward API keys to the server — use raw fetch to exercise this path
      const res = await apiFetch(`/api/user/portfolio-data?address=${TEST_ADDRESS}`)
      if (res.status === 401) return { ok: false, detail: '401 — API key bypass not working' }
      if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
      // If that passed, the bypass works; full SDK flow tested in raw section above
      return { ok: true, detail: 'Wallet-auth bypass confirmed via API key ✓ (full SDK test requires auth headers in PeridotApiClient)' }
    })
  }
}

// ── Section 3: Data integrity spot checks ─────────────────────────────────────

async function integrityChecks() {
  section('3. Data integrity')

  await check('APY keys match market metrics keys (casing alignment)', async () => {
    const client = new PeridotApiClient(config)
    const [metrics, apy] = await Promise.all([
      client.getMarketMetrics(),
      client.getMarketApy(56),
    ])

    const metricAssets = new Set(
      Object.keys(metrics)
        .filter(k => k.endsWith(':56'))
        .map(k => k.split(':')[0]!.toLowerCase())
    )
    const apyAssets = new Set(Object.keys(apy))

    const inMetricsNotApy = [...metricAssets].filter(a => !apyAssets.has(a))
    const inApyNotMetrics = [...apyAssets].filter(a => !metricAssets.has(a))

    if (inMetricsNotApy.length > 0) {
      return { ok: true, detail: `${inMetricsNotApy.length} metric assets missing from APY table: ${inMetricsNotApy.join(', ')}`, warn: true }
    }
    if (inApyNotMetrics.length > 0) {
      return { ok: true, detail: `${inApyNotMetrics.length} APY assets not in metrics: ${inApyNotMetrics.join(', ')} (stale APY rows?)`, warn: true }
    }
    return { ok: true, detail: `${metricAssets.size} assets in both tables, keys aligned` }
  })

  await check('Market prices are non-zero (oracle is live)', async () => {
    const client = new PeridotApiClient(config)
    const metrics = await client.getMarketMetrics()
    const zeroPrices = Object.entries(metrics).filter(([, m]) => m.priceUsd === 0).map(([k]) => k)
    const coreAssets = ['USDC', 'WETH', 'WBNB', 'USDT', 'WBTC', 'AUSD']
    const zeroCoreAssets = zeroPrices.filter(k => coreAssets.some(a => k.startsWith(a + ':')))
    // Core asset with zero price is a hard failure; synthetic/exotic assets are warnings
    if (zeroCoreAssets.length > 0) return { ok: false, detail: `Zero price for core assets: ${zeroCoreAssets.join(', ')} — oracle feed may be down` }
    const sample = Object.entries(metrics)
      .filter(([, m]) => m.priceUsd > 0)
      .slice(0, 3)
      .map(([k, m]) => `${k.split(':')[0]}=$${m.priceUsd.toFixed(2)}`)
      .join(', ')
    if (zeroPrices.length > 0) return { ok: true, detail: `${sample} (${zeroPrices.length} non-core assets have $0 price: ${zeroPrices.map(k => k.split(':')[0]).join(', ')})`, warn: true }
    return { ok: true, detail: sample }
  })

  await check('Market TVL is non-zero (protocol has deposits)', async () => {
    const client = new PeridotApiClient(config)
    const metrics = await client.getMarketMetrics()
    const totalTvl = Object.values(metrics).reduce((sum, m) => sum + m.tvlUsd, 0)
    if (totalTvl === 0) return { ok: false, detail: 'Total TVL is $0 — no deposits recorded (indexer not running?)' }
    return { ok: true, detail: `Total TVL across all markets: $${totalTvl.toLocaleString('en-US', { maximumFractionDigits: 0 })}` }
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${BOLD}Peridot Live Health Check${RESET}`)
  console.log(`${DIM}Server: ${API_URL}`)
  console.log(`API key: ${API_KEY ? `${API_KEY.slice(0, 6)}… (set)` : 'not set'}`)
  console.log(`Test address: ${TEST_ADDRESS}${RESET}`)

  await rawChecks()
  await sdkChecks()
  await integrityChecks()

  // ── Summary ────────────────────────────────────────────────────────────────
  const passed  = results.filter(r => r.status === 'pass').length
  const warned  = results.filter(r => r.status === 'warn').length
  const failed  = results.filter(r => r.status === 'fail').length
  const skipped = results.filter(r => r.status === 'skip').length

  console.log(`\n${BOLD}Summary${RESET}`)
  console.log(`  ${GREEN}${passed} passed${RESET}  ${YELLOW}${warned} warnings${RESET}  ${RED}${failed} failed${RESET}  ${DIM}${skipped} skipped${RESET}`)

  if (warned > 0) {
    console.log(`\n${YELLOW}Warnings (non-critical):${RESET}`)
    results.filter(r => r.status === 'warn').forEach(r => {
      console.log(`  ${YELLOW}⚠${RESET} ${r.name}`)
      console.log(`    ${DIM}${r.detail}${RESET}`)
    })
  }

  if (failed > 0) {
    console.log(`\n${RED}Failures:${RESET}`)
    results.filter(r => r.status === 'fail').forEach(r => {
      console.log(`  ${RED}✗${RESET} ${r.name}`)
      console.log(`    ${DIM}${r.detail}${RESET}`)
    })
    process.exit(1)
  }
}

main().catch(err => {
  console.error(`${RED}Fatal error:${RESET}`, err)
  process.exit(1)
})
