import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getLeaderboard } from '../get-leaderboard'
import type { PeridotConfig } from '../../../../shared/types'

const config: PeridotConfig = { apiBaseUrl: 'https://app.peridot.finance' }

const ENTRY_1 = {
  rank: 1,
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  totalPoints: 1500,
  totalSuppliedUsd: 50000,
  totalBorrowedUsd: 20000,
  netWorthUsd: 30000,
  updatedAt: '2024-03-01T00:00:00.000Z',
}

const ENTRY_2 = {
  rank: 2,
  address: '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
  totalPoints: 900,
  totalSuppliedUsd: 25000,
  totalBorrowedUsd: 10000,
  netWorthUsd: 15000,
  updatedAt: '2024-03-01T00:00:00.000Z',
}

const MOCK_LEADERBOARD = {
  ok: true,
  data: { entries: [ENTRY_1, ENTRY_2], total: 2 },
}

function makeFetch(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(body) })
}

beforeEach(() => { vi.stubGlobal('fetch', makeFetch(MOCK_LEADERBOARD)) })
afterEach(() => { vi.unstubAllGlobals() })

describe('getLeaderboard', () => {
  it('returns entries and total', async () => {
    const result = await getLeaderboard({}, config)
    expect(result.total).toBe(2)
    expect(result.entries).toHaveLength(2)
  })

  it('each entry has all expected fields', async () => {
    const result = await getLeaderboard({}, config)
    const e = result.entries[0]!
    expect(typeof e.rank).toBe('number')
    expect(typeof e.address).toBe('string')
    expect(typeof e.totalPoints).toBe('number')
    expect(typeof e.totalSuppliedUsd).toBe('number')
    expect(typeof e.totalBorrowedUsd).toBe('number')
    expect(typeof e.netWorthUsd).toBe('number')
    expect(typeof e.updatedAt).toBe('string')
  })

  it('passes limit as query param', async () => {
    const fetchMock = makeFetch(MOCK_LEADERBOARD)
    vi.stubGlobal('fetch', fetchMock)
    await getLeaderboard({ limit: 10 }, config)
    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toContain('limit=10')
  })

  it('passes chainId as query param', async () => {
    const fetchMock = makeFetch(MOCK_LEADERBOARD)
    vi.stubGlobal('fetch', fetchMock)
    await getLeaderboard({ chainId: 56 }, config)
    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toContain('chainId=56')
  })

  it('passes both limit and chainId', async () => {
    const fetchMock = makeFetch(MOCK_LEADERBOARD)
    vi.stubGlobal('fetch', fetchMock)
    await getLeaderboard({ limit: 5, chainId: 56 }, config)
    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toContain('limit=5')
    expect(url).toContain('chainId=56')
  })

  it('omits query params when not provided', async () => {
    const fetchMock = makeFetch(MOCK_LEADERBOARD)
    vi.stubGlobal('fetch', fetchMock)
    await getLeaderboard({}, config)
    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).not.toContain('?')
  })

  it('returns empty entries when server returns none', async () => {
    vi.stubGlobal('fetch', makeFetch({ ok: true, data: { entries: [], total: 0 } }))
    const result = await getLeaderboard({}, config)
    expect(result.entries).toHaveLength(0)
    expect(result.total).toBe(0)
  })

  it('throws when fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error', json: () => Promise.resolve({}) }))
    await expect(getLeaderboard({}, config)).rejects.toThrow('500')
  })

  it('throws when API returns ok: false', async () => {
    vi.stubGlobal('fetch', makeFetch({ ok: false, error: 'db_down' }))
    await expect(getLeaderboard({}, config)).rejects.toThrow('db_down')
  })
})
