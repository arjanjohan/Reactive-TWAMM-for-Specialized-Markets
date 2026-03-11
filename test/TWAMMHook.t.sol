// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {TWAMMHook} from "../src/TWAMMHook.sol";
import {IPoolManager} from "@uniswap/v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/libraries/Hooks.sol";
import {BalanceDelta} from "@uniswap/v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/types/BeforeSwapDelta.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockPoolManager {
    // Minimal implementation for testing
}

contract TWAMMHookTest is Test {
    using PoolIdLibrary for PoolKey;

    TWAMMHook public hook;
    MockPoolManager public poolManager;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    
    PoolKey public poolKey;
    
    address public alice = address(0x1);
    address public bob = address(0x2);

    // Hook needs specific address flags:
    // beforeSwap: bit 7 (0x80)
    // afterInitialize: bit 12 (0x1000)
    // afterSwap: bit 6 (0x40)
    // Required mask: 0x10C0
    address constant HOOK_ADDRESS = address(0x00000000000000000000000000000000000010C0);

    function setUp() public {
        // Deploy mock pool manager
        poolManager = new MockPoolManager();
        
        // Deploy tokens
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
        
        // Sort tokens (token0 < token1)
        (address token0, address token1) = 
            address(tokenA) < address(tokenB) ? 
            (address(tokenA), address(tokenB)) : 
            (address(tokenB), address(tokenA));
        
        // Deploy hook at specific address with valid flags
        deployCodeTo("TWAMMHook.sol:TWAMMHook", abi.encode(address(poolManager)), HOOK_ADDRESS);
        hook = TWAMMHook(HOOK_ADDRESS);
        
        // Create pool key
        poolKey = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: 3000,
            tickSpacing: 60,
            hooks: hook
        });
        
        // Fund test accounts
        tokenA.mint(alice, 1000 ether);
        tokenB.mint(alice, 1000 ether);
    }

    function test_Constructor() public view {
        assertEq(address(hook.poolManager()), address(poolManager));
    }

    function test_RevertIf_InvalidAmount() public {
        vm.startPrank(alice);
        vm.expectRevert(TWAMMHook.TWAMMHook__InvalidAmount.selector);
        hook.submitTWAMMOrder(
            poolKey,
            0,
            10 minutes,
            Currency.wrap(address(tokenA)),
            Currency.wrap(address(tokenB)),
            0
        );
        vm.stopPrank();
    }

    function test_RevertIf_InvalidDuration() public {
        vm.startPrank(alice);
        vm.expectRevert(TWAMMHook.TWAMMHook__InvalidDuration.selector);
        hook.submitTWAMMOrder(
            poolKey,
            100 ether,
            30 seconds, // Less than MIN_CHUNK_DURATION (1 minute)
            Currency.wrap(address(tokenA)),
            Currency.wrap(address(tokenB)),
            0
        );
        vm.stopPrank();
    }

    function test_RevertIf_TWAMMNotEnabled() public {
        vm.startPrank(alice);
        tokenA.approve(address(hook), 100 ether);
        
        vm.expectRevert(TWAMMHook.TWAMMHook__TWAMMNotEnabled.selector);
        hook.submitTWAMMOrder(
            poolKey,
            100 ether,
            10 minutes,
            Currency.wrap(address(tokenA)),
            Currency.wrap(address(tokenB)),
            0
        );
        vm.stopPrank();
    }

    function test_EnableTWAMM() public {
        // Enable TWAMM for the pool
        vm.prank(address(poolManager));
        hook.afterInitialize(address(this), poolKey, 0, 0);
        
        PoolId poolId = poolKey.toId();
        assertTrue(hook.twammEnabled(poolId));
    }

    function test_SubmitOrder() public {
        // Enable TWAMM for the pool
        vm.prank(address(poolManager));
        hook.afterInitialize(address(this), poolKey, 0, 0);
        
        // Alice approves and submits order
        vm.startPrank(alice);
        tokenA.approve(address(hook), 100 ether);
        
        bytes32 orderId = hook.submitTWAMMOrder(
            poolKey,
            100 ether,
            10 minutes,
            Currency.wrap(address(tokenA)),
            Currency.wrap(address(tokenB)),
            0
        );
        
        vm.stopPrank();
        
        // Verify order was created
        TWAMMHook.TWAMMOrder memory order = hook.getOrder(orderId);
        assertEq(order.owner, alice);
        assertEq(order.totalAmount, 100 ether);
        assertEq(order.minOutputPerChunk, 0);
        assertTrue(order.active);
        assertFalse(order.cancelled);
    }

    function test_SubmitOrder_StoresMinOutputPerChunk() public {
        vm.prank(address(poolManager));
        hook.afterInitialize(address(this), poolKey, 0, 0);

        vm.startPrank(alice);
        tokenA.approve(address(hook), 100 ether);
        bytes32 orderId = hook.submitTWAMMOrder(
            poolKey,
            100 ether,
            10 minutes,
            Currency.wrap(address(tokenA)),
            Currency.wrap(address(tokenB)),
            77 ether
        );
        vm.stopPrank();

        TWAMMHook.TWAMMOrder memory order = hook.getOrder(orderId);
        assertEq(order.minOutputPerChunk, 77 ether);
    }

    function test_RevertIf_SetPaused_NonOwner() public {
        vm.prank(bob);
        vm.expectRevert(TWAMMHook.TWAMMHook__OnlyOwner.selector);
        hook.setPaused(true);
    }

    function test_RevertIf_SubmitWhenPaused() public {
        vm.prank(address(poolManager));
        hook.afterInitialize(address(this), poolKey, 0, 0);

        hook.setPaused(true);

        vm.startPrank(alice);
        tokenA.approve(address(hook), 100 ether);
        vm.expectRevert(TWAMMHook.TWAMMHook__Paused.selector);
        hook.submitTWAMMOrder(
            poolKey,
            100 ether,
            10 minutes,
            Currency.wrap(address(tokenA)),
            Currency.wrap(address(tokenB)),
            0
        );
        vm.stopPrank();
    }

    function test_RevertIf_ExecuteWhenPaused() public {
        vm.prank(address(poolManager));
        hook.afterInitialize(address(this), poolKey, 0, 0);

        vm.startPrank(alice);
        tokenA.approve(address(hook), 100 ether);
        bytes32 orderId = hook.submitTWAMMOrder(
            poolKey,
            100 ether,
            10 minutes,
            Currency.wrap(address(tokenA)),
            Currency.wrap(address(tokenB)),
            0
        );
        vm.stopPrank();

        hook.setPaused(true);

        vm.expectRevert(TWAMMHook.TWAMMHook__Paused.selector);
        hook.executeTWAMMChunk(poolKey, orderId);
    }

    function test_RevertIf_ReactiveExecuteByWrongCaller() public {
        hook.setReactiveCallbackConfig(address(0xBEEF), address(0xCAFE));

        vm.prank(address(0xDEAD));
        vm.expectRevert(TWAMMHook.TWAMMHook__UnauthorizedReactiveCallback.selector);
        hook.executeTWAMMChunkReactive(address(0xCAFE), poolKey, bytes32(uint256(1)));
    }

    function test_CancelOrder() public {
        // Enable TWAMM for the pool
        vm.prank(address(poolManager));
        hook.afterInitialize(address(this), poolKey, 0, 0);
        
        // Alice submits order
        vm.startPrank(alice);
        tokenA.approve(address(hook), 100 ether);
        bytes32 orderId = hook.submitTWAMMOrder(
            poolKey,
            100 ether,
            10 minutes,
            Currency.wrap(address(tokenA)),
            Currency.wrap(address(tokenB)),
            0
        );
        
        // Cancel order
        hook.cancelTWAMMOrder(orderId);
        vm.stopPrank();
        
        // Verify order is cancelled
        TWAMMHook.TWAMMOrder memory order = hook.getOrder(orderId);
        assertFalse(order.active);
        assertTrue(order.cancelled);
    }

    function test_RevertIf_NotOwner() public {
        // Enable TWAMM for the pool
        vm.prank(address(poolManager));
        hook.afterInitialize(address(this), poolKey, 0, 0);
        
        // Alice submits order
        vm.startPrank(alice);
        tokenA.approve(address(hook), 100 ether);
        bytes32 orderId = hook.submitTWAMMOrder(
            poolKey,
            100 ether,
            10 minutes,
            Currency.wrap(address(tokenA)),
            Currency.wrap(address(tokenB)),
            0
        );
        vm.stopPrank();
        
        // Bob tries to cancel
        vm.prank(bob);
        vm.expectRevert(TWAMMHook.TWAMMHook__NotOrderOwner.selector);
        hook.cancelTWAMMOrder(orderId);
    }

    function test_RevertIf_OrderNotFound() public {
        bytes32 fakeOrderId = keccak256("fake");
        
        vm.prank(alice);
        vm.expectRevert(TWAMMHook.TWAMMHook__OrderNotFound.selector);
        hook.cancelTWAMMOrder(fakeOrderId);
    }

    function test_GetOrderProgress() public {
        // Enable TWAMM for the pool
        vm.prank(address(poolManager));
        hook.afterInitialize(address(this), poolKey, 0, 0);
        
        // Alice submits order
        vm.startPrank(alice);
        tokenA.approve(address(hook), 100 ether);
        bytes32 orderId = hook.submitTWAMMOrder(
            poolKey,
            100 ether,
            10 minutes,
            Currency.wrap(address(tokenA)),
            Currency.wrap(address(tokenB)),
            0
        );
        vm.stopPrank();
        
        // Check progress
        (uint256 executed, uint256 total) = hook.getOrderProgress(orderId);
        assertEq(executed, 0);
        assertGt(total, 0);
    }

    function test_GetPoolOrders() public {
        // Enable TWAMM for the pool
        vm.prank(address(poolManager));
        hook.afterInitialize(address(this), poolKey, 0, 0);
        
        // Alice submits order
        vm.startPrank(alice);
        tokenA.approve(address(hook), 150 ether);
        bytes32 orderId1 = hook.submitTWAMMOrder(
            poolKey,
            100 ether,
            10 minutes,
            Currency.wrap(address(tokenA)),
            Currency.wrap(address(tokenB)),
            0
        );
        
        bytes32 orderId2 = hook.submitTWAMMOrder(
            poolKey,
            50 ether,
            5 minutes,
            Currency.wrap(address(tokenA)),
            Currency.wrap(address(tokenB)),
            0
        );
        vm.stopPrank();
        
        // Check pool orders
        PoolId poolId = poolKey.toId();
        bytes32[] memory orders = hook.getPoolOrders(poolId);
        assertEq(orders.length, 2);
        assertEq(orders[0], orderId1);
        assertEq(orders[1], orderId2);
    }
}
