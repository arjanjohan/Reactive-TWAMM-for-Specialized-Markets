# Judges Q&A (Hookathon / Reactive Bounty)

## 1) What is live today?
- **Unichain Sepolia**: TWAMM hook deployed and integrated into pool flow.
- **Reactive Lasna**: ReactiveTWAMM deployed and exercised on-chain.
- Verified txs are listed in README under deployment/evidence.

## 2) Are you using Reactive in a real way or just a mock?
- We are live on **Reactive Lasna** with real transactions (`subscribe`, `batchExecute`) and emitted automation events.
- `_triggerExecution` now emits Reactive `Callback(chain_id, contract, gas_limit, payload)` with an encoded `executeTWAMMChunk(...)` payload.
- This gives a real callback instruction path on Reactive side, with tx-linked evidence.

## 3) Can this move from scaffold to full cross-chain callback?
Yes. The short path is:
1. Replace `_triggerExecution` internals with Reactive callback transport call.
2. Keep existing callback-auth checks (proxy + RVM ID validation pattern).
3. Run E2E on testnets: origin trigger → Lasna react → destination execution.
4. Add tx-link evidence for all three legs.

## 4) Why use Reactive instead of off-chain keepers?
- Reduces reliance on centralized cron/keeper infra.
- Event-driven automation model aligns with TWAMM chunk execution.
- Better transparency for judges/users through on-chain trigger traces.

## 5) What are the main risks and mitigations?
- **Execution safety**: slippage floor per chunk + pause controls.
- **Callback authenticity**: callback proxy/RVM-ID checks.
- **Operational risk**: publish tx-linked evidence and rehearsal scripts.

## 6) What remains before final submission?
- Finalize full callback transport in `_triggerExecution`.
- Record one clean E2E demo showing the complete flow.
- Keep docs explicit about what is production-ready vs scaffolded.
