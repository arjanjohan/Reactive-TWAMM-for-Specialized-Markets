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
    address constant DEFAULT_POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;

    // Fallbacks only; prefer env vars: TWAMM_HOOK, TOKEN0, TOKEN1, ORDER_ID
    address constant DEFAULT_TWAMM_HOOK = 0x1Eb187eC6240924c192230bfBbde6FDF13ce50C0;
    address constant DEFAULT_TOKEN0 = 0x399262A45EdE70B1E4dA32924C0182a2F2A0Ff21;
    address constant DEFAULT_TOKEN1 = 0xfCf3d3FAB663Fb72C15a7bC92Fd03C2d606133C8;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        address poolManager = _envAddressOr("UNICHAIN_POOL_MANAGER", DEFAULT_POOL_MANAGER);
        address hook = _envAddressOr("TWAMM_HOOK", DEFAULT_TWAMM_HOOK);
        address token0 = _envAddressOr("TOKEN0", DEFAULT_TOKEN0);
        address token1 = _envAddressOr("TOKEN1", DEFAULT_TOKEN1);
        bytes32 orderId = vm.envBytes32("ORDER_ID");

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });

        (uint256 beforeExec, uint256 total) = TWAMMHook(hook).getOrderProgress(orderId);

        vm.startBroadcast(pk);

        // Add liquidity so swap can execute
        PoolModifyLiquidityTest liquidityRouter = new PoolModifyLiquidityTest(IPoolManager(poolManager));

        IERC20(token0).approve(address(liquidityRouter), type(uint256).max);
        IERC20(token1).approve(address(liquidityRouter), type(uint256).max);

        IPoolManager.ModifyLiquidityParams memory params = IPoolManager.ModifyLiquidityParams({
            tickLower: -600,
            tickUpper: 600,
            liquidityDelta: int256(uint256(10_000e18)),
            salt: bytes32(0)
        });

        liquidityRouter.modifyLiquidity(key, params, "");

        // Execute first chunk
        TWAMMHook(hook).executeTWAMMChunk(key, orderId);

        vm.stopBroadcast();

        (uint256 afterExec,) = TWAMMHook(hook).getOrderProgress(orderId);

        console2.log("Order total chunks:", total);
        console2.log("Executed before:", beforeExec);
        console2.log("Executed after:", afterExec);
        console2.log("Success: first chunk executed onchain");
    }

    function _envAddressOr(string memory key, address fallbackAddr) internal view returns (address) {
        try vm.envAddress(key) returns (address a) {
            return a;
        } catch {
            return fallbackAddr;
        }
    }
}
