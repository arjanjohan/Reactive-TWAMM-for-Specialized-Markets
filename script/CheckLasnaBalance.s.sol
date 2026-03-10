// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

contract CheckLasnaBalance is Script {
    function run() external view {
        uint256 pk = _loadPrivateKey();
        address deployer = vm.addr(pk);

        console2.log("========================================");
        console2.log("Lasna Balance Check");
        console2.log("========================================");
        console2.log("Address:", deployer);
        console2.log("Chain ID:", block.chainid);

        uint256 bal = deployer.balance;
        console2.log("Balance (wei):", bal);
        console2.log("Balance (ether):", bal / 1e18);

        if (bal == 0) {
            console2.log("Status: EMPTY (faucet needed)");
        } else {
            console2.log("Status: FUNDED");
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
