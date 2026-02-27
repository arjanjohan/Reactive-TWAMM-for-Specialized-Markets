// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {TWAMMHook} from "../src/TWAMMHook.sol";
import {ReactiveTWAMM} from "../src/ReactiveTWAMM.sol";
import {IPoolManager} from "@uniswap/v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/types/Currency.sol";

/**
 * @title DeployTWAMM
 * @notice Deployment script for TWAMM Hook and Reactive integration
 * @dev Run with: forge script script/DeployTWAMM.s.sol --rpc-url $UNICHAIN_RPC --broadcast
 */
contract DeployTWAMM is Script {
    using PoolIdLibrary for PoolKey;

    // Unichain Sepolia Testnet addresses
    // These would be updated with actual deployed addresses
    address constant POOL_MANAGER_SEPOLIA = address(0); // TODO: Update with actual address
    address constant REACTIVE_CALLBACK_SEPOLIA = address(0); // TODO: Update with actual Reactive callback address

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console2.log("Deploying from:", deployer);
        console2.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy TWAMM Hook
        // Note: Hook must be deployed to address with correct flags:
        // beforeSwap (bit 7): 0x80
        // afterInitialize (bit 12): 0x1000
        // afterSwap (bit 6): 0x40
        // Required mask: 0x10C0
        TWAMMHook hook = new TWAMMHook(IPoolManager(POOL_MANAGER_SEPOLIA));
        console2.log("TWAMM Hook deployed at:", address(hook));

        // Deploy Reactive TWAMM (if Reactive Network is available)
        if (REACTIVE_CALLBACK_SEPOLIA != address(0)) {
            ReactiveTWAMM reactive = new ReactiveTWAMM(REACTIVE_CALLBACK_SEPOLIA);
            console2.log("Reactive TWAMM deployed at:", address(reactive));
        }

        vm.stopBroadcast();

        console2.log("Deployment complete!");
    }
}

/**
 * @title DeployToAnvil
 * @notice Local deployment for testing
 */
contract DeployToAnvil is Script {
    using PoolIdLibrary for PoolKey;

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        // For local anvil, deploy a mock PoolManager first
        vm.startBroadcast(deployerPrivateKey);

        // Deploy mock PoolManager (would need actual implementation for full testing)
        // MockPoolManager poolManager = new MockPoolManager();
        
        // Deploy hook at address with required flags
        // Use vm.etch to deploy at specific address
        address hookAddress = address(0x00000000000000000000000000000000000010C0);
        
        console2.log("Deploying to hook address:", hookAddress);

        vm.stopBroadcast();
    }
}
