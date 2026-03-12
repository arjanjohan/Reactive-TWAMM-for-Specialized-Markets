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
    error TWAMMHook__SlippageTooHigh();
    error TWAMMHook__Paused();
    error TWAMMHook__OnlyOwner();
    error TWAMMHook__TWAMMNotEnabled();
    error TWAMMHook__OnlyPoolManager();
    error TWAMMHook__UnauthorizedReactiveCallback();
    error HookNotImplemented();

    // Structs defined in ITWAMMHook interface

    // State variables
    IPoolManager public immutable POOL_MANAGER;
    address public owner;
    bool public paused;

    // Reactive callback auth (destination-side hardening)
    address public reactiveCallbackProxy;
    address public authorizedReactiveRvmId;
    mapping(bytes32 => ITWAMMHook.TWAMMOrder) public orders;
    mapping(bytes32 => uint256) public override claimableOutput;
    mapping(PoolId => bool) public twammEnabled;
    mapping(PoolId => bytes32[]) public poolOrders;

    uint256 public constant MIN_CHUNK_DURATION = 1 minutes;
    uint256 public constant MAX_CHUNKS = 100;
    uint256 public orderCounter;

    modifier onlyOwner() {
        if (msg.sender != owner) revert TWAMMHook__OnlyOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert TWAMMHook__Paused();
        _;
    }

    // ============ Events ============
    event OrderSubmitted(
        bytes32 indexed orderId,
        address indexed owner,
        PoolId indexed poolId,
        uint256 totalAmount,
        uint256 totalChunks,
        uint256 endTime,
        uint256 minOutputPerChunk
    );

    event ChunkExecuted(
        bytes32 indexed orderId,
        uint256 chunkIndex,
        uint256 amountIn,
        uint256 amountOut
    );

    event OrderCompleted(bytes32 indexed orderId);
    event OrderCancelled(bytes32 indexed orderId);
    event OutputClaimed(bytes32 indexed orderId, address indexed owner, uint256 amountOut);
    event TWAMMEnabled(PoolId indexed poolId);
    event Paused(address account);
    event Unpaused(address account);

    // ============ Constructor ============
    constructor(IPoolManager _POOL_MANAGER, address initialOwner) {
        POOL_MANAGER = _POOL_MANAGER;
        owner = initialOwner;

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
        Currency tokenOut,
        uint256 minOutputPerChunk
    ) external whenNotPaused returns (bytes32 orderId) {
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
            minOutputPerChunk: minOutputPerChunk,
            active: true,
            cancelled: false
        });

        poolOrders[poolId].push(orderId);

        // Transfer tokens from user to hook
        IERC20(Currency.unwrap(tokenIn)).transferFrom(msg.sender, address(this), amount);

        emit OrderSubmitted(
            orderId,
            msg.sender,
            poolId,
            amount,
            numChunks,
            block.timestamp + duration,
            minOutputPerChunk
        );
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
    function executeTWAMMChunk(PoolKey calldata key, bytes32 orderId) external whenNotPaused {
        _validateChunkExecution(orderId);
        _executeChunk(key, orderId);
    }

    /**
     * @notice Reactive-only entrypoint via callback proxy (security-hardened path)
     */
    function executeTWAMMChunkReactive(address reactiveRvmId, PoolKey calldata key, bytes32 orderId) external whenNotPaused {
        if (msg.sender != reactiveCallbackProxy || reactiveRvmId != authorizedReactiveRvmId) {
            revert TWAMMHook__UnauthorizedReactiveCallback();
        }

        _validateChunkExecution(orderId);
        _executeChunk(key, orderId);
    }

    function claimTWAMMOutput(bytes32 orderId) external returns (uint256 amountOut) {
        ITWAMMHook.TWAMMOrder storage order = orders[orderId];

        if (order.owner == address(0)) revert TWAMMHook__OrderNotFound();
        if (order.owner != msg.sender) revert TWAMMHook__NotOrderOwner();

        amountOut = claimableOutput[orderId];
        if (amountOut == 0) revert TWAMMHook__NoChunksToExecute();

        claimableOutput[orderId] = 0;
        IERC20(Currency.unwrap(order.tokenOut)).transfer(msg.sender, amountOut);

        emit OutputClaimed(orderId, msg.sender, amountOut);
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

    /**
     * @notice Pause or unpause the hook
     * @param _paused True to pause, false to unpause
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        if (_paused) {
            emit Paused(msg.sender);
        } else {
            emit Unpaused(msg.sender);
        }
    }

    /**
     * @notice Transfer ownership of the hook
     * @param newOwner The new owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }

    function setReactiveCallbackConfig(address callbackProxy, address reactiveRvmId) external onlyOwner {
        reactiveCallbackProxy = callbackProxy;
        authorizedReactiveRvmId = reactiveRvmId;
    }

    // ============ Internal Functions ============

    function _validateChunkExecution(bytes32 orderId) internal view {
        ITWAMMHook.TWAMMOrder storage order = orders[orderId];

        if (order.owner == address(0)) revert TWAMMHook__OrderNotFound();
        if (!order.active) revert TWAMMHook__OrderAlreadyCompleted();
        if (order.cancelled) revert TWAMMHook__OrderCancelled();
        if (order.executedChunks >= order.totalChunks) revert TWAMMHook__OrderAlreadyCompleted();

        uint256 timeSinceLastExecution = block.timestamp - order.lastExecutionTime;
        uint256 chunkDuration = (order.endTime - order.startTime) / order.totalChunks;

        if (timeSinceLastExecution < chunkDuration && order.lastExecutionTime != 0) {
            revert TWAMMHook__ExecutionTooSoon();
        }
    }

    function _processPendingOrders(PoolKey calldata key) internal {
        if (paused) return;
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

        uint256 chunkAmountOut = uint256(uint128(amountOut));

        order.executedChunks++;
        order.executedAmount += chunkAmount;
        order.lastExecutionTime = block.timestamp;
        claimableOutput[orderId] += chunkAmountOut;

        emit ChunkExecuted(orderId, order.executedChunks - 1, chunkAmount, chunkAmountOut);

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

        // Execute swap first, then settle/take exact deltas (v4 unlock accounting)
        BalanceDelta delta = POOL_MANAGER.swap(key, params, abi.encode(orderId));

        int128 delta0 = delta.amount0();
        int128 delta1 = delta.amount1();

        // Settle any negative deltas owed by this hook
        if (delta0 < 0) {
            uint256 amount0In = uint256(uint128(-delta0));
            POOL_MANAGER.sync(key.currency0);
            require(IERC20(Currency.unwrap(key.currency0)).transfer(address(POOL_MANAGER), amount0In), "Transfer failed");
            POOL_MANAGER.settle();
        }

        if (delta1 < 0) {
            uint256 amount1In = uint256(uint128(-delta1));
            POOL_MANAGER.sync(key.currency1);
            require(IERC20(Currency.unwrap(key.currency1)).transfer(address(POOL_MANAGER), amount1In), "Transfer failed");
            POOL_MANAGER.settle();
        }

        // Take positive output for TWAMM accounting/custody
        Currency outputCurrency = _currentExecution.zeroForOne ? key.currency1 : key.currency0;
        int128 outputAmount = _currentExecution.zeroForOne ? delta1 : delta0;
        require(outputAmount > 0, "Invalid output amount");

        ITWAMMHook.TWAMMOrder storage order = orders[orderId];
        uint256 amountOut = uint256(uint128(outputAmount));
        if (order.minOutputPerChunk > 0 && amountOut < order.minOutputPerChunk) {
            revert TWAMMHook__SlippageTooHigh();
        }

        POOL_MANAGER.take(outputCurrency, address(this), amountOut);

        return abi.encode(delta);
    }
}
