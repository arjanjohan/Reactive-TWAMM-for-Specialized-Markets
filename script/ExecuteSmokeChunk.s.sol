// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {IPoolManager} from "@uniswap/v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/interfaces/IHooks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TWAMMHook} from "../src/TWAMMHook.sol";

contract ExecuteSmokeChunk is Script {
    address constant POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;
    address constant TWAMM_HOOK = 0x0E7849e4034146B37bb590c7E81D8BFAAAc210C0;

    // From latest SmokeTWAMM run
    address constant TOKEN0 = 0x13bcFEE59c01b4472d85c2A6833CFb63c6e76b01;
    address constant TOKEN1 = 0xEBcb1f448A834f911203A3cDFf1431646FAe52E7;
    bytes32 constant ORDER_ID = 0x00f60176da1e459cb60d5cb1ec9db0c2363deaad0d76379f92584ac960760395;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(TOKEN0),
            currency1: Currency.wrap(TOKEN1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(TWAMM_HOOK)
        });

        (uint256 beforeExec, uint256 total) = TWAMMHook(TWAMM_HOOK).getOrderProgress(ORDER_ID);

        vm.startBroadcast(pk);

        // Add liquidity so swap can execute
        PoolModifyLiquidityTest liquidityRouter = new PoolModifyLiquidityTest(IPoolManager(POOL_MANAGER));

        IERC20(TOKEN0).approve(address(liquidityRouter), type(uint256).max);
        IERC20(TOKEN1).approve(address(liquidityRouter), type(uint256).max);

        IPoolManager.ModifyLiquidityParams memory params = IPoolManager.ModifyLiquidityParams({
            tickLower: -600,
            tickUpper: 600,
            liquidityDelta: int256(uint256(10_000e18)),
            salt: bytes32(0)
        });

        liquidityRouter.modifyLiquidity(key, params, "");

        // Execute first chunk
        TWAMMHook(TWAMM_HOOK).executeTWAMMChunk(key, ORDER_ID);

        vm.stopBroadcast();

        (uint256 afterExec,) = TWAMMHook(TWAMM_HOOK).getOrderProgress(ORDER_ID);

        console2.log("Order total chunks:", total);
        console2.log("Executed before:", beforeExec);
        console2.log("Executed after:", afterExec);
        console2.log("Success: first chunk executed onchain");
    }
}
