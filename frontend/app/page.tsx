"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ADDRS, CHAIN_ID, LASNA, POOL_MANAGER } from "./addresses";
import { Address } from "@scaffold-ui/components";
import type { NextPage } from "next";
import {
  concatHex,
  createPublicClient,
  decodeEventLog,
  defineChain,
  encodeAbiParameters,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  keccak256,
  maxUint256,
  parseAbiItem,
  parseUnits,
  toHex,
} from "viem";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useSendTransaction,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import {
  ArrowPathIcon,
  ArrowsUpDownIcon,
  BoltIcon,
  ChartBarIcon,
  ClockIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import reactiveTwammAbi from "~~/contracts/abi/ReactiveTWAMM.json";
import twammHookAbi from "~~/contracts/abi/TWAMMHook.json";
import { useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-eth";

type DurationUnit = "minutes" | "hours" | "days";

const DURATION_MULTIPLIER: Record<DurationUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
};

const MIN_CHUNK_DURATION_SECONDS = 60;
const MAX_CHUNKS = 100;
const SLIPPAGE_OPTIONS = ["0.5", "1", "2", "5", "10"] as const;
const POOLS_SLOT = 6n;
const Q96 = 2 ** 96;
const MASK_160 = (1n << 160n) - 1n;
const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);

const extsloadAbi = [
  {
    type: "function",
    name: "extsload",
    stateMutability: "view",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ name: "value", type: "bytes32" }],
  },
] as const;

const mockErc20Abi = [
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
] as const;

const lasnaChain = defineChain({
  id: LASNA.chainId,
  name: "Reactive Lasna",
  nativeCurrency: { name: "REACT", symbol: "REACT", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_LASNA_RPC || "https://lasna-rpc.rnk.dev"] },
    public: { http: [process.env.NEXT_PUBLIC_LASNA_RPC || "https://lasna-rpc.rnk.dev"] },
  },
  testnet: true,
});

