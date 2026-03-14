// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IPoolManager} from "@uniswap/v4-core/interfaces/IPoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/interfaces/IHooks.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {SimpleSwapExecutor} from "../src/SimpleSwapExecutor.sol";

interface IReactiveTWAMMAdmin {
    function owner() external view returns (address);
    function cronSubscribed() external view returns (bool);
    function ensureCronSubscription() external;
}

contract SetupDemoEnvironment is Script {
    // Unichain Sepolia pool manager
    address constant POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint160 constant SQRT_PRICE_X96_1_1 = 79228162514264337593543950336;

    function run() external {
        uint256 pk = _loadPrivateKey();
        address deployer = vm.addr(pk);
        address hook = vm.envAddress("TWAMM_HOOK");
        address reactive = vm.envAddress("REACTIVE_TWAMM");

        vm.startBroadcast(pk);

        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        MockERC20 react = new MockERC20("Reactive", "REACT", 18);

        SimpleSwapExecutor swapExecutor = new SimpleSwapExecutor(IPoolManager(POOL_MANAGER));
        PoolModifyLiquidityTest liquidityRouter = new PoolModifyLiquidityTest(IPoolManager(POOL_MANAGER));

        // mint demo balances
        // Large demo balances to support full-range liquidity despite decimal mismatch (USDC 6 vs REACT 18)
        usdc.mint(deployer, 2_000_000_000_000_000_000 * 10 ** 6);
        react.mint(deployer, 2_000_000 * 10 ** 18);

        (address token0, address token1) = address(usdc) < address(react)
            ? (address(usdc), address(react))
            : (address(react), address(usdc));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });

        IPoolManager(POOL_MANAGER).initialize(key, SQRT_PRICE_X96_1_1);

        // approvals for adding liquidity
        usdc.approve(address(liquidityRouter), type(uint256).max);
        react.approve(address(liquidityRouter), type(uint256).max);

        // approvals for swap executor bot usage
        usdc.approve(address(swapExecutor), type(uint256).max);
        react.approve(address(swapExecutor), type(uint256).max);

        int24 tickLower = -887220;
        int24 tickUpper = 887220;

        IPoolManager.ModifyLiquidityParams memory params = IPoolManager.ModifyLiquidityParams({
            tickLower: tickLower,
            tickUpper: tickUpper,
            liquidityDelta: int256(uint256(100_000e18)),
            salt: bytes32(0)
        });

        liquidityRouter.modifyLiquidity(key, params, "");

        // Cron subscription lives on Reactive chain context. Keep Unichain setup deterministic
        // and non-failing by only reading status here.
        IReactiveTWAMMAdmin reactiveAdmin = IReactiveTWAMMAdmin(reactive);
        bool cron = false;
        try reactiveAdmin.cronSubscribed() returns (bool c) {
            cron = c;
        } catch {}

        vm.stopBroadcast();

        console2.log("=== DEMO SETUP COMPLETE ===");
        console2.log("TWAMM_HOOK:", hook);
        console2.log("USDC:", address(usdc));
        console2.log("REACT:", address(react));
        console2.log("SWAP_EXECUTOR:", address(swapExecutor));
        console2.log("POOL_MANAGER:", POOL_MANAGER);
        console2.log("REACTIVE_TWAMM:", reactive);
        console2.log("cronSubscribed:", cron);
        console2.log("token0:", token0);
        console2.log("token1:", token1);
        console2.log("tickLower:", tickLower);
        console2.log("tickUpper:", tickUpper);
    }

    function _floorToSpacing(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 compressed = tick / spacing;
        if (tick < 0 && tick % spacing != 0) compressed -= 1;
        return compressed * spacing;
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
