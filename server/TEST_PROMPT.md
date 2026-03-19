# Test-Writing Prompt — peridot-mcp-server

## Context

**Company:** Peridot Finance — a DeFi money-market protocol running on BSC (chain 56),
Monad (chain 143), and Stellar (chain 56456). The protocol lets users supply and borrow
crypto assets across chains via a unified lending hub.

**Product:** `@peridot-agent/agent-kit` is an open-source TypeScript SDK that lets AI agents
(LLM applications) interact with Peridot's lending markets. It performs read queries,
simulates transactions, and builds signed transaction intents — always returning calldata
for the user to sign, never holding private keys.

**This repo:** `peridot-mcp-server` is a standalone REST API server (Bun + Hono,
TypeScript) that `@peridot-agent/agent-kit` calls to fetch live market data from Peridot's
PostgreSQL database. It is the data backbone behind every AI agent action. Without it,
agents cannot see market rates, APY figures, or user portfolio positions.

**Intermediate goal:** Make `peridot-mcp-server` production-ready so it can be deployed
to DigitalOcean and serve `@peridot-agent/agent-kit` consumers in the wild. The six changes
listed below are all in-flight. Your job is to write the tests for them.

---

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Bun (production), Node.js + tsx (development) |
| Framework | Hono |
| Database | PostgreSQL via `postgres` npm package |
| Test runner | **Vitest** — already installed |
| Existing tests | `src/middleware/__tests__/rate-limit.test.ts`, `src/routes/__tests__/health.test.ts` |
| E2e suite | `scripts/e2e.ts` — spawns the real server and fires HTTP requests |

**Conventions already established in the codebase:**

- Unit tests live in `src/**/__tests__/*.test.ts`
- The db module (`src/db.ts`) is always mocked in unit tests:
  ```ts
  const mockSql = vi.fn()
  vi.mock('../../db', () => ({
    sql: Object.assign(mockSql, { end: vi.fn().mockResolvedValue(undefined) }),
  }))
  ```
- Routes are tested by mounting them on a bare `new Hono()` app and calling
  `app.request(path, { headers: {...} })` — no real HTTP server needed
- Each test uses a unique IP (incremented counter) to avoid cross-test state
  in the rate-limit window map
- `describe` / `it` / `expect` from vitest — no custom matchers needed

---

## Items to implement and test

The implementations below are written by the core team. You write the tests.

---

### 1 — Dockerfile fix (`Dockerfile`)

**Problem:** The Dockerfile uses `bun.lock*` as the lockfile glob, but the repo uses
`pnpm-lock.yaml`. When built in CI, `bun install --frozen-lockfile` finds no lockfile
and either fails or installs unpinned versions.

**Fix:** Remove `--frozen-lockfile` from the `bun install` step (Bun resolves versions
from `package.json`; exact pinning is handled by the build pipeline). The `COPY` line
becomes `COPY package.json ./`.

**What to test:**
- The Dockerfile `build` stage compiles `src/index.ts` to `dist/server.js` without error
- The built `server.js` exists in the runtime image and is executable by the `peridot` user
- The container responds to `GET /health` with `{ ok: true }` after `docker run`
- The container exits cleanly on `SIGTERM` (graceful shutdown)

> These are integration tests that require Docker. Write them as a shell-based test or
> a vitest test that shells out via `execa`. Skip gracefully if Docker is not available
> (`docker info` exit code ≠ 0).

---

### 2 — Fix silent error swallowing in `/api/markets/metrics` (`src/routes/markets.ts`)

**Problem:** `fetchMetrics()` wraps each table query in a try/catch that silently
discards errors and moves on. If all tables fail (DB is down), it returns
`{ ok: true, data: {} }` with HTTP 200 — the agent-kit receives an empty market list
and operates silently with no data, which is a correctness bug.

**Fix:** The inner try/catch stays (it handles the "table does not exist" case for the
testnet/mainnet table name fallback). But if **no rows were fetched from any table**
AND a DB error was thrown on every attempt, the function now throws, letting the outer
handler return `{ ok: false, error: 'failed_to_fetch_metrics' }` with HTTP 500.

Concretely, `fetchMetrics` tracks whether any table succeeded. If `data` is empty AND
every table threw, it re-throws the last error.

**What to test (unit — mock `sql`):**

