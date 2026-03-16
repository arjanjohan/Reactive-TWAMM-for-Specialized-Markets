"use client";

import { useEffect, useMemo, useState } from "react";
import type { NextPage } from "next";
import { useAccount, usePublicClient, useReadContract, useSendTransaction, useSwitchChain, useWriteContract } from "wagmi";
import {
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
} from "viem";
import { ArrowPathIcon, ArrowsUpDownIcon, BoltIcon, ChartBarIcon, ClockIcon, XMarkIcon } from "@heroicons/react/24/outline";
import twammHookAbi from "~~/contracts/abi/TWAMMHook.json";
import reactiveTwammAbi from "~~/contracts/abi/ReactiveTWAMM.json";
import { useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-eth";
import { ADDRS, LASNA, POOL_MANAGER } from "./addresses";

type DurationUnit = "minutes" | "hours" | "days";

const DURATION_MULTIPLIER: Record<DurationUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
};

const MIN_CHUNK_DURATION_SECONDS = 60;
const MAX_CHUNKS = 100;
const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);

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
    default: { http: [process.env.NEXT_PUBLIC_LASNA_RPC || "https://kopli-rpc.rkt.ink"] },
    public: { http: [process.env.NEXT_PUBLIC_LASNA_RPC || "https://kopli-rpc.rkt.ink"] },
  },
  testnet: true,
});

