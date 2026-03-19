"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { hardhat } from "viem/chains";
import { FaucetButton, RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth";

/**
 * Site header
 */
export const Header = () => {
  const { targetNetwork } = useTargetNetwork();
  const isLocalNetwork = targetNetwork.id === hardhat.id;

  return (
    <div className="sticky top-0 navbar bg-base-100/90 backdrop-blur border-b border-primary/30 min-h-0 shrink-0 justify-between z-20 shadow-md shadow-primary/20 px-2">
      <div className="navbar-start w-auto">
        <Link href="/" passHref className="flex items-center gap-3 ml-4 mr-6 shrink-0">
          <div className="flex relative w-10 h-10 rounded-xl ring-1 ring-primary/40 shadow-md shadow-primary/20 bg-base-200 p-1">
            <Image alt="Reactive TWAMM logo" className="cursor-pointer" fill src="/logo.png" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold leading-tight tracking-wide">Reactive TWAMM</span>
            <span className="text-xs text-primary">Execution Dashboard</span>
          </div>
        </Link>
      </div>
      <div className="navbar-end grow mr-4">
        <RainbowKitCustomConnectButton />
        {isLocalNetwork && <FaucetButton />}
      </div>
    </div>
  );
};
