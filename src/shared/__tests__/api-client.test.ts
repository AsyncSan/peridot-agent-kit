import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PeridotApiClient } from '../api-client'
import type { PeridotConfig } from '../types'

const BASE_URL = 'https://app.peridot.finance'
const config: PeridotConfig = { apiBaseUrl: BASE_URL, biconomyApiKey: 'test-key' }

const MOCK_METRICS = {
  ok: true,
  data: {
    'USDC:56': { utilizationPct: 72.5, tvlUsd: 5_000_000, liquidityUnderlying: 100_000, liquidityUsd: 100_000, priceUsd: 1.0, collateral_factor_pct: 80, updatedAt: '2024-01-01T00:00:00Z', chainId: 56 },
  },
}

const MOCK_PORTFOLIO = {
  success: true,
  data: {
    portfolio: { currentValue: 6000, totalSupplied: 10000, totalBorrowed: 4000, netApy: 3.5, healthFactor: 2.5 },
    assets: [],
    transactions: { totalCount: 5, supplyCount: 3, borrowCount: 2, repayCount: 0, redeemCount: 0 },
    earnings: { effectiveApy: 3.5, totalLifetimeEarnings: 50 },
  },
}

const MOCK_BICONOMY_RESPONSE = {
  instructions: [{ calls: [], chainId: 56, isComposable: true }],
  estimatedGas: '500000',
}

function makeSuccessFetch(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body })
}

function makeErrorFetch(status = 500) {
  return vi.fn().mockResolvedValue({ ok: false, status, statusText: 'Error', json: async () => ({}) })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PeridotApiClient.getMarketMetrics', () => {
  it('returns parsed data on success', async () => {
    vi.stubGlobal('fetch', makeSuccessFetch(MOCK_METRICS))
    const client = new PeridotApiClient(config)
    const data = await client.getMarketMetrics()
    expect(data['USDC:56']?.utilizationPct).toBe(72.5)
    expect(data['USDC:56']?.priceUsd).toBe(1.0)
  })

  it('calls the correct endpoint', async () => {
    const fetchMock = makeSuccessFetch(MOCK_METRICS)
    vi.stubGlobal('fetch', fetchMock)
    await new PeridotApiClient(config).getMarketMetrics()
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/markets/metrics`)
  })

  it('throws when HTTP response is not ok', async () => {
    vi.stubGlobal('fetch', makeErrorFetch(503))
    await expect(new PeridotApiClient(config).getMarketMetrics()).rejects.toThrow('503')
  })

  it('throws when API returns ok: false', async () => {
    vi.stubGlobal('fetch', makeSuccessFetch({ ok: false, error: 'db_down' }))
    await expect(new PeridotApiClient(config).getMarketMetrics()).rejects.toThrow('db_down')
  })
})

describe('PeridotApiClient.getUserPortfolio', () => {
  it('returns portfolio data on success', async () => {
    vi.stubGlobal('fetch', makeSuccessFetch(MOCK_PORTFOLIO))
    const data = await new PeridotApiClient(config).getUserPortfolio('0xabc')
    expect(data.portfolio.totalSupplied).toBe(10000)
    expect(data.portfolio.healthFactor).toBe(2.5)
  })

  it('includes the address as a query param', async () => {
    const fetchMock = makeSuccessFetch(MOCK_PORTFOLIO)
    vi.stubGlobal('fetch', fetchMock)
    await new PeridotApiClient(config).getUserPortfolio('0xDeAdBeEf')
    const calledUrl = (fetchMock.mock.calls[0] as [string])[0]
    expect(calledUrl).toContain('address=0xDeAdBeEf')
  })

  it('throws when success: false', async () => {
    vi.stubGlobal('fetch', makeSuccessFetch({ success: false, error: 'not_found' }))
    await expect(new PeridotApiClient(config).getUserPortfolio('0xabc')).rejects.toThrow('not_found')
  })
})

describe('PeridotApiClient.biconomyCompose', () => {
  it('sends a POST to the Biconomy compose endpoint', async () => {
    const fetchMock = makeSuccessFetch(MOCK_BICONOMY_RESPONSE)
    vi.stubGlobal('fetch', fetchMock)

    await new PeridotApiClient(config).biconomyCompose({
      ownerAddress: '0xabc' as `0x${string}`,
      mode: 'eoa',
      composeFlows: [],
    })

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('biconomy.io')
    expect(url).toContain('/compose')
    expect(opts.method).toBe('POST')
    expect(opts.headers).toMatchObject({ 'X-API-Key': 'test-key' })
  })

  it('throws when biconomyApiKey is not configured', async () => {
    const clientNoKey = new PeridotApiClient({ apiBaseUrl: BASE_URL })
    await expect(
      clientNoKey.biconomyCompose({ ownerAddress: '0xabc' as `0x${string}`, mode: 'eoa', composeFlows: [] }),
    ).rejects.toThrow('biconomyApiKey is required')
  })

  it('throws on Biconomy API error', async () => {
    vi.stubGlobal('fetch', makeErrorFetch(400))
    await expect(
      new PeridotApiClient(config).biconomyCompose({
        ownerAddress: '0xabc' as `0x${string}`,
        mode: 'eoa',
        composeFlows: [],
      }),
    ).rejects.toThrow('Biconomy compose error')
  })

  it('returns the parsed BiconomyResponse', async () => {
    vi.stubGlobal('fetch', makeSuccessFetch(MOCK_BICONOMY_RESPONSE))
    const result = await new PeridotApiClient(config).biconomyCompose({
      ownerAddress: '0xabc' as `0x${string}`,
      mode: 'eoa',
      composeFlows: [],
    })
    expect(result.instructions).toHaveLength(1)
    expect(result.estimatedGas).toBe('500000')
  })
})

describe('PeridotApiClient.biconomyGetStatus', () => {
  it('returns success status with txHashes', async () => {
    vi.stubGlobal('fetch', makeSuccessFetch({ status: 'SUCCESS', txHashes: ['0xhash1', '0xhash2'] }))
    const status = await new PeridotApiClient(config).biconomyGetStatus('0xsuper')
    expect(status.status).toBe('success')
    expect(status.chainTxHashes).toEqual(['0xhash1', '0xhash2'])
  })

  it('returns failed status with error message', async () => {
    vi.stubGlobal('fetch', makeSuccessFetch({ status: 'FAILED', message: 'insufficient gas' }))
    const status = await new PeridotApiClient(config).biconomyGetStatus('0xsuper')
    expect(status.status).toBe('failed')
    expect(status.error).toBe('insufficient gas')
  })

  it('returns processing status', async () => {
    vi.stubGlobal('fetch', makeSuccessFetch({ status: 'PROCESSING' }))
    const status = await new PeridotApiClient(config).biconomyGetStatus('0xsuper')
    expect(status.status).toBe('processing')
  })

  it('returns not_found when HTTP 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false, json: async () => ({}) }))
    const status = await new PeridotApiClient(config).biconomyGetStatus('0xmissing')
    expect(status.status).toBe('not_found')
    expect(status.superTxHash).toBe('0xmissing')
  })

  it('returns pending for unknown status strings', async () => {
    vi.stubGlobal('fetch', makeSuccessFetch({ status: 'QUEUED' }))
    const status = await new PeridotApiClient(config).biconomyGetStatus('0xsuper')
    expect(status.status).toBe('pending')
  })
})
