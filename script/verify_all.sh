#!/usr/bin/env bash
set -euo pipefail

# Verify deployed contracts for:
# - Unichain Sepolia (TWAMMHook) via Blockscout API
# - Reactive Lasna (ReactiveTWAMM) via Reactive Sourcify endpoint

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -f ".env.addresses" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.addresses
  set +a
fi

TWAMM_HOOK_ADDR="${TWAMM_HOOK:-}"
POOL_MANAGER_ADDR="${UNICHAIN_POOL_MANAGER:-}"
DEPLOYER_ADDR="${DEPLOYER_ADDRESS:-}"
UNICHAIN_REACTIVE_ADDR="${REACTIVE_TWAMM:-}"
LASNA_REACTIVE_ADDR="${LASNA_REACTIVE_TWAMM:-}"

if [[ -z "$TWAMM_HOOK_ADDR" || -z "$POOL_MANAGER_ADDR" || -z "$DEPLOYER_ADDR" || -z "$UNICHAIN_REACTIVE_ADDR" || -z "$LASNA_REACTIVE_ADDR" ]]; then
  echo "Missing required env vars. Need: TWAMM_HOOK, UNICHAIN_POOL_MANAGER, DEPLOYER_ADDRESS, REACTIVE_TWAMM, LASNA_REACTIVE_TWAMM"
  exit 1
fi

echo "== Verifying TWAMMHook on Unichain Sepolia =="
forge verify-contract \
  --verifier blockscout \
  --verifier-url https://unichain-sepolia.blockscout.com/api/ \
  "$TWAMM_HOOK_ADDR" \
  src/TWAMMHook.sol:TWAMMHook \
  --constructor-args "$(cast abi-encode "constructor(address,address)" "$POOL_MANAGER_ADDR" "$DEPLOYER_ADDR")"

echo
echo "== Verifying ReactiveTWAMM on Unichain Sepolia =="
forge verify-contract \
  --verifier blockscout \
  --verifier-url https://unichain-sepolia.blockscout.com/api/ \
  "$UNICHAIN_REACTIVE_ADDR" \
  src/ReactiveTWAMM.sol:ReactiveTWAMM \
  --constructor-args "$(cast abi-encode "constructor(address)" "$TWAMM_HOOK_ADDR")"

echo
echo "== Verifying ReactiveTWAMM on Lasna =="
forge verify-contract \
  --watch \
  --verifier sourcify \
  --verifier-url https://sourcify.rnk.dev/ \
  --chain-id 5318007 \
  "$LASNA_REACTIVE_ADDR" \
  src/ReactiveTWAMM.sol:ReactiveTWAMM \
  --constructor-args "$(cast abi-encode "constructor(address)" "$TWAMM_HOOK_ADDR")"

echo
echo "✅ Verification commands submitted/completed."
