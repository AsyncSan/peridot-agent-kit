import { describe, it, expect, vi, afterEach } from 'vitest'
import { checkTransactionStatus } from '../check-transaction'
import type { PeridotConfig } from '../../../../shared/types'

const config: PeridotConfig = { biconomyApiKey: 'test-key' }
const HASH = '0xdeadbeefcafe1234567890abcdef1234567890abcdef1234567890abcdef1234'

function mockBiconomyStatus(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status === 200,
    status,
    json: () => Promise.resolve(body),
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checkTransactionStatus', () => {
  it('returns success with txHashes when status is SUCCESS', async () => {
    mockBiconomyStatus({ status: 'SUCCESS', txHashes: ['0xaaa', '0xbbb'] })
    const result = await checkTransactionStatus({ superTxHash: HASH }, config)
    expect(result.status).toBe('success')
    expect(result.superTxHash).toBe(HASH)
    expect(result.chainTxHashes).toEqual(['0xaaa', '0xbbb'])
  })

  it('returns success when status is COMPLETED (alternate spelling)', async () => {
    mockBiconomyStatus({ status: 'COMPLETED', txHashes: ['0xccc'] })
    const result = await checkTransactionStatus({ superTxHash: HASH }, config)
    expect(result.status).toBe('success')
  })

  it('returns failed with error message', async () => {
    mockBiconomyStatus({ status: 'FAILED', message: 'out of gas on BSC' })
    const result = await checkTransactionStatus({ superTxHash: HASH }, config)
    expect(result.status).toBe('failed')
    expect(result.error).toBe('out of gas on BSC')
  })

  it('returns processing when in flight', async () => {
    mockBiconomyStatus({ status: 'PROCESSING', txHashes: [] })
    const result = await checkTransactionStatus({ superTxHash: HASH }, config)
    expect(result.status).toBe('processing')
  })

  it('returns not_found on HTTP 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) }))
    const result = await checkTransactionStatus({ superTxHash: HASH }, config)
    expect(result.status).toBe('not_found')
    expect(result.superTxHash).toBe(HASH)
  })

  it('returns pending for an unknown/queued status', async () => {
    mockBiconomyStatus({ status: 'QUEUED' })
    const result = await checkTransactionStatus({ superTxHash: HASH }, config)
    expect(result.status).toBe('pending')
  })

  it('always echoes back the superTxHash', async () => {
    mockBiconomyStatus({ status: 'SUCCESS', txHashes: [] })
    const result = await checkTransactionStatus({ superTxHash: HASH }, config)
    expect(result.superTxHash).toBe(HASH)
  })

  it('calls the correct Biconomy status endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ status: 'SUCCESS', txHashes: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    await checkTransactionStatus({ superTxHash: HASH }, config)
    const calledUrl = (fetchMock.mock.calls[0] as [string])[0]
    expect(calledUrl).toContain(HASH)
    expect(calledUrl).toContain('biconomy.io')
  })

  it('throws on non-404 HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) }))
    await expect(checkTransactionStatus({ superTxHash: HASH }, config)).rejects.toThrow('500')
  })
})
