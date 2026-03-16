#!/usr/bin/env node
/**
 * execute-intent.ts
 *
 * Developer utility to sign and execute a cross-chain Biconomy intent from the CLI.
 * This script is for AUTOMATED BOTS and TESTING only — it requires a private key.
 *
 * The Peridot Agent Kit does NOT call this automatically. AI agents build intents;
 * humans (or authorized scripts) execute them. This is the "User Disposes" half.
 *
 * Usage:
 *   PRIVATE_KEY=0x...  BICONOMY_API_KEY=...  npx tsx scripts/execute-intent.ts
 *
 * The script reads a CrossChainIntent from stdin (JSON) and submits it to Biconomy.
 *
 * Environment variables:
 *   PRIVATE_KEY        — EOA private key (required)
 *   BICONOMY_API_KEY   — Biconomy API key (required)
 *   POLL_INTERVAL_MS   — Status poll interval in ms (default: 3000)
 *   MAX_POLLS          — Max status poll attempts (default: 40 = ~2 min)
 */

import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { bsc } from 'viem/chains'

const BICONOMY_API_URL = 'https://api.biconomy.io'
const POLL_INTERVAL_MS = parseInt(process.env['POLL_INTERVAL_MS'] ?? '3000', 10)
const MAX_POLLS = parseInt(process.env['MAX_POLLS'] ?? '40', 10)

async function main() {
  const privateKey = process.env['PRIVATE_KEY']
  const apiKey = process.env['BICONOMY_API_KEY']

  if (!privateKey) throw new Error('PRIVATE_KEY env var is required')
  if (!apiKey) throw new Error('BICONOMY_API_KEY env var is required')

  // Read CrossChainIntent from stdin
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const intent = JSON.parse(Buffer.concat(chunks).toString()) as {
    biconomyInstructions: unknown
    summary: string
  }

  console.log(`\nExecuting: ${intent.summary}`)

  const account = privateKeyToAccount(privateKey as `0x${string}`)
  console.log(`Signer: ${account.address}`)

  // Submit to Biconomy execute
  const executeRes = await fetch(`${BICONOMY_API_URL}/v1/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify({
      ownerAddress: account.address,
      instructions: (intent.biconomyInstructions as Record<string, unknown>)['instructions'],
    }),
  })

  if (!executeRes.ok) {
    const err = await executeRes.json()
    throw new Error(`Biconomy execute failed: ${JSON.stringify(err)}`)
  }

  const { superTxHash } = (await executeRes.json()) as { superTxHash: string }
  console.log(`\nSuper TX hash: ${superTxHash}`)
  console.log('Polling for status...\n')

  // Poll for completion
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

    const statusRes = await fetch(`${BICONOMY_API_URL}/v1/explorer/transaction/${superTxHash}`, {
      headers: { 'X-API-Key': apiKey },
    })
    const status = (await statusRes.json()) as Record<string, unknown>
    const statusStr = String(status['status'] ?? '').toLowerCase()

    process.stdout.write(`[${i + 1}/${MAX_POLLS}] status=${statusStr}\r`)

    if (statusStr.includes('success') || statusStr.includes('completed')) {
      console.log(`\n✓ Success! TX hashes:`, status['txHashes'])
      process.exit(0)
    }
    if (statusStr.includes('fail') || statusStr.includes('error')) {
      console.error(`\n✗ Failed: ${String(status['message'] ?? 'unknown error')}`)
      process.exit(1)
    }
  }

  console.warn(`\nTimed out after ${MAX_POLLS} polls. Last known hash: ${superTxHash}`)
  process.exit(2)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
