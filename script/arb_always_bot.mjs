#!/usr/bin/env node
/**
 * Always-on demo arb bot (Unichain Sepolia)
 *
 * Polls the live pool price, compares it to CoinGecko's REACT/USD price,
 * and performs small corrective swaps when the deviation exceeds a threshold.
 *
 * Run:
 *   node script/arb_always_bot.mjs
 *
 * Useful env vars:
 *   ARB_ALWAYS_POLL_SECONDS=20
 *   ARB_ALWAYS_MAX_DEV_PCT=0.50
 *   ARB_ALWAYS_CLOSE_GAP_PCT=20
 *   ARB_ALWAYS_MAX_SWAP_USDC=1000
 *   ARB_ALWAYS_MAX_SWAP_REACT=50000
 *   ARB_ALWAYS_CYCLE_SECONDS=20
 *   ARB_ALWAYS_DRY_RUN=true
 */

import {
  concatHex,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  fallback,
  formatUnits,
  http,
  keccak256,
  parseUnits,
  toHex,
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
  poolManager: process.env.UNICHAIN_POOL_MANAGER || "0x00B036B58a818B1BC34d502D3fE730Db729e62AC",
  botPk: process.env.BOT_PK || process.env.PRIVATE_KEY,

  twammHook: process.env.TWAMM_HOOK || "0x323cDD447000e5F9CCF1E07444898A92548410C0",
  swapExecutor:
    process.env.SWAP_EXECUTOR || process.env.SWAP_EXECUTOR_ADDRESS || "0xA2cE76584fbA37e5bC60d304f9fb229fe7c7120B",
  usdc: process.env.USDC || process.env.USDC_ADDRESS || "0xfC4bCE0c036aC2681121ec8801B4E87122C922F8",
  react: process.env.REACT_TOKEN || process.env.REACT_ADDRESS || "0x9496b94e74D6b01F03e02c505e61Ce3d492c533f",

  fee: Number(process.env.ARB_ALWAYS_FEE || process.env.ARB_FEE || "3000"),
  tickSpacing: Number(process.env.ARB_ALWAYS_TICK_SPACING || process.env.ARB_TICK_SPACING || "60"),

  pollSeconds: Number(process.env.ARB_ALWAYS_POLL_SECONDS || "20"),
  maxDeviationPct: Number(process.env.ARB_ALWAYS_MAX_DEV_PCT || process.env.ARB_MAX_DEV_PCT || "0.50"),
  closeGapPct: Number(process.env.ARB_ALWAYS_CLOSE_GAP_PCT || "20"),
  microSwaps: Number(process.env.ARB_ALWAYS_MICRO_SWAPS || "2"),
  cycleSeconds: Number(process.env.ARB_ALWAYS_CYCLE_SECONDS || "20"),
  swapUsdcAmount: process.env.ARB_ALWAYS_SWAP_USDC || "100",
  swapReactAmount: process.env.ARB_ALWAYS_SWAP_REACT || "100",
  maxSwapUsdcAmount: process.env.ARB_ALWAYS_MAX_SWAP_USDC || "1000",
  maxSwapReactAmount: process.env.ARB_ALWAYS_MAX_SWAP_REACT || "50000",
  mintBufferPct: Number(process.env.ARB_MINT_BUFFER_PCT || "15"),
  dryRun: (process.env.ARB_ALWAYS_DRY_RUN || "false").toLowerCase() === "true",
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

const extsloadAbi = [
  {
    type: "function",
    name: "extsload",
    stateMutability: "view",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ name: "value", type: "bytes32" }],
  },
];

const REACT_DEC = 18;
const USDC_DEC = 6;
const MAX_UINT = 2n ** 256n - 1n;
const Q96_BI = 2n ** 96n;
const MASK_160 = (1n << 160n) - 1n;
const MASK_24 = (1n << 24n) - 1n;
const Q96 = 2 ** 96;

function makeRpcTransport(urls) {
  const transports = urls.map(url => http(url));
  return transports.length === 1 ? transports[0] : fallback(transports);
}
const POOLS_SLOT = 6n;
const LIQUIDITY_OFFSET = 3n;
const MIN_SQRT_PRICE_LIMIT_X96 = 4295128740n;
const MAX_SQRT_PRICE_LIMIT_X96 = 340282366920938463463374607431768211455n;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function norm(addr) {
  return addr.toLowerCase();
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
  return zeroForOne ? MIN_SQRT_PRICE_LIMIT_X96 : MAX_SQRT_PRICE_LIMIT_X96;
}

function getPoolId(key) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

