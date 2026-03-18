import { describe, it, expect } from 'vitest'
import { evmAddress, tokenAmount } from '../zod-utils'

describe('evmAddress', () => {
  it('accepts a valid checksummed address', () => {
    expect(evmAddress.safeParse('0xDeAdBeEf00000000000000000000000000000001').success).toBe(true)
  })

  it('accepts a lowercase address', () => {
    expect(evmAddress.safeParse('0xdeadbeef00000000000000000000000000000001').success).toBe(true)
  })

  it('rejects an address that is too short', () => {
    const result = evmAddress.safeParse('0xabc')
    expect(result.success).toBe(false)
  })

  it('rejects an address that is too long', () => {
    const result = evmAddress.safeParse('0x' + 'a'.repeat(41))
    expect(result.success).toBe(false)
  })

  it('rejects an address without 0x prefix', () => {
    const result = evmAddress.safeParse('deadbeef00000000000000000000000000000001')
    expect(result.success).toBe(false)
  })

  it('rejects a non-hex address', () => {
    const result = evmAddress.safeParse('0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG')
    expect(result.success).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(evmAddress.safeParse('').success).toBe(false)
  })
})

describe('tokenAmount', () => {
  it('accepts a whole number', () => {
    expect(tokenAmount.safeParse('100').success).toBe(true)
  })

  it('accepts a decimal', () => {
    expect(tokenAmount.safeParse('0.5').success).toBe(true)
  })

  it('accepts zero with decimals', () => {
    expect(tokenAmount.safeParse('0.001').success).toBe(true)
  })

  it('rejects a negative number', () => {
    expect(tokenAmount.safeParse('-1').success).toBe(false)
  })

  it('rejects NaN string', () => {
    expect(tokenAmount.safeParse('NaN').success).toBe(false)
  })

  it('rejects "max" (use hub repay schema for that)', () => {
    expect(tokenAmount.safeParse('max').success).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(tokenAmount.safeParse('').success).toBe(false)
  })

  it('rejects a number with a leading sign', () => {
    expect(tokenAmount.safeParse('+100').success).toBe(false)
  })
})
