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
  fallback,
  formatUnits,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

// Support the repo's usual workflow without requiring `set -a; source .env`.
loadEnvFile(join(REPO_ROOT, ".env"));
loadEnvFile(join(REPO_ROOT, ".env.addresses"));

function parseRpcList(value, fallbackUrl) {
  const urls = (value || "")
    .split(",")
    .map(url => url.trim())
    .filter(Boolean);
  return urls.length > 0 ? urls : [fallbackUrl];
}

function resolveRpcUrls() {
  const explicitList = parseRpcList(process.env.UNICHAIN_RPCS);
  if (explicitList.length > 0) return explicitList;

  const fallbackUrls = [process.env.UNICHAIN_RPC, process.env.UNICHAIN_RPC_2]
    .map(url => url?.trim())
    .filter(Boolean);
  return fallbackUrls.length > 0 ? fallbackUrls : ["https://sepolia.unichain.org"];
}

const CFG = {
  rpcUrls: resolveRpcUrls(),
  botPk: process.env.BOT_PK || process.env.PRIVATE_KEY,

  twammHook: process.env.TWAMM_HOOK,
  swapExecutor: process.env.SWAP_EXECUTOR || process.env.SWAP_EXECUTOR_ADDRESS,
  usdc: process.env.USDC || process.env.USDC_ADDRESS,
  react: process.env.REACT_TOKEN || process.env.REACT_ADDRESS,

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
    default: { http: CFG.rpcUrls },
    public: { http: CFG.rpcUrls },
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

function makeRpcTransport(urls) {
  const transports = urls.map(url => http(url));
  return transports.length === 1 ? transports[0] : fallback(transports);
}

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

function getSwapPriceLimit(tokenIn) {
  const key = getPoolKey();
  const zeroForOne = norm(tokenIn) === norm(key.currency0);
  return zeroForOne ? 4295128740n : 340282366920938463463374607431768211455n;
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

    const sqrtPriceLimitX96 = getSwapPriceLimit(tokenIn);

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
  if (!CFG.twammHook) throw new Error("Missing TWAMM_HOOK — run: node script/sync_addresses.mjs && source .env");
  if (!CFG.swapExecutor) throw new Error("Missing SWAP_EXECUTOR — run: node script/sync_addresses.mjs && source .env");
  if (!CFG.usdc) throw new Error("Missing USDC — run: node script/sync_addresses.mjs && source .env");
  if (!CFG.react) throw new Error("Missing REACT_TOKEN — run: node script/sync_addresses.mjs && source .env");

  const account = privateKeyToAccount(CFG.botPk.startsWith("0x") ? CFG.botPk : `0x${CFG.botPk}`);
  const transport = makeRpcTransport(CFG.rpcUrls);
  const publicClient = createPublicClient({ chain: CHAIN, transport });
  const walletClient = createWalletClient({ account, chain: CHAIN, transport });

  console.log("[arb] bot address", account.address);
  console.log("[arb] rpc urls", CFG.rpcUrls.join(", "));
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
