# Idea 1: Reactive TWAMM for Specialized Markets

**Status:** 🎯 SELECTED FOR DEVELOPMENT

---

## Elevator Pitch

Time-weighted automated market maker (TWAMM) hook for Uniswap v4 that uses Reactive Network to automate large trades in illiquid specialized markets (RWA, prediction markets, exotic derivatives) on Unichain's low-latency chain.

---

## The Problem

Large trades in illiquid markets cause massive slippage. Traditional AMMs execute immediately, hurting the trader. TWAMM solves this by breaking large orders into chunks executed over time—but it requires someone to trigger each chunk.

## The Solution

1. **User** deposits a large trade into the TWAMM hook
2. **Hook** stores order parameters (amount, duration, chunk size)
3. **Reactive Network** monitors:
   - Time intervals (when to execute next chunk)
   - Price conditions on other chains (prevent execution if adverse)
4. **Reactive triggers** `executeTWAMMChunk()` on Unichain
5. **Hook** executes the chunk via Uniswap v4
6. **Repeat** until trade complete

---

## Why This Wins

### Perfect Sponsor Alignment

| Sponsor | What They Want | How We Deliver |
|---------|---------------|----------------|
| **Reactive** | Cross-chain automation, TWAMM showcase | Exact use case from their blog post |
| **Unichain** | Low-latency execution, v4 hooks | 200ms execution, native v4 integration |

### Theme Fit: "Specialized Markets"

- Designed for **illiquid assets** where TWAMM matters most
- **RWA**: Real estate tokens, private equity
- **Prediction markets**: Event outcomes with volatile liquidity
- **Exotic derivatives**: Custom curves, low volume

### Technical Feasibility

- TWAMM math is documented (Paradigm paper)
- Reactive SDK is straightforward
- Unichain v4 is live and ready
- Can build on existing hook templates

---

## Technical Architecture

### Components

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   User Frontend   │────▶│  Uniswap v4 Hook │◀────│  Reactive       │
│  (React/Vue)     │     │  (TWAMM Logic)   │     │  Contract       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                 │                           │
                                 ▼                           ▼
                        ┌──────────────────┐     ┌──────────────────┐
                        │   Unichain       │     │  Cross-Chain     │
                        │   Uniswap v4     │     │  Price Feeds     │
                        └──────────────────┘     └──────────────────┘
```

### Smart Contracts

#### 1. TWAMMHook.sol (Uniswap v4)

**Functions:**
```solidity
// Initialize TWAMM for a pool
function afterInitialize(PoolKey, uint160, int24, bytes calldata) external override;

// Intercept swaps to track TWAMM chunks
function afterSwap(
    address,
    PoolKey calldata key,
    IPoolManager.SwapParams calldata params,
    BalanceDelta delta,
    bytes calldata hookData
) external override returns (bytes4, int128);

// Core TWAMM logic
function executeTWAMMChunk(PoolKey calldata key, bytes32 orderId) external;
function submitTWAMMOrder(PoolKey calldata key, uint256 amount, uint256 duration) external payable;
function cancelTWAMMOrder(bytes32 orderId) external;
```

**Storage:**
```solidity
struct TWAMMOrder {
    address owner;
    uint256 totalAmount;
    uint256 executedAmount;
    uint256 totalChunks;
    uint256 executedChunks;
    uint256 startTime;
    uint256 endTime;
    uint256 lastExecutionTime;
    bool active;
}

mapping(bytes32 => TWAMMOrder) public orders;
mapping(PoolId => bool) public twammEnabled;
```

#### 2. ReactiveTWAMM.sol (Reactive Network)

**Functions:**
```solidity
// Reactive callback - triggered when conditions met
function executeTWAMMChunk(bytes32 orderId) external;

// Subscribe to events
function subscribeToPool(address pool, bytes32 orderId) external;

