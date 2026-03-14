#!/usr/bin/env node
/**
 * Simple TWAMM demo arb bot (Unichain Sepolia)
 *
 * Features:
 * - Watches ChunkExecuted(orderId, ...) on TWAMMHook
 * - Fetches REACT market price from CoinGecko
 * - Compares to pool execution-implied price (from event + order direction)
 * - Runs micro-swaps over ~1 minute to nudge pool price
 * - Optional noise swaps (for extra observations) on interval
 * - Mints on demand if swap balance is insufficient
 *
 * Run:
 *   BOT_PK=0x... node script/arb_bot.mjs
 */

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  formatUnits,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CFG = {
  rpcUrl: process.env.UNICHAIN_RPC || "https://sepolia.unichain.org",
  botPk: process.env.BOT_PK || process.env.PRIVATE_KEY,

  twammHook: process.env.TWAMM_HOOK || "0x1Eb187eC6240924c192230bfBbde6FDF13ce50C0",
  swapExecutor: process.env.SWAP_EXECUTOR || "0x193B245198db2E06aEC05539413C665CF5885960",
  usdc: process.env.USDC || "0xc19445639A1B13F024924832267F27Cc868b6a62",
  react: process.env.REACT_TOKEN || "0xA5d9D845F4776289650d45EE9bbF5Ec98e203cBF",

  fee: 3000,
  tickSpacing: 60,

  // Arb strategy
  maxDeviationPct: Number(process.env.ARB_MAX_DEV_PCT || "0.75"),
  microSwaps: Number(process.env.ARB_MICRO_SWAPS || "4"),
  cycleSeconds: Number(process.env.ARB_CYCLE_SECONDS || "60"),
  swapUsdcAmount: process.env.ARB_SWAP_USDC || "50", // when buying REACT with USDC
  swapReactAmount: process.env.ARB_SWAP_REACT || "50", // when selling REACT to USDC
  mintBufferPct: Number(process.env.ARB_MINT_BUFFER_PCT || "15"),

  // Optional noise swaps
  noiseEnabled: (process.env.ARB_NOISE_ENABLED || "false").toLowerCase() === "true",
  noiseMinutes: Number(process.env.ARB_NOISE_MINUTES || "3"),
  noiseUsdcAmount: process.env.ARB_NOISE_USDC || "5",
};

const CHAIN = defineChain({
  id: 1301,
  name: "Unichain Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [CFG.rpcUrl] },
    public: { http: [CFG.rpcUrl] },
  },
  blockExplorers: {
    default: { name: "Uniscan", url: "https://sepolia.uniscan.xyz" },
  },
  testnet: true,
});

const twammAbi = [
  {
    type: "event",
    name: "ChunkExecuted",
    inputs: [
      { indexed: true, name: "orderId", type: "bytes32" },
      { indexed: false, name: "chunkIndex", type: "uint256" },
      { indexed: false, name: "amountIn", type: "uint256" },
      { indexed: false, name: "amountOut", type: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "function",
    name: "getOrder",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "totalAmount", type: "uint256" },
          { name: "executedAmount", type: "uint256" },
          { name: "totalChunks", type: "uint256" },
          { name: "executedChunks", type: "uint256" },
          { name: "startTime", type: "uint256" },
          { name: "endTime", type: "uint256" },
          { name: "lastExecutionTime", type: "uint256" },
          { name: "minOutputPerChunk", type: "uint256" },
          { name: "active", type: "bool" },
          { name: "cancelled", type: "bool" },
        ],
      },
    ],
  },
];

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
];

const swapExecAbi = [
  {
    type: "function",
    name: "swapExactIn",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "key",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "tokenIn", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
];

const REACT_DEC = 18;
const USDC_DEC = 6;
const MAX_UINT = 2n ** 256n - 1n;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function norm(addr) {
  return addr.toLowerCase();
}

async function fetchReactUsd() {
  const url = "https://api.coingecko.com/api/v3/simple/price?ids=reactive-network&vs_currencies=usd";
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`coingecko ${res.status}`);
  const json = await res.json();
  const p = Number(json?.["reactive-network"]?.usd || 0);
  if (!Number.isFinite(p) || p <= 0) throw new Error("invalid coingecko price");
  return p;
}

