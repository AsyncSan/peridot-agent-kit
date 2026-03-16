import { z } from 'zod'
import { PeridotApiClient } from '../../../shared/api-client'
import type { PeridotConfig, TransactionStatus } from '../../../shared/types'

export const checkTransactionStatusSchema = z.object({
  superTxHash: z
    .string()
    .describe(
      'The Biconomy super-transaction hash returned after executing a cross-chain intent. ' +
        'Looks like a regular tx hash (0x...).',
    ),
})

export type CheckTransactionStatusInput = z.infer<typeof checkTransactionStatusSchema>

/**
 * Polls Biconomy for the status of a cross-chain super-transaction.
 * Call this after the user has signed and submitted a CrossChainIntent.
 */
export async function checkTransactionStatus(
  input: CheckTransactionStatusInput,
  config: PeridotConfig,
): Promise<TransactionStatus> {
  const client = new PeridotApiClient(config)
  return client.biconomyGetStatus(input.superTxHash)
}