function getPoolStateSlot(poolId) {
  return keccak256(concatHex([poolId, toHex(POOLS_SLOT, { size: 32 })]));
}

function getPoolLiquiditySlot(poolId) {
  return toHex(BigInt(getPoolStateSlot(poolId)) + LIQUIDITY_OFFSET, { size: 32 });
}

function decodeSlot0(packedHex) {
  const packed = BigInt(packedHex);
  return {
    sqrtPriceX96: packed & MASK_160,
    tick: Number(BigInt.asIntN(24, packed >> 160n)),
    protocolFee: Number((packed >> 184n) & MASK_24),
    lpFee: Number((packed >> 208n) & MASK_24),
  };
}

function getDecimals(token) {
  if (norm(token) === norm(CFG.usdc)) return USDC_DEC;
  if (norm(token) === norm(CFG.react)) return REACT_DEC;
  throw new Error(`Unsupported token decimals for ${token}`);
}

async function fetchReactUsd() {
  const url = "https://api.coingecko.com/api/v3/simple/price?ids=reactive-network&vs_currencies=usd";
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`coingecko ${res.status}`);
  const json = await res.json();
  const price = Number(json?.["reactive-network"]?.usd || 0);
  if (!Number.isFinite(price) || price <= 0) throw new Error("invalid coingecko price");
  return price;
}

async function readPoolReactUsd(publicClient) {
  const key = getPoolKey();
  const poolId = getPoolId(key);
  const [slot0, liquidityHex] = await Promise.all([
    publicClient.readContract({
      address: CFG.poolManager,
      abi: extsloadAbi,
      functionName: "extsload",
      args: [getPoolStateSlot(poolId)],
    }),
    publicClient.readContract({
      address: CFG.poolManager,
      abi: extsloadAbi,
      functionName: "extsload",
      args: [getPoolLiquiditySlot(poolId)],
    }),
  ]);

  const { sqrtPriceX96, tick, lpFee, protocolFee } = decodeSlot0(slot0);
  const dec0 = getDecimals(key.currency0);
  const dec1 = getDecimals(key.currency1);
  const rawToken1PerToken0 = (Number(sqrtPriceX96) / Q96) ** 2;
  const humanToken1PerToken0 = rawToken1PerToken0 * 10 ** (dec0 - dec1);
  const liquidity = BigInt(liquidityHex);

  const reactIsToken0 = norm(key.currency0) === norm(CFG.react);
  const reactUsd = reactIsToken0 ? humanToken1PerToken0 : 1 / humanToken1PerToken0;

  if (!Number.isFinite(reactUsd) || reactUsd <= 0) {
    throw new Error(`invalid pool price derived from slot0=${slot0}`);
  }

  return { reactUsd, tick, lpFee, protocolFee, liquidity, sqrtPriceX96, dec0, dec1, reactIsToken0, key };
}

function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

function priceToRawToken1PerToken0({ reactUsd, reactIsToken0, dec0, dec1 }) {
  const humanToken1PerToken0 = reactIsToken0 ? reactUsd : 1 / reactUsd;
  return humanToken1PerToken0 / 10 ** (dec0 - dec1);
}

function sqrtPriceX96FromReactUsd({ reactUsd, reactIsToken0, dec0, dec1 }) {
  const rawToken1PerToken0 = priceToRawToken1PerToken0({ reactUsd, reactIsToken0, dec0, dec1 });
  if (!Number.isFinite(rawToken1PerToken0) || rawToken1PerToken0 <= 0) {
    throw new Error(`invalid target raw price ${rawToken1PerToken0}`);
  }
  return BigInt(Math.floor(Math.sqrt(rawToken1PerToken0) * Q96));
}

function estimateAmountInForTarget({ pool, tokenIn, targetReactUsd }) {
  const targetSqrtPriceX96 = sqrtPriceX96FromReactUsd({
    reactUsd: targetReactUsd,
    reactIsToken0: pool.reactIsToken0,
    dec0: pool.dec0,
    dec1: pool.dec1,
  });
  const currentSqrtPriceX96 = pool.sqrtPriceX96;
  const zeroForOne = norm(tokenIn) === norm(pool.key.currency0);

  if (zeroForOne) {
    if (targetSqrtPriceX96 >= currentSqrtPriceX96) return 0n;
    const numerator = pool.liquidity * (currentSqrtPriceX96 - targetSqrtPriceX96) * Q96_BI;
    const denominator = currentSqrtPriceX96 * targetSqrtPriceX96;
    return denominator > 0n ? ceilDiv(numerator, denominator) : 0n;
  }

  if (targetSqrtPriceX96 <= currentSqrtPriceX96) return 0n;
  return ceilDiv(pool.liquidity * (targetSqrtPriceX96 - currentSqrtPriceX96), Q96_BI);
}