function getPoolKey() {
  const [currency0, currency1] = norm(CFG.usdc) < norm(CFG.react) ? [CFG.usdc, CFG.react] : [CFG.react, CFG.usdc];
  return {
    currency0,
    currency1,
    fee: CFG.fee,
    tickSpacing: CFG.tickSpacing,
    hooks: CFG.twammHook,
  };
}

async function ensureAllowanceAndBalance({ publicClient, walletClient, account, token, decimals, required }) {
  const bal = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });

  if (bal < required) {
    const deficit = required - bal;
    const topUp = deficit + (deficit * BigInt(Math.floor(CFG.mintBufferPct * 100))) / 10000n;
    console.log(`[arb] minting ${formatUnits(topUp, decimals)} for ${token}`);
    const h = await walletClient.writeContract({
      account,
      chain: CHAIN,
      address: token,
      abi: erc20Abi,
      functionName: "mint",
      args: [account.address, topUp],
    });
    await publicClient.waitForTransactionReceipt({ hash: h });
  }

  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, CFG.swapExecutor],
  });

  if (allowance < required) {
    console.log(`[arb] approving token ${token} to swap executor`);
    const h = await walletClient.writeContract({
      account,
      chain: CHAIN,
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [CFG.swapExecutor, MAX_UINT],
    });
    await publicClient.waitForTransactionReceipt({ hash: h });
  }
}

async function doMicroSwapCycle({ publicClient, walletClient, account, buyReact }) {
  const key = getPoolKey();
  const tokenIn = buyReact ? CFG.usdc : CFG.react;
  const decimals = buyReact ? USDC_DEC : REACT_DEC;
  const humanAmount = buyReact ? CFG.swapUsdcAmount : CFG.swapReactAmount;
  const total = parseUnits(humanAmount, decimals);

  const count = Math.max(1, CFG.microSwaps);
  const per = total / BigInt(count);
  const waitMs = Math.max(2000, Math.floor((CFG.cycleSeconds * 1000) / count));

  console.log(`[arb] cycle start: ${buyReact ? "BUY REACT" : "SELL REACT"} total=${humanAmount} in ${count} swaps`);

  for (let i = 0; i < count; i++) {
    const amountIn = i === count - 1 ? total - per * BigInt(count - 1) : per;
    if (amountIn <= 0n) continue;

    await ensureAllowanceAndBalance({ publicClient, walletClient, account, token: tokenIn, decimals, required: amountIn });

    const sqrtPriceLimitX96 = buyReact
      ? 4295128740n // zeroForOne true (token0->token1) conservative bound
      : 340282366920938463463374607431768211455n;

    const h = await walletClient.writeContract({
      account,
      chain: CHAIN,
      address: CFG.swapExecutor,
      abi: swapExecAbi,
      functionName: "swapExactIn",
      args: [key, tokenIn, amountIn, 0n, sqrtPriceLimitX96],
    });
    await publicClient.waitForTransactionReceipt({ hash: h });

    console.log(`[arb] micro-swap ${i + 1}/${count} tx=${h}`);
    if (i < count - 1) await sleep(waitMs);
  }
}

