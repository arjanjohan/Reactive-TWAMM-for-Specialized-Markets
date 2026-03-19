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
    address constant DEFAULT_POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    // Default demo price: ~0.02 USDC per REACT in human units.
    // For REACT(18) / USDC(6), this corresponds to a much smaller raw ratio than 1:1.
    uint160 constant DEFAULT_DEMO_SQRT_PRICE_X96 = 11204554194957227983746;
    uint256 constant Q192 = 2 ** 192;
    // Full-range demo liquidity sized so a ~1000 USDC buy moves price by a few percent instead of barely moving it.
    uint256 constant DEFAULT_DEMO_LIQUIDITY_DELTA = 500_000_000_000_000_000;

    function run() external {
        uint256 pk = _loadPrivateKey();
        address deployer = vm.addr(pk);
        address hook = vm.envAddress("TWAMM_HOOK");
        address reactive = vm.envAddress("REACTIVE_TWAMM");
        address poolManager = _envAddressOr("UNICHAIN_POOL_MANAGER", DEFAULT_POOL_MANAGER);
        uint256 liquidityDelta = _envUintOr("DEMO_LIQUIDITY_DELTA", DEFAULT_DEMO_LIQUIDITY_DELTA);

        vm.startBroadcast(pk);

        MockERC20 usdc = new MockERC20("USD Coin", "USDC", 6);
        MockERC20 react = new MockERC20("Reactive", "REACT", 18);

        SimpleSwapExecutor swapExecutor = new SimpleSwapExecutor(IPoolManager(poolManager));
        PoolModifyLiquidityTest liquidityRouter = new PoolModifyLiquidityTest(IPoolManager(poolManager));

        // Mint demo balances.
        // Even with a shallower full-range position, the USDC side still needs a very large nominal
        // amount at a 0.02 USDC/REACT starting price because the position spans the full tick range.
        usdc.mint(deployer, 10_000_000_000_000_000_000 * 10 ** 6);
        react.mint(deployer, 2_000_000_000_000 * 10 ** 18);

        (address token0, address token1) =
            address(usdc) < address(react) ? (address(usdc), address(react)) : (address(react), address(usdc));
        uint160 sqrtPriceX96 = _resolveInitialSqrtPrice(address(react), token0);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hook)
        });

        IPoolManager(poolManager).initialize(key, sqrtPriceX96);

        // approvals for adding liquidity
        usdc.approve(address(liquidityRouter), type(uint256).max);
        react.approve(address(liquidityRouter), type(uint256).max);

        // approvals for swap executor bot usage
        usdc.approve(address(swapExecutor), type(uint256).max);
        react.approve(address(swapExecutor), type(uint256).max);

        IPoolManager.ModifyLiquidityParams memory params = IPoolManager.ModifyLiquidityParams({
            tickLower: -887220, tickUpper: 887220, liquidityDelta: int256(liquidityDelta), salt: bytes32(0)
        });

        liquidityRouter.modifyLiquidity(key, params, "");

        vm.stopBroadcast();

        console2.log("=== DEMO SETUP COMPLETE ===");
        console2.log("TWAMM_HOOK:", hook);
        console2.log("USDC:", address(usdc));
        console2.log("REACT:", address(react));
        console2.log("SWAP_EXECUTOR:", address(swapExecutor));
        console2.log("POOL_MANAGER:", poolManager);
        console2.log("REACTIVE_TWAMM:", reactive);
        console2.log("SQRT_PRICE_X96:", sqrtPriceX96);
        console2.log("LIQUIDITY_DELTA:", liquidityDelta);
    }

    function _envAddressOr(string memory key, address fallbackAddr) internal view returns (address) {
        try vm.envAddress(key) returns (address a) {
            return a;
        } catch {
            return fallbackAddr;
        }
    }

    function _envUintOr(string memory key, uint256 fallbackValue) internal view returns (uint256) {
        try vm.envUint(key) returns (uint256 value) {
            return value;
        } catch {
            return fallbackValue;
        }
    }

    function _resolveInitialSqrtPrice(address reactToken, address token0) internal view returns (uint160) {
        try vm.envUint("DEMO_SQRT_PRICE_X96") returns (uint256 value) {
            return uint160(value);
        } catch {
            if (token0 == reactToken) return DEFAULT_DEMO_SQRT_PRICE_X96;
            return uint160(Q192 / uint256(DEFAULT_DEMO_SQRT_PRICE_X96));
        }
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
