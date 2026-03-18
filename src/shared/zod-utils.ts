import { z } from 'zod'

/**
 * Accepts any valid 0x-prefixed 40-hex-character Ethereum address.
 * Rejects bare hex strings, ENS names, and truncated addresses.
 */
export const evmAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid Ethereum address (0x followed by 40 hex chars)')

/**
 * Accepts a positive decimal number expressed as a string.
 * Valid: "100", "0.5", "1234.56789"
 * Invalid: "-1", "NaN", "Infinity", "1e18", ""
 */
export const tokenAmount = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Amount must be a positive decimal number (e.g. "100" or "0.5")')
