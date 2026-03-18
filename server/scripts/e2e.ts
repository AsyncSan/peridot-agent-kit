/**
 * E2E test script for peridot-mcp-server.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm e2e
 *
 * What it does:
 *   1. Spawns the server as a child process on a random port
 *   2. Polls /health until the server is ready (or times out)
 *   3. Runs a suite of HTTP assertions against every endpoint
 *   4. Kills the server and exits 0 (all pass) or 1 (any failure)
 */

import { spawn, type ChildProcess } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { privateKeyToAccount } from 'viem/accounts'
import { buildAuthMessage } from '../src/middleware/wallet-auth'

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = 13001 // use non-default port so tests never clash with a running dev server
const BASE = `http://localhost:${PORT}`
const READY_TIMEOUT_MS = 15_000
const READY_POLL_MS = 200

// Hardhat/Foundry account #0 — a universally known test private key with no
// real funds. Used only to generate valid EIP-191 signatures in e2e tests.
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY)
const VALID_ADDRESS = TEST_ACCOUNT.address  // 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

/** Generate a fresh {signature, timestamp} pair signed by the test account. */
async function signPortfolioAccess(address: string): Promise<{ sig: string; ts: number }> {
  const ts = Math.floor(Date.now() / 1000)
  const message = buildAuthMessage(address, ts)
  const sig = await TEST_ACCOUNT.signMessage({ message })
  return { sig, ts }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type TestResult = { name: string; ok: boolean; detail?: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`)
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = await res.text()
  }
  return { status: res.status, body }
}

function assert(name: string, pass: boolean, detail?: string): TestResult {
  return { name, ok: pass, detail: pass ? undefined : detail }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v) && !isNaN(v)
}

/** Asserts every value in `obj` satisfies `pred`. Returns the first failing key or null. */
function findInvalidField(
  obj: Record<string, unknown>,
  pred: (v: unknown, key: string) => boolean,
): string | null {
  for (const [k, v] of Object.entries(obj)) {
    if (!pred(v, k)) return `${k}=${JSON.stringify(v)}`
  }
  return null
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

function startServer(): ChildProcess {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const entry = join(__dirname, '..', 'src', 'index.ts')

  const child = spawn(
    'npx',
    ['tsx', entry],
    {
      env: {
        ...process.env,
        PORT: String(PORT),
        // Low RPM so the burst test can trigger 429 with only ~35 requests,
        // but high enough not to interfere with the ~10 legitimate API calls.
        RATE_LIMIT_RPM: '30',
        RATE_LIMIT_WINDOW_MS: '60000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  // Forward server stdout/stderr with a prefix so it's easy to distinguish
  child.stdout?.on('data', (d: Buffer) => process.stdout.write(`  [server] ${d}`))
  child.stderr?.on('data', (d: Buffer) => process.stderr.write(`  [server] ${d}`))

  return child
}

async function waitForReady(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) return true
    } catch {
      // server not up yet
    }
    await new Promise<void>((r) => setTimeout(r, READY_POLL_MS))
  }
  return false
}

// ── Test suite ────────────────────────────────────────────────────────────────

async function runSuite(): Promise<TestResult[]> {
  const results: TestResult[] = []

  // ── /health ────────────────────────────────────────────────────────────────
  {
    const { status, body } = await get('/health')
    results.push(assert('/health → 200', status === 200, `got ${status}`))
    results.push(assert('/health → ok: true', isObj(body) && body['ok'] === true, `body: ${JSON.stringify(body)}`))
    results.push(assert('/health → ts is number', isObj(body) && typeof body['ts'] === 'number', `body: ${JSON.stringify(body)}`))
    // ts should be within 5 seconds of now (not a stale cached value, not in the future)
    if (isObj(body) && typeof body['ts'] === 'number') {
      const drift = Math.abs(Date.now() - body['ts'])
      results.push(assert('/health → ts is close to now', drift < 5_000, `drift ${drift}ms`))
    }
  }

  // ── 404 on unknown route ───────────────────────────────────────────────────
  {
    const { status, body } = await get('/not-a-real-route')
    results.push(assert('unknown route → 404', status === 404, `got ${status}`))
    results.push(assert('unknown route → ok: false', isObj(body) && body['ok'] === false))
  }

  // ── /api/markets/metrics ──────────────────────────────────────────────────
  {
    const { status, body } = await get('/api/markets/metrics')
    results.push(assert('/api/markets/metrics → status 200 or 500', status === 200 || status === 500, `got ${status}`))

    if (status === 200) {
      results.push(assert('/api/markets/metrics → ok: true', isObj(body) && body['ok'] === true))
      const data = isObj(body) ? body['data'] : null
      results.push(assert('/api/markets/metrics → data is object', isObj(data)))

      if (isObj(data)) {
        const entries = Object.entries(data)

        // Should have at least one market in a live environment
        results.push(assert('/api/markets/metrics → at least one entry', entries.length > 0,
          'data is empty — no markets found'))

        // Keys must be in "ASSET:chainId" format — asset ID is uppercase alphanumeric
        // with optional hyphens (e.g. "USDC:56", "MORPHO-BOOSTED-AUSD:143", "XLM-STELLAR:56456")
        const badKey = entries.find(([k]) => !/^[A-Z0-9][A-Z0-9-]*:\d+$/.test(k))
        results.push(assert('/api/markets/metrics → keys are "ASSET:chainId" format',
          badKey === undefined, `bad key: ${badKey?.[0]}`))

        // Simple (non-hyphenated) assets must have a live price — catches a broken price oracle
        const simpleEntries = entries.filter(([k]) => !k.includes('-'))
        const hasPricedAsset = simpleEntries.some(([, v]) => isObj(v) && isFiniteNum(v['priceUsd']) && v['priceUsd'] > 0)
        results.push(assert('/api/markets/metrics → at least one simple asset has priceUsd > 0',
          hasPricedAsset, 'all simple assets have priceUsd ≤ 0 — price oracle may be broken'))

        // Validate every entry's numeric fields
        for (const [key, raw] of entries) {
          if (!isObj(raw)) continue

          // LP/vault tokens (hyphens in asset ID) may have priceUsd=0 when the oracle
          // doesn't price them directly (e.g. PANCAKE-AUSD-USDC LP token). Allow >= 0.
          results.push(assert(`metrics[${key}] → priceUsd is finite ≥ 0`,
            isFiniteNum(raw['priceUsd']) && raw['priceUsd'] >= 0,
            `priceUsd=${raw['priceUsd']}`))

          results.push(assert(`metrics[${key}] → tvlUsd is finite ≥ 0`,
            isFiniteNum(raw['tvlUsd']) && raw['tvlUsd'] >= 0,
            `tvlUsd=${raw['tvlUsd']}`))

          results.push(assert(`metrics[${key}] → utilizationPct in [0, 100]`,
            isFiniteNum(raw['utilizationPct']) && raw['utilizationPct'] >= 0 && raw['utilizationPct'] <= 100,
            `utilizationPct=${raw['utilizationPct']}`))

          results.push(assert(`metrics[${key}] → collateral_factor_pct in [0, 1]`,
            isFiniteNum(raw['collateral_factor_pct']) && raw['collateral_factor_pct'] >= 0 && raw['collateral_factor_pct'] <= 1,
            `collateral_factor_pct=${raw['collateral_factor_pct']}`))

          results.push(assert(`metrics[${key}] → chainId is positive integer`,
            isFiniteNum(raw['chainId']) && Number.isInteger(raw['chainId']) && raw['chainId'] > 0,
            `chainId=${raw['chainId']}`))

          results.push(assert(`metrics[${key}] → updatedAt is a valid ISO date`,
            typeof raw['updatedAt'] === 'string' && !isNaN(Date.parse(raw['updatedAt'])),
            `updatedAt=${raw['updatedAt']}`))
        }
      }
    } else {
      results.push(assert('/api/markets/metrics (500) → ok: false', isObj(body) && body['ok'] === false))
    }
  }

  // ── /api/apy (no filter) ──────────────────────────────────────────────────
  {
    const { status, body } = await get('/api/apy')
    results.push(assert('/api/apy → status 200 or 500', status === 200 || status === 500, `got ${status}`))

    if (status === 200) {
      results.push(assert('/api/apy → ok: true', isObj(body) && body['ok'] === true))
      const data = isObj(body) ? body['data'] : null
      results.push(assert('/api/apy → data is object', isObj(data)))

      if (isObj(data)) {
        const assets = Object.entries(data)

        results.push(assert('/api/apy → at least one asset', assets.length > 0, 'no assets returned'))

        for (const [assetId, chainMap] of assets) {
          if (!isObj(chainMap)) continue

          const chains = Object.entries(chainMap)
          results.push(assert(`apy[${assetId}] → has at least one chain entry`, chains.length > 0))

          for (const [chainId, entry] of chains) {
            if (!isObj(entry)) continue
            const label = `apy[${assetId}][${chainId}]`

            // All APY fields must be finite numbers
            const numFields = ['supplyApy', 'borrowApy', 'totalSupplyApy', 'netBorrowApy',
              'peridotSupplyApy', 'peridotBorrowApy'] as const
            const badField = findInvalidField(
              Object.fromEntries(numFields.map(f => [f, entry[f]])),
              (v) => isFiniteNum(v),
            )
            results.push(assert(`${label} → all APY fields are finite numbers`,
              badField === null, `non-finite: ${badField}`))

            // Supply APY must be non-negative (can't have negative supply yield)
            results.push(assert(`${label} → supplyApy ≥ 0`,
              isFiniteNum(entry['supplyApy']) && entry['supplyApy'] >= 0,
              `supplyApy=${entry['supplyApy']}`))

            // Borrow APY must be non-negative (cost to borrowers)
            results.push(assert(`${label} → borrowApy ≥ 0`,
              isFiniteNum(entry['borrowApy']) && entry['borrowApy'] >= 0,
              `borrowApy=${entry['borrowApy']}`))

            // Sanity: totalSupplyApy should be ≥ base supplyApy (boosted, not reduced)
            results.push(assert(`${label} → totalSupplyApy ≥ supplyApy`,
              isFiniteNum(entry['totalSupplyApy']) && isFiniteNum(entry['supplyApy']) &&
              entry['totalSupplyApy'] >= entry['supplyApy'] - 0.001, // float tolerance
              `totalSupplyApy=${entry['totalSupplyApy']} < supplyApy=${entry['supplyApy']}`))
          }
        }
      }
    } else {
      results.push(assert('/api/apy (500) → ok: false', isObj(body) && body['ok'] === false))
    }
  }

  // ── /api/apy?chainId=56 — filtered results only contain BSC data ──────────
  {
    const { status, body } = await get('/api/apy?chainId=56')
    results.push(assert('/api/apy?chainId=56 → status 200 or 500', status === 200 || status === 500, `got ${status}`))

    if (status === 200) {
      results.push(assert('/api/apy?chainId=56 → ok: true', isObj(body) && body['ok'] === true))
      const data = isObj(body) ? body['data'] : null

      if (isObj(data)) {
        // Every chain entry inside each asset must be chain 56 only
        let foundNonBsc = false
        for (const chainMap of Object.values(data)) {
          if (!isObj(chainMap)) continue
          for (const chainId of Object.keys(chainMap)) {
            if (Number(chainId) !== 56) { foundNonBsc = true; break }
          }
        }
        results.push(assert('/api/apy?chainId=56 → only chain 56 entries returned',
          !foundNonBsc, 'found entries with chainId ≠ 56'))
      }
    }
  }

  // ── /api/user/portfolio-data — auth: missing address (no auth needed) ──────
  {
    const { status, body } = await get('/api/user/portfolio-data')
    results.push(assert('portfolio-data (no address) → 400', status === 400, `got ${status}`))
    results.push(assert('portfolio-data (no address) → ok: false', isObj(body) && body['ok'] === false))
    results.push(assert('portfolio-data (no address) → error contains "Missing"',
      isObj(body) && typeof body['error'] === 'string' && body['error'].includes('Missing'),
      `error: ${isObj(body) ? body['error'] : body}`))
  }

  // ── /api/user/portfolio-data — auth: address present, no headers → 401 ────
  // Any request with ?address must be authenticated. The middleware rejects
  // before the route even runs, so bad address formats also get 401 (not 400)
  // — you prove identity before we hint at what's wrong with the address.
  {
    const res = await fetch(`${BASE}/api/user/portfolio-data?address=${VALID_ADDRESS}`)
    results.push(assert('portfolio-data (no auth headers) → 401', res.status === 401, `got ${res.status}`))
    const body = await res.json().catch(() => null)
    results.push(assert('portfolio-data (no auth headers) → ok: false',
      isObj(body) && body['ok'] === false))
  }

  // ── /api/user/portfolio-data — auth: expired timestamp → 401 ───────────
  {
    const expiredTs = Math.floor(Date.now() / 1000) - 400  // 400s ago > 300s window
    const expiredMsg = buildAuthMessage(VALID_ADDRESS, expiredTs)
    const expiredSig = await TEST_ACCOUNT.signMessage({ message: expiredMsg })
    const res = await fetch(`${BASE}/api/user/portfolio-data?address=${VALID_ADDRESS}`, {
      headers: { 'x-wallet-signature': expiredSig, 'x-wallet-timestamp': String(expiredTs) },
    })
    results.push(assert('portfolio-data (expired timestamp) → 401', res.status === 401, `got ${res.status}`))
    const body = await res.json().catch(() => null)
    results.push(assert('portfolio-data (expired) → error mentions "expired"',
      isObj(body) && typeof body['error'] === 'string' && body['error'].toLowerCase().includes('expired')))
  }

  // ── /api/user/portfolio-data — auth: wrong signer → 401 ─────────────────
  {
    // Sign for a different address than the one in ?address
    const otherAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
    const { sig, ts } = await signPortfolioAccess(otherAddress)
    const res = await fetch(`${BASE}/api/user/portfolio-data?address=${VALID_ADDRESS}`, {
      headers: { 'x-wallet-signature': sig, 'x-wallet-timestamp': String(ts) },
    })
    results.push(assert('portfolio-data (wrong signer) → 401', res.status === 401, `got ${res.status}`))
  }

  // ── /api/user/portfolio-data — valid address + valid signature ────────────
  {
    const { sig, ts } = await signPortfolioAccess(VALID_ADDRESS)
    const { status, body } = await (async () => {
      const res = await fetch(`${BASE}/api/user/portfolio-data?address=${VALID_ADDRESS}`, {
        headers: { 'x-wallet-signature': sig, 'x-wallet-timestamp': String(ts) },
      })
      let b: unknown
      try { b = await res.json() } catch { b = await res.text() }
      return { status: res.status, body: b }
    })()

    results.push(assert('portfolio-data (valid auth) → status 200 or 500',
      status === 200 || status === 500, `got ${status}`))

    if (status === 200) {
      results.push(assert('portfolio-data (valid address) → ok: true', isObj(body) && body['ok'] === true))
      const data = isObj(body) ? (body['data'] as Record<string, unknown>) : null

      if (isObj(data)) {
        const portfolio = isObj(data['portfolio']) ? data['portfolio'] : null
        const assets = Array.isArray(data['assets']) ? data['assets'] : null
        const txns = isObj(data['transactions']) ? data['transactions'] : null
        const earnings = isObj(data['earnings']) ? data['earnings'] : null

        results.push(assert('portfolio → portfolio block exists', portfolio !== null))
        results.push(assert('portfolio → assets is array', assets !== null))
        results.push(assert('portfolio → transactions block exists', txns !== null))
        results.push(assert('portfolio → earnings block exists', earnings !== null))

        // portfolio field types and ranges
        if (portfolio) {
          results.push(assert('portfolio.currentValue is finite',
            isFiniteNum(portfolio['currentValue']), `got ${portfolio['currentValue']}`))

          results.push(assert('portfolio.totalSupplied is finite ≥ 0',
            isFiniteNum(portfolio['totalSupplied']) && portfolio['totalSupplied'] >= 0,
            `got ${portfolio['totalSupplied']}`))

          results.push(assert('portfolio.totalBorrowed is finite ≥ 0',
            isFiniteNum(portfolio['totalBorrowed']) && portfolio['totalBorrowed'] >= 0,
            `got ${portfolio['totalBorrowed']}`))

          results.push(assert('portfolio.netApy is finite',
            isFiniteNum(portfolio['netApy']), `got ${portfolio['netApy']}`))

          results.push(assert('portfolio.healthFactor is finite ≥ 0',
            isFiniteNum(portfolio['healthFactor']) && portfolio['healthFactor'] >= 0,
            `got ${portfolio['healthFactor']}`))

          // accounting identity: currentValue = totalSupplied - totalBorrowed
          if (isFiniteNum(portfolio['currentValue']) &&
              isFiniteNum(portfolio['totalSupplied']) &&
              isFiniteNum(portfolio['totalBorrowed'])) {
            const expected = portfolio['totalSupplied'] - portfolio['totalBorrowed']
            const delta = Math.abs(portfolio['currentValue'] - expected)
            results.push(assert('portfolio.currentValue = totalSupplied − totalBorrowed',
              delta < 0.01, `currentValue=${portfolio['currentValue']} expected≈${expected.toFixed(4)}`))
          }

          // when no debt, healthFactor should be 0 (sentinel for "no borrow")
          if (isFiniteNum(portfolio['totalBorrowed']) && portfolio['totalBorrowed'] === 0) {
            results.push(assert('portfolio.healthFactor = 0 when no debt',
              portfolio['healthFactor'] === 0, `got ${portfolio['healthFactor']}`))
          }
        }

        // assets array item shapes
        if (assets) {
          for (let i = 0; i < assets.length; i++) {
            const a = assets[i] as Record<string, unknown>
            results.push(assert(`assets[${i}].assetId is non-empty string`,
              typeof a['assetId'] === 'string' && a['assetId'].length > 0,
              `assetId=${a['assetId']}`))
            results.push(assert(`assets[${i}].supplied is finite ≥ 0`,
              isFiniteNum(a['supplied']) && a['supplied'] >= 0, `supplied=${a['supplied']}`))
            results.push(assert(`assets[${i}].borrowed is finite ≥ 0`,
              isFiniteNum(a['borrowed']) && a['borrowed'] >= 0, `borrowed=${a['borrowed']}`))
            results.push(assert(`assets[${i}].net = supplied − borrowed`,
              isFiniteNum(a['net']) && isFiniteNum(a['supplied']) && isFiniteNum(a['borrowed']) &&
              Math.abs((a['net'] as number) - ((a['supplied'] as number) - (a['borrowed'] as number))) < 0.01,
              `net=${a['net']} supplied=${a['supplied']} borrowed=${a['borrowed']}`))
          }
        }

        // transactions counts are non-negative integers
        if (txns) {
          const countFields = ['totalCount', 'supplyCount', 'borrowCount', 'repayCount', 'redeemCount']
          for (const f of countFields) {
            results.push(assert(`transactions.${f} is integer ≥ 0`,
              isFiniteNum(txns[f]) && Number.isInteger(txns[f]) && (txns[f] as number) >= 0,
              `${f}=${txns[f]}`))
          }
          // totalCount should be ≥ sum of individual counts (some types overlap via cross-chain_ prefix)
          if (countFields.every(f => isFiniteNum(txns[f]))) {
            const subSum = (txns['supplyCount'] as number) + (txns['borrowCount'] as number) +
              (txns['repayCount'] as number) + (txns['redeemCount'] as number)
            results.push(assert('transactions.totalCount ≥ sum of sub-counts',
              (txns['totalCount'] as number) >= subSum,
              `totalCount=${txns['totalCount']} subSum=${subSum}`))
          }
        }

        // earnings
        if (earnings) {
          results.push(assert('earnings.effectiveApy is finite',
            isFiniteNum(earnings['effectiveApy']), `got ${earnings['effectiveApy']}`))
          results.push(assert('earnings.totalLifetimeEarnings is finite ≥ 0',
            isFiniteNum(earnings['totalLifetimeEarnings']) && (earnings['totalLifetimeEarnings'] as number) >= 0,
            `got ${earnings['totalLifetimeEarnings']}`))
        }
      }
    }
  }

  // ── /metrics ──────────────────────────────────────────────────────────────
  {
    const { status, body } = await get('/metrics')
    results.push(assert('/metrics → 200', status === 200, `got ${status}`))
    results.push(assert('/metrics → ok: true', isObj(body) && body['ok'] === true))

    const data = isObj(body) ? body['data'] : null
    results.push(assert('/metrics → data is object', isObj(data)))

    if (isObj(data)) {
      results.push(assert('/metrics → uptime_seconds is non-negative integer',
        isFiniteNum(data['uptime_seconds']) && Number.isInteger(data['uptime_seconds']) &&
        (data['uptime_seconds'] as number) >= 0,
        `got ${data['uptime_seconds']}`))

      results.push(assert('/metrics → requests_total is non-negative integer',
        isFiniteNum(data['requests_total']) && Number.isInteger(data['requests_total']) &&
        (data['requests_total'] as number) >= 0,
        `got ${data['requests_total']}`))

      results.push(assert('/metrics → errors_4xx_total is non-negative integer',
        isFiniteNum(data['errors_4xx_total']) && Number.isInteger(data['errors_4xx_total']) &&
        (data['errors_4xx_total'] as number) >= 0,
        `got ${data['errors_4xx_total']}`))

      results.push(assert('/metrics → errors_5xx_total is non-negative integer',
        isFiniteNum(data['errors_5xx_total']) && Number.isInteger(data['errors_5xx_total']) &&
        (data['errors_5xx_total'] as number) >= 0,
        `got ${data['errors_5xx_total']}`))

      const mem = isObj(data['memory']) ? data['memory'] : null
      results.push(assert('/metrics → memory block present', mem !== null))
      if (mem) {
        results.push(assert('/metrics → memory.rss_mb > 0',
          isFiniteNum(mem['rss_mb']) && (mem['rss_mb'] as number) > 0,
          `rss_mb=${mem['rss_mb']}`))
        results.push(assert('/metrics → memory.heap_total_mb ≥ heap_used_mb',
          isFiniteNum(mem['heap_total_mb']) && isFiniteNum(mem['heap_used_mb']) &&
          (mem['heap_total_mb'] as number) >= (mem['heap_used_mb'] as number),
          `heap_total=${mem['heap_total_mb']} heap_used=${mem['heap_used_mb']}`))
      }

      results.push(assert('/metrics → routes is object', typeof data['routes'] === 'object' && data['routes'] !== null))
    }
  }

  // Check Cache-Control: no-store on /metrics
  {
    const res = await fetch(`${BASE}/metrics`)
    results.push(assert('/metrics → Cache-Control: no-store',
      res.headers.get('cache-control') === 'no-store',
      `got: ${res.headers.get('cache-control')}`))
  }

  // ── /api/leaderboard ──────────────────────────────────────────────────────
  {
    const { status, body } = await get('/api/leaderboard')
    results.push(assert('/api/leaderboard → status 200 or 500', status === 200 || status === 500, `got ${status}`))

    if (status === 200) {
      results.push(assert('/api/leaderboard → ok: true', isObj(body) && body['ok'] === true))
      const data = isObj(body) ? body['data'] : null
      results.push(assert('/api/leaderboard → data is object', isObj(data)))

      if (isObj(data)) {
        results.push(assert('/api/leaderboard → entries is array',
          Array.isArray(data['entries'])))
        results.push(assert('/api/leaderboard → total is non-negative integer',
          isFiniteNum(data['total']) && Number.isInteger(data['total']) &&
          (data['total'] as number) >= 0,
          `total=${data['total']}`))

        const entries = Array.isArray(data['entries']) ? data['entries'] as Record<string, unknown>[] : []
        for (let i = 0; i < Math.min(entries.length, 3); i++) {
          const e = entries[i]
          results.push(assert(`leaderboard[${i}] → rank is positive integer`,
            isFiniteNum(e['rank']) && Number.isInteger(e['rank']) && (e['rank'] as number) > 0,
            `rank=${e['rank']}`))
          results.push(assert(`leaderboard[${i}] → address is non-empty string`,
            typeof e['address'] === 'string' && (e['address'] as string).length > 0))
          results.push(assert(`leaderboard[${i}] → totalPoints is finite ≥ 0`,
            isFiniteNum(e['totalPoints']) && (e['totalPoints'] as number) >= 0))
          results.push(assert(`leaderboard[${i}] → supplyCount is finite ≥ 0`,
            isFiniteNum(e['supplyCount']) && (e['supplyCount'] as number) >= 0))
          results.push(assert(`leaderboard[${i}] → borrowCount is finite ≥ 0`,
            isFiniteNum(e['borrowCount']) && (e['borrowCount'] as number) >= 0))
          results.push(assert(`leaderboard[${i}] → repayCount is finite ≥ 0`,
            isFiniteNum(e['repayCount']) && (e['repayCount'] as number) >= 0))
          results.push(assert(`leaderboard[${i}] → redeemCount is finite ≥ 0`,
            isFiniteNum(e['redeemCount']) && (e['redeemCount'] as number) >= 0))
          results.push(assert(`leaderboard[${i}] → updatedAt is valid ISO date`,
            typeof e['updatedAt'] === 'string' && !isNaN(Date.parse(e['updatedAt'] as string)),
            `updatedAt=${e['updatedAt']}`))
        }
      }
    } else {
      results.push(assert('/api/leaderboard (500) → ok: false', isObj(body) && body['ok'] === false))
    }
  }

  // Validate leaderboard query params
  {
    const { status: s400 } = await get('/api/leaderboard?limit=abc')
    results.push(assert('/api/leaderboard?limit=abc → 400', s400 === 400, `got ${s400}`))

    const { status: s400c } = await get('/api/leaderboard?chainId=bsc')
    results.push(assert('/api/leaderboard?chainId=bsc → 400', s400c === 400, `got ${s400c}`))

    // Valid limit and chainId should not error
    const { status: s200 } = await get('/api/leaderboard?limit=10&chainId=56')
    results.push(assert('/api/leaderboard?limit=10&chainId=56 → 200 or 500',
      s200 === 200 || s200 === 500, `got ${s200}`))
  }

  // ── CORS header present on API routes ─────────────────────────────────────
  {
    const res = await fetch(`${BASE}/api/apy`)
    const origin = res.headers.get('access-control-allow-origin')
    results.push(assert('CORS header present on /api/apy', origin !== null, 'access-control-allow-origin missing'))
  }

  // ── Security headers ───────────────────────────────────────────────────────
  {
    const res = await fetch(`${BASE}/health`)
    results.push(assert('x-content-type-options header present',
      res.headers.has('x-content-type-options')))
    results.push(assert('x-frame-options header present',
      res.headers.has('x-frame-options')))
  }

  // ── Deep health check ──────────────────────────────────────────────────────
  {
    const { status, body } = await get('/health/db')
    // 200 if DB reachable, 503 if not — both are valid server behaviours in e2e
    results.push(assert('/health/db → status 200 or 503', status === 200 || status === 503, `got ${status}`))
    results.push(assert('/health/db → ok field is boolean', isObj(body) && typeof body['ok'] === 'boolean'))
    results.push(assert('/health/db → db field present', isObj(body) && typeof body['db'] === 'string'))

    if (status === 200) {
      results.push(assert('/health/db → ok: true when up', isObj(body) && body['ok'] === true))
      results.push(assert('/health/db → db: "up" when up', isObj(body) && body['db'] === 'up'))
      results.push(assert('/health/db → latencyMs is finite ≥ 0',
        isObj(body) && isFiniteNum(body['latencyMs']) && (body['latencyMs'] as number) >= 0,
        `latencyMs=${isObj(body) ? body['latencyMs'] : '?'}`))
    } else {
      results.push(assert('/health/db → ok: false when down', isObj(body) && body['ok'] === false))
      results.push(assert('/health/db → db: "down" when down', isObj(body) && body['db'] === 'down'))
      results.push(assert('/health/db → error string present', isObj(body) && typeof body['error'] === 'string'))
    }
  }

  // ── Request ID header ──────────────────────────────────────────────────────
  {
    // Every response must include x-request-id
    for (const path of ['/health', '/api/apy', '/api/markets/metrics']) {
      const res = await fetch(`${BASE}${path}`)
      results.push(assert(`${path} → x-request-id header present`,
        res.headers.has('x-request-id'), 'x-request-id header missing'))
    }

    // When client sends x-request-id, server echoes the same value back
    const clientId = 'e2e-trace-abc123'
    const echoRes = await fetch(`${BASE}/api/apy`, {
      headers: { 'x-request-id': clientId },
    })
    results.push(assert('request-id: provided ID is echoed in response header',
      echoRes.headers.get('x-request-id') === clientId,
      `got: ${echoRes.headers.get('x-request-id')}`))

    // When client sends no x-request-id, server generates one (8-char lowercase hex)
    const genRes = await fetch(`${BASE}/api/apy`)
    const generatedId = genRes.headers.get('x-request-id') ?? ''
    results.push(assert('request-id: server generates 8-char hex when not provided',
      /^[0-9a-f]{8}$/.test(generatedId),
      `got: ${generatedId}`))

    // Two requests without a client-supplied ID must get different IDs
    const genRes2 = await fetch(`${BASE}/api/apy`)
    const id2 = genRes2.headers.get('x-request-id') ?? ''
    results.push(assert('request-id: each auto-generated ID is unique',
      generatedId !== id2,
      `both requests returned '${generatedId}'`))
  }

  // ── Item 3: JSON logger (middleware chain observable via x-request-id) ─────
  // Full NDJSON format is verified by unit tests (src/middleware/__tests__/logger.test.ts).
  // In e2e we verify the middleware stack is wired end-to-end: a provided
  // x-request-id propagates requestId() → context → jsonLogger() → response header.
  {
    const reqId = 'e2e-logger-verify'
    const res = await fetch(`${BASE}/api/apy`, {
      headers: { 'x-request-id': reqId },
    })
    results.push(assert('jsonLogger: x-request-id propagated through full middleware chain',
      res.headers.get('x-request-id') === reqId,
      `got: ${res.headers.get('x-request-id')}`))
  }

  // ── Item 5: Env validation (startup gate) ──────────────────────────────────
  // loadEnv() is called before the server binds to a port. If any required or
  // invalid env var caused it to throw, the server would never become ready —
  // meaning we would never reach this point in the suite.
  {
    const { status } = await get('/health')
    results.push(assert('env: server started cleanly — loadEnv() validation passed',
      status === 200, `got ${status}`))
  }

  // ── Rate limit headers on successful API responses ─────────────────────────
  {
    const res = await fetch(`${BASE}/api/apy`)
    results.push(assert('rate limit: X-RateLimit-Limit header present',
      res.headers.has('x-ratelimit-limit'), 'x-ratelimit-limit missing'))
    results.push(assert('rate limit: X-RateLimit-Remaining header present',
      res.headers.has('x-ratelimit-remaining'), 'x-ratelimit-remaining missing'))
    const limit = Number(res.headers.get('x-ratelimit-limit'))
    const remaining = Number(res.headers.get('x-ratelimit-remaining'))
    results.push(assert('rate limit: X-RateLimit-Limit is positive integer',
      Number.isInteger(limit) && limit > 0, `got ${limit}`))
    results.push(assert('rate limit: X-RateLimit-Remaining is non-negative integer',
      Number.isInteger(remaining) && remaining >= 0, `got ${remaining}`))
    results.push(assert('rate limit: remaining ≤ limit',
      remaining <= limit, `remaining=${remaining} limit=${limit}`))
  }

  // ── Rate limit 429 behaviour (burst test — runs last to avoid polluting other tests) ──
  // The server is started with RATE_LIMIT_RPM=30. By the time we reach here,
  // roughly 10-15 requests have already been made. Fire 25 more in parallel —
  // at some point the window fills up and 429s must appear.
  {
    const burst = await Promise.all(
      Array.from({ length: 25 }, () => fetch(`${BASE}/api/apy`)),
    )
    const statuses = burst.map((r) => r.status)
    const hit429 = statuses.some((s) => s === 429)
    results.push(assert('rate limit: 429 triggered after burst of requests',
      hit429, `all ${statuses.length} burst requests returned ${[...new Set(statuses)].join('/')} — limit may be too high`))

    // Pick one 429 response and validate its shape
    const blocked = burst.find((r) => r.status === 429)
    if (blocked) {
      const body = await blocked.clone().json().catch(() => null)
      results.push(assert('rate limit: 429 body has ok: false',
        isObj(body) && body['ok'] === false))
      results.push(assert('rate limit: 429 body has error field',
        isObj(body) && typeof body['error'] === 'string'))
      results.push(assert('rate limit: Retry-After header present on 429',
        blocked.headers.has('retry-after'), 'retry-after header missing'))
      results.push(assert('rate limit: X-RateLimit-Remaining is 0 on 429',
        blocked.headers.get('x-ratelimit-remaining') === '0'))
      const retryAfter = Number(blocked.headers.get('retry-after'))
      results.push(assert('rate limit: Retry-After is a positive integer',
        Number.isInteger(retryAfter) && retryAfter > 0, `got ${retryAfter}`))
    }

    // Health endpoint must still respond even while API is rate-limited
    const healthDuringRateLimit = await fetch(`${BASE}/health`)
    results.push(assert('rate limit: /health still responds 200 when API is throttled',
      healthDuringRateLimit.status === 200, `got ${healthDuringRateLimit.status}`))
  }

  return results
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n╔══════════════════════════════════════════╗`)
  console.log(`║   peridot-mcp-server  e2e test suite     ║`)
  console.log(`╚══════════════════════════════════════════╝\n`)

  if (!process.env['DATABASE_URL']) {
    console.warn('⚠  DATABASE_URL not set — server will start but DB calls will fail (500s are expected)\n')
  }

  console.log(`▶ Starting server on port ${PORT}…`)
  const server = startServer()
  let exitCode = 0

  try {
    const ready = await waitForReady(READY_TIMEOUT_MS)
    if (!ready) {
      console.error(`✗ Server did not become ready within ${READY_TIMEOUT_MS}ms`)
      process.exit(1)
    }
    console.log('✓ Server is ready\n')

    console.log('▶ Running test suite…\n')
    const results = await runSuite()

    const passed = results.filter((r) => r.ok)
    const failed = results.filter((r) => !r.ok)

    for (const r of results) {
      const icon = r.ok ? '  ✓' : '  ✗'
      console.log(`${icon}  ${r.name}`)
      if (!r.ok && r.detail) console.log(`       ${r.detail}`)
    }

    console.log(`\n─────────────────────────────────────────`)
    console.log(`  ${passed.length} passed  /  ${failed.length} failed  /  ${results.length} total`)

    if (failed.length > 0) {
      console.log(`\n✗ ${failed.length} test(s) failed`)
      exitCode = 1
    } else {
      console.log(`\n✓ All tests passed`)
    }
  } finally {
    console.log('\n▶ Stopping server…')
    server.kill('SIGTERM')
    // give it a moment to flush
    await new Promise<void>((r) => setTimeout(r, 300))
    console.log('✓ Done\n')
  }

  process.exit(exitCode)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
