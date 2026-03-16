# Reactive TWAMM for Specialized Markets


<div align="center">

![logo](/frontend/public/logo.png)
<h4 align="center">
  <a href="https://reactive-twamm-for-specialized-mark.vercel.app">App</a> |
  <a href="https://scaffold-move-chi.vercel.app/">Demo video</a>
</h4>
</div>

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

# Test (24 tests across 3 suites)
forge test

# Run with verbosity
forge test -vv
```

---

## 🚢 Full Deployment Flow

### Prerequisites

Create a `.env` file with:

```bash
PRIVATE_KEY=0x...          # Deployer private key
UNICHAIN_RPC=https://sepolia.unichain.org
```

Load environment in every terminal session:

```bash
set -a; source .env; source .env.addresses; set +a
```

### Step 1: Deploy TWAMMHook to Unichain Sepolia

Deploys the TWAMM hook (with CREATE2 salt mining for correct hook permission flags) and a Unichain-side ReactiveTWAMM contract.

```bash
forge script script/DeployTWAMM.s.sol \
  --rpc-url $UNICHAIN_RPC --broadcast -vvv
```

Capture the output addresses:
- `TWAMM_HOOK_ADDRESS` (the CREATE2-mined hook)
- `REACTIVE_TWAMM_ADDRESS`

Update `deployments/addresses.json` with the new `twammHook` and `reactiveTwamm` values.

### Step 2: Sync addresses

```bash
node script/sync_addresses.mjs
source .env.addresses
```

This regenerates `.env.addresses` and `frontend/app/addresses.ts` from the single source of truth.

### Step 3: Setup demo environment (tokens + pool + liquidity)

Deploys fresh USDC/REACT demo tokens, creates a Uniswap v4 pool with the hook, and adds full-range liquidity.

```bash
forge script script/SetupDemoEnvironment.s.sol \
  --rpc-url $UNICHAIN_RPC --broadcast -vvv
```

Capture the output addresses (USDC, REACT, SWAP_EXECUTOR) and update the `demo` section in `deployments/addresses.json`, then re-sync:

```bash
node script/sync_addresses.mjs
source .env.addresses
```

### Step 4: Configure Reactive callback authorization

Authorizes the Reactive Network infrastructure to call `executeTWAMMChunkReactive` on the hook. Without this, Reactive-triggered chunk executions will revert.

**Important:** The second argument must be the **deployer EOA address** (`$DEPLOYER_ADDRESS`), NOT the Lasna contract address. Reactive Network overwrites the first `address` parameter in callback payloads with the RVM ID, which equals the deployer's EOA.

```bash
cast send $TWAMM_HOOK \
  "setReactiveCallbackConfig(address,address)" \
  $REACTIVE_CALLBACK_UNICHAIN $DEPLOYER_ADDRESS \
  --rpc-url $UNICHAIN_RPC --private-key $PRIVATE_KEY
```

### Step 5: Deploy ReactiveTWAMM to Lasna (if needed)

Only required on first deploy or if the Lasna contract needs changes. The existing Lasna deployment can be reused across hook redeploys since new subscriptions pass the hook address dynamically.

```bash
# Check Lasna wallet balance first
forge script script/CheckLasnaBalance.s.sol --rpc-url https://kopli-rpc.rkt.ink

# Deploy (funds contract with 0.1 ETH for Reactive service fees)
forge script script/DeployReactiveLasna.s.sol \
  --rpc-url https://kopli-rpc.rkt.ink --broadcast -vvv
```

Update `reactiveLasna.reactiveTwamm` in `addresses.json` and re-sync.

### Step 6: Setup cron subscription on Lasna

One-time bootstrap so the Reactive cron fires `react()` on each block to check for executable orders.

```bash
forge script script/SetupReactiveCron.s.sol \
  --rpc-url https://kopli-rpc.rkt.ink --broadcast -vvv
```

### Verification

```bash
# Verify contracts on block explorers
./script/verify_all.sh

# Quick smoke test: submit an order + execute a chunk
forge script script/SmokeTWAMM.s.sol --rpc-url $UNICHAIN_RPC --broadcast -vvv
```

### End-to-End Reactive Callback Test

Tests the full cross-chain flow: submit order on Unichain, trigger execution on Lasna, verify callback delivery back to Unichain.

**Step 1 — Unichain: Submit order** (deploys test tokens, pool, liquidity, and submits a TWAMM order):

```bash
forge script script/E2EReactiveTest.s.sol:E2E_Step1_SubmitOrder \
  --rpc-url $UNICHAIN_RPC --broadcast --slow -vvv
