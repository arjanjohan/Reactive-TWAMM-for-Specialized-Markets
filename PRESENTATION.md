# UHI Hookathon Presentation Outline

**Project:** Reactive TWAMM for Specialized Markets  
**Team:** arjanjohan + AI assistant (RaspberryPiccolo)  
**Track:** Specialized Markets (Reactive + Unichain Sponsors)

---

## 1. Hook (30 seconds)

**Elevator Pitch:**
> Time-weighted AMM hook for Uniswap v4 that uses Reactive Network to automate large trades in illiquid markets (RWA, prediction markets, exotic derivatives) on Unichain's low-latency chain.

**The Problem:**
- Large trades in illiquid markets cause massive slippage
- TWAMM exists but requires manual triggering of each chunk
- No solution for automated, cross-chain-aware TWAMM execution

**The Solution:**
- Break large orders into time-weighted chunks
- Use Reactive Network to trigger execution automatically
- Monitor price conditions across chains (Base, Arbitrum, Optimism)
- Execute on Unichain's 200ms sub-blocks

---

## 2. Why This Hook Wins (45 seconds)

**Perfect Sponsor Alignment:**

| Sponsor | What They Want | How We Deliver |
|---------|---------------|----------------|
| **Reactive Network** | Cross-chain automation, TWAMM showcase | Exact use case from their blog post |
| **Unichain** | Low-latency execution, v4 hooks | 200ms execution, native v4 integration |

**Theme Fit: "Specialized Markets"**
- RWA (Real World Assets): Real estate tokens, private equity
- Prediction markets: Event outcomes with volatile liquidity
- Exotic derivatives: Custom curves, low volume
- Any illiquid asset where TWAMM matters

**Technical Differentiation:**
- First TWAMM hook with Reactive Network integration
- Cross-chain price monitoring prevents adverse execution
- Gas-efficient batching via Reactive's parallel EVM

---

## 3. Technical Architecture (60 seconds)

**System Diagram:**

```
User Frontend          Uniswap v4              Reactive
     │                   Hook                  Network
     │                     │                      │
     ▼                     ▼                      ▼
┌──────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Submit  │───▶│  Store Order     │    │  Monitor Time    │
│  Order   │    │  Parameters      │    │  + Price         │
└──────────┘    └──────────────────┘    └──────────────────┘
                         │                      │
                         ▼                      ▼
                ┌──────────────────┐    ┌──────────────────┐
                │  PoolManager     │◀───│  Trigger         │
                │  swap()          │    │  Execution       │
                └──────────────────┘    └──────────────────┘
```

**Key Components:**

1. **TWAMMHook.sol** (Unichain)
   - `submitTWAMMOrder()` - Lock funds, store params
   - `executeTWAMMChunk()` - Execute via PoolManager.unlock()
   - `afterSwap()` - Process pending orders after each swap
   - `unlockCallback()` - Handle token settlements

2. **ReactiveTWAMM.sol** (Reactive Network)
   - `subscribe()` - Register orders for monitoring
   - `checkExecutionConditions()` - Time + price validation
   - `executeTWAMMChunk()` - Cross-chain callback trigger
   - `batchExecute()` - Process multiple orders

3. **Execution Flow:**
   ```
   1. User submits 1000 USDC → WETH order over 10 hours
   2. Hook splits into 100 chunks of 10 USDC each
   3. Reactive monitors every 6 minutes
   4. At T+6min: Reactive triggers chunk #1
   5. Hook executes swap via PoolManager
   6. User receives WETH, next chunk queued
   7. Repeat until complete
   ```

---

## 4. Code Demo (60 seconds)

**Key Implementation Highlights:**

