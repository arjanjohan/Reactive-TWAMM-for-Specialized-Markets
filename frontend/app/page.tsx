"use client";

import { useMemo, useState } from "react";
import type { NextPage } from "next";
import { useAccount, usePublicClient, useReadContract } from "wagmi";
import { decodeEventLog, erc20Abi, formatUnits, parseUnits } from "viem";
import { ArrowPathIcon, ArrowsUpDownIcon, BoltIcon, ChartBarIcon, ClockIcon } from "@heroicons/react/24/outline";
import twammHookAbi from "~~/contracts/abi/TWAMMHook.json";
import { useScaffoldReadContract, useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-eth";

type DurationUnit = "minutes" | "hours" | "days";

const DURATION_MULTIPLIER: Record<DurationUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
};

const ADDRS = {
  hook: "0x1eb187ec6240924c192230bfbbde6fdf13ce50c0" as const,
  reactive: "0x7087f17ecb3d5b90f83d561b27147c9fe67ee1e6" as const,
  usdc: "0x0000000000000000000000000000000000000000" as const,
  react: "0x0000000000000000000000000000000000000000" as const,
};

const MIN_CHUNK_DURATION_SECONDS = 60;
const MAX_CHUNKS = 100;

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

  const poolKey = useMemo(
    () => ({
      currency0: tokenIn.address as `0x${string}`,
      currency1: tokenOut.address as `0x${string}`,
      fee: 3000,
      tickSpacing: 60,
      hooks: ADDRS.hook,
    }),
    [tokenIn.address, tokenOut.address],
  );

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

  const canSubmitOrder = durationSeconds >= MIN_CHUNK_DURATION_SECONDS && Number(amountIn || 0) > 0;

  const submitAndSubscribe = async () => {
    const amountBase = parseUnits(amountIn || "0", tokenIn.decimals);
    const minOutBase = parseUnits(minOutputPerChunk || "0", tokenOut.decimals);

    const submitHash = await writeTwamm({
      functionName: "submitTWAMMOrder",
      args: [poolKey, amountBase, BigInt(durationSeconds), tokenIn.address as `0x${string}`, tokenOut.address as `0x${string}`, minOutBase],
    });

    const receipt = await publicClient?.waitForTransactionReceipt({ hash: submitHash });
    if (!receipt) return;

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

    if (!parsedOrderId) return;
    setLastOrderId(parsedOrderId);

    if (!cronSubscribed) {
      await writeReactive({ functionName: "ensureCronSubscription", args: [] });
    }

    await writeReactive({ functionName: "subscribe", args: [ADDRS.hook, poolKey, parsedOrderId] });
  };

  const executeManual = async () => {
    if (!lastOrderId) return;
    await writeReactive({ functionName: "batchExecute", args: [[lastOrderId]] });
  };

  const claim = async () => {
    if (!lastOrderId) return;
    await writeTwamm({ functionName: "claimTWAMMOutput", args: [lastOrderId] });
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

          <button className="btn btn-primary w-full" disabled={!canSubmitOrder || isTwammMining || isReactiveMining} onClick={submitAndSubscribe}>
            <BoltIcon className="h-4 w-4" /> Submit & Subscribe
          </button>
        </div>
      </section>

      <section className="card bg-base-100 border border-base-300">
        <div className="card-body space-y-3">
          <div className="text-sm">
            <p className="text-base-content/70">Latest order</p>
            <p className="font-mono break-all">{lastOrderId || "— submit order first —"}</p>
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
    </main>
  );
};

export default Home;