// Check if conditions met
function checkExecutionConditions(
    bytes32 orderId,
    uint256 currentPrice,
    uint256 targetTime
) external view returns (bool);
```

**Reactive pattern:**
```solidity
// On Reactive Network
function checkAndExecute(bytes32 orderId, address targetHook) external {
    require(checkExecutionConditions(orderId), "Conditions not met");
    // Trigger cross-chain execution
    reactiveCallback(targetHook, abi.encodeWithSelector(
        TWAMMHook.executeTWAMMChunk.selector,
        orderId
    ));
}
```

### Frontend

**Key screens:**

1. **Dashboard**
   - Active TWAMM orders
   - Progress bars showing % complete
   - Estimated completion time

2. **Submit Order**
   - Token pair selector
   - Amount input
   - Duration slider (hours/days)
   - Slippage preview (immediate vs TWAMM)

3. **Order Detail**
   - Chunk execution history
   - Price charts
   - Reactive execution logs

4. **Cross-Chain Monitor (optional)**
   - Real-time price feeds from Base/Arbitrum
   - Execution triggers log

### Backend

**Minimal backend:**
- Static hosting for frontend
- Optional: RPC proxy for rate limiting
- No persistent database (read from chain)

---

## Hackathon Timeline

### Week 1: Foundation (Feb 24 - Mar 2)

**Goal:** Submit proposal, have basic hook working locally

| Day | Tasks | Deliverable |
|-----|-------|-------------|
| **Mon 24** | Set up dev environment: Foundry, Unichain testnet, Reactive SDK | Environment ready |
| **Tue 25** | Deploy sample v4 hook on Unichain testnet | Working basic hook |
| **Wed 26** | Write TWAMMHook.sol skeleton, storage structures | Contract skeleton |
| **Thu 27** | Implement submitTWAMMOrder, cancel functions | Order submission working |
| **Fri 28** | Implement executeTWAMMChunk, hook callbacks | Core logic complete |
| **Sat 1** | Write tests, debug edge cases | Test suite passing |
| **Sun 2** | **Submit proposal by deadline** | Proposal submitted |

### Week 2: Integration (Mar 3 - Mar 9)

**Goal:** Reactive integration working, basic frontend

| Day | Tasks | Deliverable |
|-----|-------|-------------|
| **Mon 3** | Set up Reactive Network integration, subscribe pattern | Reactive connected |
| **Tue 4** | Implement cross-chain price monitoring | Price feeds working |
| **Wed 5** | Wire Reactive → Hook execution | End-to-end test passing |
| **Thu 6** | Deploy to testnet, verify full flow | Testnet deployment |
| **Fri 7** | Build frontend: dashboard, order submission | Basic UI working |
| **Sat 8** | Frontend: execution logs, progress tracking | Full UI complete |
| **Sun 9** | **Update 1 due** - Core mechanism working | Screenshot/video submitted |

### Week 3: Polish (Mar 10 - Mar 16)

**Goal:** Sponsor integrations complete, demo-ready

| Day | Tasks | Deliverable |
|-----|-------|-------------|
| **Mon 10** | Frontend polish: responsive, loading states, error handling | Polished UI |
| **Tue 11** | Gas optimization, contract review | Optimized contracts |
| **Wed 12** | Reactive mainnet integration (if available) | Production ready |
| **Thu 13** | Demo video: record walkthrough | Raw video recorded |
| **Fri 14** | Final bug fixes, edge case testing | Stable build |
| **Sat 15** | Documentation, README, code cleanup | Docs complete |
| **Sun 16** | **Update 2 due** - Sponsor integrations complete | Final update submitted |

### Final Stretch (Mar 17 - Mar 19)

| Day | Tasks |
|-----|-------|
| **Mon 17** | Final polish, deploy to production |
| **Tue 18** | Submission docs, demo video final cut |
| **Wed 19** | **Final submission deadline** |

---

## Deliverables

### Update 1 (Mar 9)
- [ ] TWAMMHook.sol deployed on Unichain testnet
- [ ] Proof of concept: submit order → execute chunks → complete
- [ ] Screenshot/video of working mechanism

### Update 2 (Mar 16)
- [ ] Reactive Network integration live on testnet
- [ ] Cross-chain price monitoring working
- [ ] Frontend complete with execution logs
- [ ] Demo presentation ready

### Final Submission (Mar 19)
- [ ] Production deployment
- [ ] Demo video (2-3 minutes)
- [ ] Complete documentation
- [ ] Code repository with README

---

## Resources

### Reactive Network
- [Blog: Unichain Integration](https://blog.reactive.network/reactive-network-integrates-with-unichain/)
- [Dev Docs](https://dev.reactive.network/)
- [GitHub Examples](https://github.com/reactive-network/)

### Unichain & Uniswap v4
- [Unichain Docs](https://docs.unichain.org/)
- [v4 Hooks Docs](https://docs.uniswap.org/contracts/v4/concepts/hooks)
- [Building Your First Hook](https://docs.uniswap.org/contracts/v4/guides/hooks/your-first-hook)

### TWAMM Reference
- [Paradigm TWAMM Paper](https://www.paradigm.xyz/2021/07/twamm)
- [Awesome v4 Hooks](https://github.com/fewwwww/awesome-uniswap-hooks)

---

*Created: Feb 24, 2026*
*Last Updated: Feb 24, 2026*