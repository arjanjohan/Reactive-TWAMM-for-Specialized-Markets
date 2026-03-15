"use client";

import { useEffect, useMemo, useState } from "react";
import type { NextPage } from "next";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { decodeEventLog, encodeAbiParameters, erc20Abi, formatUnits, keccak256, maxUint256, parseAbiItem, parseUnits } from "viem";
import { ArrowPathIcon, ArrowsUpDownIcon, BoltIcon, ChartBarIcon, ClockIcon } from "@heroicons/react/24/outline";
import twammHookAbi from "~~/contracts/abi/TWAMMHook.json";
import { useScaffoldReadContract, useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-eth";
import { ADDRS, POOL_MANAGER } from "./addresses";

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

const Home: NextPage = () => {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { targetNetwork } = useTargetNetwork();

  const [usdcToReact, setUsdcToReact] = useState(true);
  const [amountIn, setAmountIn] = useState("1000");
  const [durationValue, setDurationValue] = useState("30");
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("minutes");
  const [minOutputPerChunk, setMinOutputPerChunk] = useState("0");
  const [lastOrderId, setLastOrderId] = useState<`0x${string}` | null>(null);
  const [flowStatus, setFlowStatus] = useState<string>("Idle");
  const [windowSeconds, setWindowSeconds] = useState<number>(3600); // default 1h

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
    query: { enabled: Boolean(address) && tokenIn.address !== "0x0000000000000000000000000000000000000000" },
  });

  const { data: tokenOutBalanceRaw } = useReadContract({
    address: tokenOut.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) && tokenOut.address !== "0x0000000000000000000000000000000000000000" },
  });

  const { data: tokenInAllowanceRaw } = useReadContract({
    address: tokenIn.address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, ADDRS.hook] : undefined,
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

  const tokenInAllowance = useMemo(() => {
    if (!tokenInAllowanceRaw) return 0n;
    return tokenInAllowanceRaw;
  }, [tokenInAllowanceRaw]);

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

  const { data: cronSubscribed } = useScaffoldReadContract({ contractName: "ReactiveTWAMM", functionName: "cronSubscribed" });
  const { data: activeOrderCount } = useScaffoldReadContract({ contractName: "ReactiveTWAMM", functionName: "getActiveOrderCount" });
  const { data: claimableOutputRaw } = useScaffoldReadContract({
    contractName: "TWAMMHook",
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
  const { writeContractAsync: writeReactive, isMining: isReactiveMining } = useScaffoldWriteContract({
    contractName: "ReactiveTWAMM",
  });
  const { writeContractAsync: writeErc20 } = useWriteContract();

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

  const submitOrder = async () => {
    setFlowStatus("Submitting order...");
    const amountBase = parseUnits(amountIn || "0", tokenIn.decimals);
    const minOutBase = parseUnits(minOutputPerChunk || "0", tokenOut.decimals);

    if (tokenInAllowance < amountBase) {
      setFlowStatus(`Approving ${tokenIn.symbol} for TWAMM hook...`);
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
      setFlowStatus(`Approval confirmed. Click Submit Order again.`);
      return;
    }

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

  const subscribeLastOrder = async () => {
    if (!lastOrderId) return;
    setFlowStatus("Subscribing order to Reactive...");
    await writeReactive({ functionName: "subscribe", args: [ADDRS.hook, poolKey, lastOrderId] });
    setFlowStatus("Subscribed ✅");
  };

  const executeManual = async () => {
    if (!lastOrderId) return;
    await writeReactive({ functionName: "batchExecute", args: [[lastOrderId]] });
  };

  const claim = async () => {
    if (!lastOrderId) return;
    await writeTwamm({ functionName: "claimTWAMMOutput", args: [lastOrderId] });
  };

  const approveInputToken = async () => {
    await writeErc20({
      address: tokenIn.address,
      abi: mockErc20Abi,
      functionName: "approve",
      args: [ADDRS.hook, maxUint256],
    });
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

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70">Cron</p>
              <p className="font-semibold">{String(Boolean(cronSubscribed))}</p>
            </div>
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70">Active</p>
              <p className="font-semibold">{String(Number(activeOrderCount || 0))}</p>
            </div>
            <div className="rounded-lg bg-base-200 p-2 border border-base-300">
              <p className="text-base-content/70">Claimable</p>
              <p className="font-semibold">{claimableOutput}</p>
            </div>
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

          <div className="grid grid-cols-3 gap-2">
            <button className="btn btn-outline btn-sm" onClick={() => mintDemo("USDC")}>
              Mint USDC
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => mintDemo("REACT")}>
              Mint REACT
            </button>
            <button className="btn btn-outline btn-sm" onClick={approveInputToken}>
              Approve {tokenIn.symbol}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button className="btn btn-primary w-full" disabled={!canSubmitOrder || isTwammMining || isReactiveMining} onClick={submitOrder}>
              <BoltIcon className="h-4 w-4" /> Submit Order
            </button>
            <button className="btn btn-secondary w-full" disabled={!lastOrderId || isReactiveMining} onClick={subscribeLastOrder}>
              <BoltIcon className="h-4 w-4" /> Subscribe Order
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

          <div className="flex gap-2">
            <button className="btn btn-outline flex-1" disabled={!lastOrderId || isReactiveMining} onClick={executeManual}>
              <ArrowPathIcon className="h-4 w-4" /> Execute (manual)
            </button>
            <button className="btn btn-accent flex-1" disabled={!lastOrderId || isTwammMining} onClick={claim}>
              Claim
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
