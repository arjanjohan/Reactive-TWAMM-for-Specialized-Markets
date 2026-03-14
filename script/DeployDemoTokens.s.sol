// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MockERC20} from "../src/MockERC20.sol";

contract DeployDemoTokens is Script {
    function run() external {
        uint256 pk = _loadPrivateKey();
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        MockERC20 react = new MockERC20("Reactive", "REACT", 18);

        usdc.mint(deployer, 1_000_000 * 10 ** 6);
        react.mint(deployer, 1_000_000 * 10 ** 18);

        vm.stopBroadcast();

        console2.log("USDC:", address(usdc));
        console2.log("REACT:", address(react));
        console2.log("Minted to:", deployer);
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
