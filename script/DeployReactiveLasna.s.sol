// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ReactiveTWAMM} from "../src/ReactiveTWAMM.sol";

/**
 * @title DeployReactiveLasna
 * @notice Deploy only the ReactiveTWAMM contract to Reactive Lasna testnet.
 */
contract DeployReactiveLasna is Script {
    // Reactive callback proxy on Lasna testnet (from Reactive docs: Origins & Destinations)
    address constant REACTIVE_CALLBACK_LASNA = 0x0000000000000000000000000000000000fffFfF;
    uint256 constant FUND_AMOUNT = 0.5 ether;

    function run() external {
        uint256 deployerPrivateKey = _loadPrivateKey();
        address deployer = vm.addr(deployerPrivateKey);
        address targetHook = vm.envAddress("TWAMM_HOOK");

        console2.log("========================================");
        console2.log("Deploying ReactiveTWAMM to Lasna");
        console2.log("========================================");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);
        console2.log("Target Hook (Unichain):", targetHook);
        console2.log("Reactive Callback (Lasna):", REACTIVE_CALLBACK_LASNA);

        require(block.chainid == 5318007, "Wrong network: expected Lasna (5318007)");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy + fund
        ReactiveTWAMM reactive = new ReactiveTWAMM(targetHook);
        (bool ok,) = payable(address(reactive)).call{value: FUND_AMOUNT}("");
        require(ok, "Funding ReactiveTWAMM failed");

        vm.stopBroadcast();

        console2.log("");
        console2.log("ReactiveTWAMM deployed at:", address(reactive));
        console2.log("Funded amount (wei):", FUND_AMOUNT);
        console2.log("Export:");
        console2.log("LASNA_REACTIVE_TWAMM_ADDRESS=", address(reactive));
        console2.log("");
        console2.log("IMPORTANT: Run initialize() after deployment to set up subscriptions:");
        console2.log("  cast send", address(reactive), "\"initialize()\" --rpc-url $LASNA_RPC --private-key $PRIVATE_KEY");
    }

    function _loadPrivateKey() internal view returns (uint256) {
        string memory raw = vm.envString("PRIVATE_KEY");
        bytes memory b = bytes(raw);

        if (b.length >= 2 && b[0] == bytes1("0") && (b[1] == bytes1("x") || b[1] == bytes1("X"))) {
            return vm.parseUint(raw);
        }

        return vm.parseUint(string(abi.encodePacked("0x", raw)));
    }
}
