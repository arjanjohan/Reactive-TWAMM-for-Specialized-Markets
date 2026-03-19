#!/usr/bin/env node
/**
 * Demo buy-pressure bot (Unichain Sepolia)
 *
 * Performs a fixed-size USDC -> REACT swap on a timer so you can watch
 * the always-on arb bot nudge price back toward market.
 *
 * Run:
 *   node script/buy_pressure_bot.mjs
 *
 * Useful env vars:
 *   BUY_PRESSURE_PK=0x...          # recommended separate key from arb bot
 *   BUY_PRESSURE_USDC=1000
 *   BUY_PRESSURE_INTERVAL_SECONDS=60
 *   BUY_PRESSURE_DRY_RUN=true
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
  botPk: process.env.BUY_PRESSURE_PK || process.env.BOT_PK || process.env.PRIVATE_KEY,

  twammHook: process.env.TWAMM_HOOK || "0x323cDD447000e5F9CCF1E07444898A92548410C0",
  swapExecutor:
    process.env.SWAP_EXECUTOR || process.env.SWAP_EXECUTOR_ADDRESS || "0xA2cE76584fbA37e5bC60d304f9fb229fe7c7120B",
  usdc: process.env.USDC || process.env.USDC_ADDRESS || "0xfC4bCE0c036aC2681121ec8801B4E87122C922F8",
  react: process.env.REACT_TOKEN || process.env.REACT_ADDRESS || "0x9496b94e74D6b01F03e02c505e61Ce3d492c533f",

  fee: Number(process.env.BUY_PRESSURE_FEE || process.env.ARB_FEE || "3000"),
  tickSpacing: Number(process.env.BUY_PRESSURE_TICK_SPACING || process.env.ARB_TICK_SPACING || "60"),

  intervalSeconds: Number(process.env.BUY_PRESSURE_INTERVAL_SECONDS || "60"),
  buyUsdcAmount: process.env.BUY_PRESSURE_USDC || "1000",
  mintBufferPct: Number(process.env.BUY_PRESSURE_MINT_BUFFER_PCT || process.env.ARB_MINT_BUFFER_PCT || "15"),
  dryRun: (process.env.BUY_PRESSURE_DRY_RUN || "false").toLowerCase() === "true",
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

const USDC_DEC = 6;
const REACT_DEC = 18;
const MAX_UINT = 2n ** 256n - 1n;
const MASK_160 = (1n << 160n) - 1n;
const MASK_24 = (1n << 24n) - 1n;
const Q96 = 2 ** 96;
const POOLS_SLOT = 6n;
const MIN_SQRT_PRICE_LIMIT_X96 = 4295128740n;
const MAX_SQRT_PRICE_LIMIT_X96 = 340282366920938463463374607431768211455n;

function makeRpcTransport(urls) {
  const transports = urls.map(url => http(url));
  return transports.length === 1 ? transports[0] : fallback(transports);
}

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

async function readPoolReactUsd(publicClient) {
  const key = getPoolKey();
  const poolId = getPoolId(key);
  const slot0 = await publicClient.readContract({
    address: CFG.poolManager,
    abi: extsloadAbi,
    functionName: "extsload",
    args: [getPoolStateSlot(poolId)],
  });

  const { sqrtPriceX96, tick } = decodeSlot0(slot0);
  const dec0 = getDecimals(key.currency0);
  const dec1 = getDecimals(key.currency1);
  const rawToken1PerToken0 = (Number(sqrtPriceX96) / Q96) ** 2;
  const humanToken1PerToken0 = rawToken1PerToken0 * 10 ** (dec0 - dec1);
  const reactIsToken0 = norm(key.currency0) === norm(CFG.react);
  const reactUsd = reactIsToken0 ? humanToken1PerToken0 : 1 / humanToken1PerToken0;

  if (!Number.isFinite(reactUsd) || reactUsd <= 0) {
    throw new Error(`invalid pool price derived from slot0=${slot0}`);
  }

  return { reactUsd, tick };
}

async function ensureAllowanceAndBalance({ publicClient, walletClient, account, required }) {
  const readBalance = () =>
    publicClient.readContract({
      address: CFG.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });

  let balance = await readBalance();
  if (balance < required) {
    const deficit = required - balance;
    const topUp = deficit + (deficit * BigInt(Math.floor(CFG.mintBufferPct * 100))) / 10000n;
    console.log(`[buy-pressure] minting ${formatUnits(topUp, USDC_DEC)} USDC`);
    const hash = await walletClient.writeContract({
      account,
      chain: CHAIN,
      address: CFG.usdc,
      abi: erc20Abi,
      functionName: "mint",
      args: [account.address, topUp],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    for (let attempt = 0; attempt < 6; attempt++) {
      balance = await readBalance();
      if (balance >= required) break;
      await sleep(500);
    }
  }

  const allowance = await publicClient.readContract({
    address: CFG.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, CFG.swapExecutor],
  });

  if (allowance < required) {
    console.log("[buy-pressure] approving USDC to swap executor");
    const hash = await walletClient.writeContract({
      account,
      chain: CHAIN,
      address: CFG.usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [CFG.swapExecutor, MAX_UINT],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}

async function runBuyOnce({ publicClient, walletClient, account }) {
  const before = await readPoolReactUsd(publicClient);
  const amountIn = parseUnits(CFG.buyUsdcAmount, USDC_DEC);

  console.log(
    `[buy-pressure] pool=${before.reactUsd.toFixed(6)} tick=${before.tick} -> BUY REACT with ${CFG.buyUsdcAmount} USDC`,
  );

  if (CFG.dryRun) {
    console.log("[buy-pressure] dry-run enabled, skipping tx");
    return;
  }

  await ensureAllowanceAndBalance({ publicClient, walletClient, account, required: amountIn });

  let hash;
  try {
    hash = await walletClient.writeContract({
      account,
      chain: CHAIN,
      address: CFG.swapExecutor,
      abi: swapExecAbi,
      functionName: "swapExactIn",
      args: [getPoolKey(), CFG.usdc, amountIn, 0n, getSwapPriceLimit(CFG.usdc)],
    });
  } catch (err) {
    const msg = err?.shortMessage || err?.message || String(err);
    if (msg.includes("ERC20InsufficientBalance") || msg.includes("0xe450d38c")) {
      console.log("[buy-pressure] balance race after mint detected, retrying once");
      await ensureAllowanceAndBalance({ publicClient, walletClient, account, required: amountIn });
      await sleep(750);
      hash = await walletClient.writeContract({
        account,
        chain: CHAIN,
        address: CFG.swapExecutor,
        abi: swapExecAbi,
        functionName: "swapExactIn",
        args: [getPoolKey(), CFG.usdc, amountIn, 0n, getSwapPriceLimit(CFG.usdc)],
      });
    } else {
      throw err;
    }
  }

  await publicClient.waitForTransactionReceipt({ hash });
  const after = await readPoolReactUsd(publicClient);

  console.log(`[buy-pressure] tx=${hash}`);
  console.log(`[buy-pressure] pool after=${after.reactUsd.toFixed(6)} tick=${after.tick}`);
}

async function main() {
  if (!CFG.botPk) throw new Error("Missing BUY_PRESSURE_PK (or BOT_PK / PRIVATE_KEY)");
  if (!CFG.poolManager) throw new Error("Missing UNICHAIN_POOL_MANAGER");
  if (!CFG.twammHook) throw new Error("Missing TWAMM_HOOK");
  if (!CFG.swapExecutor) throw new Error("Missing SWAP_EXECUTOR");
  if (!CFG.usdc) throw new Error("Missing USDC");
  if (!CFG.react) throw new Error("Missing REACT_TOKEN");

  const account = privateKeyToAccount(CFG.botPk.startsWith("0x") ? CFG.botPk : `0x${CFG.botPk}`);
  const transport = makeRpcTransport(CFG.rpcUrls);
  const publicClient = createPublicClient({ chain: CHAIN, transport });
  const walletClient = createWalletClient({ account, chain: CHAIN, transport });

  console.log("[buy-pressure] bot address", account.address);
  console.log("[buy-pressure] rpc urls", CFG.rpcUrls.join(", "));
  console.log("[buy-pressure] pool manager", CFG.poolManager);
  console.log("[buy-pressure] hook", CFG.twammHook);
  console.log("[buy-pressure] executor", CFG.swapExecutor);
  console.log("[buy-pressure] interval seconds", CFG.intervalSeconds);
  console.log("[buy-pressure] buy size usdc", CFG.buyUsdcAmount);
  console.log("[buy-pressure] dry run", CFG.dryRun);

  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    console.log("\n[buy-pressure] stopping...");
  });

  while (!stopping) {
    try {
      await runBuyOnce({ publicClient, walletClient, account });
    } catch (err) {
      console.error("[buy-pressure] tick error", err?.message || err);
    }

    if (stopping) break;
    await sleep(Math.max(10, CFG.intervalSeconds) * 1000);
  }
}

main().catch(err => {
  console.error("[buy-pressure] fatal", err);
  process.exit(1);
});