function computeDynamicTrade({ pool, marketReactUsd }) {
  const closeFrac = Math.min(1, Math.max(0.01, CFG.closeGapPct / 100));
  const targetReactUsd = pool.reactUsd + (marketReactUsd - pool.reactUsd) * closeFrac;
  const buyReact = pool.reactUsd < marketReactUsd;
  const tokenIn = buyReact ? CFG.usdc : CFG.react;
  const decimals = buyReact ? USDC_DEC : REACT_DEC;
  const fallbackHumanAmount = buyReact ? CFG.swapUsdcAmount : CFG.swapReactAmount;
  const maxHumanAmount = buyReact ? CFG.maxSwapUsdcAmount : CFG.maxSwapReactAmount;
  const maxRawAmount = parseUnits(maxHumanAmount, decimals);
  const fallbackRawAmount = parseUnits(fallbackHumanAmount, decimals);
  const estimatedRawAmount = estimateAmountInForTarget({ pool, tokenIn, targetReactUsd });
  const totalRawAmount =
    estimatedRawAmount > 0n ? (estimatedRawAmount > maxRawAmount ? maxRawAmount : estimatedRawAmount) : fallbackRawAmount;

  return {
    buyReact,
    targetReactUsd,
    totalRawAmount,
    totalHumanAmount: formatUnits(totalRawAmount, decimals),
    maxHumanAmount,
    usedFallback: estimatedRawAmount <= 0n,
  };
}

