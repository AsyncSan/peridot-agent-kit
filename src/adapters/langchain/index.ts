/**
 * LangChain adapter for the Peridot Agent Kit.
 *
 * @example
 * ```typescript
 * import { ChatOpenAI } from "@langchain/openai"
 * import { createReactAgent } from "langchain/agents"
 * import { createLangChainTools } from "@peridot/agent-kit/langchain"
 *
 * const tools = createLangChainTools({ network: "mainnet" })
 * const agent = await createReactAgent({ llm: new ChatOpenAI(), tools })
 * await agent.invoke({ input: "What is the USDC supply APY on Peridot?" })
 * ```
 */

import { StructuredTool } from '@langchain/core/tools'
import type { z } from 'zod'
import { lendingTools } from '../../features/lending/tools'
import type { PeridotConfig, ToolDefinition } from '../../shared/types'

// Future feature tool arrays are imported and spread into allTools below.
// import { marginTools } from '../../features/margin/tools'

function toolsForConfig(_config: PeridotConfig): ToolDefinition[] {
  return [
    ...lendingTools,
    // ...marginTools,     // Phase 2
    // ...liquidationTools // Phase 3
  ]
}

/**
 * Create LangChain StructuredTools for all Peridot Agent Kit tools.
 * Optionally filter by category: 'lending' | 'margin' | 'status' etc.
 */
export function createLangChainTools(
  config: PeridotConfig = {},
  options?: { categories?: PeridotConfig['network'] extends string ? string[] : string[] },
): StructuredTool[] {
  const tools = toolsForConfig(config)
  const filtered = options?.categories
    ? tools.filter((t) => options.categories!.includes(t.category))
    : tools

  return filtered.map((tool) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const capturedTool = tool as ToolDefinition<any, any>
    const capturedConfig = config

    class PeridotTool extends StructuredTool {
      name = capturedTool.name
      description = capturedTool.description
      schema = capturedTool.inputSchema as z.ZodObject<z.ZodRawShape>

      protected async _call(input: unknown): Promise<string> {
        const result = (await capturedTool.execute(input, capturedConfig)) as unknown
        return JSON.stringify(result, null, 2)
      }
    }

    return new PeridotTool()
  })
}
