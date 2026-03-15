// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

interface IReactiveTWAMMOwner {
    function owner() external view returns (address);
    function cronSubscribed() external view returns (bool);
    function ensureCronSubscription() external;
}

/**
 * @notice One-time Reactive-side cron bootstrap.
 * @dev Must be broadcast on Reactive Network RPC, not Unichain.
 */
contract SetupReactiveCron is Script {
    function run() external {
        uint256 pk = _loadPrivateKey();
        address signer = vm.addr(pk);
        address reactive = _loadReactiveAddress();

        IReactiveTWAMMOwner r = IReactiveTWAMMOwner(reactive);

        vm.startBroadcast(pk);

        address owner = r.owner();
        require(owner == signer, "signer is not ReactiveTWAMM owner");

        bool beforeState = r.cronSubscribed();
        if (!beforeState) {
            r.ensureCronSubscription();
        }
        bool afterState = r.cronSubscribed();

        vm.stopBroadcast();

        console2.log("=== REACTIVE CRON SETUP ===");
        console2.log("REACTIVE_TWAMM:", reactive);
        console2.log("owner:", owner);
        console2.log("cronSubscribed(before):", beforeState);
        console2.log("cronSubscribed(after):", afterState);
    }

    function _loadReactiveAddress() internal view returns (address) {
        // Prefer Lasna-specific var to avoid accidental Unichain address usage.
        try vm.envAddress("LASNA_REACTIVE_TWAMM") returns (address a) {
            return a;
        } catch {
            return vm.envAddress("REACTIVE_TWAMM");
        }
    }

    function _loadPrivateKey() internal view returns (uint256) {
        string memory pkHex = vm.envString("PRIVATE_KEY");
        if (bytes(pkHex).length == 0) revert("PRIVATE_KEY not set");
        return vm.parseUint(pkHex);
    }
}