```solidity
// Submit order - lock tokens, store params
function submitTWAMMOrder(
    PoolKey calldata key,
    uint256 amount,
    uint256 duration,
    Currency tokenIn,
    Currency tokenOut
) external returns (bytes32 orderId) {
    // Calculate chunks (1-100)
    uint256 numChunks = duration / MIN_CHUNK_DURATION;
    
    // Store order
    orders[orderId] = TWAMMOrder({
        owner: msg.sender,
        totalAmount: amount,
        totalChunks: numChunks,
        // ... other params
    });
    
    // Lock tokens
    IERC20(tokenIn).transferFrom(msg.sender, address(this), amount);
}

// Execute chunk - via PoolManager.unlock()
function _executeChunk(PoolKey calldata key, bytes32 orderId) internal {
    // Prepare swap params
    IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
        zeroForOne: zeroForOne,
        amountSpecified: -int256(chunkAmount),
        sqrtPriceLimitX96: priceLimit
    });
    
    // Execute via unlock callback
    POOL_MANAGER.unlock(abi.encode(1, key, params, orderId));
}
```

**Test Coverage:**
- ✅ 11/11 tests passing
- Order lifecycle (submit, cancel, execute)
- Permission checks (owner-only, validation)
- Edge cases (zero amount, invalid duration)

---

## 5. Live Demo (90 seconds)

**What to Show:**

1. **Forge Test Output**
   ```bash
   $ forge test
   [PASS] test_SubmitOrder
   [PASS] test_CancelOrder
   [PASS] test_ExecuteChunk
   ... 11 tests passing
   ```

2. **Contract Deployment** (if on testnet)
   - Show hook address with correct flags (0x10C0)
   - Show Reactive contract subscription

3. **Order Execution Flow**
   - Submit order
   - Show order stored with chunks
   - Trigger execution
   - Show chunk executed, progress updated

**Screenshots to Include:**
- Code structure in VS Code/IDE
- Terminal showing tests passing
- Etherscan/Uniscan showing deployed contract

---

## 6. Future Work / Roadmap (30 seconds)

**Post-Hackathon:**

1. **Price Oracle Integration**
   - Chainlink oracles for price conditions
   - TWAP-based execution triggers

2. **Advanced Order Types**
   - Stop-loss TWAMM (cancel if price drops)
   - Limit TWAMM (only execute above/below price)
   - Dollar-cost averaging (recurring orders)

3. **Frontend**
   - React app for order submission
   - Real-time progress tracking
   - Cross-chain price charts

4. **Production Deployment**
   - Unichain mainnet
   - Reactive Network mainnet
   - Security audit

---

## 7. Resources (15 seconds)

**Links:**
- GitHub: `github.com/Unwatched2345/uhi-hookathon`
- Docs: See README.md and IDEA-1-TWAMM.md
- Paradigm TWAMM Paper: paradigm.xyz/2021/07/twamm
- Reactive Network: blog.reactive.network

**Tech Stack:**
- Solidity ^0.8.26
- Foundry (testing)
- Uniswap v4
- Reactive Network
- Unichain

---

## Appendix: Talking Points

**Q: Why Reactive Network instead of keepers?**
A: Reactive provides decentralized, cross-chain event listening without relying on centralized keepers. Matches the "cross-chain automation" use case perfectly.

**Q: Why Unichain specifically?**
A: 200ms sub-blocks enable faster chunk execution. Lower latency = better price execution for TWAMM. Also sponsor requirement.

**Q: How does this differ from Paradigm's TWAMM?**
A: Original TWAMM was a standalone AMM. This is a Uniswap v4 hook, making it composable with existing v4 liquidity. Plus we add Reactive automation.

**Q: What's the business model?**
A: Hook could charge small fee (0.01-0.05%) on executed chunks. Fee split between LPers (incentive) and protocol.

**Q: Security considerations?**
A: - Reentrancy protection via _isExecutingChunk flag
- Order ownership checks
- Token settlement validation in unlockCallback
- Would need audit before mainnet

---

## Timing Summary

| Section | Time |
|---------|------|
| Hook (Problem/Solution) | 0:30 |
| Why This Wins | 0:45 |
| Technical Architecture | 1:00 |
| Code Demo | 1:00 |
| Live Demo | 1:30 |
| Future Work | 0:30 |
| Resources | 0:15 |
| **Total** | **~5:30** |

*Target: 5-7 minutes for demo video*
