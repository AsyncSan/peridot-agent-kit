/**
 * Vercel AI SDK adapter for the Peridot Agent Kit.
 *
 * @example
 * ```typescript
 * import { generateText } from "ai"
 * import { openai } from "@ai-sdk/openai"
 * import { createVercelAITools } from "@peridot/agent-kit/vercel-ai"
 *
 * const tools = createVercelAITools({ network: "mainnet" })
 *
 * const { text } = await generateText({
 *   model: openai("gpt-4o"),
 *   tools,
 *   prompt: "What is my health factor? My address is 0x..."
 * })
 * ```
 */

import { tool } from 'ai'
import type { z } from 'zod'
import { lendingTools } from '../../features/lending/tools'
import type { PeridotConfig, ToolDefinition } from '../../shared/types'

// import { marginTools } from '../../features/margin/tools'  // Phase 2

function toolsForConfig(_config: PeridotConfig): ToolDefinition[] {
  return [
    ...lendingTools,
    // ...marginTools,
  ]
}

/**
 * Create Vercel AI SDK tools for all Peridot Agent Kit tools.
 * Returns a record of tool name → tool, ready to pass to `generateText` / `streamText`.
 */
export function createVercelAITools(
  config: PeridotConfig = {},
): Record<string, unknown> {
  const tools = toolsForConfig(config)

  const entries = Object.fromEntries(
    tools.map((t) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const capturedTool = t as ToolDefinition<any, any>
      return [
        capturedTool.name,
        tool({
          description: capturedTool.description,
          parameters: capturedTool.inputSchema as z.ZodObject<z.ZodRawShape>,
          execute: async (input: unknown) => {
            const result = (await capturedTool.execute(input, config)) as unknown
            return result
          },
        }),
      ]
    }),
  )

  return entries as Record<string, unknown>
}
