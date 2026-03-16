# 💎 Peridot Agent Kit

**Enable AI Agents to seamlessly and safely interact with Peridot's Money Markets.**

The Peridot Agent Kit provides LLM-ready tools (Skills) that allow AI agents to fetch market data, simulate lending positions, and prepare transaction intents for users. It is designed to bridge the gap between natural language and deterministic DeFi execution, without compromising user safety.

## 🧠 Why use the Peridot Agent Kit?

LLMs are great at conversation but notoriously bad at calculating blockchain decimals, predicting liquidation thresholds, or formatting raw smart contract calldata. 

This toolkit solves that by providing **AI-optimized wrappers** around the Peridot API. 

**Our Core Philosophy: AI Proposes, User Disposes**
1. **Zero Math for AI:** Agents rely on the Peridot backend for precise `Health Factor` and decimal calculations.
2. **Read & Simulate First:** Agents simulate borrowing actions to warn users about liquidation risks *before* generating transactions.
3. **Intent-Based Execution:** Agents never hold private keys. They generate standardized transaction payloads (intents) that the user reviews and signs in their wallet or dApp frontend.

---

## 🛠️ Supported Frameworks

The core tools are framework-agnostic, but we provide ready-to-use wrappers for:
- [x] LangChain (`@peridot/langchain-tools`)
- [x] ElizaOS (`@peridot/eliza-plugin`) *(Coming soon)*
- [x] Vercel AI SDK

---

## 📦 Installation

```bash
npm install @peridot/agent-kit
# or
yarn add @peridot/agent-kit
```

## 🧰 Available Tools (Lend & Borrow)
These tools are formatted with clear descriptions and strict JSON schemas so your LLM knows exactly when and how to use them.

### 🔍 Read & Simulate (Risk-Free)
`get_market_rates(asset)`: Fetches current Supply APY, Borrow APY, and Total Value Locked for a specific asset (e.g., USDC, WETH).

`get_user_position(address)`: Returns the user's total collateral, total debt, and current Health Factor.

`simulate_borrow(address, asset, amount)`: Crucial for safety. Simulates a borrow action and returns the projected new Health Factor and liquidation price.

### ✍️ Transaction Intents (Requires User Signature)
These tools return safe, pre-calculated calldata for the frontend.

`build_supply_intent(asset, amount)`: Prepares the transaction to supply an asset as collateral.

`build_borrow_intent(asset, amount)`: Prepares the transaction to borrow an asset against existing collateral.

`build_repay_intent(asset, amount)`: Prepares the transaction to repay an active debt.

`build_withdraw_intent(asset, amount)`: Prepares the transaction to withdraw supplied collateral.

## 🚀 Quick Start (LangChain Example)
Here is how you can give your AI agent the ability to interact with Peridot:

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { initializeAgentExecutorWithOptions } from "langchain/agents";
import { 
  GetUserPositionTool, 
  SimulateBorrowTool, 
  BuildBorrowIntentTool 
} from "@peridot/agent-kit/langchain";

// 1. Initialize the LLM
const model = new ChatOpenAI({ temperature: 0 });

// 2. Load Peridot Skills
const tools = [
  new GetUserPositionTool(),
  new SimulateBorrowTool(),
  new BuildBorrowIntentTool()
];

// 3. Create the Agent
const executor = await initializeAgentExecutorWithOptions(tools, model, {
  agentType: "structured-chat-zero-shot-react-description",
});

// 4. Run it
const result = await executor.invoke({ 
  input: "I want to borrow 500 USDC against my existing collateral. Is it safe?" 
});

console.log(result.output);
```

## 🗺️ Roadmap
Phase 1: Core Money Market (✅ Active) - Lend, Borrow, Repay, Withdraw.

Phase 2: Margin & Leverage (🚧 In Development) - 1-click looping strategies, leverage intents, and advanced swap routing.

Phase 3: Automated Liquidations - Tools for specialized keeper bots.

## 🛡️ Security
This SDK provides data and transaction preparation. It does not execute transactions automatically. Always ensure your application interface clearly displays the intent data (especially the Health Factor changes) before prompting the user to sign with their wallet.

## 🤝 Contributing
We welcome contributions! Please see our Contributing Guidelines to get started.
