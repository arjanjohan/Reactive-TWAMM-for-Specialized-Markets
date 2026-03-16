// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/interfaces/IHooks.sol";

/**
 * @title VerifyReactiveFlow
 * @notice On-chain diagnostic scripts for the Reactive TWAMM callback pipeline.
 *
 *  Part A - Run on Lasna:
 *    Subscribes a known orderId, calls batchExecute, and checks that
 *    the Callback event was emitted in the tx receipt.
 *
 *  Part B - Run on Unichain:
 *    Reads order progress on TWAMMHook to see if the callback actually landed.
 *
 *  Usage:
 *    # --- Lasna side ---
 *    forge script script/VerifyReactiveFlow.s.sol:VerifyLasnaCallback \
 *      --rpc-url https://lasna-rpc.rnk.dev --broadcast -vvv
 *
 *    # --- Unichain side ---
 *    forge script script/VerifyReactiveFlow.s.sol:VerifyUnichainDelivery \
 *      --rpc-url $UNICHAIN_RPC -vvv
 *
 *  Required env vars:
 *    PRIVATE_KEY              - deployer / owner key
 *    LASNA_REACTIVE_TWAMM     - ReactiveTWAMM address on Lasna
 *    TWAMM_HOOK               - TWAMMHook address on Unichain
 *    TOKEN0, TOKEN1           - demo token pair (sorted)
 *    ORDER_ID                 - existing orderId (hex, 32-byte)
 */

// ─────────────────────────────────────────────────────────────────────
// Minimal interfaces (avoids import issues across chains)
// ─────────────────────────────────────────────────────────────────────

interface IReactiveTWAMM {
    struct Subscription {
        address targetHook;
        PoolKey poolKey;
        bytes32 orderId;
        uint256 lastExecutionTime;
        bool active;
        bool usePriceCondition;
        address priceFeed;
        uint256 targetPrice;
        bool aboveTarget;
    }

    function owner() external view returns (address);
    function cronSubscribed() external view returns (bool);
    function getActiveOrderCount() external view returns (uint256);
    function getSubscription(bytes32 orderId) external view returns (Subscription memory);
    function subscribe(address targetHook, PoolKey calldata poolKey, bytes32 orderId) external;
    function batchExecute(bytes32[] calldata orderIds) external;
}

interface ITWAMMHookView {
    function getOrderProgress(bytes32 orderId) external view returns (uint256 executed, uint256 total);
    function reactiveCallbackProxy() external view returns (address);
    function authorizedReactiveRvmId() external view returns (address);
}

// ═════════════════════════════════════════════════════════════════════
//  Part A: Lasna - subscribe + batchExecute + verify Callback emitted
// ═════════════════════════════════════════════════════════════════════