const Home: NextPage = () => {
  const { address, chainId: walletChainId } = useAccount();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  useTargetNetwork();
  const { switchChainAsync } = useSwitchChain();

  const [usdcToReact, setUsdcToReact] = useState(true);
  const [amountIn, setAmountIn] = useState("1000");
  const [durationValue, setDurationValue] = useState("30");
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("minutes");
  const [slippagePct, setSlippagePct] = useState<(typeof SLIPPAGE_OPTIONS)[number]>("5");
  const [lastOrderId, setLastOrderId] = useState<`0x${string}` | null>(null);
  const [flowStatus, setFlowStatus] = useState<string>("Idle");
  const [windowSeconds, setWindowSeconds] = useState<number>(300); // default 5m
  const [lasnaReactiveBalance, setLasnaReactiveBalance] = useState<string>("-");
  const [lasnaActiveOrderCount, setLasnaActiveOrderCount] = useState<number>(0);
  const [lasnaDebt, setLasnaDebt] = useState<string>("0");
  const [orderProgress, setOrderProgress] = useState<{ executed: number; total: number } | null>(null);
  const [lasnaSubscribing, setLasnaSubscribing] = useState(false);
  const [fundAmount, setFundAmount] = useState("0.1");
  const [callbackReserves, setCallbackReserves] = useState<string>("-");
  const [callbackDebt, setCallbackDebt] = useState<string>("0");
  const [callbackFundAmount, setCallbackFundAmount] = useState("0.02");

  const tokenIn = useMemo(
    () =>
      usdcToReact
        ? { symbol: "USDC", decimals: 6, address: ADDRS.usdc }
        : { symbol: "REACT", decimals: 18, address: ADDRS.react },
    [usdcToReact],
  );

  const tokenOut = useMemo(
    () =>
      usdcToReact
        ? { symbol: "REACT", decimals: 18, address: ADDRS.react }
        : { symbol: "USDC", decimals: 6, address: ADDRS.usdc },
    [usdcToReact],
  );

  const { data: tokenInBalanceRaw } = useReadContract({
    chainId: CHAIN_ID,
    address: tokenIn.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { data: tokenOutBalanceRaw } = useReadContract({
    chainId: CHAIN_ID,
    address: tokenOut.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { data: tokenInAllowanceRaw } = useReadContract({
    chainId: CHAIN_ID,
    address: tokenIn.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, ADDRS.hook] : undefined,
    query: { enabled: Boolean(address) },
  });
  const tokenInBalance = useMemo(() => {
    if (!tokenInBalanceRaw) return "0";
    return Number(formatUnits(tokenInBalanceRaw, tokenIn.decimals)).toLocaleString(undefined, {
      maximumFractionDigits: 4,
    });
  }, [tokenInBalanceRaw, tokenIn.decimals]);

  const tokenOutBalance = useMemo(() => {
    if (!tokenOutBalanceRaw) return "0";
    return Number(formatUnits(tokenOutBalanceRaw, tokenOut.decimals)).toLocaleString(undefined, {
      maximumFractionDigits: 4,
    });
  }, [tokenOutBalanceRaw, tokenOut.decimals]);

  const durationSeconds = useMemo(() => {
    const n = Number(durationValue || 0);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(n * DURATION_MULTIPLIER[durationUnit]);
  }, [durationUnit, durationValue]);

  const chunkCount = useMemo(() => {
    if (durationSeconds < MIN_CHUNK_DURATION_SECONDS) return 0;
    return Math.max(1, Math.min(MAX_CHUNKS, Math.floor(durationSeconds / MIN_CHUNK_DURATION_SECONDS)));
  }, [durationSeconds]);

  const amountInBase = useMemo(() => {
    try {
      return parseUnits(amountIn || "0", tokenIn.decimals);
    } catch {
      return 0n;
    }
  }, [amountIn, tokenIn.decimals]);

  const hasEnoughAllowance = useMemo(() => {
    if (!address || amountInBase <= 0n) return false;
    return ((tokenInAllowanceRaw as bigint | undefined) ?? 0n) >= amountInBase;
  }, [address, amountInBase, tokenInAllowanceRaw]);

  const poolKey = useMemo(() => {
    const [currency0, currency1] =
      ADDRS.usdc.toLowerCase() < ADDRS.react.toLowerCase() ? [ADDRS.usdc, ADDRS.react] : [ADDRS.react, ADDRS.usdc];

    return {
      currency0: currency0 as `0x${string}`,
      currency1: currency1 as `0x${string}`,
      fee: 3000,
      tickSpacing: 60,
      hooks: ADDRS.hook,
    };
  }, []);

  const [lasnaCronSubscribed, setLasnaCronSubscribed] = useState<boolean | null>(null);
  const { data: claimableOutputRaw } = useReadContract({
    chainId: CHAIN_ID,
    address: ADDRS.hook,
    abi: twammHookAbi as any,
    functionName: "claimableOutput",
    args: lastOrderId ? [lastOrderId] : undefined,
    query: { enabled: Boolean(lastOrderId) },
  });

  const claimableOutput = useMemo(() => {
    if (!claimableOutputRaw) return "0";
    return Number(formatUnits(claimableOutputRaw as bigint, tokenOut.decimals)).toLocaleString(undefined, {
      maximumFractionDigits: 6,
    });
  }, [claimableOutputRaw, tokenOut.decimals]);

  const { writeContractAsync: writeTwamm, isMining: isTwammMining } = useScaffoldWriteContract({
    contractName: "TWAMMHook",
  }) as any;
  const { writeContractAsync: writeErc20 } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();

  const canSubmitOrder = durationSeconds >= MIN_CHUNK_DURATION_SECONDS && Number(amountIn || 0) > 0;

  const poolId = useMemo(() => {
    return keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      ),
    );
  }, [poolKey]);

  const [chartPoints, setChartPoints] = useState<
    {
      index: number;
      ts: number;
      execPrice: number;
      trendPrice: number;
      chunkIn: string;
      chunkOut: string;
      source: "chunk" | "swap" | "live";
      blockNumber: number;
    }[]
  >([]);
  const [livePoolPrice, setLivePoolPrice] = useState<number | null>(null);

  const latestObservedPrice = useMemo(() => {
    const latestPoint = chartPoints[chartPoints.length - 1];
    return latestPoint?.execPrice && Number.isFinite(latestPoint.execPrice) && latestPoint.execPrice > 0
      ? latestPoint.execPrice
      : null;
  }, [chartPoints]);

  const displayPrice = livePoolPrice ?? latestObservedPrice;

  const estimatedTotalOut = useMemo(() => {
    const n = Number(amountIn || 0);
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (!displayPrice || chunkCount === 0) return "—";

    const chunkIn = n / chunkCount;
    const perChunkOut = usdcToReact ? chunkIn / displayPrice : chunkIn * displayPrice;
    const estimatedOut = perChunkOut * chunkCount;
    if (!Number.isFinite(estimatedOut) || estimatedOut <= 0) return "0";
    return estimatedOut.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }, [amountIn, chunkCount, displayPrice, usdcToReact]);

  const estimatedPerChunkOut = useMemo(() => {
    const totalOut = Number(estimatedTotalOut.replaceAll(",", ""));
    if (!Number.isFinite(totalOut) || totalOut <= 0 || chunkCount === 0) return estimatedTotalOut === "—" ? "—" : "0";
    return (totalOut / chunkCount).toLocaleString(undefined, { maximumFractionDigits: 6 });
  }, [chunkCount, estimatedTotalOut]);

  const displayedMinOutputPerChunk = useMemo(() => {
    if (estimatedPerChunkOut === "—") return "—";
    const perChunk = Number(estimatedPerChunkOut.replaceAll(",", ""));
    const slip = Number(slippagePct);
    if (!Number.isFinite(perChunk) || perChunk <= 0 || !Number.isFinite(slip)) return "0";
    return (perChunk * (1 - slip / 100)).toLocaleString(undefined, { maximumFractionDigits: 6 });
  }, [estimatedPerChunkOut, slippagePct]);

  useEffect(() => {
    let cancelled = false;
    const getPoolStateSlot = () => keccak256(concatHex([poolId, toHex(POOLS_SLOT, { size: 32 })]));

    const fetchLivePoolPrice = async () => {
      if (!publicClient) return;
      try {
        const slot0 = await publicClient.readContract({
          address: POOL_MANAGER,
          abi: extsloadAbi,
          functionName: "extsload",
          args: [getPoolStateSlot()],
        });

        const packed = BigInt(slot0 as `0x${string}`);
        const sqrtPriceX96 = packed & MASK_160;
        const liveDec0 = poolKey.currency0.toLowerCase() === ADDRS.usdc.toLowerCase() ? 6 : 18;
        const liveDec1 = poolKey.currency1.toLowerCase() === ADDRS.usdc.toLowerCase() ? 6 : 18;
        const rawToken1PerToken0 = (Number(sqrtPriceX96) / Q96) ** 2;
        const humanToken1PerToken0 = rawToken1PerToken0 * 10 ** (liveDec0 - liveDec1);
        const reactIsToken0 = poolKey.currency0.toLowerCase() === ADDRS.react.toLowerCase();
        const reactUsd = reactIsToken0 ? humanToken1PerToken0 : 1 / humanToken1PerToken0;

        if (!cancelled && Number.isFinite(reactUsd) && reactUsd > 0) {
          setLivePoolPrice(reactUsd);
        }
      } catch {
        if (!cancelled) setLivePoolPrice(null);
      }
    };

    const fetchPriceSeries = async () => {
      if (!publicClient) return;
      try {
        type RawPoint = {
          ts: number;
          execPrice: number;
          chunkIn: string;
          chunkOut: string;
          source: "chunk" | "swap" | "live";
          blockNumber: number;
        };
        const rawPoints: RawPoint[] = [];
        const latestBlock = await publicClient.getBlockNumber();
        const fromBlock = latestBlock > 20_000n ? latestBlock - 20_000n : 0n;

        // --- 1. ChunkExecuted events from hook ---
        const chunkEvent = parseAbiItem(
          "event ChunkExecuted(bytes32 indexed orderId, uint256 chunkIndex, uint256 amountIn, uint256 amountOut)",
        );
        let chunkLogs: any[] = [];
        if (lastOrderId) {
          try {
            chunkLogs = await publicClient.getLogs({
              address: ADDRS.hook,
              event: chunkEvent,
              fromBlock,
              toBlock: "latest",
            });
          } catch {
            chunkLogs = [];
          }
        }

        // Collect all block numbers for timestamp resolution
        const allBlockNums = new Set<number>();
        chunkLogs.forEach(l => {
          if (l.blockNumber) allBlockNums.add(Number(l.blockNumber));
        });

        // --- 2. Swap events from PoolManager ---
        let swapLogs: any[] = [];
        try {
          const allSwapLogs = await publicClient.getLogs({
            address: POOL_MANAGER,
            event: swapEvent,
            fromBlock,
            toBlock: "latest",
          });
          swapLogs = allSwapLogs.filter(log => {
            const topicPoolId = log.topics?.[1]?.toLowerCase();
            return topicPoolId === poolId.toLowerCase();
          });
        } catch {
          swapLogs = [];
        }
        swapLogs.forEach(l => {
          if (l.blockNumber) allBlockNums.add(Number(l.blockNumber));
        });

        // Resolve block timestamps
        const blockTs = new Map<number, number>();
        await Promise.all(
          [...allBlockNums].map(async b => {
            const block = await publicClient.getBlock({ blockNumber: BigInt(b) });
            blockTs.set(b, Number(block.timestamp));
          }),
        );

        // Process chunk logs
        const orderMeta = new Map<string, { tokenIn: string; tokenOut: string }>();
        for (const log of chunkLogs) {
          const args = (log as any).args || {};
          const orderId = args.orderId as string;
          const amountInRaw = args.amountIn as bigint;
          const amountOutRaw = args.amountOut as bigint;
          if (!amountInRaw || !amountOutRaw || amountInRaw === 0n || amountOutRaw === 0n) continue;
          if (lastOrderId && orderId.toLowerCase() !== lastOrderId.toLowerCase()) continue;

          if (!orderMeta.has(orderId)) {
            try {
              const order = await publicClient.readContract({
                address: ADDRS.hook,
                abi: twammHookAbi as any,
                functionName: "getOrder",
                args: [orderId],
              });
              orderMeta.set(orderId, {
                tokenIn: ((order as any).tokenIn as string).toLowerCase(),
                tokenOut: ((order as any).tokenOut as string).toLowerCase(),
              });
            } catch {
              continue;
            }
          }

          const meta = orderMeta.get(orderId);
          if (!meta) continue;

          const currentUsdc = ADDRS.usdc.toLowerCase();
          const currentReact = ADDRS.react.toLowerCase();
          const isCurrentPair =
            (meta.tokenIn === currentUsdc && meta.tokenOut === currentReact) ||
            (meta.tokenIn === currentReact && meta.tokenOut === currentUsdc);
          if (!isCurrentPair) continue;

          const inIsUsdc = meta.tokenIn === currentUsdc;
          const inDec = inIsUsdc ? 6 : 18;
          const outDec = inIsUsdc ? 18 : 6;
          const amtIn = Number(formatUnits(amountInRaw, inDec));
          const amtOut = Number(formatUnits(amountOutRaw, outDec));

          let reactUsd: number;
          if (inIsUsdc) {
            reactUsd = amtOut > 0 ? amtIn / amtOut : 0;
          } else {
            reactUsd = amtIn > 0 ? amtOut / amtIn : 0;
          }
          if (reactUsd <= 0) continue;

          const bn = Number(log.blockNumber || 0n);
          rawPoints.push({
            ts: blockTs.get(bn) || Math.floor(Date.now() / 1000),
            execPrice: reactUsd,
            chunkIn: `${amtIn.toFixed(inIsUsdc ? 2 : 4)} ${inIsUsdc ? "USDC" : "REACT"}`,
            chunkOut: `${amtOut.toFixed(inIsUsdc ? 4 : 2)} ${inIsUsdc ? "REACT" : "USDC"}`,
            source: "chunk",
            blockNumber: bn,
          });
        }

        // Process swap logs (from PoolManager — includes arb bot swaps etc.)
        const dec0 = poolKey.currency0.toLowerCase() === ADDRS.usdc.toLowerCase() ? 6 : 18;
        const dec1 = poolKey.currency1.toLowerCase() === ADDRS.usdc.toLowerCase() ? 6 : 18;
        for (const log of swapLogs) {
          const args = (log as any).args || {};
          const sqrt = Number(args.sqrtPriceX96 || 0n);
          if (!sqrt) continue;

          const p1Per0 = (sqrt / 2 ** 96) ** 2 * 10 ** (dec0 - dec1);
          let reactUsd = p1Per0;
          if (poolKey.currency0.toLowerCase() === ADDRS.usdc.toLowerCase()) {
            reactUsd = p1Per0 > 0 ? 1 / p1Per0 : 0;
          }
          if (reactUsd <= 0) continue;

          const bn = Number(log.blockNumber || 0n);
          rawPoints.push({
            ts: blockTs.get(bn) || Math.floor(Date.now() / 1000),
            execPrice: reactUsd,
            chunkIn: "-",
            chunkOut: "-",
            source: "swap",
            blockNumber: bn,
          });
        }

        // Add a direct live pool snapshot so the chart still updates even if log polling is sparse.
        const slot0 = await publicClient.readContract({
          address: POOL_MANAGER,
          abi: extsloadAbi,
          functionName: "extsload",
          args: [getPoolStateSlot()],
        });
        const packed = BigInt(slot0 as `0x${string}`);
        const sqrtPriceX96 = packed & MASK_160;
        const liveDec0 = poolKey.currency0.toLowerCase() === ADDRS.usdc.toLowerCase() ? 6 : 18;
        const liveDec1 = poolKey.currency1.toLowerCase() === ADDRS.usdc.toLowerCase() ? 6 : 18;
        const rawToken1PerToken0 = (Number(sqrtPriceX96) / Q96) ** 2;
        const humanToken1PerToken0 = rawToken1PerToken0 * 10 ** (liveDec0 - liveDec1);
        const reactIsToken0 = poolKey.currency0.toLowerCase() === ADDRS.react.toLowerCase();
        const liveReactUsd = reactIsToken0 ? humanToken1PerToken0 : 1 / humanToken1PerToken0;
        if (Number.isFinite(liveReactUsd) && liveReactUsd > 0) {
          rawPoints.push({
            ts: Math.floor(Date.now() / 1000),
            execPrice: liveReactUsd,
            chunkIn: "-",
            chunkOut: "-",
            source: "live",
            blockNumber: Number(latestBlock),
          });
        }

        // Sort by block number then compute EMA
        rawPoints.sort((a, b) => a.blockNumber - b.blockNumber || a.ts - b.ts);

        if (!cancelled) {
          setChartPoints(prev => {
            const carryLive = prev
              .filter(p => p.source === "live")
              .slice(-60)
              .map(p => ({
                ts: p.ts,
                execPrice: p.execPrice,
                chunkIn: p.chunkIn,
                chunkOut: p.chunkOut,
                source: p.source,
                blockNumber: p.blockNumber,
              }));

            const deduped = new Map<string, (typeof carryLive)[number]>();
            for (const point of [...carryLive, ...rawPoints]) {
              const key =
                point.source === "live"
                  ? `${point.source}-${point.ts}`
                  : `${point.source}-${point.blockNumber}-${point.ts}`;
              deduped.set(key, point);
            }

            const merged = [...deduped.values()]
              .sort((a, b) => a.blockNumber - b.blockNumber || a.ts - b.ts)
              .slice(-200);

            let ema = 0;
            return merged.map((p, idx) => {
              ema = idx === 0 ? p.execPrice : ema * 0.6 + p.execPrice * 0.4;
              return {
                index: idx + 1,
                ts: p.ts,
                execPrice: p.execPrice,
                trendPrice: ema,
                chunkIn: p.chunkIn,
                chunkOut: p.chunkOut,
                source: p.source,
                blockNumber: p.blockNumber,
              };
            });
          });
        }
      } catch {
        if (!cancelled) setChartPoints([]);
      }
    };

    fetchLivePoolPrice();
    fetchPriceSeries();
    const priceId = setInterval(fetchLivePoolPrice, 8000);
    const id = setInterval(fetchPriceSeries, 10000);
    return () => {
      cancelled = true;
      clearInterval(priceId);
      clearInterval(id);
    };
  }, [lastOrderId, publicClient, poolId, poolKey]);

  useEffect(() => {
    let cancelled = false;

    const fetchLasnaState = async () => {
      try {
        const lasnaRpc = lasnaChain.rpcUrls.default.http[0];
        if (!lasnaRpc) {
          if (!cancelled) setLasnaReactiveBalance("set NEXT_PUBLIC_LASNA_RPC");
          return;
        }

        const lasnaClient = createPublicClient({ chain: lasnaChain, transport: http(lasnaRpc) });
        const bal = await lasnaClient.getBalance({ address: LASNA.reactiveTwamm });
        if (!cancelled) setLasnaReactiveBalance(formatEther(bal));

        const initStatus = await lasnaClient.readContract({
          address: LASNA.reactiveTwamm,
          abi: reactiveTwammAbi as any,
          functionName: "initialized",
          args: [],
        });
        if (!cancelled) setLasnaCronSubscribed(initStatus as boolean);

        const activeCount = await lasnaClient.readContract({
          address: LASNA.reactiveTwamm,
          abi: reactiveTwammAbi as any,
          functionName: "getActiveOrderCount",
          args: [],
        });
        if (!cancelled) setLasnaActiveOrderCount(Number(activeCount));

        // Fetch debt from Reactive system contract
        const debtsAbi = [
          {
            type: "function",
            name: "debts",
            inputs: [{ name: "", type: "address" }],
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
          },
        ] as const;
        try {
          const debt = await lasnaClient.readContract({
            address: LASNA.systemContract,
            abi: debtsAbi,
            functionName: "debts",
            args: [LASNA.reactiveTwamm],
          });
          if (!cancelled) setLasnaDebt(formatEther(debt as bigint));
        } catch {
          if (!cancelled) setLasnaDebt("?");
        }
      } catch {
        if (!cancelled) {
          setLasnaReactiveBalance("error");
          setLasnaCronSubscribed(null);
        }
      }
    };

    fetchLasnaState();
    const id = setInterval(fetchLasnaState, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Poll Unichain callback proxy reserves/debt for the deployer (RVM ID)
  useEffect(() => {
    let cancelled = false;
    const proxyAbi = [
      {
        type: "function",
        name: "reserves",
        inputs: [{ name: "", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
      },
      {
        type: "function",
        name: "debts",
        inputs: [{ name: "", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
      },
      {
        type: "function",
        name: "depositTo",
        inputs: [{ name: "", type: "address" }],
        outputs: [],
        stateMutability: "payable",
      },
    ] as const;

    const fetchCallbackState = async () => {
      if (!publicClient) return;
      try {
        // Callback delivery fees are charged to the TARGET contract (hook), not the sender
        const reserves = await publicClient.readContract({
          address: ADDRS.callbackProxy,
          abi: proxyAbi,
          functionName: "reserves",
          args: [ADDRS.hook],
        });
        if (!cancelled) setCallbackReserves(formatEther(reserves as bigint));

        const debt = await publicClient.readContract({
          address: ADDRS.callbackProxy,
          abi: proxyAbi,
          functionName: "debts",
          args: [ADDRS.hook],
        });
        if (!cancelled) setCallbackDebt(formatEther(debt as bigint));
      } catch {
        if (!cancelled) {
          setCallbackReserves("?");
          setCallbackDebt("?");
        }
      }
    };

    fetchCallbackState();
    const id = setInterval(fetchCallbackState, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [publicClient]);

  // Poll order progress from Unichain TWAMMHook
  useEffect(() => {
    if (!lastOrderId || !publicClient) {
      setOrderProgress(null);
      return;
    }

    let cancelled = false;
    const fetchProgress = async () => {
      try {
        const result = await publicClient.readContract({
          address: ADDRS.hook,
          abi: twammHookAbi as any,
          functionName: "getOrderProgress",
          args: [lastOrderId],
        });
        const [executed, total] = result as [bigint, bigint];
        if (!cancelled) setOrderProgress({ executed: Number(executed), total: Number(total) });
      } catch {
        if (!cancelled) setOrderProgress(null);
      }
    };

    fetchProgress();
    const id = setInterval(fetchProgress, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [lastOrderId, publicClient]);

  const filteredChartPoints = useMemo(() => {
    if (chartPoints.length === 0) return [];
    if (windowSeconds <= 0) return chartPoints;

    const latestTs = chartPoints[chartPoints.length - 1]?.ts ?? Math.floor(Date.now() / 1000);
    const minTs = latestTs - windowSeconds;
    return chartPoints.filter(p => p.ts >= minTs);
  }, [chartPoints, windowSeconds]);

  const svgChart = useMemo(() => {
    if (filteredChartPoints.length < 2) {
      return {
        exec: "",
        trend: "",
        chunkDots: [] as { cx: number; cy: number; key: string }[],
        yMin: 0,
        yMax: 0,
        xStart: "",
        xEnd: "",
      };
    }

    const width = 640;
    const height = 220;
    const padL = 52;
    const padR = 20;
    const padT = 16;
    const padB = 28;

    const prices = filteredChartPoints.flatMap(p => [p.execPrice, p.trendPrice]);
    const yMin = Math.min(...prices);
    const yMax = Math.max(...prices);
    const ySpan = Math.max(yMax - yMin, 1e-9);

    const minTs = Math.min(...filteredChartPoints.map(p => p.ts));
    const maxTs = Math.max(...filteredChartPoints.map(p => p.ts));
    const tSpan = Math.max(maxTs - minTs, 1);

    const toXY = (ts: number, y: number) => {
      const x = padL + ((ts - minTs) / tSpan) * (width - padL - padR);
      const yy = height - padB - ((y - yMin) / ySpan) * (height - padT - padB);
      return `${x},${yy}`;
    };

    const exec = filteredChartPoints.map(p => toXY(p.ts, p.execPrice)).join(" ");
    const trend = filteredChartPoints.map(p => toXY(p.ts, p.trendPrice)).join(" ");
    const chunkDots = filteredChartPoints
      .filter(p => p.source === "chunk")
      .map((p, idx) => {
        const [cx, cy] = toXY(p.ts, p.execPrice).split(",").map(Number);
        return { cx, cy, key: `${p.blockNumber}-${p.ts}-${idx}` };
      });

    const xStart = new Date(minTs * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const xEnd = new Date(maxTs * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    return { exec, trend, chunkDots, yMin, yMax, xStart, xEnd };
  }, [filteredChartPoints]);

  const approveForHook = async () => {
    setFlowStatus(`Approving ${tokenIn.symbol} for TWAMM hook...`);
    try {
      const approveHash = await writeErc20({
        address: tokenIn.address,
        abi: mockErc20Abi,
        functionName: "approve",
        args: [ADDRS.hook, maxUint256],
      });
      if (publicClient) {
        setFlowStatus("Waiting for approve confirmation...");
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
      setFlowStatus(`${tokenIn.symbol} approved ✅ Now submit your order.`);
    } catch (err: any) {
      setFlowStatus(`Approve failed: ${err.shortMessage || err.message}`);
    }
  };

  const submitOrder = async () => {
    try {
      setFlowStatus("Submitting order...");
      const minOutBase = 0n;
      const submitHash = await writeTwamm({
        functionName: "submitTWAMMOrder",
        args: [
          poolKey,
          amountInBase,
          BigInt(durationSeconds),
          tokenIn.address as `0x${string}`,
          tokenOut.address as `0x${string}`,
          minOutBase,
        ],
      });

      setFlowStatus("Waiting for tx receipt...");
      const receipt = await publicClient?.waitForTransactionReceipt({ hash: submitHash });
      if (!receipt) {
        setFlowStatus("No receipt found");
        return;
      }

      let parsedOrderId: `0x${string}` | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: twammHookAbi as any, data: log.data, topics: log.topics }) as any;
          if (decoded.eventName === "OrderSubmitted") {
            parsedOrderId = decoded.args.orderId as `0x${string}`;
            break;
          }
        } catch {
          // ignore unrelated logs
        }
      }

      if (!parsedOrderId) {
        setFlowStatus("Order submitted, but orderId not found in logs");
        return;
      }
      setLastOrderId(parsedOrderId);
      setFlowStatus("Order submitted ✅ Now click Subscribe.");
    } catch (err: any) {
      const message = err?.shortMessage || err?.message || "Submit failed";
      if (message.includes("ERC20InsufficientAllowance") || message.includes("0xfb8f41b2")) {
        setFlowStatus(`Submit failed: approve ${tokenIn.symbol} for the current hook first.`);
        return;
      }
      setFlowStatus(`Submit failed: ${message}`);
    }
  };

  const withLasnaChain = async (fn: () => Promise<void>) => {
    const prevChainId = walletChainId;
    try {
      if (walletChainId !== LASNA.chainId) {
        setFlowStatus("Switching wallet to Lasna...");
        await switchChainAsync({ chainId: LASNA.chainId });
      }
      await fn();
    } finally {
      if (prevChainId && prevChainId !== LASNA.chainId) {
        try {
          await switchChainAsync({ chainId: prevChainId });
        } catch {
          // user may reject switch-back, that's ok
        }
      }
    }
  };

  const subscribeLastOrder = async () => {
    if (!lastOrderId) return;
    setLasnaSubscribing(true);
    setFlowStatus("Subscribing order on Lasna Reactive Network...");
    try {
      await withLasnaChain(async () => {
        await writeErc20({
          address: LASNA.reactiveTwamm,
          abi: reactiveTwammAbi as any,
          functionName: "subscribe",
          args: [ADDRS.hook, poolKey, lastOrderId],
        });
      });
      setFlowStatus("Subscribed on Lasna ✅ Reactive cron will auto-execute chunks.");
    } catch (err: any) {
      setFlowStatus(`Subscribe failed: ${err.shortMessage || err.message}`);
    } finally {
      setLasnaSubscribing(false);
    }
  };

  const executeManual = async () => {
    if (!lastOrderId) return;
    setLasnaSubscribing(true);
    setFlowStatus("Executing on Lasna...");
    try {
      await withLasnaChain(async () => {
        await writeErc20({
          address: LASNA.reactiveTwamm,
          abi: reactiveTwammAbi as any,
          functionName: "batchExecute",
          args: [[lastOrderId]],
        });
      });
      setFlowStatus("Manual execute sent ✅");
    } catch (err: any) {
      setFlowStatus(`Execute failed: ${err.shortMessage || err.message}`);
    } finally {
      setLasnaSubscribing(false);
    }
  };

  const claim = async () => {
    if (!lastOrderId) return;
    setFlowStatus("Claiming output...");
    try {
      await writeTwamm({ functionName: "claimTWAMMOutput", args: [lastOrderId] });
      setFlowStatus("Output claimed ✅");
    } catch (err: any) {
      setFlowStatus(`Claim failed: ${err.shortMessage || err.message}`);
    }
  };

  const cancelOrder = async () => {
    if (!lastOrderId) return;
    setFlowStatus("Cancelling order...");
    try {
      await writeTwamm({ functionName: "cancelTWAMMOrder", args: [lastOrderId] });
      setFlowStatus("Order cancelled ✅ Remaining input tokens refunded.");
    } catch (err: any) {
      setFlowStatus(`Cancel failed: ${err.shortMessage || err.message}`);
    }
  };

  const fundLasnaContract = async () => {
    setFlowStatus("Funding Lasna contract...");
    try {
      await withLasnaChain(async () => {
        const hash = await sendTransactionAsync({
          to: LASNA.reactiveTwamm,
          value: parseUnits(fundAmount || "0", 18),
        });
        setFlowStatus(`Funded ${fundAmount} REACT to contract. Tx: ${hash.slice(0, 10)}...`);
      });
    } catch (err: any) {
      setFlowStatus(`Fund failed: ${err.shortMessage || err.message}`);
    }
  };

  const coverLasnaDebt = async () => {
    setFlowStatus("Covering debt on Lasna...");
    try {
      await withLasnaChain(async () => {
        await writeErc20({
          address: LASNA.reactiveTwamm,
          abi: reactiveTwammAbi as any,
          functionName: "coverDebt",
          args: [],
        });
      });
      setFlowStatus("Debt covered! Contract should be reactivated.");
    } catch (err: any) {
      setFlowStatus(`Cover debt failed: ${err.shortMessage || err.message}`);
    }
  };

  const fundCallbackProxy = async () => {
    setFlowStatus("Funding callback delivery for hook...");
    try {
      // Reactive infra charges the TARGET contract (hook) for callback delivery
      const hookAddrPadded = ADDRS.hook.slice(2).toLowerCase().padStart(64, "0");
      const hash = await sendTransactionAsync({
        to: ADDRS.callbackProxy,
        value: parseUnits(callbackFundAmount || "0", 18),
        data: `0xb760faf9${hookAddrPadded}` as `0x${string}`, // depositTo(hookAddress)
      });
      setFlowStatus(`Funded callback proxy for hook with ${callbackFundAmount} ETH. Tx: ${hash.slice(0, 10)}...`);
    } catch (err: any) {
      setFlowStatus(`Callback fund failed: ${err.shortMessage || err.message}`);
    }
  };

  const mintDemo = async (token: "USDC" | "REACT") => {
    if (!address) return;
    const tokenCfg =
      token === "USDC"
        ? { address: ADDRS.usdc, decimals: 6, amount: "10000" }
        : { address: ADDRS.react, decimals: 18, amount: "10000" };
    await writeErc20({
      address: tokenCfg.address,
      abi: mockErc20Abi,
      functionName: "mint",
      args: [address, parseUnits(tokenCfg.amount, tokenCfg.decimals)],
    });
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 space-y-5">
      <div className="flex justify-center">
        <Image src="/logo.png" alt="Reactive TWAMM" width={400} height={400} priority />
      </div>
      <section className="card bg-base-100 border border-primary/30 shadow-xl shadow-primary/10">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-black">ReactiveTWAMM.sol</h1>
            <div className="badge badge-primary badge-outline">Reactive Lasna</div>
          </div>
          <Address
            address={LASNA.reactiveTwamm}
            blockExplorerAddressLink={`https://lasna.reactscan.net/address/${LASNA.reactiveTwamm}`}
          />

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70">Initialized</p>
              <p className="font-semibold">{lasnaCronSubscribed === null ? "..." : String(lasnaCronSubscribed)}</p>
            </div>
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70">Active (Lasna)</p>
              <p className="font-semibold">{lasnaActiveOrderCount}</p>
            </div>
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70">Claimable</p>
              <p className="font-semibold">{claimableOutput}</p>
            </div>
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70">Lasna Reactive Bal</p>
              <p className="font-semibold">{lasnaReactiveBalance}</p>
            </div>
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70">Debt</p>
              <p className={`font-semibold ${lasnaDebt !== "0" && lasnaDebt !== "?" ? "text-error" : ""}`}>
                {lasnaDebt}
              </p>
            </div>
          </div>

          {((lasnaDebt !== "0" && lasnaDebt !== "?") ||
            (lasnaReactiveBalance !== "-" &&
              lasnaReactiveBalance !== "error" &&
              parseFloat(lasnaReactiveBalance) < 0.01)) && (
            <div className="alert alert-warning text-sm">
              <span>
                {lasnaDebt !== "0" && lasnaDebt !== "?"
                  ? "Contract has debt and may be inactive."
                  : "Contract balance is low."}{" "}
                Fund and cover debt to reactivate.
              </span>
            </div>
          )}

          <div className="flex gap-2 items-end">
            <label className="form-control flex-1">
              <span className="label-text text-xs">Fund amount (REACT)</span>
              <input
                className="input input-bordered input-sm"
                value={fundAmount}
                onChange={e => setFundAmount(e.target.value)}
              />
            </label>
            <button className="btn btn-sm btn-outline" onClick={fundLasnaContract}>
              Fund
            </button>
            <button
              className="btn btn-sm btn-error btn-outline"
              onClick={coverLasnaDebt}
              disabled={lasnaDebt === "0" || lasnaDebt === "?"}
            >
              Cover Debt
            </button>
          </div>

          <div className="divider text-xs text-base-content/50 my-1"> </div>

          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-black">TWAMMHook.sol</h1>
            <span className="badge badge-outline badge-sm border-[#FC0FC0] text-[#FC0FC0]">Unichain Sepolia</span>
          </div>
          <Address
            address={ADDRS.hook}
            blockExplorerAddressLink={`https://unichain-sepolia.blockscout.com/address/${ADDRS.hook}`}
          />
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70">Callback Reserves</p>
              <p className="font-semibold">{callbackReserves} ETH</p>
            </div>
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70">Callback Debt</p>
              <p className={`font-semibold ${callbackDebt !== "0" && callbackDebt !== "?" ? "text-error" : ""}`}>
                {callbackDebt} ETH
              </p>
            </div>
          </div>

          {((callbackDebt !== "0" && callbackDebt !== "?") ||
            (callbackReserves !== "-" && callbackReserves !== "?" && parseFloat(callbackReserves) < 0.005)) && (
            <div className="alert alert-warning text-sm">
              <span>
                {callbackDebt !== "0" && callbackDebt !== "?"
                  ? "Callback delivery has debt."
                  : "Callback reserves are low."}{" "}
                Fund the callback proxy to enable cross-chain delivery.
              </span>
            </div>
          )}

          <div className="flex gap-2 items-end">
            <label className="form-control flex-1">
              <span className="label-text text-xs">Fund amount (ETH on Unichain)</span>
              <input
                className="input input-bordered input-sm"
                value={callbackFundAmount}
                onChange={e => setCallbackFundAmount(e.target.value)}
              />
            </label>
            <button className="btn btn-sm btn-outline" onClick={fundCallbackProxy}>
              Fund Callback
            </button>
          </div>
        </div>
      </section>

      <section className="card bg-base-100 border border-base-300 shadow-lg">
        <div className="card-body space-y-3">
          <div className="rounded-2xl border border-base-300 bg-base-200 p-3">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-semibold">You pay</span>
              <span className="text-base-content/70">
                Balance: {tokenInBalance} {tokenIn.symbol}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <input
                className="input input-ghost text-2xl font-semibold px-0 w-full"
                value={amountIn}
                onChange={e => setAmountIn(e.target.value)}
              />
              <div className="badge badge-outline badge-lg">{tokenIn.symbol}</div>
            </div>
          </div>

          <div className="flex justify-center">
            <button className="btn btn-circle btn-sm btn-outline" onClick={() => setUsdcToReact(v => !v)}>
              <ArrowsUpDownIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="rounded-2xl border border-base-300 bg-base-200 p-3">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-semibold">You receive (est.)</span>
              <span className="text-base-content/70">
                Balance: {tokenOutBalance} {tokenOut.symbol}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-2xl font-semibold">~{estimatedTotalOut}</div>
              <div className="badge badge-outline badge-lg">{tokenOut.symbol}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[7rem_7rem_7rem_minmax(0,1fr)] sm:items-end">
            <label className="form-control">
              <span className="label-text text-xs">Duration</span>
              <input
                className="input input-bordered input-sm w-full"
                inputMode="numeric"
                value={durationValue}
                onChange={e => setDurationValue(e.target.value)}
              />
            </label>
            <label className="form-control">
              <span className="label-text text-xs">Unit</span>
              <select
                className="select select-bordered select-sm w-full"
                value={durationUnit}
                onChange={e => setDurationUnit(e.target.value as DurationUnit)}
              >
                <option value="minutes">min</option>
                <option value="hours">hour</option>
                <option value="days">day</option>
              </select>
            </label>
            <label className="form-control">
              <span className="label-text text-xs">Slippage</span>
              <select
                className="select select-bordered select-sm w-full"
                value={slippagePct}
                onChange={e => setSlippagePct(e.target.value as (typeof SLIPPAGE_OPTIONS)[number])}
              >
                {SLIPPAGE_OPTIONS.map(option => (
                  <option key={option} value={option}>
                    {option}%
                  </option>
                ))}
              </select>
            </label>
            <label className="form-control">
              <span className="label-text text-xs">Min output / chunk ({tokenOut.symbol})</span>
              <div className="input input-bordered input-sm w-full flex items-center text-sm">
                {displayedMinOutputPerChunk}
              </div>
            </label>
          </div>

          <p className="text-xs text-base-content/60">
            Slippage only affects this preview. For demo safety, orders still submit with min output per chunk set to
            `0`.
          </p>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70 flex items-center gap-1">
                <ClockIcon className="h-3 w-3" /> Seconds
              </p>
              <p className="font-semibold">{durationSeconds}</p>
            </div>
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70 flex items-center gap-1">
                <ChartBarIcon className="h-3 w-3" /> Chunks
              </p>
              <p className="font-semibold">{chunkCount}</p>
            </div>
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70">Per chunk</p>
              <p className="font-semibold">~{estimatedPerChunkOut}</p>
            </div>
          </div>
          {/*
          <div className="rounded-lg bg-base-200 p-2 border border-base-300 text-xs">
            <p className="text-base-content/70">Latest pool price</p>
            <p className="font-semibold">
              {displayPrice ? `${displayPrice.toFixed(6)} USDC per REACT` : "Waiting for pool state..."}
            </p>
          </div> */}

          <div className="flex gap-2">
            <button className="btn btn-outline btn-sm flex-1" onClick={() => mintDemo("USDC")}>
              Mint USDC
            </button>
            <button className="btn btn-outline btn-sm flex-1" onClick={() => mintDemo("REACT")}>
              Mint REACT
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button className="btn btn-outline w-full" onClick={approveForHook}>
              {hasEnoughAllowance ? `1. ${tokenIn.symbol} Approved` : `1. Approve ${tokenIn.symbol}`}
            </button>
            <button
              className="btn btn-primary w-full"
              disabled={!canSubmitOrder || !hasEnoughAllowance || isTwammMining || lasnaSubscribing}
              onClick={submitOrder}
            >
              <BoltIcon className="h-4 w-4" /> 2. Submit Order
            </button>
            <button
              className="btn btn-secondary w-full"
              disabled={!lastOrderId || lasnaSubscribing}
              onClick={subscribeLastOrder}
            >
              <BoltIcon className="h-4 w-4" /> 3. Subscribe
            </button>
          </div>

          {!hasEnoughAllowance && Number(amountIn || 0) > 0 && (
            <p className="text-xs text-warning">Approve the current input token for this hook before submitting.</p>
          )}
        </div>
      </section>

      <section className="card bg-base-100 border border-base-300">
        <div className="card-body space-y-3">
          <div className="text-sm">
            <p className="text-base-content/70">Latest order</p>
            <p className="font-mono break-all">{lastOrderId || "— submit order first —"}</p>
            <p className="text-xs text-base-content/60 mt-1">Flow status: {flowStatus}</p>
          </div>

          {orderProgress && orderProgress.total > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span>Chunks executed</span>
                <span className="font-semibold">
                  {orderProgress.executed} / {orderProgress.total}
                </span>
              </div>
              <progress
                className="progress progress-primary w-full"
                value={orderProgress.executed}
                max={orderProgress.total}
              />
              {orderProgress.executed >= orderProgress.total && (
                <p className="text-xs text-success font-semibold">Order complete — claim your output below.</p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              className="btn btn-outline flex-1"
              disabled={!lastOrderId || lasnaSubscribing}
              onClick={executeManual}
            >
              <ArrowPathIcon className="h-4 w-4" /> Execute (manual)
            </button>
            <button
              className="btn btn-accent flex-1"
              disabled={!lastOrderId || isTwammMining || claimableOutput === "0"}
              onClick={claim}
            >
              Claim {claimableOutput !== "0" ? `(${claimableOutput} ${tokenOut.symbol})` : ""}
            </button>
            <button
              className="btn btn-error btn-outline flex-1"
              disabled={!lastOrderId || isTwammMining}
              onClick={cancelOrder}
            >
              <XMarkIcon className="h-4 w-4" /> Cancel
            </button>
          </div>

          <p className="text-xs text-base-content/60">
            Reactive should execute chunks automatically after subscribe. Manual execute remains as fallback for demo
            control.
          </p>
        </div>
      </section>

      <section className="card bg-base-100 border border-base-300">
        <div className="card-body space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="card-title text-lg">Pool Price</h2>
            <span className="text-xs text-base-content/60">chunks + swaps (auto-updates)</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-base-content/60">Range</span>
            <button
              className={`btn btn-xs ${windowSeconds === 300 ? "btn-primary" : "btn-outline"}`}
              onClick={() => setWindowSeconds(300)}
            >
              5m
            </button>
            <button
              className={`btn btn-xs ${windowSeconds === 900 ? "btn-primary" : "btn-outline"}`}
              onClick={() => setWindowSeconds(900)}
            >
              15m
            </button>
            <button
              className={`btn btn-xs ${windowSeconds === 3600 ? "btn-primary" : "btn-outline"}`}
              onClick={() => setWindowSeconds(3600)}
            >
              1h
            </button>
            <button
              className={`btn btn-xs ${windowSeconds === 14400 ? "btn-primary" : "btn-outline"}`}
              onClick={() => setWindowSeconds(14400)}
            >
              4h
            </button>
            <button
              className={`btn btn-xs ${windowSeconds === 0 ? "btn-primary" : "btn-outline"}`}
              onClick={() => setWindowSeconds(0)}
            >
              all
            </button>

            <div className="ml-auto flex gap-1">
              <button
                className="btn btn-xs btn-outline"
                onClick={() => setWindowSeconds(prev => (prev === 0 ? 3600 : Math.max(60, Math.floor(prev / 2))))}
              >
                Zoom in
              </button>
              <button
                className="btn btn-xs btn-outline"
                onClick={() => setWindowSeconds(prev => (prev === 0 ? 0 : Math.min(86400, prev * 2)))}
              >
                Zoom out
              </button>
            </div>
          </div>

          {filteredChartPoints.length < 2 ? (
            <p className="text-sm text-base-content/70">No price observations in selected window.</p>
          ) : (
            <div className="rounded-xl border border-base-300 bg-base-200 p-2 overflow-x-auto">
              <svg viewBox="0 0 640 220" className="w-full min-w-[640px] h-[220px]">
                <line x1="52" y1="16" x2="52" y2="192" stroke="currentColor" opacity="0.25" />
                <line x1="52" y1="192" x2="620" y2="192" stroke="currentColor" opacity="0.25" />

                <polyline fill="none" stroke="#02bbf0" strokeWidth="3" points={svgChart.exec} />
                <polyline fill="none" stroke="#ff8f2e" strokeWidth="2" strokeDasharray="6 6" points={svgChart.trend} />
                {svgChart.chunkDots.map(dot => (
                  <circle key={dot.key} cx={dot.cx} cy={dot.cy} r="4.5" fill="#e11d48" stroke="#ffffff" strokeWidth="1.5" />
                ))}

                <text x="6" y="24" fontSize="10" fill="currentColor" opacity="0.7">
                  {svgChart.yMax.toFixed(6)}
                </text>
                <text x="6" y="192" fontSize="10" fill="currentColor" opacity="0.7">
                  {svgChart.yMin.toFixed(6)}
                </text>
                <text x="52" y="212" fontSize="10" fill="currentColor" opacity="0.7">
                  {svgChart.xStart}
                </text>
                <text x="560" y="212" fontSize="10" fill="currentColor" opacity="0.7">
                  {svgChart.xEnd}
                </text>
              </svg>
              <div className="mt-2 flex flex-wrap gap-4 text-xs">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-[#02bbf0]" />
                  Price (USDC/REACT)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-[#ff8f2e]" />
                  Trend (EMA)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#e11d48]" />
                  Chunk
                </span>
                <span className="badge badge-xs badge-outline">swap</span>
                <span className="badge badge-xs">live</span>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="table table-xs">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Time</th>
                  <th>Price (USDC/REACT)</th>
                  <th>Trend (EMA)</th>
                  <th>In</th>
                  <th>Out</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {[...filteredChartPoints]
                  .slice(-8)
                  .reverse()
                  .map(point => (
                    <tr key={`${point.source}-${point.index}`}>
                      <td>{point.index}</td>
                      <td>
                        {new Date(point.ts * 1000).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </td>
                      <td>{point.execPrice.toFixed(6)}</td>
                      <td>{point.trendPrice.toFixed(6)}</td>
                      <td className="text-xs">{point.chunkIn}</td>
                      <td className="text-xs">{point.chunkOut}</td>
                      <td>
                        <span
                          className={`badge badge-xs ${
                            point.source === "chunk"
                              ? "border-rose-600 bg-rose-600 text-white"
                              : point.source === "swap"
                                ? "badge-outline"
                                : ""
                          }`}
                        >
                          {point.source}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
};

export default Home;