async function ensureAllowanceAndBalance({ publicClient, walletClient, account, token, decimals, required }) {
  const readBalance = () =>
    publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });

  let balance = await readBalance();

  if (balance < required) {
    const deficit = required - balance;
    const topUp = deficit + (deficit * BigInt(Math.floor(CFG.mintBufferPct * 100))) / 10000n;
    console.log(`[always-arb] minting ${formatUnits(topUp, decimals)} for ${token}`);
    const hash = await walletClient.writeContract({
      account,
      chain: CHAIN,
      address: token,
      abi: erc20Abi,
      functionName: "mint",
      args: [account.address, topUp],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    // Some RPC backends lag briefly after the mint receipt; poll until the new balance is visible.
    for (let attempt = 0; attempt < 6; attempt++) {
      balance = await readBalance();
      if (balance >= required) break;
      await sleep(500);
    }
  }

  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, CFG.swapExecutor],
  });

  if (allowance < required) {
    console.log(`[always-arb] approving ${token} to swap executor`);
    const hash = await walletClient.writeContract({
      account,
      chain: CHAIN,
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [CFG.swapExecutor, MAX_UINT],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}

async function doMicroSwapCycle({
  publicClient,
  walletClient,
  account,
  buyReact,
  reason,
  totalRawAmount,
  totalHumanAmount,
}) {
  const key = getPoolKey();
  const tokenIn = buyReact ? CFG.usdc : CFG.react;
  const decimals = buyReact ? USDC_DEC : REACT_DEC;
  const total = totalRawAmount;
  const count = 1;
  const per = total / BigInt(count);
  const waitMs = Math.max(1500, Math.floor((CFG.cycleSeconds * 1000) / count));

  console.log(
    `[always-arb] ${reason} -> ${buyReact ? "BUY REACT" : "SELL REACT"} total=${totalHumanAmount} in ${count} swap(s)`,
  );

  if (CFG.dryRun) {
    console.log("[always-arb] dry-run enabled, skipping txs");
    return;
  }

  for (let i = 0; i < count; i++) {
    const amountIn = i === count - 1 ? total - per * BigInt(count - 1) : per;
    if (amountIn <= 0n) continue;

    await ensureAllowanceAndBalance({
      publicClient,
      walletClient,
      account,
      token: tokenIn,
      decimals,
      required: amountIn,
    });

    const sqrtPriceLimitX96 = getSwapPriceLimit(tokenIn);

    let hash;
    try {
      hash = await walletClient.writeContract({
        account,
        chain: CHAIN,
        address: CFG.swapExecutor,
        abi: swapExecAbi,
        functionName: "swapExactIn",
        args: [key, tokenIn, amountIn, 0n, sqrtPriceLimitX96],
      });
    } catch (err) {
      const msg = err?.shortMessage || err?.message || String(err);
      if (msg.includes("ERC20InsufficientBalance") || msg.includes("0xe450d38c")) {
        console.log("[always-arb] balance race after mint detected, refreshing balance and retrying once");
        await ensureAllowanceAndBalance({
          publicClient,
          walletClient,
          account,
          token: tokenIn,
          decimals,
          required: amountIn,
        });
        await sleep(750);
        hash = await walletClient.writeContract({
          account,
          chain: CHAIN,
          address: CFG.swapExecutor,
          abi: swapExecAbi,
          functionName: "swapExactIn",
          args: [key, tokenIn, amountIn, 0n, sqrtPriceLimitX96],
        });
      } else {
        throw err;
      }
    }

    await publicClient.waitForTransactionReceipt({ hash });

    console.log(`[always-arb] swap ${i + 1}/${count} tx=${hash}`);
    if (i < count - 1) await sleep(waitMs);
  }
}

async function tickOnce({ publicClient, walletClient, account }) {
  const [marketReactUsd, pool] = await Promise.all([
    fetchReactUsd(),
    readPoolReactUsd(publicClient),
  ]);

  const deviationPct = ((pool.reactUsd - marketReactUsd) / marketReactUsd) * 100;
  const absDeviationPct = Math.abs(deviationPct);

  console.log(
    `[always-arb] market=${marketReactUsd.toFixed(6)} pool=${pool.reactUsd.toFixed(6)} tick=${pool.tick} dev=${deviationPct.toFixed(3)}%`,
  );

  if (pool.tick === 0 && Math.abs(pool.reactUsd) >= 1e9) {
    console.log(
      "[always-arb] note: this demo pool was initialized at 1:1 raw units with 18 vs 6 decimals, so tick=0 implies a ~1e12 human-price skew",
    );
  }

  if (absDeviationPct < CFG.maxDeviationPct) {
    console.log("[always-arb] within threshold, no corrective swap");
    return;
  }

  const buyReact = pool.reactUsd < marketReactUsd;
  const sizing = computeDynamicTrade({ pool, marketReactUsd });
  const fallbackNote = sizing.usedFallback ? ` fallback=${buyReact ? CFG.swapUsdcAmount : CFG.swapReactAmount}` : "";
  const reason =
    `dev ${deviationPct.toFixed(3)}% vs threshold ${CFG.maxDeviationPct}%` +
    ` target=${sizing.targetReactUsd.toFixed(6)} close=${CFG.closeGapPct}% cap=${sizing.maxHumanAmount}${buyReact ? " USDC" : " REACT"}` +
    fallbackNote;
  await doMicroSwapCycle({
    publicClient,
    walletClient,
    account,
    buyReact,
    reason,
    totalRawAmount: sizing.totalRawAmount,
    totalHumanAmount: sizing.totalHumanAmount,
  });
}

async function main() {
  if (!CFG.botPk) throw new Error("Missing BOT_PK (or PRIVATE_KEY)");
  if (!CFG.poolManager) throw new Error("Missing UNICHAIN_POOL_MANAGER");
  if (!CFG.twammHook) throw new Error("Missing TWAMM_HOOK");
  if (!CFG.swapExecutor) throw new Error("Missing SWAP_EXECUTOR");
  if (!CFG.usdc) throw new Error("Missing USDC");
  if (!CFG.react) throw new Error("Missing REACT_TOKEN");

  const account = privateKeyToAccount(CFG.botPk.startsWith("0x") ? CFG.botPk : `0x${CFG.botPk}`);
  const transport = makeRpcTransport(CFG.rpcUrls);
  const publicClient = createPublicClient({ chain: CHAIN, transport });
  const walletClient = createWalletClient({ account, chain: CHAIN, transport });

  console.log("[always-arb] bot address", account.address);
  console.log("[always-arb] rpc urls", CFG.rpcUrls.join(", "));
  console.log("[always-arb] pool manager", CFG.poolManager);
  console.log("[always-arb] hook", CFG.twammHook);
  console.log("[always-arb] executor", CFG.swapExecutor);
  console.log("[always-arb] poll seconds", CFG.pollSeconds);
  console.log("[always-arb] threshold %", CFG.maxDeviationPct);
  console.log("[always-arb] close gap %", CFG.closeGapPct);
  console.log("[always-arb] dry run", CFG.dryRun);

  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    console.log("\n[always-arb] stopping...");
  });

  while (!stopping) {
    try {
      await tickOnce({ publicClient, walletClient, account });
    } catch (err) {
      console.error("[always-arb] tick error", err?.message || err);
    }

    if (stopping) break;
    await sleep(Math.max(5, CFG.pollSeconds) * 1000);
  }
}

main().catch(err => {
  console.error("[always-arb] fatal", err);
  process.exit(1);
});
