// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {TWAMMHook} from "../src/TWAMMHook.sol";
import {ReactiveTWAMM} from "../src/ReactiveTWAMM.sol";
import {ITWAMMHook} from "../src/interfaces/ITWAMMHook.sol";
import {IReactive} from "reactive-lib/interfaces/IReactive.sol";
import {PoolManager} from "@uniswap/v4-core/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/interfaces/IHooks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/test/PoolModifyLiquidityTest.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title ReactiveCallbackTest
 * @notice Tests the full Reactive Network callback flow:
 *         1. User submits TWAMM order on Unichain (TWAMMHook)
 *         2. User subscribes order on Reactive (ReactiveTWAMM)
 *         3. Cron fires → react() processes LogRecord → emits Callback event
 *         4. Reactive infra delivers callback → executeTWAMMChunkReactive() on Unichain
 *
 *         Since we can't run the real Reactive infra in forge, we simulate:
 *         - ReactiveTWAMM deployed locally (vm=true, skips cron subscribe)
 *         - Capture Callback event payload from react()/batchExecute()
 *         - Deliver payload to TWAMMHook as the callback proxy would
 */
contract ReactiveCallbackTest is Test {
    using PoolIdLibrary for PoolKey;

    // ---- Contracts ----
    PoolManager public poolManager;
    TWAMMHook public hook;
    ReactiveTWAMM public reactive;
    MockToken public tokenA;
    MockToken public tokenB;
    PoolModifyLiquidityTest public liquidityRouter;

    // ---- Pool ----
    PoolKey public poolKey;

    // ---- Actors ----
    address public deployer = address(this);
    address public alice = address(0xA11CE);
    address public lp = address(0x1111);

    // Simulate Reactive infra addresses
    address public callbackProxy = address(0xCA11BAC);
    address public reactiveRvmId; // set after deploying ReactiveTWAMM

    // ---- Constants ----
    address constant HOOK_ADDRESS = address(0x00000000000000000000000000000000000010C0);
    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint160 constant SQRT_PRICE_X96 = 79228162514264337593543950336; // 1:1

    // Mirror Callback event from IReactive
    event Callback(uint256 indexed chain_id, address indexed _contract, uint64 indexed gas_limit, bytes payload);

    function setUp() public {
        // Deploy core
        poolManager = new PoolManager(address(this));
        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");

        (MockToken t0, MockToken t1) = address(tokenA) < address(tokenB)
            ? (tokenA, tokenB) : (tokenB, tokenA);

        // Deploy hook
        deployCodeTo("TWAMMHook.sol:TWAMMHook", abi.encode(address(poolManager), deployer), HOOK_ADDRESS);
        hook = TWAMMHook(HOOK_ADDRESS);

        // Deploy ReactiveTWAMM (vm=true in forge, skips cron subscribe)
        reactive = new ReactiveTWAMM(HOOK_ADDRESS);
        reactiveRvmId = address(reactive);

        // Configure hook to accept callbacks from our simulated proxy + reactive contract
        hook.setReactiveCallbackConfig(callbackProxy, reactiveRvmId);

        // Setup pool
        liquidityRouter = new PoolModifyLiquidityTest(IPoolManager(address(poolManager)));
        poolKey = PoolKey({
            currency0: Currency.wrap(address(t0)),
            currency1: Currency.wrap(address(t1)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: hook
        });
        poolManager.initialize(poolKey, SQRT_PRICE_X96);

        // Fund LP and add liquidity
        tokenA.mint(lp, 100_000 ether);
        tokenB.mint(lp, 100_000 ether);
        vm.startPrank(lp);
        tokenA.approve(address(liquidityRouter), type(uint256).max);
        tokenB.approve(address(liquidityRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity(poolKey, IPoolManager.ModifyLiquidityParams({
            tickLower: -887220, tickUpper: 887220,
            liquidityDelta: int256(5e21), salt: bytes32(0)
        }), "");
        vm.stopPrank();

        // Fund Alice
        tokenA.mint(alice, 10_000 ether);
        tokenB.mint(alice, 10_000 ether);
    }

    // ================================================================
    // Helpers
    // ================================================================

    function _submitOrder(uint256 amount, uint256 duration) internal returns (bytes32 orderId) {
        vm.startPrank(alice);
        tokenA.approve(address(hook), amount);
        orderId = hook.submitTWAMMOrder(
            poolKey, amount, duration,
            Currency.wrap(address(tokenA) < address(tokenB) ? address(tokenA) : address(tokenB)),
            Currency.wrap(address(tokenA) < address(tokenB) ? address(tokenB) : address(tokenA)),
            0
        );
        vm.stopPrank();
    }

    /// @dev Simulate what Reactive infra does: take the Callback payload and deliver it
    ///      to the target hook as if msg.sender == callbackProxy
    function _deliverCallback(bytes memory payload) internal {
        vm.prank(callbackProxy);
        (bool ok, bytes memory ret) = address(hook).call(payload);
        if (!ok) {
            if (ret.length > 0) {
                assembly { revert(add(ret, 32), mload(ret)) }
            }
            revert("Callback delivery failed");
        }
    }

    /// @dev Build a fake cron LogRecord to feed into react()
    function _buildCronLogRecord() internal view returns (IReactive.LogRecord memory) {
        return IReactive.LogRecord({
            chain_id: block.chainid,
            _contract: address(0xfffFfF), // system contract
            topic_0: reactive.CRON10_TOPIC0(),
            topic_1: 0,
            topic_2: 0,
            topic_3: 0,
            data: "",
            block_number: block.number,
            op_code: 0,
            block_hash: 0,
            tx_hash: 0,
            log_index: 0
        });
    }

    // ================================================================
    // Test: Callback payload encoding matches what the hook expects
    // ================================================================

    function test_CallbackPayloadEncoding() public {
        bytes32 orderId = _submitOrder(10 ether, 10 minutes);

        // Subscribe on Reactive side
        reactive.subscribe(address(hook), poolKey, orderId);

        // Capture what _triggerExecution encodes
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = orderId;

        vm.recordLogs();
        reactive.batchExecute(ids);

        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Find the Callback event
        bytes memory payload;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("Callback(uint256,address,uint64,bytes)")) {
                payload = abi.decode(logs[i].data, (bytes));
                break;
            }
        }
        assertTrue(payload.length > 0, "Callback event not emitted");

        // Decode the payload to inspect the reactiveRvmId argument
        // payload layout: selector (4 bytes) + abi-encoded args
        bytes4 selector = bytes4(payload[0]) | (bytes4(payload[1]) >> 8) | (bytes4(payload[2]) >> 16) | (bytes4(payload[3]) >> 24);
        // reactiveRvmId is the first ABI argument, bytes 4..36
        address encodedRvmId;
        bytes memory argSlice = new bytes(32);
        for (uint256 k = 0; k < 32; k++) {
            argSlice[k] = payload[4 + k];
        }
        encodedRvmId = abi.decode(argSlice, (address));

        assertEq(selector, ITWAMMHook.executeTWAMMChunkReactive.selector, "Wrong function selector");

        console2.log("Encoded reactiveRvmId in payload:", encodedRvmId);
        console2.log("Authorized reactiveRvmId on hook:", hook.authorizedReactiveRvmId());

        // THIS IS THE BUG: _triggerExecution encodes address(0) but hook expects reactiveRvmId
        assertEq(
            encodedRvmId,
            hook.authorizedReactiveRvmId(),
            "BUG: payload reactiveRvmId does not match hook's authorizedReactiveRvmId"
        );
    }

    // ================================================================
    // Test: executeTWAMMChunkReactive rejects wrong caller
    // ================================================================

    function test_RevertIf_CallerIsNotCallbackProxy() public {
        bytes32 orderId = _submitOrder(10 ether, 10 minutes);
        vm.warp(block.timestamp + 1 minutes);

        // Call from random address (not the callback proxy)
        vm.prank(address(0xDEAD));
        vm.expectRevert(abi.encodeWithSelector(TWAMMHook.TWAMMHook__UnauthorizedReactiveCallback.selector));
        hook.executeTWAMMChunkReactive(reactiveRvmId, poolKey, orderId);
    }

    // ================================================================
    // Test: executeTWAMMChunkReactive rejects wrong rvmId
    // ================================================================

    function test_RevertIf_WrongRvmId() public {
        bytes32 orderId = _submitOrder(10 ether, 10 minutes);
        vm.warp(block.timestamp + 1 minutes);

        // Call from correct proxy but wrong rvmId
        vm.prank(callbackProxy);
        vm.expectRevert(abi.encodeWithSelector(TWAMMHook.TWAMMHook__UnauthorizedReactiveCallback.selector));
        hook.executeTWAMMChunkReactive(address(0xBAD), poolKey, orderId);
    }

    // ================================================================
    // Test: executeTWAMMChunkReactive succeeds with correct auth
    // ================================================================

    function test_ReactiveChunkExecution_DirectCall() public {
        bytes32 orderId = _submitOrder(10 ether, 10 minutes);
        vm.warp(block.timestamp + 1 minutes);

        // Correct proxy + correct rvmId
        vm.prank(callbackProxy);
        hook.executeTWAMMChunkReactive(reactiveRvmId, poolKey, orderId);

        (uint256 executed, uint256 total) = hook.getOrderProgress(orderId);
        assertEq(executed, 1, "Chunk should have executed");
        assertEq(total, 10);
    }

    // ================================================================
    // Test: Full end-to-end with react() (simulated cron)
    // ================================================================

    function test_EndToEnd_CronTriggeredExecution() public {
        bytes32 orderId = _submitOrder(10 ether, 10 minutes);

        // Step 1: Subscribe on Reactive side
        reactive.subscribe(address(hook), poolKey, orderId);
        assertEq(reactive.getActiveOrderCount(), 1);

        // Step 2: Simulate cron firing → react() processes it
        IReactive.LogRecord memory cronLog = _buildCronLogRecord();

        vm.warp(block.timestamp + 1 minutes);

        vm.recordLogs();
        vm.prank(address(reactive)); // react() is vmOnly, but in forge vm=true so this works from any address
        reactive.react(cronLog);

        // Step 3: Extract Callback payload
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes memory payload;
        address callbackTarget;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("Callback(uint256,address,uint64,bytes)")) {
                callbackTarget = address(uint160(uint256(logs[i].topics[2])));
                payload = abi.decode(logs[i].data, (bytes));
                break;
            }
        }
        assertTrue(payload.length > 0, "react() should emit Callback");
        assertEq(callbackTarget, address(hook), "Callback should target the hook");

        // Step 4: Deliver callback as the proxy would
        _deliverCallback(payload);

        // Step 5: Verify chunk executed
        (uint256 executed, uint256 total) = hook.getOrderProgress(orderId);
        assertEq(executed, 1, "One chunk should have executed via reactive callback");
        assertEq(total, 10);
    }

    // ================================================================
    // Test: Full order execution over multiple cron cycles
    // ================================================================

    function test_EndToEnd_FullOrderViaReactiveCron() public {
        bytes32 orderId = _submitOrder(10 ether, 10 minutes);
        reactive.subscribe(address(hook), poolKey, orderId);

        IReactive.LogRecord memory cronLog = _buildCronLogRecord();

        for (uint256 i = 0; i < 10; i++) {
            vm.warp(block.timestamp + 1 minutes);

            // Cron fires → react()
            vm.recordLogs();
            vm.prank(address(reactive));
            reactive.react(cronLog);

            // Extract and deliver callback
            Vm.Log[] memory logs = vm.getRecordedLogs();
            for (uint256 j = 0; j < logs.length; j++) {
                if (logs[j].topics[0] == keccak256("Callback(uint256,address,uint64,bytes)")) {
                    bytes memory payload = abi.decode(logs[j].data, (bytes));
                    _deliverCallback(payload);
                    break;
                }
            }
        }

        (uint256 executed, uint256 total) = hook.getOrderProgress(orderId);
        assertEq(executed, 10, "All chunks should be executed");
        assertEq(total, 10);

        // Verify output accumulated
        uint256 claimable = hook.claimableOutput(orderId);
        assertGt(claimable, 0, "Should have claimable output after full execution");
    }

    // ================================================================
    // Test: batchExecute callback delivery
    // ================================================================

    function test_EndToEnd_BatchExecuteDelivery() public {
        bytes32 orderId = _submitOrder(10 ether, 10 minutes);
        reactive.subscribe(address(hook), poolKey, orderId);

        vm.warp(block.timestamp + 1 minutes);

        bytes32[] memory ids = new bytes32[](1);
        ids[0] = orderId;

        vm.recordLogs();
        reactive.batchExecute(ids);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes memory payload;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("Callback(uint256,address,uint64,bytes)")) {
                payload = abi.decode(logs[i].data, (bytes));
                break;
            }
        }
        assertTrue(payload.length > 0, "batchExecute should emit Callback");

        // Deliver and verify
        _deliverCallback(payload);

        (uint256 executed,) = hook.getOrderProgress(orderId);
        assertEq(executed, 1, "Chunk should execute via batchExecute callback");
    }

    // ================================================================
    // Test: Multiple orders in single cron cycle
    // ================================================================

    function test_EndToEnd_MultipleOrdersSingleCron() public {
        bytes32 order1 = _submitOrder(5 ether, 5 minutes);
        bytes32 order2 = _submitOrder(10 ether, 10 minutes);

        reactive.subscribe(address(hook), poolKey, order1);
        reactive.subscribe(address(hook), poolKey, order2);
        assertEq(reactive.getActiveOrderCount(), 2);

        vm.warp(block.timestamp + 1 minutes);

        IReactive.LogRecord memory cronLog = _buildCronLogRecord();

        vm.recordLogs();
        vm.prank(address(reactive));
        reactive.react(cronLog);

        // Should have 2 Callback events
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 callbackCount;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("Callback(uint256,address,uint64,bytes)")) {
                bytes memory payload = abi.decode(logs[i].data, (bytes));
                _deliverCallback(payload);
                callbackCount++;
            }
        }
        assertEq(callbackCount, 2, "Should emit 2 Callbacks for 2 active orders");

        (uint256 exec1,) = hook.getOrderProgress(order1);
        (uint256 exec2,) = hook.getOrderProgress(order2);
        assertEq(exec1, 1);
        assertEq(exec2, 1);
    }
}