| Scenario | Expected |
|---|---|
| DB returns rows from the first table | 200, `{ ok: true, data: { "USDC:56": {...} } }` |
| First table throws (not found), second returns rows | 200, data from the second table |
| Both tables throw with DB errors | 500, `{ ok: false, error: 'failed_to_fetch_metrics' }` |
| DB returns zero rows (empty table) | 200, `{ ok: true, data: {} }` — empty is valid |
| `updated_at` is null | `updatedAt` field is an empty string or `"Invalid Date"` is not returned — handle gracefully |
| Row has null numeric fields | All numeric fields default to `0` |

---

### 3 — Structured JSON logging (`src/middleware/logger.ts`)

**Problem:** Hono's built-in `logger()` middleware emits human-readable colored text.
DigitalOcean Logs and other production log aggregators expect newline-delimited JSON.

**Implementation:** A custom Hono middleware exported as `jsonLogger()` from
`src/middleware/logger.ts`. It replaces the `logger()` call in `src/app.ts`.

On every request it writes one JSON line to stdout:

```jsonc
{
  "ts": "2026-03-18T14:00:00.000Z",  // ISO-8601 UTC
  "method": "GET",
  "path": "/api/apy",
  "status": 200,
  "latencyMs": 37,
  "requestId": "a1b2c3d4"             // from x-request-id header (see item 6)
}
```

On error (status ≥ 500) it also includes:
```jsonc
{ ..., "error": "Error message string" }
```

`console.error(err)` calls throughout the route handlers are replaced by
`console.error(JSON.stringify({ ts, requestId, error: err.message }))` so errors
are also machine-parseable.

**What to test (unit):**

| Scenario | Expected |
|---|---|
| Successful GET request | One JSON line written to stdout with `method`, `path`, `status`, `latencyMs`, `ts`, `requestId` |
| `ts` field | Valid ISO-8601 string parseable by `new Date()` |
| `latencyMs` | Finite number ≥ 0 |
| `status` field | Matches the actual HTTP status code returned by the handler |
| `requestId` | Matches the `x-request-id` header value if provided |
| `requestId` when no header | A non-empty string is generated (see item 6) |
| 500 response | JSON line includes an `error` string field |
| Output is valid JSON | `JSON.parse(capturedLine)` does not throw |
| Multiple concurrent requests | Each produces its own independent log line (no interleaving) |

> Capture stdout in tests using `vi.spyOn(process.stdout, 'write')`.

---

### 4 — GitHub Actions CI (`.github/workflows/ci.yml`)

**Implementation:** A workflow that runs on every push and pull request to `main`:

```
typecheck → test → (e2e skipped in CI — requires live DB tunnel)
```

Steps:
1. Checkout
2. Install pnpm
3. `pnpm install`
4. `pnpm typecheck`
5. `pnpm test`

Uses `actions/setup-node@v4` with Node 20, `pnpm/action-setup@v4` with pnpm 10.

**What to test:**
- The YAML is valid (parseable by `js-yaml`)
- The workflow triggers on `push` and `pull_request` to `main`
- Both `typecheck` and `test` steps are present
- The Node version is 20
- No secrets are hardcoded (no `DATABASE_URL`, no API keys in the workflow file)

> Write these as a vitest test that reads `.github/workflows/ci.yml`, parses the YAML,
> and makes assertions on the parsed object. Use `js-yaml` (add as devDependency).

---

### 5 — Startup environment validation (`src/env.ts`)

**Implementation:** A module `src/env.ts` that is imported at the top of `src/index.ts`
(before the server starts) and validates all environment variables. It throws a
descriptive `Error` on the first invalid value so the process exits immediately with a
clear message rather than crashing on the first request.

Exported interface:

```ts
export interface Env {
  DATABASE_URL: string      // required, must start with "postgres"
  PORT: number              // optional, default 3001, must be integer 1–65535
  HOST: string              // optional, default "0.0.0.0"
  CORS_ORIGIN: string       // optional, default "*"
  NETWORK_PRESET: 'mainnet' | 'testnet'  // optional, default "mainnet"
  RATE_LIMIT_RPM: number    // optional, default 120, must be integer > 0
  RATE_LIMIT_WINDOW_MS: number // optional, default 60000, must be integer > 0
  DB_SSL_REJECT_UNAUTHORIZED: boolean // optional, default true
}

export function loadEnv(): Env  // reads process.env, validates, returns typed object
```

**What to test (unit — use `vi.stubEnv` to set process.env):**

