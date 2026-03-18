// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

interface IReactiveTWAMMStatus {
    function owner() external view returns (address);
    function targetHook() external view returns (address);
    function getActiveOrderCount() external view returns (uint256);
}

/**
 * @notice Status check for the ReactiveTWAMM contract on Lasna.
 * @dev Cron and event subscriptions are now set up in the constructor.
 *      This script is kept for diagnostics. Run on Reactive Network RPC.
 */
contract SetupReactiveCron is Script {
    function run() external view {
        address reactive = _loadReactiveAddress();
        IReactiveTWAMMStatus r = IReactiveTWAMMStatus(reactive);

        console2.log("=== REACTIVE TWAMM STATUS ===");
        console2.log("REACTIVE_TWAMM:", reactive);
        console2.log("Owner:", r.owner());
        console2.log("Target hook:", r.targetHook());
        console2.log("Balance:", reactive.balance);
        console2.log("Active orders (RN side):", r.getActiveOrderCount());
        console2.log("");
        console2.log("NOTE: Cron and event subscriptions are set up in the constructor.");
        console2.log("Orders auto-register in the RVM via OrderRegisteredReactive events.");
    }

    function _loadReactiveAddress() internal view returns (address) {
        try vm.envAddress("LASNA_REACTIVE_TWAMM") returns (address a) {
            return a;
        } catch {
            return vm.envAddress("REACTIVE_TWAMM");
        }
    }
}