```

Copy `TOKEN0`, `TOKEN1`, and `ORDER_ID` from the output.

**Step 2 — Lasna: Subscribe + execute** (subscribes the order and calls `batchExecute` to emit a `Callback` event):

```bash
ORDER_ID=<from step 1> TOKEN0=<from step 1> TOKEN1=<from step 1> \
forge script script/E2EReactiveTest.s.sol:E2E_Step2_ReactiveExecute \
  --rpc-url https://lasna-rpc.rnk.dev --broadcast --slow -vvv
```

Check the `-vvv` trace for a `Callback(uint256,address,uint64,bytes)` event.

**Step 3 — Unichain: Verify delivery** (wait ~60s for Reactive infra, then check if chunk executed):

```bash
ORDER_ID=<from step 1> \
forge script script/E2EReactiveTest.s.sol:E2E_Step3_VerifyDelivery \
  --rpc-url $UNICHAIN_RPC -vvv
```

Reports `SUCCESS` if chunks executed, or a diagnostic checklist if the callback didn't land.

---

## 📍 Address Management

All deployed addresses live in `deployments/addresses.json` (single source of truth).

After any address change, sync to consumers:

```bash
node script/sync_addresses.mjs
```

This updates:
- `.env.addresses` — sourced by Foundry scripts and shell commands
- `frontend/app/addresses.ts` — imported by the Next.js frontend

The `externalContracts.ts` file in the frontend also references the hook/reactive addresses for the scaffold-eth debug UI — update manually if needed.

---

## 📁 Project Structure

```
├── src/
│   ├── TWAMMHook.sol          # Core TWAMM hook (Uniswap v4)
│   ├── ReactiveTWAMM.sol      # Reactive Network automation contract
│   ├── SimpleSwapExecutor.sol  # Swap execution helper
│   ├── interfaces/
│   │   └── ITWAMMHook.sol     # Hook interface
│   ├── MockERC20.sol          # Test token
│   └── TestToken.sol          # Test token
├── test/
│   ├── TWAMMHook.t.sol              # Unit tests (16 passing)
│   ├── TWAMMHook.integration.t.sol  # Integration tests (4 passing)
│   ├── ReactiveTWAMM.t.sol          # Reactive tests (4 passing)
│   └── ReactiveCallback.t.sol      # Cross-chain callback tests (8 passing)
├── script/
│   ├── DeployTWAMM.s.sol            # Deploy hook to Unichain
│   ├── DeployReactiveLasna.s.sol    # Deploy ReactiveTWAMM to Lasna
│   ├── SetupDemoEnvironment.s.sol   # Tokens + pool + liquidity
│   ├── SetupReactiveCron.s.sol      # Bootstrap cron on Lasna
│   ├── SmokeTWAMM.s.sol             # Smoke test order
│   ├── ExecuteSmokeChunk.s.sol      # Execute test chunk
│   ├── E2EReactiveTest.s.sol        # 3-step cross-chain E2E test
│   ├── VerifyReactiveFlow.s.sol     # Diagnostic scripts (Lasna + Unichain)
│   ├── sync_addresses.mjs           # Address sync utility
│   └── arb_bot.mjs                  # Arbitrage bot
├── frontend/                   # Next.js React dApp
├── deployments/
│   └── addresses.json          # Single source of truth
├── lib/
│   ├── v4-core/               # Uniswap v4 core
│   ├── v4-periphery/          # Uniswap v4 periphery
│   └── forge-std/             # Foundry std lib
├── foundry.toml               # Foundry config
├── IDEA-1-TWAMM.md            # Detailed technical spec
└── README.md                  # This file
```

---

## 📊 Test Coverage

Current: **32/32 tests passing**

- `TWAMMHook.t.sol`: 16/16 passing
- `TWAMMHook.integration.t.sol`: 4/4 passing
- `ReactiveTWAMM.t.sol`: 4/4 passing
- `ReactiveCallback.t.sol`: 8/8 passing (simulated cross-chain callback flow)

---

## 🔗 Links

- [Frontend](https://reactive-twamm-for-specialized-mark.vercel.app)
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
