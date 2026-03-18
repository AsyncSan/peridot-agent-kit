import { describe, it, expect } from 'vitest'
import { loadEnv } from '../env'

const VALID_BASE = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
}

function load(overrides: Record<string, string | undefined> = {}) {
  return loadEnv({ ...VALID_BASE, ...overrides })
}

describe('loadEnv', () => {
  // ── DATABASE_URL ────────────────────────────────────────────────────────────
  describe('DATABASE_URL', () => {
    it('throws when DATABASE_URL is missing', () => {
      expect(() => loadEnv({})).toThrow(/DATABASE_URL/)
    })

    it('throws when DATABASE_URL does not start with "postgres"', () => {
      expect(() => load({ DATABASE_URL: 'mysql://host/db' })).toThrow(/DATABASE_URL/)
    })

    it('accepts a valid postgres:// URL', () => {
      expect(load().DATABASE_URL).toBe(VALID_BASE.DATABASE_URL)
    })

    it('accepts a postgresql:// URL', () => {
      const url = 'postgresql://user:pass@host:5432/db'
      expect(load({ DATABASE_URL: url }).DATABASE_URL).toBe(url)
    })
  })

  // ── PORT ────────────────────────────────────────────────────────────────────
  describe('PORT', () => {
    it('defaults to 3001 when not set', () => {
      expect(load().PORT).toBe(3001)
    })

    it('returns PORT as a number, not a string', () => {
      expect(typeof load({ PORT: '4000' }).PORT).toBe('number')
    })

    it('parses a valid port', () => {
      expect(load({ PORT: '8080' }).PORT).toBe(8080)
    })

    it('throws for non-numeric PORT', () => {
      expect(() => load({ PORT: 'abc' })).toThrow(/PORT/)
    })

    it('throws for PORT=0 (out of range)', () => {
      expect(() => load({ PORT: '0' })).toThrow(/PORT/)
    })

    it('throws for PORT=65536 (out of range)', () => {
      expect(() => load({ PORT: '65536' })).toThrow(/PORT/)
    })

    it('accepts PORT=1 (lower bound)', () => {
      expect(load({ PORT: '1' }).PORT).toBe(1)
    })

    it('accepts PORT=65535 (upper bound)', () => {
      expect(load({ PORT: '65535' }).PORT).toBe(65535)
    })

    it('throws for a float like "3001.5"', () => {
      expect(() => load({ PORT: '3001.5' })).toThrow(/PORT/)
    })
  })

  // ── HOST ────────────────────────────────────────────────────────────────────
  describe('HOST', () => {
    it('defaults to "0.0.0.0"', () => {
      expect(load().HOST).toBe('0.0.0.0')
    })

    it('returns the provided HOST', () => {
      expect(load({ HOST: '127.0.0.1' }).HOST).toBe('127.0.0.1')
    })
  })

  // ── CORS_ORIGIN ─────────────────────────────────────────────────────────────
  describe('CORS_ORIGIN', () => {
    it('defaults to "*"', () => {
      expect(load().CORS_ORIGIN).toBe('*')
    })

    it('returns the provided CORS_ORIGIN', () => {
      expect(load({ CORS_ORIGIN: 'https://app.peridot.finance' }).CORS_ORIGIN)
        .toBe('https://app.peridot.finance')
    })
  })

  // ── NETWORK_PRESET ──────────────────────────────────────────────────────────
  describe('NETWORK_PRESET', () => {
    it('defaults to "mainnet"', () => {
      expect(load().NETWORK_PRESET).toBe('mainnet')
    })

    it('accepts "testnet"', () => {
      expect(load({ NETWORK_PRESET: 'testnet' }).NETWORK_PRESET).toBe('testnet')
    })

    it('accepts "mainnet" explicitly', () => {
      expect(load({ NETWORK_PRESET: 'mainnet' }).NETWORK_PRESET).toBe('mainnet')
    })

    it('throws for an unknown preset', () => {
      expect(() => load({ NETWORK_PRESET: 'staging' })).toThrow(/NETWORK_PRESET/)
    })
  })

  // ── RATE_LIMIT_RPM ──────────────────────────────────────────────────────────
  describe('RATE_LIMIT_RPM', () => {
    it('defaults to 120', () => {
      expect(load().RATE_LIMIT_RPM).toBe(120)
    })

    it('parses a valid value', () => {
      expect(load({ RATE_LIMIT_RPM: '50' }).RATE_LIMIT_RPM).toBe(50)
    })

    it('returns a number not a string', () => {
      expect(typeof load({ RATE_LIMIT_RPM: '60' }).RATE_LIMIT_RPM).toBe('number')
    })

    it('throws for 0', () => {
      expect(() => load({ RATE_LIMIT_RPM: '0' })).toThrow(/RATE_LIMIT_RPM/)
    })

    it('throws for negative values', () => {
      expect(() => load({ RATE_LIMIT_RPM: '-1' })).toThrow(/RATE_LIMIT_RPM/)
    })

    it('throws for non-numeric values', () => {
      expect(() => load({ RATE_LIMIT_RPM: 'high' })).toThrow(/RATE_LIMIT_RPM/)
    })
  })

  // ── RATE_LIMIT_WINDOW_MS ────────────────────────────────────────────────────
  describe('RATE_LIMIT_WINDOW_MS', () => {
    it('defaults to 60000', () => {
      expect(load().RATE_LIMIT_WINDOW_MS).toBe(60000)
    })

    it('parses a valid value', () => {
      expect(load({ RATE_LIMIT_WINDOW_MS: '5000' }).RATE_LIMIT_WINDOW_MS).toBe(5000)
    })

    it('throws for 0', () => {
      expect(() => load({ RATE_LIMIT_WINDOW_MS: '0' })).toThrow(/RATE_LIMIT_WINDOW_MS/)
    })
  })

  // ── DB_SSL_REJECT_UNAUTHORIZED ──────────────────────────────────────────────
  describe('DB_SSL_REJECT_UNAUTHORIZED', () => {
    it('defaults to true when not set', () => {
      expect(load().DB_SSL_REJECT_UNAUTHORIZED).toBe(true)
    })

    it('is true when set to "true"', () => {
      expect(load({ DB_SSL_REJECT_UNAUTHORIZED: 'true' }).DB_SSL_REJECT_UNAUTHORIZED).toBe(true)
    })

    it('is false when set to "false"', () => {
      expect(load({ DB_SSL_REJECT_UNAUTHORIZED: 'false' }).DB_SSL_REJECT_UNAUTHORIZED).toBe(false)
    })

    it('is true for any value other than "false"', () => {
      expect(load({ DB_SSL_REJECT_UNAUTHORIZED: 'yes' }).DB_SSL_REJECT_UNAUTHORIZED).toBe(true)
    })
  })

  // ── Full defaults ───────────────────────────────────────────────────────────
  it('returns all defaults when only DATABASE_URL is provided', () => {
    const env = load()
    expect(env).toMatchObject({
      PORT: 3001,
      HOST: '0.0.0.0',
      CORS_ORIGIN: '*',
      NETWORK_PRESET: 'mainnet',
      RATE_LIMIT_RPM: 120,
      RATE_LIMIT_WINDOW_MS: 60000,
      DB_SSL_REJECT_UNAUTHORIZED: true,
    })
  })
})
