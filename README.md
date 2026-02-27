# Reactive TWAMM for Specialized Markets

**Hookathon:** UHI (Uniswap Hook Incubator) - Specialized Markets Track  
**Sponsors:** Reactive Network + Unichain  
**Timeline:** March 2-19, 2026

---

## 🎯 Elevator Pitch

Time-weighted automated market maker (TWAMM) hook for Uniswap v4 that uses Reactive Network to automate large trades in illiquid specialized markets (RWA, prediction markets, exotic derivatives) on Unichain's low-latency chain.

---

## 📝 Project Status

| Milestone | Status | Date |
|-----------|--------|------|
| ✅ Foundry Setup | Complete | Feb 27 |
| ✅ Core TWAMM Hook | Complete | Feb 27 |
| 🔄 Test Coverage | In Progress | - |
| ⏳ Reactive Integration | Pending | Week 2 |
| ⏳ Frontend (optional) | Pending | Week 3 |

---

## 🔧 What This Hook Does

Large trades in illiquid markets cause massive slippage. Traditional AMMs execute immediately, hurting the trader. TWAMM solves this by breaking large orders into chunks executed over time—but it requires someone to trigger each chunk.

### How It Works

1. **User deposits** a large trade into the TWAMM hook
2. **Hook stores** order parameters (amount, duration, chunk size)
3. **Reactive Network monitors:**
   - Time intervals (when to execute next chunk)
   - Price conditions on other chains (prevent execution if adverse)
4. **Reactive triggers** `executeTWAMMChunk()` on Unichain
5. **Hook executes** the chunk via Uniswap v4
6. **Repeat** until trade complete

---

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  User Frontend  │───▶│ Uniswap v4 Hook  │◀───│    Reactive     │
│ (React - Wk 3)  │    │   (TWAMM Logic)    │    │    Contract     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                      ┌──────────────────┐
                      │     Unichain     │
                      │  Uniswap v4 Pool │
                      └──────────────────┘
```

---

## 💡 Why This Project Wins

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

## 🛠️ Tech Stack

- **Solidity ^0.8.26** - Hook implementation
- **Foundry** - Testing & deployment
- **Uniswap v4** - Core AMM integration
- **Reactive SDK** - Cross-chain automation (Week 2)
- **Unichain** - Execution layer

---

## 📦 Getting Started

```bash
# Install dependencies
forge install

# Build
forge build

# Test
forge test

# Run with verbosity
forge test -vv
```

---

## 📁 Project Structure

```
├── src/
│   └── TWAMMHook.sol          # Main hook implementation
├── test/
│   └── TWAMMHook.t.sol        # Test suite (11 tests passing ✅)
├── lib/
│   ├── v4-core/               # Uniswap v4 core contracts
│   ├── v4-periphery/          # Uniswap v4 periphery
│   └── forge-std/             # Foundry std lib
├── foundry.toml               # Foundry config
├── IDEA-1-TWAMM.md            # Detailed technical spec
└── README.md                  # This file
```

---

## 📊 Test Coverage

Current: **11/11 tests passing**

```
[PASS] test_CancelOrder
[PASS] test_Constructor
[PASS] test_EnableTWAMM
[PASS] test_GetOrderProgress
[PASS] test_GetPoolOrders
[PASS] test_RevertIf_InvalidAmount
[PASS] test_RevertIf_InvalidDuration
[PASS] test_RevertIf_NotOwner
[PASS] test_RevertIf_OrderNotFound
[PASS] test_RevertIf_TWAMMNotEnabled
[PASS] test_SubmitOrder
```

---

## 📝 Proposal Deliverables

### March 2 - Proposal Submission
- ✅ Hook concept & architecture
- ✅ Initial implementation scaffold
- ✅ Test suite demonstrating core logic
- 🔄 Demo video (optional, can defer to Week 3)

### March 9 - Update 1
- ✅ Core TWAMM hook deployed on Unichain testnet
- ✅ Order submission → chunk execution flow working
- 🔄 Screenshot/video of working mechanism

### March 16 - Update 2
- ✅ Reactive Network integration live
- ✅ Cross-chain price monitoring
- ✅ Frontend with execution logs
- 🔄 Demo presentation ready

### March 19 - Final Submission
- ✅ Production deployment
- ✅ Complete documentation
- ✅ 2-3 minute demo video

---

## 🔗 Resources

- [Paradigm TWAMM Paper](https://www.paradigm.xyz/2021/07/twamm)
- [Uniswap v4 Hooks Docs](https://docs.uniswap.org/contracts/v4/concepts/hooks)
- [Reactive Network Blog - Unichain Integration](https://blog.reactive.network/reactive-network-integrates-with-unichain/)
- [Unichain Docs](https://docs.unichain.org/)

---

## 📄 License

MIT

---

**Built for the UHI Hookathon 2026** 🦄
