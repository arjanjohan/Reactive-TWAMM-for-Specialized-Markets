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

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("========================================");
        console2.log("Deploying ReactiveTWAMM to Lasna");
        console2.log("========================================");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);
        console2.log("Reactive Callback (Lasna):", REACTIVE_CALLBACK_LASNA);

        require(block.chainid == 5318007, "Wrong network: expected Lasna (5318007)");

        vm.startBroadcast(deployerPrivateKey);
        ReactiveTWAMM reactive = new ReactiveTWAMM(REACTIVE_CALLBACK_LASNA);
        vm.stopBroadcast();

        console2.log("");
        console2.log("ReactiveTWAMM deployed at:", address(reactive));
        console2.log("Export:");
        console2.log("LASNA_REACTIVE_TWAMM_ADDRESS=", address(reactive));
    }
}
