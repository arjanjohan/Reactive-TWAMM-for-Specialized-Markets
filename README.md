# Reactive TWAMM for Specialized Markets

**Hookathon:** UHI (Uniswap Hook Incubator) - Specialized Markets Track  
**Sponsors:** Reactive Network + Unichain  
**Timeline:** March 2-19, 2026

---

## 🎯 Elevator Pitch

Time-weighted automated market maker (TWAMM) hook for Uniswap v4 that uses Reactive Network to automate large trades in illiquid specialized markets (RWA, prediction markets, exotic derivatives) on Unichain's low-latency chain.

---

## 📝 Project Status

## TODO
- [ ] Make TWAMM chunk cadence configurable (pool-level or bounded per-order parameter) instead of fully hardcoded `MIN_CHUNK_DURATION`, while preserving safe limits (`MAX_CHUNKS`, minimum duration guards).

## 🚀 Testnet Deployment (Unichain Sepolia + Reactive Lasna)

### Unichain Sepolia (destination)
- **TWAMM Hook (latest):** [`0x1Eb187eC6240924c192230bfBbde6FDF13ce50C0`](https://sepolia.uniscan.xyz/address/0x1Eb187eC6240924c192230bfBbde6FDF13ce50C0)
- **Reactive callback proxy (Unichain Sepolia live):** [`0x9299472A6399Fd1027ebF067571Eb3e3D7837FC4`](https://sepolia.uniscan.xyz/address/0x9299472A6399Fd1027ebF067571Eb3e3D7837FC4)
- **Reactive callback config tx (latest hook):** [`0x945bdee7a1e49a580babda60d595a60814bc4085fc66c5fc3d3a2aad32d1a3ce`](https://sepolia.uniscan.xyz/tx/0x945bdee7a1e49a580babda60d595a60814bc4085fc66c5fc3d3a2aad32d1a3ce)

Deployment transactions:
- Hook deploy tx (latest): [`0x422f0e5fdcf3d0483a81821bad5e15b94edb44079c0337ba328c0d483d1c8e83`](https://sepolia.uniscan.xyz/tx/0x422f0e5fdcf3d0483a81821bad5e15b94edb44079c0337ba328c0d483d1c8e83)
- ReactiveTWAMM deploy on Unichain: [`0x7feb7debab91d30f47334d32e81a40b54a067e9ed4ca6eda159ae18481b670e7`](https://sepolia.uniscan.xyz/tx/0x7feb7debab91d30f47334d32e81a40b54a067e9ed4ca6eda159ae18481b670e7)
- Smoke order submit on latest hook: [`0x023f32945a50db0e8285a67dce1f51d49062c6ea11bbd92503145e8dd211c8a7`](https://sepolia.uniscan.xyz/tx/0x023f32945a50db0e8285a67dce1f51d49062c6ea11bbd92503145e8dd211c8a7)

### Reactive Lasna (automation layer)
- **ReactiveTWAMM (Lasna, latest):** `0x7Ec9b8802342a119FACCd228b806eC49B4124D17`
- **Deploy tx (latest):** `0xb8a048765451439bd4cb81dc5b6296adeedf09e585b218b9e84e006bf1b4072f`
- **Cron subscription tx (`ensureCronSubscription`, latest):** `0x29fa63f6558a07fce197633b164d9c4c5e94fd468b2bca6ea09773c4dd301393`

Proof-of-flow txs on Lasna (latest, targeting latest Unichain hook):
- `subscribe(...)`: `0x8b1ea57725fdd06f614cbed99f4fa49058a34257cce8a30faadecea6261cee93`
- `batchExecute([orderId])` (emits `Callback` + `ExecutionTriggered`): `0x75f46b714ff69894a4637a2e4ba8ebd7d4b44cd93481e946ee43874fd9c67de0`

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

Note: `_triggerExecution` now emits Reactive `Callback(chain_id, contract, gas_limit, payload)` instructions using hardened payload encoding for `executeTWAMMChunkReactive(address rvmId, PoolKey, bytes32)` destination delivery.

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
