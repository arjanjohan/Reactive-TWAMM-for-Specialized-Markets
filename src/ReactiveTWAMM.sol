// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ITWAMMHook} from "./interfaces/ITWAMMHook.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/types/PoolId.sol";

interface ISubscriptionService {
    function subscribe(uint256 chain_id, address _contract, uint256 topic_0, uint256 topic_1, uint256 topic_2, uint256 topic_3) external;
    function unsubscribe(uint256 chain_id, address _contract, uint256 topic_0, uint256 topic_1, uint256 topic_2, uint256 topic_3) external;
}

/**
 * @title ReactiveTWAMM
 * @notice Reactive Network contract that monitors and triggers TWAMM execution
 * @dev This contract runs on Reactive Network and calls back to Unichain
 * 
 * Reactive Network Integration:
 * - Monitors time intervals for chunk execution
 * - Can monitor price conditions on other chains (Base, Arbitrum)
 * - Triggers executeTWAMMChunk() on Unichain hook
 */
contract ReactiveTWAMM {
    using PoolIdLibrary for PoolKey;

    uint256 public constant UNICHAIN_SEPOLIA_CHAIN_ID = 1301;
    uint64 public constant CALLBACK_GAS_LIMIT = 1_200_000;
    address public constant REACTIVE_SERVICE = 0x0000000000000000000000000000000000fffFfF;

    // Cron10 event topic from Reactive docs (~1 min cadence)
    uint256 public constant CRON10_TOPIC0 = 0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687;

    // ============ Errors ============
    error ReactiveTWAMM__UnauthorizedCallback();
    error ReactiveTWAMM__InvalidOrder();
    error ReactiveTWAMM__ConditionsNotMet();
    error ReactiveTWAMM__CallbackFailed();

    // ============ Events ============
    event Subscribed(PoolId indexed poolId, bytes32 indexed orderId);
    event Unsubscribed(PoolId indexed poolId, bytes32 indexed orderId);
    event ExecutionTriggered(PoolId indexed poolId, bytes32 indexed orderId, uint256 timestamp);
    event PriceConditionChecked(bytes32 indexed orderId, uint256 currentPrice, bool conditionMet);

    // Reactive system callback event (picked up by Reactive infrastructure)
    event Callback(uint256 indexed chain_id, address indexed _contract, uint64 indexed gas_limit, bytes payload);

    // ============ Structs ============
    struct Subscription {
        address targetHook;
        PoolKey poolKey;
        bytes32 orderId;
        uint256 lastExecutionTime;
        bool active;
        // Price monitoring (optional)
        bool usePriceCondition;
        address priceFeed; // Oracle address to check
        uint256 targetPrice;
        bool aboveTarget; // true = execute if price >= target, false = execute if price <= target
    }

    struct LogRecord {
        uint256 chain_id;
        address _contract;
        uint256 topic_0;
        uint256 topic_1;
        uint256 topic_2;
        uint256 topic_3;
        bytes data;
        uint256 block_number;
        uint256 op_code;
        uint256 block_hash;
        uint256 tx_hash;
        uint256 log_index;
    }

    // ============ State ============
    // Reactive Network callback address (set by Reactive Network)
    address public immutable reactiveCallbackAddress;
    
    // Owner/admin
    address public owner;
    
    // Subscriptions: orderId => subscription details
    mapping(bytes32 => Subscription) public subscriptions;
    
    // Track all active order IDs for iteration
    bytes32[] public activeOrderIds;
    mapping(bytes32 => uint256) public orderIndex;
    bool public cronSubscribed;

    // ============ Modifiers ============
    modifier onlyReactiveCallback() {
        if (msg.sender != reactiveCallbackAddress) revert ReactiveTWAMM__UnauthorizedCallback();
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyReactiveService() {
        require(msg.sender == REACTIVE_SERVICE, "Only reactive service");
        _;
    }

    // ============ Constructor ============
    constructor(address _reactiveCallbackAddress) {
        reactiveCallbackAddress = _reactiveCallbackAddress;
        owner = msg.sender;
    }

    // ============ External Functions ============

    /**
     * @notice Subscribe a TWAMM order for automated execution
     * @param targetHook The TWAMMHook address on Unichain
     * @param poolKey The pool key
     * @param orderId The order to monitor
     */
    function subscribe(
        address targetHook,
        PoolKey calldata poolKey,
        bytes32 orderId
    ) external onlyOwner {
        PoolId poolId = poolKey.toId();
        
        subscriptions[orderId] = Subscription({
            targetHook: targetHook,
            poolKey: poolKey,
            orderId: orderId,
            lastExecutionTime: 0,
            active: true,
            usePriceCondition: false,
            priceFeed: address(0),
            targetPrice: 0,
            aboveTarget: false
        });

        orderIndex[orderId] = activeOrderIds.length;
        activeOrderIds.push(orderId);

        _ensureCronSubscribed();
        emit Subscribed(poolId, orderId);
    }

    /**
     * @notice Subscribe with price condition
     * @param targetHook The TWAMMHook address
     * @param poolKey The pool key
     * @param orderId The order to monitor
     * @param priceFeed Oracle address for price checks
     * @param targetPrice Price threshold
     * @param aboveTarget Execute if price >= target (true) or <= target (false)
     */
    function subscribeWithPriceCondition(
        address targetHook,
        PoolKey calldata poolKey,
        bytes32 orderId,
        address priceFeed,
        uint256 targetPrice,
        bool aboveTarget
    ) external onlyOwner {
        PoolId poolId = poolKey.toId();
        
        subscriptions[orderId] = Subscription({
            targetHook: targetHook,
            poolKey: poolKey,
            orderId: orderId,
            lastExecutionTime: 0,
            active: true,
            usePriceCondition: true,
            priceFeed: priceFeed,
            targetPrice: targetPrice,
            aboveTarget: aboveTarget
        });

        orderIndex[orderId] = activeOrderIds.length;
        activeOrderIds.push(orderId);

        _ensureCronSubscribed();
        emit Subscribed(poolId, orderId);
    }

    /**
     * @notice Unsubscribe an order from automated execution
     * @param orderId The order to unsubscribe
     */
    function unsubscribe(bytes32 orderId) external onlyOwner {
        Subscription storage sub = subscriptions[orderId];
        if (!sub.active) revert ReactiveTWAMM__InvalidOrder();

        sub.active = false;
        
        // Remove from active list (swap and pop)
        uint256 index = orderIndex[orderId];
        uint256 lastIndex = activeOrderIds.length - 1;
        if (index != lastIndex) {
            bytes32 lastOrderId = activeOrderIds[lastIndex];
            activeOrderIds[index] = lastOrderId;
            orderIndex[lastOrderId] = index;
        }
        activeOrderIds.pop();
        delete orderIndex[orderId];

        emit Unsubscribed(sub.poolKey.toId(), orderId);
    }

    /**
     * @notice Check if conditions are met for executing a chunk
     * @param orderId The order to check
     * @return canExecute Whether execution should proceed
     */
    function checkExecutionConditions(bytes32 orderId) public view returns (bool canExecute) {
        Subscription memory sub = subscriptions[orderId];
        if (!sub.active) return false;

        // Check time-based condition
        // In production, you'd get order details from the hook
        // For now, assume time-based execution only
        
        // Check price condition if enabled
        if (sub.usePriceCondition) {
            // This would call an oracle on the destination chain
            // Simplified: assume condition is checked in the reactive callback
        }

        return true; // Simplified - actual logic would check order state
    }

    /**
     * @notice Reactive callback - triggered by Reactive Network when conditions met
     * @dev This function is called by Reactive Network infrastructure
     * @param orderId The order to execute
     */
    function executeTWAMMChunk(bytes32 orderId) external onlyReactiveCallback {
        Subscription storage sub = subscriptions[orderId];
        if (!sub.active) revert ReactiveTWAMM__InvalidOrder();
        if (!checkExecutionConditions(orderId)) revert ReactiveTWAMM__ConditionsNotMet();

        // Trigger callback to Unichain hook
        // This initiates a cross-chain call through Reactive Network
        _triggerExecution(sub.targetHook, sub.poolKey, orderId);

        sub.lastExecutionTime = block.timestamp;

        emit ExecutionTriggered(sub.poolKey.toId(), orderId, block.timestamp);
    }

    /**
     * @notice Batch check and execute multiple orders
     * @dev Can be called by anyone to trigger eligible executions
     * @param orderIds Array of order IDs to check
     */
    function batchExecute(bytes32[] calldata orderIds) external {
        for (uint256 i = 0; i < orderIds.length; i++) {
            bytes32 orderId = orderIds[i];
            if (checkExecutionConditions(orderId)) {
                Subscription memory sub = subscriptions[orderId];
                if (sub.active) {
                    _triggerExecution(sub.targetHook, sub.poolKey, orderId);
                }
            }
        }
    }

    /**
     * @notice Reactive entrypoint: called by Reactive service when subscribed logs are received
     */
    function react(LogRecord calldata log) external onlyReactiveService {
        if (log.topic_0 != CRON10_TOPIC0) return;

        // Process a bounded number of active orders per tick for gas safety.
        uint256 limit = activeOrderIds.length;
        if (limit > 10) limit = 10;

        for (uint256 i = 0; i < limit; i++) {
            bytes32 orderId = activeOrderIds[i];
            if (!checkExecutionConditions(orderId)) continue;

            Subscription memory sub = subscriptions[orderId];
            if (!sub.active) continue;

            _triggerExecution(sub.targetHook, sub.poolKey, orderId);
        }
    }

    function ensureCronSubscription() external onlyOwner {
        _ensureCronSubscribed();
    }

    // ============ View Functions ============

    function getSubscription(bytes32 orderId) external view returns (Subscription memory) {
        return subscriptions[orderId];
    }

    function getActiveOrderCount() external view returns (uint256) {
        return activeOrderIds.length;
    }

    function getActiveOrders(uint256 start, uint256 count) external view returns (bytes32[] memory) {
        uint256 end = start + count;
        if (end > activeOrderIds.length) end = activeOrderIds.length;
        
        bytes32[] memory result = new bytes32[](end - start);
        for (uint256 i = start; i < end; i++) {
            result[i - start] = activeOrderIds[i];
        }
        return result;
    }

    // ============ Internal Functions ============

    /**
     * @notice Trigger execution on the target hook
     * @dev In production, this uses Reactive Network's cross-chain messaging
     */
    function _triggerExecution(address targetHook, PoolKey memory poolKey, bytes32 orderId) internal {
        // First argument is replaced by Reactive infra with the source RVM ID.
        bytes memory payload = abi.encodeWithSelector(
            ITWAMMHook.executeTWAMMChunkReactive.selector,
            address(0),
            poolKey,
            orderId
        );

        emit Callback(UNICHAIN_SEPOLIA_CHAIN_ID, targetHook, CALLBACK_GAS_LIMIT, payload);
        emit ExecutionTriggered(poolKey.toId(), orderId, block.timestamp);
    }

    function _ensureCronSubscribed() internal {
        if (cronSubscribed) return;

        uint256 size;
        assembly {
            size := extcodesize(REACTIVE_SERVICE)
        }

        // In local/unit tests there is no Reactive system contract deployed.
        if (size == 0) return;

        try ISubscriptionService(REACTIVE_SERVICE).subscribe(
            block.chainid,
            REACTIVE_SERVICE,
            CRON10_TOPIC0,
            0,
            0,
            0
        ) {
            cronSubscribed = true;
        } catch {
            // Not in RN execution context (e.g., plain EVM script path).
            // Keep manual execution paths available.
            cronSubscribed = false;
        }
    }

    // ============ Admin Functions ============

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }
}
