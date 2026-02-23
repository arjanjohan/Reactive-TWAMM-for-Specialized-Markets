# UHI Hookathon Research & Ideas

> **Theme:** Specialized Markets  
> **Sponsors:** Reactive Network + Unichain  
> **Timeline:** March 2-19, 2026 (3 weeks)

---

## 📅 Key Dates

| Milestone | Date | Days Left | Deliverable |
|-----------|------|-----------|-------------|
| Proposal Due | March 2 | 7 days | Hook idea submission |
| Update 1 | March 9 | 14 days | Core mechanism working |
| Update 2 | March 16 | 21 days | Sponsor integrations |
| Final Submission | March 19 | 24 days | Polish + demo |

---

## 🎯 Theme: Specialized Markets

From Atrium Academy: Build hooks that focus on **Specialized Markets** - non-standard AMM use cases that go beyond basic token swaps.

**What counts as "Specialized Markets":**
- Prediction markets
- Derivatives (options, perps)
- Real World Assets (RWA)
- Custom curves for specific asset types
- Time-weighted execution strategies
- Cross-chain/market arbitrage

---

## 🔍 Sponsor Research

### Reactive Network

**What they want:**
- Cross-chain automation using Reactive contracts
- Event-driven execution (contracts listen & react to events across chains)
- TWAMM (Time-Weighted AMM) automation
- Oracle-based limit orders
- RWA pool automation
- Multi-chain capabilities

**Key insight from their blog:**
> "Reactive contracts can automate these processes, removing the need for manual execution. Large trades in illiquid RWA pools could be finalized automatically — with executeTWAMMOrders() running at set intervals."

**Tech stack:**
- EVM-compatible execution layer
- Listens for event logs from multiple chains
- Triggers Solidity logic in response
- Parallelized EVM implementation

### Unichain

**What they want:**
- Low-latency hooks (200ms "sub-blocks")
- High-frequency trading optimization
- Superchain interoperability
- DeFi-focused innovations

**Key specs:**
- Chain ID: 130
- Built on OP Stack
- Part of Optimism Superchain
- EVM-equivalent (deploy Ethereum contracts directly)
- Home of Uniswap v4

---

## 💡 Hook Ideas

### Tier 1: Strong Match (Recommended)

#### 1. Reactive TWAMM for Specialized Markets ⭐ BEST FIT

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

---

#### 2. Cross-Chain Limit Order Hook

**Concept:**
Limit orders that execute when price hits target on ANY chain in the Superchain ecosystem.

**Why it works:**
- ✅ Uses Reactive for cross-chain price monitoring
- ✅ Unichain for fast execution
- ✅ Specialized for traders who care about best price across chains

**Tech:**
- Reactive listens for price events on Base, Arbitrum, Optimism
- When threshold hit, triggers Unichain execution
- Users deposit collateral once, trade anywhere

---

### Tier 2: Medium Match (Needs Adaptation)

#### 3. Superchain Arbitrage Hook

**Concept:**
Automated arbitrage across Unichain/Base/Arbitrum using Reactive to monitor prices.

**Sponsor fit:**
- Reactive: Multi-chain monitoring
- Unichain: Fast execution venue

**Risk:** May be too generic for "Specialized Markets"

---

#### 4. RWA Pool Automator

**Concept:**
Specialized AMM for Real World Assets with automated order execution.

**Sponsor fit:**
- Reactive specifically mentioned RWA pools in blog post
- Good for illiquid assets

**Needs:** Clear RWA angle (oracles, compliance, etc.)

---

### Tier 3: Weak Match (Skip)

#### 5. Median Market Hook

**Concept:**
AMM using median price from multiple sources.

**Why weak:**
- ❌ No clear Reactive integration point
- ❌ Not differentiated for hackathon
- ❌ Doesn't leverage sponsor tech

---

## 🏆 Recommendation

**GO WITH: Reactive TWAMM for Specialized Markets**

### Why this wins:

1. **Perfect sponsor alignment:**
   - Reactive gets their exact use case showcased (TWAMM automation)
   - Unichain gets to show off low-latency execution
   - Both sponsors incentivized to help/debug/promote

2. **Clear "Specialized Markets" angle:**
   - Designed specifically for illiquid/market-insensitive assets
   - TWAMM is specialized execution, not basic swap

3. **Doable in 3 weeks:**
   - Core TWAMM logic exists in v4 reference implementations
   - Reactive integration is straightforward (they have SDK)
   - Can build on top of existing hook templates

4. **Demo impact:**
   - Visual: Show large trade executing smoothly over time
   - Technical: Cross-chain monitoring in real-time
   - Business: Solves real problem (slippage on large trades)

---

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

## 📚 Resources

### Reactive Network
- [Blog: Unichain Integration](https://blog.reactive.network/reactive-network-integrates-with-unichain-to-power-next-gen-v4-hooks/)
- [Docs](https://dev.reactive.network/)
- [Website](https://reactive.network/)

### Unichain
- [Chain ID: 130](https://mainnet.unichain.org)
- [Explorer](https://uniscan.xyz)
- [Docs](https://docs.unichain.org/)

### Uniswap v4
- [Hooks Docs](https://docs.uniswap.org/contracts/v4/concepts/hooks)
- [Building Your First Hook](https://docs.uniswap.org/contracts/v4/guides/hooks/your-first-hook)
- [Awesome Hooks GitHub](https://github.com/fewwwww/awesome-uniswap-hooks)

### Hook Examples
- [Prediction Market Hook](https://github.com/shift0x/uniswap-v4-prediction-market-hook)
- [Orderbook Hook](https://github.com/jamesbachini/Orderbook-Hook)

---

## ✅ Action Items

### This Week (Before March 2):

- [ ] Decide: Solo or team?
- [ ] Finalize hook idea (Reactive TWAMM recommended)
- [ ] Submit proposal by March 2 deadline
- [ ] Set up dev environment
  - [ ] Foundry/Hardhat
  - [ ] Unichain testnet
  - [ ] Reactive SDK

### Week 1 (March 2-9):

- [ ] Core TWAMM hook contract
- [ ] Basic testing on local fork
- [ ] Update 1 submission

### Week 2 (March 9-16):

- [ ] Reactive integration
- [ ] Cross-chain monitoring
- [ ] Update 2 submission

### Week 3 (March 16-19):

- [ ] Polish & bug fixes
- [ ] Demo video
- [ ] Final submission

---

## 🤔 Open Questions

1. Which specialized market to focus on? Options:
   - RWA (Real World Assets like real estate tokens)
   - Prediction markets
   - Exotic derivatives (volatility, baskets)
   - Low-liquidity long-tail assets

2. Simple frontend or just contracts?