const Home: NextPage = () => {
  const { address, chainId: walletChainId } = useAccount();
  const publicClient = usePublicClient();
  const { targetNetwork } = useTargetNetwork();
  const { switchChainAsync } = useSwitchChain();

  const [usdcToReact, setUsdcToReact] = useState(true);
  const [amountIn, setAmountIn] = useState("1000");
  const [durationValue, setDurationValue] = useState("30");
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("minutes");
  const [minOutputPerChunk, setMinOutputPerChunk] = useState("0");
  const [lastOrderId, setLastOrderId] = useState<`0x${string}` | null>(null);
  const [flowStatus, setFlowStatus] = useState<string>("Idle");
  const [windowSeconds, setWindowSeconds] = useState<number>(3600); // default 1h
  const [lasnaReactiveBalance, setLasnaReactiveBalance] = useState<string>("-");
  const [lasnaActiveOrderCount, setLasnaActiveOrderCount] = useState<number>(0);
  const [lasnaDebt, setLasnaDebt] = useState<string>("0");
  const [orderProgress, setOrderProgress] = useState<{ executed: number; total: number } | null>(null);
  const [lasnaSubscribing, setLasnaSubscribing] = useState(false);
  const [fundAmount, setFundAmount] = useState("0.1");

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
    address: tokenIn.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { data: tokenOutBalanceRaw } = useReadContract({
    address: tokenOut.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });



  const tokenInBalance = useMemo(() => {
    if (!tokenInBalanceRaw) return "0";
    return Number(formatUnits(tokenInBalanceRaw, tokenIn.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 });
  }, [tokenInBalanceRaw, tokenIn.decimals]);

  const tokenOutBalance = useMemo(() => {
    if (!tokenOutBalanceRaw) return "0";
    return Number(formatUnits(tokenOutBalanceRaw, tokenOut.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 });
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

  const estimatedTotalOut = useMemo(() => {
    const n = Number(amountIn || 0);
    if (!Number.isFinite(n) || n <= 0) return "0";
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }, [amountIn]);

  const estimatedPerChunkOut = useMemo(() => {
    const n = Number(amountIn || 0);
    if (!Number.isFinite(n) || n <= 0 || chunkCount === 0) return "0";
    return (n / chunkCount).toLocaleString(undefined, { maximumFractionDigits: 6 });
  }, [amountIn, chunkCount]);

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

  const { writeContractAsync: writeTwamm, isMining: isTwammMining } = useScaffoldWriteContract({ contractName: "TWAMMHook" });
  const { writeContractAsync: writeErc20 } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();

  const canSubmitOrder = durationSeconds >= MIN_CHUNK_DURATION_SECONDS && Number(amountIn || 0) > 0;

  const poolId = useMemo(() => {
    return keccak256(
      encodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "int24" },
          { type: "address" },
        ],
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
    }[]
  >([]);

  useEffect(() => {
    let cancelled = false;

    const fetchSwapSeries = async () => {
      if (!publicClient) return;
      try {
        const logs = await publicClient.getLogs({
          address: POOL_MANAGER,
          event: swapEvent,
          args: { id: poolId },
          fromBlock: 0n,
          toBlock: "latest",
        });

        const blocks = [...new Set(logs.map(l => l.blockNumber).filter(Boolean).map(b => Number(b)))];
        const blockTs = new Map<number, number>();
        await Promise.all(
          blocks.map(async b => {
            const block = await publicClient.getBlock({ blockNumber: BigInt(b) });
            blockTs.set(b, Number(block.timestamp));
          }),
        );

        const dec0 = poolKey.currency0.toLowerCase() === ADDRS.usdc.toLowerCase() ? 6 : 18;
        const dec1 = poolKey.currency1.toLowerCase() === ADDRS.usdc.toLowerCase() ? 6 : 18;

        const points: { index: number; ts: number; execPrice: number; trendPrice: number; chunkIn: string; chunkOut: string }[] = [];
        let ema = 0;

        logs.forEach((log, idx) => {
          const args = (log as any).args || {};
          const sqrt = Number(args.sqrtPriceX96 || 0n);
          if (!sqrt) return;

          const p1Per0 = (sqrt / 2 ** 96) ** 2 * 10 ** (dec0 - dec1);
          let reactUsd = p1Per0;

          if (poolKey.currency0.toLowerCase() === ADDRS.usdc.toLowerCase()) {
            reactUsd = p1Per0 > 0 ? 1 / p1Per0 : 0;
          }

          ema = points.length === 0 ? reactUsd : ema * 0.6 + reactUsd * 0.4;
          const bn = Number(log.blockNumber || 0n);

          points.push({
            index: idx + 1,
            ts: blockTs.get(bn) || Math.floor(Date.now() / 1000) + idx,
            execPrice: reactUsd,
            trendPrice: ema,
            chunkIn: "-",
            chunkOut: "-",
          });
        });

        if (!cancelled) setChartPoints(points);
      } catch {
        if (!cancelled) setChartPoints([]);
      }
    };

    fetchSwapSeries();
    const id = setInterval(fetchSwapSeries, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [publicClient, poolId, poolKey]);

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

        const cronStatus = await lasnaClient.readContract({
          address: LASNA.reactiveTwamm,
          abi: reactiveTwammAbi as any,
          functionName: "cronSubscribed",
          args: [],
        });
        if (!cancelled) setLasnaCronSubscribed(cronStatus as boolean);

        const activeCount = await lasnaClient.readContract({
          address: LASNA.reactiveTwamm,
          abi: reactiveTwammAbi as any,
          functionName: "getActiveOrderCount",
          args: [],
        });
        if (!cancelled) setLasnaActiveOrderCount(Number(activeCount));

        // Fetch debt from Reactive system contract
        try {
          const debt = await lasnaClient.readContract({
            address: "0x0000000000000000000000000000000000fffFfF",
            abi: [{ type: "function", name: "debts", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" }] as const,
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

    const xStart = new Date(minTs * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const xEnd = new Date(maxTs * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    return { exec, trend, yMin, yMax, xStart, xEnd };
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
    setFlowStatus("Submitting order...");
    const amountBase = parseUnits(amountIn || "0", tokenIn.decimals);
    const minOutBase = parseUnits(minOutputPerChunk || "0", tokenOut.decimals);

    const submitHash = await writeTwamm({
      functionName: "submitTWAMMOrder",
      args: [poolKey, amountBase, BigInt(durationSeconds), tokenIn.address as `0x${string}`, tokenOut.address as `0x${string}`, minOutBase],
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
        const decoded = decodeEventLog({ abi: twammHookAbi as any, data: log.data, topics: log.topics });
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

  const mintDemo = async (token: "USDC" | "REACT") => {
    if (!address) return;
    const tokenCfg = token === "USDC" ? { address: ADDRS.usdc, decimals: 6, amount: "10000" } : { address: ADDRS.react, decimals: 18, amount: "10000" };
    await writeErc20({
      address: tokenCfg.address,
      abi: mockErc20Abi,
      functionName: "mint",
      args: [address, parseUnits(tokenCfg.amount, tokenCfg.decimals)],
    });
  };

  return (
    <main className="mx-auto max-w-xl px-4 py-10 space-y-5">
      <section className="card bg-base-100 border border-primary/30 shadow-xl shadow-primary/10">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-black">Reactive TWAMM</h1>
            <div className="badge badge-primary badge-outline">{targetNetwork.name}</div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70">Cron</p>
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
              <p className={`font-semibold ${lasnaDebt !== "0" && lasnaDebt !== "?" ? "text-error" : ""}`}>{lasnaDebt}</p>
            </div>
          </div>

          {(lasnaDebt !== "0" && lasnaDebt !== "?" || (lasnaReactiveBalance !== "-" && lasnaReactiveBalance !== "error" && parseFloat(lasnaReactiveBalance) < 0.01)) && (
            <div className="alert alert-warning text-sm">
              <span>{lasnaDebt !== "0" && lasnaDebt !== "?" ? "Contract has debt and may be inactive." : "Contract balance is low."} Fund and cover debt to reactivate.</span>
            </div>
          )}

          <div className="flex gap-2 items-end">
            <label className="form-control flex-1">
              <span className="label-text text-xs">Fund amount (REACT)</span>
              <input className="input input-bordered input-sm" value={fundAmount} onChange={e => setFundAmount(e.target.value)} />
            </label>
            <button className="btn btn-sm btn-outline" onClick={fundLasnaContract}>Fund</button>
            <button className="btn btn-sm btn-error btn-outline" onClick={coverLasnaDebt} disabled={lasnaDebt === "0" || lasnaDebt === "?"}>
              Cover Debt
            </button>
          </div>
        </div>
      </section>

      <section className="card bg-base-100 border border-base-300 shadow-lg">
        <div className="card-body space-y-3">
          <div className="rounded-2xl border border-base-300 bg-base-200 p-3">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="font-semibold">You pay</span>
              <span className="text-base-content/70">Balance: {tokenInBalance} {tokenIn.symbol}</span>
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
              <span className="text-base-content/70">Balance: {tokenOutBalance} {tokenOut.symbol}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-2xl font-semibold">~{estimatedTotalOut}</div>
              <div className="badge badge-outline badge-lg">{tokenOut.symbol}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="form-control col-span-2">
              <span className="label-text text-xs">Duration</span>
              <input className="input input-bordered" value={durationValue} onChange={e => setDurationValue(e.target.value)} />
            </label>
            <label className="form-control">
              <span className="label-text text-xs">Unit</span>
              <select className="select select-bordered" value={durationUnit} onChange={e => setDurationUnit(e.target.value as DurationUnit)}>
                <option value="minutes">min</option>
                <option value="hours">hour</option>
                <option value="days">day</option>
              </select>
            </label>
          </div>

          <label className="form-control">
            <span className="label-text text-xs">Min output per chunk ({tokenOut.symbol})</span>
            <input
              className="input input-bordered"
              value={minOutputPerChunk}
              onChange={e => setMinOutputPerChunk(e.target.value)}
            />
          </label>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70 flex items-center gap-1"><ClockIcon className="h-3 w-3" /> Seconds</p>
              <p className="font-semibold">{durationSeconds}</p>
            </div>
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70 flex items-center gap-1"><ChartBarIcon className="h-3 w-3" /> Chunks</p>
              <p className="font-semibold">{chunkCount}</p>
            </div>
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70">Per chunk</p>
              <p className="font-semibold">~{estimatedPerChunkOut}</p>
            </div>
          </div>

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
              1. Approve {tokenIn.symbol}
            </button>
            <button className="btn btn-primary w-full" disabled={!canSubmitOrder || isTwammMining || lasnaSubscribing} onClick={submitOrder}>
              <BoltIcon className="h-4 w-4" /> 2. Submit Order
            </button>
            <button className="btn btn-secondary w-full" disabled={!lastOrderId || lasnaSubscribing} onClick={subscribeLastOrder}>
              <BoltIcon className="h-4 w-4" /> 3. Subscribe
            </button>
          </div>
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
                <span className="font-semibold">{orderProgress.executed} / {orderProgress.total}</span>
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
            <button className="btn btn-outline flex-1" disabled={!lastOrderId || lasnaSubscribing} onClick={executeManual}>
              <ArrowPathIcon className="h-4 w-4" /> Execute (manual)
            </button>
            <button className="btn btn-accent flex-1" disabled={!lastOrderId || isTwammMining} onClick={claim}>
              Claim
            </button>
            <button className="btn btn-error btn-outline flex-1" disabled={!lastOrderId || isTwammMining} onClick={cancelOrder}>
              <XMarkIcon className="h-4 w-4" /> Cancel
            </button>
          </div>

          <p className="text-xs text-base-content/60">
            Reactive should execute chunks automatically after subscribe. Manual execute remains as fallback for demo control.
          </p>
        </div>
      </section>

      <section className="card bg-base-100 border border-base-300">
        <div className="card-body space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="card-title text-lg">Live Price (from swaps)</h2>
            <span className="text-xs text-base-content/60">auto-updates from pool swap events</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-base-content/60">Range</span>
            <button className={`btn btn-xs ${windowSeconds === 300 ? "btn-primary" : "btn-outline"}`} onClick={() => setWindowSeconds(300)}>5m</button>
            <button className={`btn btn-xs ${windowSeconds === 900 ? "btn-primary" : "btn-outline"}`} onClick={() => setWindowSeconds(900)}>15m</button>
            <button className={`btn btn-xs ${windowSeconds === 3600 ? "btn-primary" : "btn-outline"}`} onClick={() => setWindowSeconds(3600)}>1h</button>
            <button className={`btn btn-xs ${windowSeconds === 14400 ? "btn-primary" : "btn-outline"}`} onClick={() => setWindowSeconds(14400)}>4h</button>
            <button className={`btn btn-xs ${windowSeconds === 0 ? "btn-primary" : "btn-outline"}`} onClick={() => setWindowSeconds(0)}>all</button>

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
            <p className="text-sm text-base-content/70">No swap observations in selected window.</p>
          ) : (
            <div className="rounded-xl border border-base-300 bg-base-200 p-2 overflow-x-auto">
              <svg viewBox="0 0 640 220" className="w-full min-w-[640px] h-[220px]">
                <line x1="52" y1="16" x2="52" y2="192" stroke="currentColor" opacity="0.25" />
                <line x1="52" y1="192" x2="620" y2="192" stroke="currentColor" opacity="0.25" />

                <polyline fill="none" stroke="#02bbf0" strokeWidth="3" points={svgChart.exec} />
                <polyline fill="none" stroke="#ff8f2e" strokeWidth="2" strokeDasharray="6 6" points={svgChart.trend} />

                <text x="6" y="24" fontSize="10" fill="currentColor" opacity="0.7">{svgChart.yMax.toFixed(6)}</text>
                <text x="6" y="192" fontSize="10" fill="currentColor" opacity="0.7">{svgChart.yMin.toFixed(6)}</text>
                <text x="52" y="212" fontSize="10" fill="currentColor" opacity="0.7">{svgChart.xStart}</text>
                <text x="560" y="212" fontSize="10" fill="currentColor" opacity="0.7">{svgChart.xEnd}</text>
              </svg>
              <div className="mt-2 flex flex-wrap gap-4 text-xs">
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#02bbf0]" />Execution price (USDC per REACT)</span>
                <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#ff8f2e]" />Trend price (EMA)</span>
                <span className="text-base-content/70">X-axis: time</span>
                <span className="text-base-content/70">Y-axis: price</span>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="table table-xs">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Time</th>
                  <th>Execution Price</th>
                  <th>Trend Price</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {[...filteredChartPoints].slice(-8).reverse().map(point => (
                  <tr key={point.index}>
                    <td>{point.index}</td>
                    <td>{new Date(point.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                    <td>{point.execPrice.toFixed(6)}</td>
                    <td>{point.trendPrice.toFixed(6)}</td>
                    <td>Swap</td>
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
