# Unichain Sepolia Testnet Setup

## Wallet Created ✅

**Address:** `0xDC5a620525501023746cBB3dCe2A59edD30798ef`

**Private Key:** Stored in `.env` file (DO NOT COMMIT THIS FILE)

---

## Get Testnet ETH

You need Unichain Sepolia ETH to deploy contracts. Here are the faucets:

### 1. QuickNode Faucet (Recommended)
- **URL:** https://faucet.quicknode.com/unichain/sepolia
- **Amount:** 0.01 ETH
- **Cooldown:** 12 hours
- **Method:** Connect wallet and claim

### 2. Thirdweb Faucet
- **URL:** https://thirdweb.com/unichain-sepolia-testnet
- **Amount:** 0.01 ETH/day
- **Cooldown:** 24 hours

### 3. L2 Faucet (Alternative)
- **URL:** https://www.l2faucet.com/unichain
- **Method:** Device attestation (no social verification)

### 4. Unichain Official Faucet List
- **Docs:** https://docs.unichain.org/docs/tools/faucets

---

## How to Claim

1. Go to one of the faucet URLs above
2. Connect your wallet (address: `0xDC5a620525501023746cBB3dCe2A59edD30798ef`)
3. Click "Claim" or "Request"
4. Wait for transaction to confirm (usually within seconds)
5. Check balance:
   ```bash
   export PATH="$HOME/.foundry/bin:$PATH"
   cast balance 0xDC5a620525501023746cBB3dCe2A59edD30798ef --rpc-url https://sepolia.unichain.org
   ```

---

## Testnet Configuration

### Network Details
- **Network Name:** Unichain Sepolia
- **RPC URL:** https://sepolia.unichain.org
- **Chain ID:** 1301
- **Currency Symbol:** ETH
- **Block Explorer:** https://sepolia.uniscan.xyz

### Add to MetaMask
1. Open MetaMask
2. Click network dropdown → "Add Network"
3. Click "Add Network Manually"
4. Fill in details above
5. Save

---

## Deployment Checklist

Before deploying, make sure you have:

- [ ] Testnet ETH in your wallet (at least 0.001 ETH for gas)
- [ ] `.env` file with `PRIVATE_KEY` set
- [ ] RPC endpoint working (test with `cast chain-id --rpc-url https://sepolia.unichain.org`)

---

## Deploy Commands

```bash
# 1. Load environment
export $(cat .env | xargs)

# 2. Check balance
cast balance $DEPLOYER_ADDRESS --rpc-url $UNICHAIN_RPC

# 3. Run deployment
forge script script/DeployTWAMM.s.sol:DeployTWAMM \
  --rpc-url $UNICHAIN_RPC \
  --broadcast \
  --verify \
  --verifier etherscan \
  --verifier-url https://api-sepolia.uniscan.xyz/api
```

---

## Troubleshooting

### "Insufficient funds"
- You need testnet ETH. Use one of the faucets above.

### "Nonce too low"
- Reset your nonce in MetaMask or wait for pending transactions.

### RPC issues
- Try alternative RPC: `https://sepolia.unichain.org`
- Check chain status: https://status.unichain.org

---

## Already Deployed Contracts (Unichain Sepolia)

| Contract | Address |
|----------|---------|
| PoolManager | `0x00b036b58a818b1bc34d502d3fe730db729e62ac` |
| PositionManager | `0xf969aee60879c54baaed9f3ed26147db216fd664` |
| UniversalRouter | `0xf70536b3bcc1bd1a972dc186a2cf84cc6da6be5d` |
| Quoter | `0x56dcd40a3f2d466f48e7f48bdbe5cc9b92ae4472` |
| StateView | `0xc199f1072a74d4e905aba1a84d9a45e2546b6222` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

Source: https://docs.uniswap.org/contracts/v4/deployments
