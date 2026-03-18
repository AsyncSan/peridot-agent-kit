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
  return vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) })
}

function makeErrorFetch(status = 500) {
  return vi.fn().mockResolvedValue({ ok: false, status, statusText: 'Error', json: () => Promise.resolve({}) })
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

describe('PeridotApiClient.getMarketApy', () => {
  const MOCK_APY_ALL = {
    success: true,
    data: {
      usdc: {
        56: { supplyApy: 3.21, borrowApy: 5.67, peridotSupplyApy: 1.10, peridotBorrowApy: 0.80, boostSourceSupplyApy: 0.50, boostRewardsSupplyApy: 0.20, totalSupplyApy: 5.01, netBorrowApy: 4.87, timestamp: '2024-01-01T00:00:00Z' },
        143: { supplyApy: 1.50, borrowApy: 3.00, peridotSupplyApy: 0.50, peridotBorrowApy: 0.30, boostSourceSupplyApy: 0, boostRewardsSupplyApy: 0, totalSupplyApy: 2.00, netBorrowApy: 2.70, timestamp: '2024-01-01T00:00:00Z' },
      },
      weth: {
        56: { supplyApy: 1.80, borrowApy: 3.50, peridotSupplyApy: 0.60, peridotBorrowApy: 0.40, boostSourceSupplyApy: 0, boostRewardsSupplyApy: 0, totalSupplyApy: 2.40, netBorrowApy: 3.10, timestamp: '2024-01-01T00:00:00Z' },
      },
    },
  }

  it('returns parsed APY data on success', async () => {
    vi.stubGlobal('fetch', makeSuccessFetch(MOCK_APY_ALL))
    const data = await new PeridotApiClient(config).getMarketApy()
    expect(data['usdc']?.[56]?.supplyApy).toBe(3.21)
    expect(data['usdc']?.[56]?.totalSupplyApy).toBe(5.01)
    expect(data['weth']?.[56]?.borrowApy).toBe(3.50)
  })

  it('calls /api/apy with no chainId when none provided', async () => {
    const fetchMock = makeSuccessFetch(MOCK_APY_ALL)
    vi.stubGlobal('fetch', fetchMock)
    await new PeridotApiClient(config).getMarketApy()
    const calledUrl = (fetchMock.mock.calls[0] as [string])[0]
    expect(calledUrl).toBe(`${BASE_URL}/api/apy`)
    expect(calledUrl).not.toContain('chainId')
  })

  it('appends chainId as a query param when provided', async () => {
    const fetchMock = makeSuccessFetch(MOCK_APY_ALL)
    vi.stubGlobal('fetch', fetchMock)
    await new PeridotApiClient(config).getMarketApy(56)
    const calledUrl = (fetchMock.mock.calls[0] as [string])[0]
    expect(calledUrl).toBe(`${BASE_URL}/api/apy?chainId=56`)
  })

  it('uses config.apiBaseUrl as the base', async () => {
    const fetchMock = makeSuccessFetch(MOCK_APY_ALL)
    vi.stubGlobal('fetch', fetchMock)
    const customClient = new PeridotApiClient({ apiBaseUrl: 'https://staging.peridot.finance' })
    await customClient.getMarketApy(56)
    const calledUrl = (fetchMock.mock.calls[0] as [string])[0]
    expect(calledUrl).toContain('staging.peridot.finance')
  })

  it('returns all APY breakdown fields', async () => {
    vi.stubGlobal('fetch', makeSuccessFetch(MOCK_APY_ALL))
    const data = await new PeridotApiClient(config).getMarketApy()
    const entry = data['usdc']![56]!
    expect(typeof entry.supplyApy).toBe('number')
    expect(typeof entry.borrowApy).toBe('number')
    expect(typeof entry.peridotSupplyApy).toBe('number')
    expect(typeof entry.peridotBorrowApy).toBe('number')
    expect(typeof entry.boostSourceSupplyApy).toBe('number')
    expect(typeof entry.boostRewardsSupplyApy).toBe('number')
    expect(typeof entry.totalSupplyApy).toBe('number')
    expect(typeof entry.netBorrowApy).toBe('number')
  })

  it('throws when HTTP response is not ok', async () => {
    vi.stubGlobal('fetch', makeErrorFetch(503))
    await expect(new PeridotApiClient(config).getMarketApy()).rejects.toThrow('503')
  })

  it('throws when success: false', async () => {
    vi.stubGlobal('fetch', makeSuccessFetch({ success: false, error: 'apy_unavailable' }))
    await expect(new PeridotApiClient(config).getMarketApy()).rejects.toThrow('apy_unavailable')
  })

  it('returns empty object when data is empty', async () => {
    vi.stubGlobal('fetch', makeSuccessFetch({ success: true, data: {} }))
    const data = await new PeridotApiClient(config).getMarketApy()
    expect(data).toEqual({})
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false, json: () => Promise.resolve({}) }))
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
