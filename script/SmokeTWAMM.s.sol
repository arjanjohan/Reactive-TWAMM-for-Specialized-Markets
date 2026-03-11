// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IPoolManager} from "@uniswap/v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/interfaces/IHooks.sol";
import {TWAMMHook} from "../src/TWAMMHook.sol";
import {TestToken} from "../src/TestToken.sol";

contract SmokeTWAMM is Script {
    address constant POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    address constant TWAMM_HOOK = 0x1Eb187eC6240924c192230bfBbde6FDF13ce50C0;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint160 constant SQRT_PRICE_X96 = 79228162514264337593543950336; // 1:1

    function run() external {
        uint256 pk = _loadPrivateKey();
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        bytes32 saltA = keccak256(abi.encodePacked("smoke-a", block.chainid, block.timestamp));
        bytes32 saltB = keccak256(abi.encodePacked("smoke-b", block.chainid, block.timestamp));
        TestToken tokenA = new TestToken{salt: saltA}("TWAMM Smoke A", "TSA");
        TestToken tokenB = new TestToken{salt: saltB}("TWAMM Smoke B", "TSB");

        (address token0, address token1) = address(tokenA) < address(tokenB)
            ? (address(tokenA), address(tokenB))
            : (address(tokenB), address(tokenA));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(TWAMM_HOOK)
        });

        IPoolManager(POOL_MANAGER).initialize(key, SQRT_PRICE_X96);

        tokenA.mint(deployer, 1_000 ether);
        tokenB.mint(deployer, 1_000 ether);

        // Submit smoke TWAMM order on whichever token is token0
        TestToken inToken = token0 == address(tokenA) ? tokenA : tokenB;
        TestToken outToken = token0 == address(tokenA) ? tokenB : tokenA;

        inToken.approve(TWAMM_HOOK, 100 ether);
        bytes32 orderId = _submitOrderCompat(
            key,
            100 ether,
            10 minutes,
            Currency.wrap(address(inToken)),
            Currency.wrap(address(outToken))
        );

        vm.stopBroadcast();

        console2.log("Smoke done");
        console2.log("Token A:", address(tokenA));
        console2.log("Token B:", address(tokenB));
        console2.log("Order ID:");
        console2.logBytes32(orderId);
    }

    function _submitOrderCompat(
        PoolKey memory key,
        uint256 amount,
        uint256 duration,
        Currency tokenIn,
        Currency tokenOut
    ) internal returns (bytes32 orderId) {
        // Modern 6-arg signature: submitTWAMMOrder((...),uint256,uint256,address,address,uint256)
        bytes memory modern = abi.encodeWithSelector(
            TWAMMHook.submitTWAMMOrder.selector,
            key,
            amount,
            duration,
            tokenIn,
            tokenOut,
            0
        );

        (bool ok, bytes memory ret) = TWAMM_HOOK.call(modern);
        if (ok && ret.length >= 32) {
            return abi.decode(ret, (bytes32));
        }

        // Legacy 5-arg signature fallback for older deployments.
        bytes4 legacySelector = 0x24aacde0;
        bytes memory legacy = abi.encodeWithSelector(
            legacySelector,
            key,
            amount,
            duration,
            Currency.unwrap(tokenIn),
            Currency.unwrap(tokenOut)
        );

        (ok, ret) = TWAMM_HOOK.call(legacy);
        require(ok && ret.length >= 32, "submit failed (modern+legacy)");
        return abi.decode(ret, (bytes32));
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
