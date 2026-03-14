"use client";

import { useMemo, useState } from "react";
import type { NextPage } from "next";
import { formatUnits, parseUnits } from "viem";
import { ArrowPathIcon, ArrowsRightLeftIcon, BoltIcon, ClockIcon, CurrencyDollarIcon } from "@heroicons/react/24/outline";
import { useScaffoldReadContract, useScaffoldWriteContract, useTargetNetwork } from "~~/hooks/scaffold-eth";

type DurationUnit = "minutes" | "hours" | "days";

const DURATION_MULTIPLIER: Record<DurationUnit, number> = {
  minutes: 60,
  hours: 3600,
  days: 86400,
};

const MIN_CHUNK_DURATION_SECONDS = 60;
const MAX_CHUNKS = 100;

const Home: NextPage = () => {
  const { targetNetwork } = useTargetNetwork();

  // Filled from setup script output
  const [usdcAddress, setUsdcAddress] = useState("0x0000000000000000000000000000000000000000");
  const [reactAddress, setReactAddress] = useState("0x0000000000000000000000000000000000000000");
  const [twammHookAddress, setTwammHookAddress] = useState("0x1eb187ec6240924c192230bfbbde6fdf13ce50c0");

  const [usdcToReact, setUsdcToReact] = useState(true);
  const [amountIn, setAmountIn] = useState("1000");
  const [durationValue, setDurationValue] = useState("30");
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("minutes");
  const [minOutputPerChunk, setMinOutputPerChunk] = useState("0");

  const [orderId, setOrderId] = useState("");

  const tokenIn = useMemo(
    () =>
      usdcToReact
        ? { symbol: "USDC", decimals: 6, address: usdcAddress }
        : { symbol: "REACT", decimals: 18, address: reactAddress },
    [reactAddress, usdcAddress, usdcToReact],
  );

  const tokenOut = useMemo(
    () =>
      usdcToReact
        ? { symbol: "REACT", decimals: 18, address: reactAddress }
        : { symbol: "USDC", decimals: 6, address: usdcAddress },
    [reactAddress, usdcAddress, usdcToReact],
  );

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

  const canSubmitOrder =
    durationSeconds >= MIN_CHUNK_DURATION_SECONDS &&
    Number(amountIn || 0) > 0 &&
    tokenIn.address !== "0x0000000000000000000000000000000000000000" &&
    tokenOut.address !== "0x0000000000000000000000000000000000000000" &&
    twammHookAddress !== "0x0000000000000000000000000000000000000000";

  const normalizedOrderId = useMemo(() => {
    const trimmed = orderId.trim();
    if (!trimmed.startsWith("0x") || trimmed.length !== 66) return null;
    return trimmed as `0x${string}`;
  }, [orderId]);

  const poolKey = useMemo(
    () => ({
      currency0: tokenIn.address as `0x${string}`,
      currency1: tokenOut.address as `0x${string}`,
      fee: 3000,
      tickSpacing: 60,
      hooks: twammHookAddress as `0x${string}`,
    }),
    [tokenIn.address, tokenOut.address, twammHookAddress],
  );

  const { data: cronSubscribed } = useScaffoldReadContract({
    contractName: "ReactiveTWAMM",
    functionName: "cronSubscribed",
  });

  const { data: activeOrderCount } = useScaffoldReadContract({
    contractName: "ReactiveTWAMM",
    functionName: "getActiveOrderCount",
  });

  const { data: claimableOutputRaw } = useScaffoldReadContract({
    contractName: "TWAMMHook",
    functionName: "claimableOutput",
    args: normalizedOrderId ? [normalizedOrderId] : undefined,
    query: { enabled: Boolean(normalizedOrderId) },
  });

  const claimableOutput = useMemo(() => {
    if (!claimableOutputRaw) return "0";
    return formatUnits(claimableOutputRaw as bigint, tokenOut.decimals);
  }, [claimableOutputRaw, tokenOut.decimals]);

  const { writeContractAsync: writeTwamm, isMining: isTwammMining } = useScaffoldWriteContract({
    contractName: "TWAMMHook",
  });
  const { writeContractAsync: writeReactive, isMining: isReactiveMining } = useScaffoldWriteContract({
    contractName: "ReactiveTWAMM",
  });

  const handleSubmitOrder = async () => {
    const amountBase = parseUnits(amountIn || "0", tokenIn.decimals);
    const minOutBase = parseUnits(minOutputPerChunk || "0", tokenOut.decimals);

    await writeTwamm({
      functionName: "submitTWAMMOrder",
      args: [
        poolKey,
        amountBase,
        BigInt(durationSeconds),
        tokenIn.address as `0x${string}`,
        tokenOut.address as `0x${string}`,
        minOutBase,
      ],
    });
  };

  const handleEnsureCron = async () => {
    await writeReactive({ functionName: "ensureCronSubscription", args: [] });
  };

  const handleSubscribe = async () => {
    if (!normalizedOrderId) return;
    await writeReactive({
      functionName: "subscribe",
      args: [twammHookAddress as `0x${string}`, poolKey, normalizedOrderId],
    });
  };

  const handleExecute = async () => {
    if (!normalizedOrderId) return;
    await writeReactive({
      functionName: "batchExecute",
      args: [[normalizedOrderId]],
    });
  };

  const handleClaim = async () => {
    if (!normalizedOrderId) return;
    await writeTwamm({ functionName: "claimTWAMMOutput", args: [normalizedOrderId] });
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10 space-y-6">
      <section className="card bg-base-100 border border-primary/30 shadow-lg shadow-primary/10">
        <div className="card-body">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-black tracking-wide">Reactive TWAMM Demo</h1>
              <p className="text-base-content/70 mt-1">
                Create order → Subscribe → Execute chunk → Claim output (USDC/REACT flow).
              </p>
            </div>
            <div className="badge badge-primary badge-outline">{targetNetwork.name}</div>
          </div>

          <div className="grid md:grid-cols-3 gap-3 mt-3 text-sm">
            <div className="bg-base-200 rounded-xl p-3 border border-base-300">
              <p className="text-base-content/70">Reactive cron</p>
              <p className="font-semibold">{String(Boolean(cronSubscribed))}</p>
            </div>
            <div className="bg-base-200 rounded-xl p-3 border border-base-300">
              <p className="text-base-content/70">Active subscriptions</p>
              <p className="font-semibold">{String(Number(activeOrderCount || 0))}</p>
            </div>
            <div className="bg-base-200 rounded-xl p-3 border border-base-300">
              <p className="text-base-content/70">Current claimable ({tokenOut.symbol})</p>
              <p className="font-semibold">{claimableOutput}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="card bg-base-100 border border-base-300">
        <div className="card-body">
          <h2 className="card-title">1) Demo Setup</h2>
          <p className="text-sm text-base-content/70">Use addresses from setup script output (USDC, REACT, hook).</p>
          <div className="grid md:grid-cols-3 gap-3">
            <label className="form-control">
              <span className="label-text">USDC address</span>
              <input className="input input-bordered" value={usdcAddress} onChange={e => setUsdcAddress(e.target.value)} />
            </label>
            <label className="form-control">
              <span className="label-text">REACT address</span>
              <input className="input input-bordered" value={reactAddress} onChange={e => setReactAddress(e.target.value)} />
            </label>
            <label className="form-control">
              <span className="label-text">TWAMM Hook address</span>
              <input className="input input-bordered" value={twammHookAddress} onChange={e => setTwammHookAddress(e.target.value)} />
            </label>
          </div>

          <div>
            <button className="btn btn-secondary btn-sm" onClick={handleEnsureCron} disabled={isReactiveMining}>
              Ensure Reactive Cron Subscription
            </button>
          </div>
        </div>
      </section>

      <section className="card bg-base-100 border border-base-300">
        <div className="card-body space-y-4">
          <h2 className="card-title">2) Create TWAMM Order</h2>

          <div className="flex flex-wrap items-center gap-3 bg-base-200 border border-base-300 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2">
              <CurrencyDollarIcon className="h-5 w-5 text-primary" />
              <span className="font-semibold">Input: {tokenIn.symbol}</span>
            </div>
            <button className="btn btn-sm btn-outline" onClick={() => setUsdcToReact(v => !v)}>
              <ArrowsRightLeftIcon className="h-4 w-4" /> Swap Direction
            </button>
            <div className="font-semibold">Output: {tokenOut.symbol}</div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="form-control">
              <span className="label-text">Amount In ({tokenIn.symbol})</span>
              <input className="input input-bordered" value={amountIn} onChange={e => setAmountIn(e.target.value)} />
            </label>

            <div className="grid grid-cols-3 gap-2">
              <label className="form-control col-span-2">
                <span className="label-text">Duration</span>
                <input className="input input-bordered" value={durationValue} onChange={e => setDurationValue(e.target.value)} />
              </label>
              <label className="form-control">
                <span className="label-text">Unit</span>
                <select className="select select-bordered" value={durationUnit} onChange={e => setDurationUnit(e.target.value as DurationUnit)}>
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
              </label>
            </div>
          </div>

          <label className="form-control">
            <span className="label-text">Min Output Per Chunk ({tokenOut.symbol})</span>
            <input className="input input-bordered" value={minOutputPerChunk} onChange={e => setMinOutputPerChunk(e.target.value)} />
          </label>

          <div className="grid md:grid-cols-3 gap-3 text-sm">
            <div className="bg-base-200 rounded-xl p-3 border border-base-300">
              <p className="text-base-content/70 flex items-center gap-1">
                <ClockIcon className="h-4 w-4" /> Duration (seconds)
              </p>
              <p className="font-semibold">{durationSeconds}</p>
            </div>
            <div className="bg-base-200 rounded-xl p-3 border border-base-300">
              <p className="text-base-content/70">Estimated total out ({tokenOut.symbol})</p>
              <p className="font-semibold">~{estimatedTotalOut}</p>
            </div>
            <div className="bg-base-200 rounded-xl p-3 border border-base-300">
              <p className="text-base-content/70">Estimated chunks / out per chunk</p>
              <p className="font-semibold">{chunkCount} / ~{estimatedPerChunkOut}</p>
            </div>
          </div>

          <p className="text-xs text-base-content/60">
            Estimate is a simple spot approximation for demo UX. Real output depends on pool price and between-chunk market movement.
          </p>

          <button className="btn btn-primary w-fit" disabled={!canSubmitOrder || isTwammMining} onClick={handleSubmitOrder}>
            <BoltIcon className="h-4 w-4" /> Submit TWAMM Order
          </button>
        </div>
      </section>

      <section className="card bg-base-100 border border-base-300">
        <div className="card-body space-y-3">
          <h2 className="card-title">3) Reactive Flow (Subscribe → Execute → Claim)</h2>
          <label className="form-control">
            <span className="label-text">Order ID (bytes32)</span>
            <input className="input input-bordered" placeholder="Paste orderId from tx logs" value={orderId} onChange={e => setOrderId(e.target.value)} />
          </label>

          <div className="flex flex-wrap gap-2">
            <button className="btn btn-secondary" disabled={!normalizedOrderId || isReactiveMining} onClick={handleSubscribe}>
              Subscribe
            </button>
            <button className="btn btn-outline" disabled={!normalizedOrderId || isReactiveMining} onClick={handleExecute}>
              <ArrowPathIcon className="h-4 w-4" /> Execute Chunk
            </button>
            <button className="btn btn-accent" disabled={!normalizedOrderId || isTwammMining} onClick={handleClaim}>
              Claim Output
            </button>
          </div>
        </div>
      </section>

      <section className="text-xs text-base-content/60">
        <p>
          Chunk cadence is derived onchain from order duration. Hook constants: MIN_CHUNK_DURATION=60s, MAX_CHUNKS=100.
          Reactive is trigger automation, not chunk scheduler configuration.
        </p>
      </section>
    </main>
  );
};

export default Home;
