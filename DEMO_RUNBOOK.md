# Live Demo Runbook (Unichain Sepolia + Reactive)

## Network Facts
- Unichain Sepolia PoolManager: `0x00B036B58a818B1BC34d502D3fE730Db729e62AC`
- TWAMM Hook (deployed): `0x0E7849e4034146B37bb590c7E81D8BFAAAc210C0`
- ReactiveTWAMM (deployed): `0x62329f582D5865fb1459a9ba7384F9cdE55aF331`
- Reactive callback proxy (official): `0x9299472A6399Fd1027ebF067571Eb3e3D7837FC4`

## Phase 0 — Pre-flight (before presentation day)
1. Ensure `.env` has:
   - `PRIVATE_KEY`
   - `UNICHAIN_RPC`
2. Run local verification:
   ```bash
   forge test
   ```
   Expect: `22 passed, 0 failed`.
3. Pre-fund deployer wallet with enough Unichain Sepolia ETH + tokens for smoke scripts.

## Phase 1 — On-chain dry run (recommended before live demo)

### 1) Create a smoke order
```bash
forge script script/SmokeTWAMM.s.sol \
  --rpc-url $UNICHAIN_RPC \
  --broadcast
```
Capture:
- TokenA address
- TokenB address
- `orderId`

### 2) Execute first chunk + verify progress
Update `script/ExecuteSmokeChunk.s.sol` constants (`TOKEN0`, `TOKEN1`, `ORDER_ID`) from step 1 output, then:
```bash
forge script script/ExecuteSmokeChunk.s.sol \
  --rpc-url $UNICHAIN_RPC \
  --broadcast
```
Expect:
- `Executed before: 0`
- `Executed after: 1`

### 3) Explorer verification
In Uniscan, show:
- order submission tx
- chunk execution tx
- emitted events + state progress

## Phase 2 — Live presentation flow (2-3 minutes)
1. Problem statement: large trades in illiquid markets cause slippage.
2. Show architecture: TWAMM hook + Reactive automation.
3. Show local confidence:
   ```bash
   forge test
   ```
4. Show existing Unichain Sepolia deployment addresses.
5. Run chunk execution script (or replay from recorded dry run if network unstable).
6. Show order progress increment onchain.
7. Mention official callback proxy support now live on Unichain Sepolia.

## Contingency Plan
If RPC/testnet is flaky during presentation:
- Use recorded dry-run tx hashes and explorer pages.
- Still run `forge test` live to prove deterministic local correctness.

## Talking Points
- Real PoolManager unlock accounting tested.
- Slippage guard tested (`minOutputPerChunk` + revert path).
- Reactive callback authorization path tested.
- Unichain Sepolia is now live as origin + destination on Reactive.
