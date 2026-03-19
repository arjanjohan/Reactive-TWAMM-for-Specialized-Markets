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
- **TWAMM Hook:** [`0x323cDD447000e5F9CCF1E07444898A92548410C0`](https://sepolia.uniscan.xyz/address/0x323cDD447000e5F9CCF1E07444898A92548410C0)
- **Reactive callback proxy:** [`0x9299472A6399Fd1027ebF067571Eb3e3D7837FC4`](https://sepolia.uniscan.xyz/address/0x9299472A6399Fd1027ebF067571Eb3e3D7837FC4)

### Reactive Lasna (automation layer)
- **ReactiveTWAMM:** [`0xeAD58F77d28d30C3144e7D8CA56F3b54459cEC76`](https://lasna.reactscan.net/address/0xeAD58F77d28d30C3144e7D8CA56F3b54459cEC76)
- **System contract:** `0x0000000000000000000000000000000000fffFfF`

### Architecture: Event-Driven RVM Auto-Registration

The ReactiveTWAMM contract uses a fully event-driven architecture:

1. On deployment, `initialize()` subscribes to 4 event types:
   - **CRON10** — periodic trigger (~every 10 blocks on Lasna)
   - **OrderRegisteredReactive** — auto-registers new orders from Unichain in RVM state
   - **OrderCancelled** / **OrderCompleted** — auto-deregisters orders

2. When a user submits a TWAMM order on Unichain, the hook emits `OrderRegisteredReactive`. The RVM picks this up via `react()` and stores the order.

3. Each CRON tick, `react()` iterates active orders and emits `Callback` events that the Reactive infra delivers to Unichain as `executeTWAMMChunkReactive()` calls.

**Dual funding requirement:**
- **Lasna**: The ReactiveTWAMM contract needs REACT (native token) for RVM execution fees via `depositTo(contractAddr)` on system contract
- **Unichain**: The callback proxy needs ETH deposited via `depositTo(hookAddr)` for cross-chain delivery fees. Reactive infra charges the **target contract** (hook), not the sender

| Milestone | Status | Date |
|-----------|--------|------|
| ✅ Foundry Setup | Complete | Feb 27 |
| ✅ Core TWAMM Hook | Complete | Feb 27 |
| ✅ Test Coverage | Complete (32/32) | Mar 9 |
| ✅ Reactive Integration | Complete | Mar 18 |
| ✅ Frontend | Complete | Mar 18 |

---

## 🔧 What This Hook Does

Large trades in illiquid markets cause massive slippage. Traditional AMMs execute immediately, hurting the trader. TWAMM solves this by breaking large orders into chunks executed over time—but it requires someone to trigger each chunk.

### How It Works

1. **User submits** a large trade into the TWAMM hook on Unichain
2. **Hook stores** order parameters and emits `OrderRegisteredReactive`
3. **ReactVM auto-registers** the order by listening to the event via `react()`
4. **CRON fires** every ~10 blocks on Lasna, triggering `react()` which emits `Callback` events
5. **Reactive infra delivers** callbacks to Unichain, executing `executeTWAMMChunkReactive()`
6. **Hook executes** each chunk as a swap via Uniswap v4
7. **Repeat** until all chunks complete, then user claims output

---

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│  User Frontend  │───▶│   Unichain Sepolia    │    │   Reactive Lasna     │
│  (Next.js App)  │    │                        │    │                      │
│                 │    │  TWAMMHook             │◀───│  ReactiveTWAMM       │
│  - Submit order │    │  - submitTWAMMOrder()  │    │  - react() (RVM)     │
│  - Fund both    │    │  - executeTWAMMChunk() │    │  - CRON10 trigger    │
│    chains       │    │                        │    │  - Auto-register     │
│  - Monitor      │    │  Callback Proxy        │    │    orders via events │
│                 │    │  - depositTo() (fund)  │    │                      │
│                 │    │  - delivers callbacks  │    │  System Contract     │
│                 │    │                        │    │  - depositTo() (fund)│
└─────────────────┘    └──────────────────────┘    └──────────────────────┘
                              │
                              ▼
                      ┌──────────────────┐
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

# Test (32 tests across 4 suites)
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

Important:
- The hook is **immutable**. Re-running the deploy script does **not** upgrade code at an existing hook address.
- Treat the deployment as valid only if you can confirm the new tx on Uniscan and the resulting hook address is the one you intend to use.
- If the reported hook address is the same as an existing deployment, do **not** assume the live hook was upgraded. Verify the tx and bytecode before proceeding.
- If you want to force a genuinely new hook address, set `HOOK_ADDRESS_TO_AVOID=<old hook>` before deployment.
- If you want to resume salt mining from a later point, set `HOOK_SALT_START=<number>`.

Capture the output addresses:
- `TWAMM_HOOK_ADDRESS` (the CREATE2-mined hook)
- `REACTIVE_TWAMM_ADDRESS`

Update `deployments/addresses.json` with the new `twammHook` and `reactiveTwamm` values.

### Step 2: Sync addresses

```bash
node script/sync_addresses.mjs
source .env.addresses
```

This regenerates `.env.addresses`, `frontend/app/addresses.ts`, and `frontend/contracts/externalContracts.ts` from the single source of truth.

### Step 3: Setup demo environment (tokens + pool + liquidity)

Deploys fresh USDC/REACT demo tokens, creates a Uniswap v4 pool with the hook, and adds full-range liquidity.
The default pool initialization price is now a realistic REACT/USD starting point instead of the old raw `1:1` setup.
Override it with `DEMO_SQRT_PRICE_X96` if you want a different starting price.

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

### Step 5: Deploy ReactiveTWAMM to Lasna

Redeploy the Lasna `ReactiveTWAMM` when the target hook changes, or when you explicitly want a fresh Lasna instance for testing. If the Unichain hook address did not actually change, a Lasna redeploy is usually unnecessary.

```bash
# Deploy (also seeds the Lasna contract with 0.5 native token)
TWAMM_HOOK=$TWAMM_HOOK forge script script/DeployReactiveLasna.s.sol \
  --rpc-url $LASNA_RPC --broadcast -vvv
```

Update `reactiveLasna.reactiveTwamm` in `addresses.json` and re-sync.

### Step 6: Initialize subscriptions on Lasna

Must be called separately after deployment (cannot be done in constructor on Reactive Network):

```bash
cast send $LASNA_REACTIVE_TWAMM "initialize()" \
  --rpc-url $LASNA_RPC --private-key $PRIVATE_KEY
```

### Step 7: Fund callback delivery on Unichain

The callback proxy on Unichain needs ETH to pay for cross-chain callback delivery. **Important:** Reactive infra charges the **target contract** (the hook that receives callbacks), not the sender. Fund using `depositTo(hookAddress)`:

```bash
cast send $REACTIVE_CALLBACK_UNICHAIN \
  "depositTo(address)" $TWAMM_HOOK \
  --rpc-url $UNICHAIN_RPC --private-key $PRIVATE_KEY \
  --value 0.02ether
```

Check reserves and debt:
```bash
cast call $REACTIVE_CALLBACK_UNICHAIN \
  "reserves(address)(uint256)" $TWAMM_HOOK \
  --rpc-url $UNICHAIN_RPC

cast call $REACTIVE_CALLBACK_UNICHAIN \
  "debts(address)(uint256)" $TWAMM_HOOK \
  --rpc-url $UNICHAIN_RPC
```

If the hook has debt, callbacks will be silently dropped. The error on ReactScan reads: "We were unable to send callback because the destination Smart Contract is in debt".

### Step 8: Fund RVM execution on Lasna

The ReactiveTWAMM contract needs REACT (native token) for RVM execution fees:

```bash
cast send 0x0000000000000000000000000000000000fffFfF \
  "depositTo(address)" $LASNA_REACTIVE_TWAMM \
  --rpc-url $LASNA_RPC --private-key $PRIVATE_KEY \
  --value 0.5ether
```

### Verification

```bash
# Verify contracts on block explorers
./script/verify_all.sh

# Quick smoke test: submit an order + execute a chunk
forge script script/SmokeTWAMM.s.sol --rpc-url $UNICHAIN_RPC --broadcast -vvv
```

`verify_all.sh` verifies:
- `TWAMMHook` on Unichain Sepolia
- the Unichain-side `ReactiveTWAMM` companion deployment
- the Lasna `ReactiveTWAMM`

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

## 🤖 Arbitrage Bot

The project includes a demo arbitrage bot (`script/arb_bot.mjs`) that watches for TWAMM chunk executions and nudges the pool price back toward the market rate.

### What it does

1. **Watches `ChunkExecuted` events** on the TWAMMHook contract
2. **Fetches REACT market price** from CoinGecko
3. **Compares pool execution price** vs market price
4. **Runs micro-swap cycles** (multiple small swaps over ~1 minute) to correct deviations above threshold
5. **Optional noise swaps** — periodic small swaps to generate price observations for the chart

### Running the bot

```bash
# Required: a funded Unichain Sepolia wallet
BOT_PK=0x<your-private-key> node script/arb_bot.mjs
```

The bot reads addresses from environment variables (auto-synced from `addresses.json` via `.env`). No hardcoded addresses needed.

### Configuration (env vars)

| Variable | Default | Description |
|---|---|---|
| `BOT_PK` / `PRIVATE_KEY` | — | Bot wallet private key (required) |
| `UNICHAIN_RPC` | `https://sepolia.unichain.org` | Unichain RPC URL |
| `ARB_MAX_DEV_PCT` | `0.75` | Min price deviation % to trigger arb |
| `ARB_MICRO_SWAPS` | `4` | Number of micro-swaps per correction cycle |
| `ARB_CYCLE_SECONDS` | `60` | Duration of one arb cycle |
| `ARB_SWAP_USDC` | `50` | USDC amount per arb cycle (when buying REACT) |
| `ARB_SWAP_REACT` | `50` | REACT amount per arb cycle (when selling REACT) |
| `ARB_NOISE_ENABLED` | `false` | Enable periodic noise swaps |
| `ARB_NOISE_MINUTES` | `3` | Interval between noise swaps |
| `ARB_NOISE_USDC` | `5` | USDC amount per noise swap |

The bot uses demo `MockERC20` tokens that have a public `mint()` function — it auto-mints tokens when its balance is insufficient.

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
- `frontend/contracts/externalContracts.ts` — scaffold-eth debug UI references

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
