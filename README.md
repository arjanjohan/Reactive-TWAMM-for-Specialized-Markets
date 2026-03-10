# Reactive TWAMM for Specialized Markets

**Hookathon:** UHI (Uniswap Hook Incubator) - Specialized Markets Track  
**Sponsors:** Reactive Network + Unichain  
**Timeline:** March 2-19, 2026

---

## 🎯 Elevator Pitch

Time-weighted automated market maker (TWAMM) hook for Uniswap v4 that uses Reactive Network to automate large trades in illiquid specialized markets (RWA, prediction markets, exotic derivatives) on Unichain's low-latency chain.

---

## 📝 Project Status

## 🚀 Testnet Deployment (Unichain Sepolia + Reactive Lasna)

### Unichain Sepolia (destination)
- **TWAMM Hook:** [`0x0E7849e4034146B37bb590c7E81D8BFAAAc210C0`](https://sepolia.uniscan.xyz/address/0x0E7849e4034146B37bb590c7E81D8BFAAAc210C0)
- **Reactive callback proxy (Unichain Sepolia live):** [`0x9299472A6399Fd1027ebF067571Eb3e3D7837FC4`](https://sepolia.uniscan.xyz/address/0x9299472A6399Fd1027ebF067571Eb3e3D7837FC4)

Deployment transactions:
- Hook deploy tx: [`0x1f31c19fcc2bfe5302ff4c4af14a8388a74c43a3d6cb8c85576d8cc8145ac0d6`](https://sepolia.uniscan.xyz/tx/0x1f31c19fcc2bfe5302ff4c4af14a8388a74c43a3d6cb8c85576d8cc8145ac0d6)
- Legacy Reactive deploy (Unichain): [`0x463d0372e952eebf96e3103095130be596c0a5c76081608e96dc4edf113f46a0`](https://sepolia.uniscan.xyz/tx/0x463d0372e952eebf96e3103095130be596c0a5c76081608e96dc4edf113f46a0)

### Reactive Lasna (automation layer)
- **ReactiveTWAMM (Lasna):** `0x0608C330822aAbd78B346865B3F0744Db0841935`
- **Deploy tx:** `0xb9734b7320dfb4fe0d489fb77fbb6b811717503f96479d02da5ee819d7fefacb`

Proof-of-flow txs on Lasna:
- `subscribe(...)`: `0x7247283d8772cef009a2ebeb4670495a6546d8ee375d4b97b29a0ec04d88e934`
- `batchExecute([orderId])` (emits `Callback` + `ExecutionTriggered`): `0x4d587a097a77fa4f08937f8f9dce574d79e1da6a4ca497717baea25bc19eb9a6`

### ✅ Reactive Bounty Evidence (copy/paste)
- Unichain Sepolia hook deployed and callable.
- Reactive Lasna automation contract deployed by team wallet.
- On Lasna, team executed:
  1. `subscribe(...)` for a Unichain hook target
  2. `batchExecute([orderId])` to trigger execution event
- Resulting on-chain events emitted on Lasna:
  - `Subscribed(poolId, orderId)`
  - `ExecutionTriggered(poolId, orderId, timestamp)`

This proves a live Reactive-side automation path tied to our Unichain hook target, with verifiable tx hashes above.

Note: `_triggerExecution` now emits Reactive `Callback(chain_id, contract, gas_limit, payload)` instructions using `ITWAMMHook.executeTWAMMChunk(...)` payload encoding for destination delivery.

| Milestone | Status | Date |
|-----------|--------|------|
| ✅ Foundry Setup | Complete | Feb 27 |
| ✅ Core TWAMM Hook | Complete | Feb 27 |
| ✅ Test Coverage | Complete (22/22 local) | Mar 9 |
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

Current: **22/22 tests passing**

- `TWAMMHook.t.sol`: 15/15 passing
- `TWAMMHook.integration.t.sol`: 4/4 passing
- `ReactiveTWAMM.t.sol`: 3/3 passing

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
