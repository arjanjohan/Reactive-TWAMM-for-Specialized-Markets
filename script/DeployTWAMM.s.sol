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
 * 
 * Unichain Sepolia Testnet:
 * - RPC: https://sepolia.unichain.org
 * - Chain ID: 1301
 * - PoolManager: 0x00b036b58a818b1bc34d502d3fe730db729e62ac
 */
contract DeployTWAMM is Script {
    using PoolIdLibrary for PoolKey;

    // Unichain Sepolia Testnet v4 Contracts
    // Source: https://docs.uniswap.org/contracts/v4/deployments
    address constant POOL_MANAGER_SEPOLIA = 0x00b036b58a818b1bc34d502d3fe730db729e62ac;
    address constant UNIVERSAL_ROUTER_SEPOLIA = 0xf70536b3bcc1bd1a972dc186a2cf84cc6da6be5d;
    address constant PERMIT2_SEPOLIA = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    
    // TODO: Update with actual Reactive callback address when available
    address constant REACTIVE_CALLBACK_SEPOLIA = address(0);

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console2.log("========================================");
        console2.log("Deploying TWAMM Hook to Unichain Sepolia");
        console2.log("========================================");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);
        console2.log("PoolManager:", POOL_MANAGER_SEPOLIA);
        console2.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy TWAMM Hook
        // Hook must be deployed to address with correct flags:
        // beforeSwap (bit 7): 0x80
        // afterInitialize (bit 12): 0x1000  
        // afterSwap (bit 6): 0x40
        // Required mask: 0x10C0
        console2.log("Deploying TWAMMHook...");
        TWAMMHook hook = new TWAMMHook(IPoolManager(POOL_MANAGER_SEPOLIA));
        console2.log("TWAMM Hook deployed at:", address(hook));
        console2.log("Hook flags check:");
        console2.log("  Address:", address(hook));
        console2.log("  Flags (last 4 hex):", uint160(address(hook)) & 0xFFFF);

        // Deploy Reactive TWAMM (if Reactive Network is available)
        if (REACTIVE_CALLBACK_SEPOLIA != address(0)) {
            console2.log("");
            console2.log("Deploying ReactiveTWAMM...");
            ReactiveTWAMM reactive = new ReactiveTWAMM(REACTIVE_CALLBACK_SEPOLIA);
            console2.log("Reactive TWAMM deployed at:", address(reactive));
        } else {
            console2.log("");
            console2.log("Skipping ReactiveTWAMM (no callback address set)");
        }

        vm.stopBroadcast();

        console2.log("");
        console2.log("========================================");
        console2.log("Deployment complete!");
        console2.log("========================================");
        console2.log("NEXT STEPS:");
        console2.log("1. Update .env with deployed addresses");
        console2.log("2. Verify contracts on Uniscan");
        console2.log("3. Test hook with PoolSwapTest");
        console2.log("4. Get test tokens from faucet");
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
