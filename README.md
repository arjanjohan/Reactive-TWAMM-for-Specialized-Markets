# 🎯 Reactive TWAMM for Specialized Markets

From Atrium Academy: Build hooks that focus on **Specialized Markets** - non-standard AMM use cases that go beyond basic token swaps.

**What counts as "Specialized Markets":**
- Prediction markets
- Derivatives (options, perps)
- Real World Assets (RWA)
- Custom curves for specific asset types
- Time-weighted execution strategies
- Cross-chain/market arbitrage

---

## 💡 Hook Ideas

### Tier 1: Strong Match (Recommended)

#### 1. Reactive TWAMM for Specialized Markets ⭐

**Concept:**
Time-Weighted AMM hook that uses Reactive Network to automate large trades in illiquid markets (RWA, prediction markets, exotic derivatives).

**Why it wins:**
- ✅ Directly uses Reactive Network for automation (their exact use case)
- ✅ Leverages Unichain's 200ms latency for execution
- ✅ Fits "Specialized Markets" theme perfectly
- ✅ Matches Reactive's blog post example exactly
- ✅ Your Canopy experience with automated strategies transfers

**How it works:**
1. User initiates large trade in illiquid pool
2. Hook breaks trade into smaller chunks over time (TWAMM)
3. Reactive contracts monitor price on other chains
4. When conditions met, Reactive triggers execution via Unichain's low latency
5. Gas-efficient batching via Reactive's parallel EVM

**Sponsor alignment:**
- Reactive: Cross-chain automation + TWAMM execution
- Unichain: Low-latency execution + v4 hooks

## 🛠️ Technical Architecture

### Components:

1. **Uniswap v4 Hook Contract**
   - `afterSwap()` - Track trade chunks
   - `afterInitialize()` - Set up TWAMM params
   - Custom: `executeTWAMMChunk()` - Called by Reactive

2. **Reactive Smart Contract**
   - Listens for: Price events, time intervals
   - Triggers: TWAMM execution on Unichain
   - Cross-chain: Monitors Base/Arbitrum for reference prices

3. **Frontend (Optional for hackathon)**
   - Show TWAMM progress
   - Display cross-chain price feeds
   - Reactive execution logs

### Data Flow:

```
User deposits large trade
    ↓
v4 Hook stores TWAMM params
    ↓
Reactive monitors (time + price on other chains)
    ↓
Conditions met → Reactive triggers execution
    ↓
Unichain hook executes next chunk
    ↓
Repeat until trade complete
```

---

## 🤔 Open Questions

1. Which specialized market to focus on? Options:
   - RWA (Real World Assets like real estate tokens)
   - Prediction markets
   - Exotic derivatives (volatility, baskets)
   - Low-liquidity long-tail assets

2. Simple frontend or just contracts?