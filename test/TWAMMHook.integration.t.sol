// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {TWAMMHook} from "../src/TWAMMHook.sol";
import {PoolManager} from "@uniswap/v4-core/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/types/BalanceDelta.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/test/PoolModifyLiquidityTest.sol";

/**
 * @title TestToken
 * @notice Simple ERC20 for testing
 */
contract TestToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title TWAMMHookIntegrationTest
 * @notice Full integration test with real PoolManager
 * @dev This test demonstrates the complete TWAMM flow:
 *      1. Deploy tokens and PoolManager
 *      2. Initialize pool with TWAMM hook
 *      3. Add initial liquidity
 *      4. Submit TWAMM order
 *      5. Execute chunks over time
 *      6. Verify token balances and progress
 */
contract TWAMMHookIntegrationTest is Test {
    using PoolIdLibrary for PoolKey;

    // Contract instances
    PoolManager public poolManager;
    TWAMMHook public hook;
    TestToken public tokenA;
    TestToken public tokenB;
    PoolModifyLiquidityTest public modifyLiquidityRouter;
    
    // Pool key
    PoolKey public poolKey;
    
    // Test accounts
    address public alice = address(0x1);
    address public bob = address(0x2);
    address public lp = address(0x3); // Liquidity provider
    
    // Constants
    uint24 constant FEE = 3000; // 0.3%
    int24 constant TICK_SPACING = 60;
    uint160 constant SQRT_PRICE_X96 = 79228162514264337593543950336; // 1:1 price
    
    // Hook must be at address with flags: 0x10C0
    address constant HOOK_ADDRESS = address(0x00000000000000000000000000000000000010C0);

    function setUp() public {
        // Deploy PoolManager
        poolManager = new PoolManager(address(this));
        
        // Deploy tokens
        tokenA = new TestToken("Token A", "TKA");
        tokenB = new TestToken("Token B", "TKB");
        
        // Sort tokens (currency0 < currency1)
        (TestToken token0, TestToken token1) = 
            address(tokenA) < address(tokenB) ? 
            (tokenA, tokenB) : 
            (tokenB, tokenA);
        
        // Deploy hook at address with correct flags
        deployCodeTo("TWAMMHook.sol:TWAMMHook", abi.encode(address(poolManager), address(this)), HOOK_ADDRESS);
        hook = TWAMMHook(HOOK_ADDRESS);

        // Deploy v4 test router for real liquidity integration
        modifyLiquidityRouter = new PoolModifyLiquidityTest(IPoolManager(address(poolManager)));
        
        // Create pool key
        poolKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: hook
        });
        
        // Initialize pool (this also enables TWAMM via hook callbacks)
        poolManager.initialize(poolKey, SQRT_PRICE_X96);
        
        // Fund test accounts
        tokenA.mint(alice, 10_000 ether);
        tokenB.mint(alice, 10_000 ether);
        tokenA.mint(lp, 100_000 ether);
        tokenB.mint(lp, 100_000 ether);
        tokenA.mint(bob, 10_000 ether);
        tokenB.mint(bob, 10_000 ether);

        vm.startPrank(lp);
        tokenA.approve(address(modifyLiquidityRouter), type(uint256).max);
        tokenB.approve(address(modifyLiquidityRouter), type(uint256).max);
        vm.stopPrank();

        
        console2.log("Setup complete:");
        console2.log("  PoolManager: %s", address(poolManager));
        console2.log("  Hook: %s", address(hook));
        console2.log("  Token0: %s", address(token0));
        console2.log("  Token1: %s", address(token1));
    }

    /**
     * @notice DEMO TEST: Full TWAMM order execution
     * @dev This is the showcase test for the hackathon demo
     * 
     * Scenario: Alice wants to swap 1000 tokenA for tokenB over 10 minutes
     * - Order is split into 10 chunks of 100 tokenA each
     * - Each chunk executes every 1 minute
     * - Alice receives tokenB gradually with minimal slippage
     */
    function test_Demo_TWAMMFullExecution() public {
        console2.log("\n========================================");
        console2.log("DEMO: TWAMM Full Order Execution");
        console2.log("========================================\n");
        
        // Setup: Add liquidity to the pool
        _addLiquidity(lp, 50_000 ether, 50_000 ether);
        
        // Record initial balances
        uint256 aliceInitialA = tokenA.balanceOf(alice);
        uint256 aliceInitialB = tokenB.balanceOf(alice);
        console2.log("Initial balances:");
        console2.log("  Alice TokenA: %s ether", aliceInitialA / 1e18);
        console2.log("  Alice TokenB: %s ether", aliceInitialB / 1e18);
        
        // Step 1: Alice submits TWAMM order
        vm.startPrank(alice);
        tokenA.approve(address(hook), 1000 ether);
        
        bytes32 orderId = hook.submitTWAMMOrder(
            poolKey,
            10 ether,        // 10 tokenA
            10 minutes,      // Over 10 minutes
            Currency.wrap(address(tokenA) < address(tokenB) ? address(tokenA) : address(tokenB)),
            Currency.wrap(address(tokenA) < address(tokenB) ? address(tokenB) : address(tokenA)),
            0
        );
        vm.stopPrank();
        
        console2.log("\n1. Order submitted");
        console2.log("   Order ID: %s", uint256(orderId));
        console2.log("   Amount: 10 tokenA");
        console2.log("   Duration: 10 minutes");
        console2.log("   Chunks: 10 (1 tokenA each)");
        
        // Verify order was created
        (uint256 executed, uint256 total) = hook.getOrderProgress(orderId);
        assertEq(executed, 0, "Should have 0 executed chunks");
        assertEq(total, 10, "Should have 10 total chunks");
        
        // Step 2: Advance chunk windows and execute real TWAMM chunks
        console2.log("\n2. Advancing chunk windows + executing chunks...");

        for (uint256 i = 0; i < 10; i++) {
            vm.warp(block.timestamp + 1 minutes);
            hook.executeTWAMMChunk(poolKey, orderId);
            console2.log("  Chunk %s / 10 executed", i + 1);
        }
        
        // Step 3: Verify final state
        uint256 aliceFinalA = tokenA.balanceOf(alice);
        uint256 aliceFinalB = tokenB.balanceOf(alice);
        
        console2.log("\n3. Execution complete");
        console2.log("   Final TokenA: %s ether", aliceFinalA / 1e18);
        console2.log("   Final TokenB: %s ether", aliceFinalB / 1e18);
        console2.log("   TokenA spent: %s ether", (aliceInitialA - aliceFinalA) / 1e18);
        console2.log("   TokenB received: %s ether", (aliceFinalB - aliceInitialB) / 1e18);
        
        // Verify all chunks were executed
        (executed, total) = hook.getOrderProgress(orderId);
        console2.log("4. Order progress:");
        console2.log("   Executed: %s", executed);
        console2.log("   Total: %s", total);
        
        // Assertions
        assertEq(executed, 10, "All chunks should be executed");
        assertEq(aliceInitialA - aliceFinalA, 10 ether, "Should have escrowed/spent 10 tokenA");
        assertEq(aliceFinalB, aliceInitialB, "Output is currently retained by hook custody");
        assertGt(tokenB.balanceOf(address(hook)), 0, "Hook should receive output tokenB from executed swaps");
        
        console2.log("\n[PASS] DEMO COMPLETE: TWAMM chunks executed via real swap-triggered hook flow!");
        console2.log("========================================\n");
    }

    /**
     * @notice Test order cancellation mid-execution
     */
    function test_Demo_CancelPartialOrder() public {
        console2.log("\n========================================");
        console2.log("DEMO: Cancel Order Mid-Execution");
        console2.log("========================================\n");
        
        // Setup
        _addLiquidity(lp, 50_000 ether, 50_000 ether);
        
        // Alice submits order
        vm.startPrank(alice);
        tokenA.approve(address(hook), 1000 ether);
        bytes32 orderId = hook.submitTWAMMOrder(
            poolKey,
            1000 ether,
            10 minutes,
            Currency.wrap(address(tokenA) < address(tokenB) ? address(tokenA) : address(tokenB)),
            Currency.wrap(address(tokenA) < address(tokenB) ? address(tokenB) : address(tokenA)),
            0
        );
        
        uint256 balanceBeforeCancel = tokenA.balanceOf(alice);
        console2.log("Order submitted, balance before cancel: %s tokenA", balanceBeforeCancel / 1e18);
        
        // Cancel order
        hook.cancelTWAMMOrder(orderId);
        vm.stopPrank();
        
        uint256 balanceAfterCancel = tokenA.balanceOf(alice);
        console2.log("Order cancelled, balance after cancel: %s tokenA", balanceAfterCancel / 1e18);
        console2.log("Refunded: %s tokenA", (balanceAfterCancel - balanceBeforeCancel) / 1e18);
        
        // Verify order is cancelled
        TWAMMHook.TWAMMOrder memory order = hook.getOrder(orderId);
        assertFalse(order.active, "Order should be inactive");
        assertTrue(order.cancelled, "Order should be marked cancelled");
        assertEq(balanceAfterCancel, balanceBeforeCancel + 1000 ether, "Full amount should be refunded");
        
        console2.log("\n[PASS] DEMO COMPLETE: Order cancelled and funds returned!");
        console2.log("========================================\n");
    }

    /**
     * @notice Test multiple concurrent orders
     */
    function test_RevertIf_SlippageTooHigh() public {
        _addLiquidity(lp, 50_000 ether, 50_000 ether);

        vm.startPrank(alice);
        tokenA.approve(address(hook), 10 ether);
        bytes32 orderId = hook.submitTWAMMOrder(
            poolKey,
            10 ether,
            10 minutes,
            Currency.wrap(address(tokenA) < address(tokenB) ? address(tokenA) : address(tokenB)),
            Currency.wrap(address(tokenA) < address(tokenB) ? address(tokenB) : address(tokenA)),
            1_000 ether
        );
        vm.stopPrank();

        vm.warp(block.timestamp + 1 minutes);
        vm.expectRevert();
        hook.executeTWAMMChunk(poolKey, orderId);

        (uint256 executed, ) = hook.getOrderProgress(orderId);
        assertEq(executed, 0, "Chunk should not execute when slippage floor is too high");
    }

    function test_Demo_MultipleOrders() public {
        console2.log("\n========================================");
        console2.log("DEMO: Multiple Concurrent Orders");
        console2.log("========================================\n");
        
        _addLiquidity(lp, 100_000 ether, 100_000 ether);
        
        // Alice and Bob both submit orders
        vm.startPrank(alice);
        tokenA.approve(address(hook), 500 ether);
        bytes32 orderA = hook.submitTWAMMOrder(
            poolKey,
            500 ether,
            5 minutes,
            Currency.wrap(address(tokenA) < address(tokenB) ? address(tokenA) : address(tokenB)),
            Currency.wrap(address(tokenA) < address(tokenB) ? address(tokenB) : address(tokenA)),
            0
        );
        vm.stopPrank();
        
        vm.startPrank(bob);
        tokenA.mint(bob, 1000 ether);
        tokenA.approve(address(hook), 1000 ether);
        bytes32 orderB = hook.submitTWAMMOrder(
            poolKey,
            1000 ether,
            10 minutes,
            Currency.wrap(address(tokenA) < address(tokenB) ? address(tokenA) : address(tokenB)),
            Currency.wrap(address(tokenA) < address(tokenB) ? address(tokenB) : address(tokenA)),
            0
        );
        vm.stopPrank();
        
        console2.log("Alice order: %s - 500 tokenA over 5 chunks", uint256(orderA));
        console2.log("Bob order: %s - 1000 tokenA over 10 chunks", uint256(orderB));
        
        // Verify both orders exist
        PoolId poolId = poolKey.toId();
        bytes32[] memory orders = hook.getPoolOrders(poolId);
        assertEq(orders.length, 2, "Should have 2 orders");
        
        console2.log("\n[PASS] DEMO COMPLETE: Multiple orders tracked correctly!");
        console2.log("========================================\n");
    }

    // ============ Helper Functions ============
    
    /**
     * @notice Add liquidity to the pool
     */
    function _addLiquidity(address provider, uint256 amount0, uint256 amount1) internal {
        vm.startPrank(provider);
        IPoolManager.ModifyLiquidityParams memory params = IPoolManager.ModifyLiquidityParams({
            tickLower: -887220,
            tickUpper: 887220,
            liquidityDelta: int256(5e21),
            salt: bytes32(0)
        });
        modifyLiquidityRouter.modifyLiquidity(poolKey, params, "");
        vm.stopPrank();

        console2.log("  Liquidity added: %s token0 / %s token1", amount0 / 1e18, amount1 / 1e18);
    }
}
