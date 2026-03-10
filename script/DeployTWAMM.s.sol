// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {TWAMMHook} from "../src/TWAMMHook.sol";
import {ReactiveTWAMM} from "../src/ReactiveTWAMM.sol";
import {IPoolManager} from "@uniswap/v4-core/interfaces/IPoolManager.sol";

/**
 * @title DeployTWAMM
 * @notice Deploy TWAMM Hook with CREATE2 mining so hook flags are embedded in address bits.
 */
contract DeployTWAMM is Script {
    // Unichain Sepolia
    address constant POOL_MANAGER_SEPOLIA = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;

    // Reactive callback proxy on Unichain Sepolia (from Reactive docs: Origins & Destinations)
    address constant REACTIVE_CALLBACK_SEPOLIA = 0x9299472A6399Fd1027ebF067571Eb3e3D7837FC4;

    // CREATE2 deployer used by Foundry/Uniswap docs
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // Required hook flags: afterInitialize (0x1000) + beforeSwap (0x80) + afterSwap (0x40)
    uint160 constant REQUIRED_FLAGS = 0x10C0;
    uint160 constant ALL_HOOK_MASK = uint160((1 << 14) - 1);

    function run() public {
        uint256 deployerPrivateKey = _loadPrivateKey();
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("========================================");
        console2.log("Deploying TWAMM Hook to Unichain Sepolia");
        console2.log("========================================");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);
        console2.log("PoolManager:", POOL_MANAGER_SEPOLIA);
        console2.log("Reactive Callback:", REACTIVE_CALLBACK_SEPOLIA);
        console2.log("");

        bytes memory constructorArgs = abi.encode(IPoolManager(POOL_MANAGER_SEPOLIA));
        bytes memory initCode = abi.encodePacked(type(TWAMMHook).creationCode, constructorArgs);

        (bytes32 salt, address predictedHook) = _mineSalt(initCode, REQUIRED_FLAGS);
        console2.log("Found salt:");
        console2.logBytes32(salt);
        console2.log("Predicted hook address:", predictedHook);
        console2.log("Hook flags:", uint160(predictedHook) & 0xFFFF);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy hook with CREATE2 deployer
        address hook = _deployCreate2(salt, initCode);
        require(hook == predictedHook, "Hook address mismatch");
        console2.log("TWAMM Hook deployed at:", hook);

        // Deploy reactive contract
        ReactiveTWAMM reactive = new ReactiveTWAMM(REACTIVE_CALLBACK_SEPOLIA);
        console2.log("ReactiveTWAMM deployed at:", address(reactive));

        vm.stopBroadcast();

        console2.log("");
        console2.log("========================================");
        console2.log("Deployment complete!");
        console2.log("========================================");
        console2.log("TWAMM_HOOK_ADDRESS=", hook);
        console2.log("REACTIVE_TWAMM_ADDRESS=", address(reactive));
    }

    function _mineSalt(bytes memory initCode, uint160 flags) internal view returns (bytes32 salt, address hookAddr) {
        bytes32 initCodeHash = keccak256(initCode);

        for (uint256 i = 0; i < 5_000_000; i++) {
            salt = bytes32(i);
            hookAddr = vm.computeCreate2Address(salt, initCodeHash, CREATE2_DEPLOYER);
            if ((uint160(hookAddr) & ALL_HOOK_MASK) == flags) {
                return (salt, hookAddr);
            }
        }

        revert("Could not find valid hook salt");
    }

    function _deployCreate2(bytes32 salt, bytes memory initCode) internal returns (address deployed) {
        bytes memory data = abi.encodePacked(salt, initCode);

        (bool ok, bytes memory ret) = CREATE2_DEPLOYER.call(data);
        require(ok, "CREATE2 deploy failed");

        if (ret.length == 20) {
            assembly ("memory-safe") {
                deployed := shr(96, mload(add(ret, 32)))
            }
        } else if (ret.length == 32) {
            deployed = abi.decode(ret, (address));
        } else {
            revert("Invalid CREATE2 return");
        }
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
