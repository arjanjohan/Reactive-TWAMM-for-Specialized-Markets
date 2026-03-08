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
    address constant TWAMM_HOOK = 0x0E7849e4034146B37bb590c7E81D8BFAAAc210C0;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint160 constant SQRT_PRICE_X96 = 79228162514264337593543950336; // 1:1

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        TestToken tokenA = new TestToken("TWAMM Smoke A", "TSA");
        TestToken tokenB = new TestToken("TWAMM Smoke B", "TSB");

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
        bytes32 orderId = TWAMMHook(TWAMM_HOOK).submitTWAMMOrder(
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
}