| Scenario | Expected |
|---|---|
| `DATABASE_URL` missing | throws `Error` mentioning `DATABASE_URL` |
| `DATABASE_URL` not starting with `"postgres"` | throws `Error` mentioning `DATABASE_URL` |
| `DATABASE_URL` valid | `loadEnv()` returns object with correct value |
| `PORT` missing | defaults to `3001` |
| `PORT=abc` (non-numeric) | throws `Error` mentioning `PORT` |
| `PORT=0` | throws (out of range) |
| `PORT=65536` | throws (out of range) |
| `PORT=3001` | returns `{ PORT: 3001 }` (number, not string) |
| `NETWORK_PRESET=testnet` | returns `{ NETWORK_PRESET: 'testnet' }` |
| `NETWORK_PRESET=invalid` | throws `Error` mentioning `NETWORK_PRESET` |
| `RATE_LIMIT_RPM=0` | throws (must be > 0) |
| `RATE_LIMIT_RPM=50` | returns `{ RATE_LIMIT_RPM: 50 }` |
| `DB_SSL_REJECT_UNAUTHORIZED=false` | returns `{ DB_SSL_REJECT_UNAUTHORIZED: false }` |
| `DB_SSL_REJECT_UNAUTHORIZED=true` | returns `{ DB_SSL_REJECT_UNAUTHORIZED: true }` |
| All defaults | Returns fully-typed object with all defaults |

---

### 6 — Request ID header (`src/middleware/request-id.ts`)

**Implementation:** A Hono middleware exported as `requestId()` from
`src/middleware/request-id.ts`. It runs before all other middleware in `src/app.ts`.

Behaviour:
- If the incoming request has an `x-request-id` header, use that value
- Otherwise generate a new ID: 8 random hex characters (e.g. `"a3f9c1b2"`)
- Store it on the Hono context: `c.set('requestId', id)`
- Set `x-request-id` on the response so clients can correlate logs

**What to test (unit):**

| Scenario | Expected |
|---|---|
| Request has `x-request-id: abc123` | Response has `x-request-id: abc123` |
| Request has `x-request-id: abc123` | `c.get('requestId')` equals `"abc123"` inside handler |
| Request has no `x-request-id` | Response has `x-request-id` with an 8-char hex string |
| Request has no `x-request-id` | Two separate requests get different IDs |
| Generated ID format | Matches `/^[0-9a-f]{8}$/` |
| Very long client-provided ID (>128 chars) | Truncated or replaced with a generated ID (server's choice — document the behaviour and test it) |
| Empty string `x-request-id: ` | Treated as missing — a new ID is generated |

---

## File layout to produce

```
src/
├── env.ts                                  ← item 5 implementation (you write tests)
├── middleware/
│   ├── logger.ts                           ← item 3 implementation (you write tests)
│   ├── request-id.ts                       ← item 6 implementation (you write tests)
│   └── __tests__/
│       ├── rate-limit.test.ts              ← already written, reference for style
│       ├── logger.test.ts                  ← YOU WRITE THIS
│       ├── request-id.test.ts              ← YOU WRITE THIS
│       └── env.test.ts                     ← YOU WRITE THIS
├── routes/
│   ├── markets.ts                          ← item 2 fix (you write tests)
│   └── __tests__/
│       ├── health.test.ts                  ← already written, reference for style
│       └── markets.test.ts                 ← YOU WRITE THIS
.github/
└── workflows/
    ├── ci.yml                              ← item 4 implementation (you write tests)
    └── __tests__/
        └── ci.test.ts                      ← YOU WRITE THIS
scripts/
└── e2e.ts                                  ← already written, add new sections for items 3, 5, 6
```

---

## Reference: existing test style

```ts
// src/middleware/__tests__/rate-limit.test.ts — reference
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { rateLimit } from '../rate-limit'

let ipCounter = 0
function nextIp() { return `10.0.${Math.floor(ipCounter / 255)}.${++ipCounter % 255}` }

function makeApp(maxRpm: number) {
  const app = new Hono()
  app.use('/api/*', rateLimit(maxRpm))
  app.get('/api/test', (c) => c.json({ ok: true }))
  return app
}

describe('rateLimit middleware', () => {
  it('blocks the request that exceeds the limit with 429', async () => {
    const ip = nextIp()
    const app = makeApp(3)
    for (let i = 0; i < 3; i++) await app.request('/api/test', { headers: { 'x-forwarded-for': ip } })
    const res = await app.request('/api/test', { headers: { 'x-forwarded-for': ip } })
    expect(res.status).toBe(429)
  })
})
```

---

## Definition of done

- `pnpm test` passes with zero failures
- `pnpm typecheck` passes with zero errors
- Each new test file has at least one `describe` block per exported function/middleware
- No test hits the real database (mock `src/db.ts` as shown above)
- No test starts a real HTTP server (use `app.request()`)
- E2e additions to `scripts/e2e.ts` cover the observable HTTP behaviour of items 3, 5, and 6