async function maybeArbFromChunk({ publicClient, walletClient, account, orderId, amountInRaw, amountOutRaw }) {
  const order = await publicClient.readContract({
    address: CFG.twammHook,
    abi: twammAbi,
    functionName: "getOrder",
    args: [orderId],
  });

  const tokenIn = norm(order.tokenIn);
  const tokenOut = norm(order.tokenOut);

  const amountIn = Number(formatUnits(amountInRaw, tokenIn === norm(CFG.usdc) ? USDC_DEC : REACT_DEC));
  const amountOut = Number(formatUnits(amountOutRaw, tokenOut === norm(CFG.usdc) ? USDC_DEC : REACT_DEC));

  if (amountIn <= 0 || amountOut <= 0) return;

  let poolReactUsd;
  if (tokenIn === norm(CFG.react) && tokenOut === norm(CFG.usdc)) {
    poolReactUsd = amountOut / amountIn;
  } else if (tokenIn === norm(CFG.usdc) && tokenOut === norm(CFG.react)) {
    poolReactUsd = amountIn / amountOut;
  } else {
    console.log("[arb] non-demo pair order detected; skipping");
    return;
  }

  const market = await fetchReactUsd();
  const deviationPct = Math.abs((poolReactUsd - market) / market) * 100;

  console.log(`[arb] market=${market.toFixed(6)} pool=${poolReactUsd.toFixed(6)} dev=${deviationPct.toFixed(3)}%`);

  if (deviationPct < CFG.maxDeviationPct) {
    console.log("[arb] within threshold, no arb cycle");
    return;
  }

  const buyReact = poolReactUsd < market;
  await doMicroSwapCycle({ publicClient, walletClient, account, buyReact });
}

async function runNoiseLoop({ publicClient, walletClient, account }) {
  if (!CFG.noiseEnabled) return;
  const everyMs = Math.max(30_000, CFG.noiseMinutes * 60_000);

  while (true) {
    try {
      await ensureAllowanceAndBalance({
        publicClient,
        walletClient,
        account,
        token: CFG.usdc,
        decimals: USDC_DEC,
        required: parseUnits(CFG.noiseUsdcAmount, USDC_DEC),
      });

      const key = getPoolKey();
      const h = await walletClient.writeContract({
        account,
        chain: CHAIN,
        address: CFG.swapExecutor,
        abi: swapExecAbi,
        functionName: "swapExactIn",
        args: [
          key,
          CFG.usdc,
          parseUnits(CFG.noiseUsdcAmount, USDC_DEC),
          0n,
          4295128740n,
        ],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
      console.log(`[noise] small swap tx=${h}`);
    } catch (e) {
      console.error("[noise] error", e?.message || e);
    }

    await sleep(everyMs);
  }
}

async function main() {
  if (!CFG.botPk) throw new Error("Missing BOT_PK (or PRIVATE_KEY)");

  const account = privateKeyToAccount(CFG.botPk.startsWith("0x") ? CFG.botPk : `0x${CFG.botPk}`);
  const publicClient = createPublicClient({ chain: CHAIN, transport: http(CFG.rpcUrl) });
  const walletClient = createWalletClient({ account, chain: CHAIN, transport: http(CFG.rpcUrl) });

  console.log("[arb] bot address", account.address);
  console.log("[arb] hook", CFG.twammHook);
  console.log("[arb] executor", CFG.swapExecutor);

  runNoiseLoop({ publicClient, walletClient, account }).catch(err => console.error("[noise-loop]", err));

  const unwatch = publicClient.watchContractEvent({
    address: CFG.twammHook,
    abi: twammAbi,
    eventName: "ChunkExecuted",
    onLogs: async logs => {
      for (const log of logs) {
        try {
          const decoded = decodeEventLog({ abi: twammAbi, data: log.data, topics: log.topics });
          const orderId = decoded.args.orderId;
          const amountInRaw = decoded.args.amountIn;
          const amountOutRaw = decoded.args.amountOut;
          console.log(`[arb] ChunkExecuted order=${orderId} block=${log.blockNumber}`);
          await maybeArbFromChunk({ publicClient, walletClient, account, orderId, amountInRaw, amountOutRaw });
        } catch (e) {
          console.error("[arb] decode/process error", e?.message || e);
        }
      }
    },
  });

  process.on("SIGINT", () => {
    console.log("\n[arb] stopping...");
    unwatch();
    process.exit(0);
  });

  console.log("[arb] watching ChunkExecuted... (Ctrl+C to stop)");
}

main().catch(err => {
  console.error("[arb] fatal", err);
  process.exit(1);
});
