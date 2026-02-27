// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@uniswap/v4-core/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/types/Currency.sol";
import {SafeCast} from "@uniswap/v4-core/libraries/SafeCast.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/types/BeforeSwapDelta.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITWAMMHook} from "./interfaces/ITWAMMHook.sol";

/**
 * @title TWAMMHook
 * @notice Time-Weighted AMM Hook for Uniswap v4
 * @dev Enables large trades to be executed over time to minimize slippage
 *
 * Hook Address Requirements:
 * - beforeSwap: bit 7 (1 << 7 = 0x80)
 * - afterInitialize: bit 12 (1 << 12 = 0x1000)
 * - afterSwap: bit 6 (1 << 6 = 0x40)
 *
 * Required address mask: 0x10C0
 * Example valid address: 0x...00000000000010C0
 */
contract TWAMMHook is IHooks, ITWAMMHook {
    using PoolIdLibrary for PoolKey;
    using SafeCast for uint256;
    using Hooks for IHooks;

    // ============ Errors ============
    error TWAMMHook__InvalidDuration();
    error TWAMMHook__InvalidAmount();
    error TWAMMHook__OrderNotFound();
    error TWAMMHook__NotOrderOwner();
    error TWAMMHook__OrderAlreadyCompleted();
    error TWAMMHook__OrderCancelled();
    error TWAMMHook__NoChunksToExecute();
    error TWAMMHook__ExecutionTooSoon();
    error TWAMMHook__TWAMMNotEnabled();
    error TWAMMHook__OnlyPoolManager();
    error HookNotImplemented();

    // Structs defined in ITWAMMHook interface

    // State variables
    IPoolManager public immutable POOL_MANAGER;
    mapping(bytes32 => ITWAMMHook.TWAMMOrder) public orders;
    mapping(PoolId => bool) public twammEnabled;
    mapping(PoolId => bytes32[]) public poolOrders;

    uint256 public constant MIN_CHUNK_DURATION = 1 minutes;
    uint256 public constant MAX_CHUNKS = 100;
    uint256 public orderCounter;

    // ============ Events ============
    event OrderSubmitted(
        bytes32 indexed orderId,
        address indexed owner,
        PoolId indexed poolId,
        uint256 totalAmount,
        uint256 totalChunks,
        uint256 endTime
    );

    event ChunkExecuted(
        bytes32 indexed orderId,
        uint256 chunkIndex,
        uint256 amountIn,
        uint256 amountOut
    );

    event OrderCompleted(bytes32 indexed orderId);
    event OrderCancelled(bytes32 indexed orderId);
    event TWAMMEnabled(PoolId indexed poolId);

    // ============ Constructor ============
    constructor(IPoolManager _POOL_MANAGER) {
        POOL_MANAGER = _POOL_MANAGER;

        // Validate hook permissions
        // beforeSwap enabled to track TWAMM-originated swaps
        Hooks.validateHookPermissions(
            this,
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: true,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    /// @notice Returns the PoolManager address (interface compatibility)
    function poolManager() external view override returns (address) {
        return address(POOL_MANAGER);
    }

    // ============ Hook Functions ============

    function beforeInitialize(address, PoolKey calldata, uint160) external pure override returns (bytes4) {
        revert HookNotImplemented();
    }

    // Tracks whether we're currently executing a TWAMM chunk (to prevent recursion)
    bool internal _isExecutingChunk;

    /// @notice Only processes TWAMM chunks on external swaps (not TWAMM-initiated ones)
    function beforeSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) external view override returns (bytes4, BeforeSwapDelta, uint24) {
        if (msg.sender != address(POOL_MANAGER)) revert TWAMMHook__OnlyPoolManager();

        // If this is a TWAMM-initiated swap (from _executeChunk), just pass through
        // If it's an external swap and we have TWAMM orders to execute, process them in afterSwap

        return (IHooks.beforeSwap.selector, BeforeSwapDelta.wrap(0), 0);
    }

    function afterInitialize(
        address,
        PoolKey calldata key,
        uint160,
        int24
    ) external override returns (bytes4) {
        if (msg.sender != address(POOL_MANAGER)) revert TWAMMHook__OnlyPoolManager();

        // For this scaffold, we'll enable TWAMM for all pools that use this hook
        // In production, you'd use hookData to decide
        PoolId poolId = key.toId();
        twammEnabled[poolId] = true;
        emit TWAMMEnabled(poolId);

        return IHooks.afterInitialize.selector;
    }

    function beforeAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) external override returns (bytes4, int128) {
        if (msg.sender != address(POOL_MANAGER)) revert TWAMMHook__OnlyPoolManager();

        // Skip processing if we're in the middle of executing a TWAMM chunk
        // to prevent infinite recursion
        if (!_isExecutingChunk && twammEnabled[key.toId()]) {
            _processPendingOrders(key);
        }
        return (IHooks.afterSwap.selector, 0);
    }

    function beforeDonate(
        address,
        PoolKey calldata,
        uint256,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterDonate(
        address,
        PoolKey calldata,
        uint256,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        revert HookNotImplemented();
    }

    // ============ External Functions ============

    /**
     * @notice Submit a new TWAMM order
     * @param key The pool key
     * @param amount Total amount to trade
     * @param duration Total duration for the TWAMM execution
     * @param tokenIn Input currency
     * @param tokenOut Output currency
     */
    function submitTWAMMOrder(
        PoolKey calldata key,
        uint256 amount,
        uint256 duration,
        Currency tokenIn,
        Currency tokenOut
    ) external returns (bytes32 orderId) {
        if (amount == 0) revert TWAMMHook__InvalidAmount();
        if (duration < MIN_CHUNK_DURATION) revert TWAMMHook__InvalidDuration();

        PoolId poolId = key.toId();
        if (!twammEnabled[poolId]) revert TWAMMHook__TWAMMNotEnabled();

        // Calculate number of chunks (at least 1, at most MAX_CHUNKS)
        uint256 numChunks = duration / MIN_CHUNK_DURATION;
        if (numChunks > MAX_CHUNKS) numChunks = MAX_CHUNKS;
        if (numChunks == 0) numChunks = 1;

        orderId = keccak256(abi.encodePacked(msg.sender, block.timestamp, orderCounter++));

        orders[orderId] = TWAMMOrder({
            owner: msg.sender,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            totalAmount: amount,
            executedAmount: 0,
            totalChunks: numChunks,
            executedChunks: 0,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            lastExecutionTime: 0,
            active: true,
            cancelled: false
        });

        poolOrders[poolId].push(orderId);

        // Transfer tokens from user to hook
        IERC20(Currency.unwrap(tokenIn)).transferFrom(msg.sender, address(this), amount);

        emit OrderSubmitted(orderId, msg.sender, poolId, amount, numChunks, block.timestamp + duration);
    }

    /**
     * @notice Cancel an active TWAMM order
     * @param orderId The order ID to cancel
     */
    function cancelTWAMMOrder(bytes32 orderId) external {
        ITWAMMHook.TWAMMOrder storage order = orders[orderId];

        if (order.owner == address(0)) revert TWAMMHook__OrderNotFound();
        if (order.owner != msg.sender) revert TWAMMHook__NotOrderOwner();
        if (!order.active) revert TWAMMHook__OrderAlreadyCompleted();
        if (order.cancelled) revert TWAMMHook__OrderCancelled();

        order.cancelled = true;
        order.active = false;

        // Return remaining tokens to user
        uint256 remainingAmount = order.totalAmount - order.executedAmount;
        if (remainingAmount > 0) {
            IERC20(Currency.unwrap(order.tokenIn)).transfer(msg.sender, remainingAmount);
        }

        emit OrderCancelled(orderId);
    }

    /**
     * @notice Execute the next chunk of a TWAMM order
     * @param key The pool key
     * @param orderId The order ID to execute
     */
    function executeTWAMMChunk(PoolKey calldata key, bytes32 orderId) external {
        ITWAMMHook.TWAMMOrder storage order = orders[orderId];

        if (order.owner == address(0)) revert TWAMMHook__OrderNotFound();
        if (!order.active) revert TWAMMHook__OrderAlreadyCompleted();
        if (order.cancelled) revert TWAMMHook__OrderCancelled();
        if (order.executedChunks >= order.totalChunks) revert TWAMMHook__OrderAlreadyCompleted();

        // Check if enough time has passed since last execution
        uint256 timeSinceLastExecution = block.timestamp - order.lastExecutionTime;
        uint256 chunkDuration = (order.endTime - order.startTime) / order.totalChunks;

        if (timeSinceLastExecution < chunkDuration && order.lastExecutionTime != 0) {
            revert TWAMMHook__ExecutionTooSoon();
        }

        _executeChunk(key, orderId);
    }

    // ============ View Functions ============

    function getOrder(bytes32 orderId) external view returns (ITWAMMHook.TWAMMOrder memory) {
        return orders[orderId];
    }

    function getPoolOrders(PoolId poolId) external view returns (bytes32[] memory) {
        return poolOrders[poolId];
    }

    function getOrderProgress(bytes32 orderId) external view returns (uint256 executed, uint256 total) {
        ITWAMMHook.TWAMMOrder storage order = orders[orderId];
        return (order.executedChunks, order.totalChunks);
    }

    // ============ Internal Functions ============

    function _processPendingOrders(PoolKey calldata key) internal {
        PoolId poolId = key.toId();
        bytes32[] storage ordersList = poolOrders[poolId];

        for (uint256 i = 0; i < ordersList.length; i++) {
            bytes32 orderId = ordersList[i];
            ITWAMMHook.TWAMMOrder storage order = orders[orderId];

            if (!order.active || order.cancelled) continue;
            if (order.executedChunks >= order.totalChunks) continue;

            // Check if it's time to execute next chunk
            uint256 timeSinceLastExecution = block.timestamp - order.lastExecutionTime;
            uint256 chunkDuration = (order.endTime - order.startTime) / order.totalChunks;

            if (timeSinceLastExecution >= chunkDuration || order.lastExecutionTime == 0) {
                _executeChunk(key, orderId);
            }
        }
    }

    // TWAMM execution context for unlock callback
    struct ChunkExecution {
        PoolKey key;
        bytes32 orderId;
        uint256 chunkAmount;
        bool zeroForOne;
    }
    ChunkExecution internal _currentExecution;

    function _executeChunk(PoolKey calldata key, bytes32 orderId) internal {
        ITWAMMHook.TWAMMOrder storage order = orders[orderId];

        uint256 remainingChunks = order.totalChunks - order.executedChunks;
        uint256 remainingAmount = order.totalAmount - order.executedAmount;
        uint256 chunkAmount = remainingAmount / remainingChunks;

        if (chunkAmount == 0) revert TWAMMHook__NoChunksToExecute();

        _isExecutingChunk = true;

        // Store execution context for unlock callback
        bool zeroForOne = order.tokenIn == key.currency0;
        _currentExecution = ChunkExecution({
            key: key,
            orderId: orderId,
            chunkAmount: chunkAmount,
            zeroForOne: zeroForOne
        });

        // Prepare swap parameters and execute via unlock
        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: -int256(chunkAmount), // Exact input
            sqrtPriceLimitX96: zeroForOne ? 4295128740 : 340282366920938463463374607431768211455
        });

        bytes memory result = POOL_MANAGER.unlock(abi.encode(1, key, params, orderId));
        (BalanceDelta delta) = abi.decode(result, (BalanceDelta));

        // Calculate amount out from delta
        int128 amountOut = zeroForOne ? delta.amount1() : delta.amount0();

        order.executedChunks++;
        order.executedAmount += chunkAmount;
        order.lastExecutionTime = block.timestamp;

        emit ChunkExecuted(orderId, order.executedChunks - 1, chunkAmount, uint128(amountOut));

        _isExecutingChunk = false;
        delete _currentExecution;

        // Check if order is complete
        if (order.executedChunks >= order.totalChunks) {
            order.active = false;
            emit OrderCompleted(orderId);
        }
    }

    /// @notice Callback from PoolManager.unlock() to execute swap
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(POOL_MANAGER)) revert TWAMMHook__OnlyPoolManager();

        (uint256 op, PoolKey memory key, IPoolManager.SwapParams memory params, bytes32 orderId) =
            abi.decode(data, (uint256, PoolKey, IPoolManager.SwapParams, bytes32));

        require(op == 1, "Invalid operation");

        // Pull tokens from hook into PoolManager
        require(IERC20(Currency.unwrap(_currentExecution.zeroForOne ? key.currency0 : key.currency1))
            .transfer(address(POOL_MANAGER), uint256(-params.amountSpecified)), "Transfer failed");

        // Execute the actual swap
        BalanceDelta delta = POOL_MANAGER.swap(key, params, abi.encode(orderId));

        // Take the output tokens from the pool
        Currency outputCurrency = _currentExecution.zeroForOne ? key.currency1 : key.currency0;
        int128 outputAmount = _currentExecution.zeroForOne ? delta.amount1() : delta.amount0();
        require(outputAmount > 0, "Invalid output amount");
        POOL_MANAGER.take(outputCurrency, address(this), uint256(uint128(outputAmount)));

        return abi.encode(delta);
    }
}