contract VerifyLasnaCallback is Script {
    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;

    function run() external {
        uint256 pk = _loadPk();
        address signer = vm.addr(pk);

        address reactiveAddr = vm.envAddress("LASNA_REACTIVE_TWAMM");
        address hookAddr = vm.envAddress("TWAMM_HOOK");
        address token0 = vm.envAddress("TOKEN0");
        address token1 = vm.envAddress("TOKEN1");

        // Use provided ORDER_ID, or generate a synthetic one for testing
        bytes32 orderId;
        try vm.envBytes32("ORDER_ID") returns (bytes32 id) {
            orderId = id;
        } catch {
            orderId = keccak256(abi.encodePacked("verify-reactive", block.chainid, block.timestamp, signer));
            console2.log("Generated synthetic orderId (no ORDER_ID env var)");
        }

        IReactiveTWAMM reactive = IReactiveTWAMM(reactiveAddr);

        console2.log("========================================");
        console2.log("  Verify Reactive Flow - Lasna Side");
        console2.log("========================================");
        console2.log("");

        // ── Pre-flight checks ──
        console2.log("-- Pre-flight --");
        console2.log("ReactiveTWAMM:", reactiveAddr);
        console2.log("TWAMMHook (target):", hookAddr);
        console2.log("Signer:", signer);
        console2.log("Owner:", reactive.owner());
        console2.log("cronSubscribed:", reactive.cronSubscribed());
        console2.log("activeOrderCount:", reactive.getActiveOrderCount());
        console2.log("Contract balance:", reactiveAddr.balance);
        console2.log("");

        require(signer == reactive.owner(), "Signer must be owner");

        // ── Check if already subscribed ──
        IReactiveTWAMM.Subscription memory existing = reactive.getSubscription(orderId);
        bool alreadySubscribed = existing.active;
        console2.log("Order already subscribed:", alreadySubscribed);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hookAddr)
        });

        vm.startBroadcast(pk);

        // ── Subscribe if needed ──
        if (!alreadySubscribed) {
            console2.log("");
            console2.log("-- Subscribing order --");
            reactive.subscribe(hookAddr, key, orderId);
            console2.log("subscribe() tx sent");
        }

        // ── BatchExecute ──
        console2.log("");
        console2.log("-- Calling batchExecute --");
        console2.log("  (check tx logs for Callback event)");

        bytes32[] memory ids = new bytes32[](1);
        ids[0] = orderId;
        reactive.batchExecute(ids);
        console2.log("batchExecute() tx sent");

        vm.stopBroadcast();

        // ── Post-flight ──
        console2.log("");
        console2.log("-- Post-flight --");
        console2.log("activeOrderCount:", reactive.getActiveOrderCount());

        IReactiveTWAMM.Subscription memory sub = reactive.getSubscription(orderId);
        console2.log("subscription.active:", sub.active);
        console2.log("subscription.targetHook:", sub.targetHook);

        console2.log("");
        console2.log("========================================");
        console2.log("  NEXT STEPS");
        console2.log("========================================");
        console2.log("1. Check batchExecute tx on Lasna explorer for Callback event");
        console2.log("2. Run VerifyUnichainDelivery on Unichain to check if chunk executed");
        console2.log("3. If no Callback event: cron/subscribe issue on Reactive side");
        console2.log("4. If Callback exists but no Unichain effect: delivery infra issue");
    }

    function _loadPk() internal view returns (uint256) {
        string memory raw = vm.envString("PRIVATE_KEY");
        bytes memory b = bytes(raw);
        if (b.length >= 2 && b[0] == bytes1("0") && (b[1] == bytes1("x") || b[1] == bytes1("X"))) {
            return vm.parseUint(raw);
        }
        return vm.parseUint(string(abi.encodePacked("0x", raw)));
    }
}

// ═════════════════════════════════════════════════════════════════════
//  Part B: Unichain - check if callback actually landed
// ═════════════════════════════════════════════════════════════════════

contract VerifyUnichainDelivery is Script {
    function run() external view {
        address hookAddr = vm.envAddress("TWAMM_HOOK");
        bytes32 orderId = vm.envBytes32("ORDER_ID");

        // Optionally check multiple order IDs
        ITWAMMHookView hook = ITWAMMHookView(hookAddr);

        console2.log("========================================");
        console2.log("  Verify Reactive Flow - Unichain Side");
        console2.log("========================================");
        console2.log("");
        console2.log("TWAMMHook:", hookAddr);
        console2.log("Checking orderId:");
        console2.logBytes32(orderId);
        console2.log("");

        // ── Callback config ──
        console2.log("-- Callback Config --");
        console2.log("reactiveCallbackProxy:", hook.reactiveCallbackProxy());
        console2.log("authorizedReactiveRvmId:", hook.authorizedReactiveRvmId());
        console2.log("");

        // ── Order progress ──
        console2.log("-- Order Progress --");
        (uint256 executed, uint256 total) = hook.getOrderProgress(orderId);
        console2.log("Executed chunks:", executed);
        console2.log("Total chunks:", total);
        console2.log("");

        if (total == 0) {
            console2.log("[!] Order not found - wrong ORDER_ID or order not submitted on Unichain");
        } else if (executed == 0) {
            console2.log("[!] NO chunks executed - Reactive callbacks are NOT reaching Unichain");
            console2.log("    Possible causes:");
            console2.log("    - Callback event not emitted on Lasna (check batchExecute tx logs)");
            console2.log("    - Reactive infra not delivering callbacks");
            console2.log("    - reactiveCallbackProxy or authorizedReactiveRvmId mismatch");
            console2.log("    - authorizedReactiveRvmId must match Lasna contract address");
        } else if (executed < total) {
            console2.log("[~] Partial execution - some callbacks landed");
            console2.log("    Reactive flow is working but may be slow or intermittent");
        } else {
            console2.log("[OK] All chunks executed - Reactive flow is fully working!");
        }

        console2.log("");
        console2.log("========================================");
    }
}
