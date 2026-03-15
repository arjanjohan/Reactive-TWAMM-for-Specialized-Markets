// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ReactiveTWAMM} from "../src/ReactiveTWAMM.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/interfaces/IHooks.sol";

/**
 * @notice Minimal proof flow on Lasna: subscribe + batchExecute
 */
contract ReactiveProofLasna is Script {
    address constant REACTIVE_TWAMM_LASNA = 0x7Ec9b8802342a119FACCd228b806eC49B4124D17;
    address constant UNICHAIN_HOOK = 0x1Eb187eC6240924c192230bfBbde6FDF13ce50C0;

    // Reusing token pair observed in Unichain smoke attempt
    address constant TOKEN0 = 0xEc2b561F6dA40e321759F3C7Bc1484a9b743385e;
    address constant TOKEN1 = 0xf6C7A9F11E2c7AD8c2e9eABB59b655fbDBC4fA42;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;

    function run() external {
        uint256 pk = _loadPrivateKey();
        bytes32 orderId = keccak256(abi.encodePacked("lasna-proof", block.chainid, block.timestamp));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(TOKEN0),
            currency1: Currency.wrap(TOKEN1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(UNICHAIN_HOOK)
        });

        vm.startBroadcast(pk);

        ReactiveTWAMM reactive = ReactiveTWAMM(REACTIVE_TWAMM_LASNA);
        reactive.subscribe(UNICHAIN_HOOK, key, orderId);

        bytes32[] memory ids = new bytes32[](1);
        ids[0] = orderId;
        reactive.batchExecute(ids);

        vm.stopBroadcast();

        console2.log("Proof orderId:");
        console2.logBytes32(orderId);
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
