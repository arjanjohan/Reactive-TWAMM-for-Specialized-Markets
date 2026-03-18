// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ITWAMMHook} from "./interfaces/ITWAMMHook.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/interfaces/IHooks.sol";
import {AbstractReactive} from "reactive-lib/abstract-base/AbstractReactive.sol";
import {IReactive} from "reactive-lib/interfaces/IReactive.sol";

/**
 * @title ReactiveTWAMM
 * @notice Reactive Network contract that monitors and triggers TWAMM execution
 * @dev Inherits from AbstractReactive for proper Reactive Network integration.
 *
 *      Architecture: the contract exists in TWO separate state environments:
 *        - Reactive Network (RN): handles subscriptions, payments, admin
 *        - ReactVM (RVM): runs react(), stores order state, emits Callbacks
 *
 *      State does NOT propagate between RN and RVM. Orders are registered
 *      in the RVM by subscribing to OrderRegisteredReactive events from the
 *      TWAMMHook on Unichain. The RVM also listens for OrderCancelled and
 *      OrderCompleted events to clean up, and CRON10 events to trigger execution.
 */
contract ReactiveTWAMM is AbstractReactive {
    using PoolIdLibrary for PoolKey;

    uint256 public constant UNICHAIN_SEPOLIA_CHAIN_ID = 1301;
    uint64 public constant CALLBACK_GAS_LIMIT = 1_200_000;

    // Cron event topic (fires every ~10 blocks on Lasna)
    uint256 public constant CRON10_TOPIC0 = 0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687;

    // TWAMMHook event signatures (topic0) — used to auto-register/deregister orders in the RVM
    // keccak256("OrderRegisteredReactive(bytes32,address,address,uint24,int24,address)")
    uint256 public constant ORDER_REGISTERED_TOPIC0 =
        0x6253400cc4d6a5c59c76a398cd5f895819e3c7ec9b1331138e54a2c638a06695;
    // keccak256("OrderCancelled(bytes32)")
    uint256 public constant ORDER_CANCELLED_TOPIC0 =
        0x5152abf959f6564662358c2e52b702259b78bac5ee7842a0f01937e670efcc7d;
    // keccak256("OrderCompleted(bytes32)")
    uint256 public constant ORDER_COMPLETED_TOPIC0 =
        0xc1471de81880c1b225e1d454a583a6f0fde1f88fb0f03ca678be2a3656c0f7c2;

    // ============ Errors ============
    error ReactiveTWAMM__InvalidOrder();

    // ============ Events ============
    event Subscribed(PoolId indexed poolId, bytes32 indexed orderId);
    event Unsubscribed(PoolId indexed poolId, bytes32 indexed orderId);
    event ExecutionTriggered(PoolId indexed poolId, bytes32 indexed orderId, uint256 timestamp);

    // ============ Structs ============
    struct Subscription {
        address targetHook;
        PoolKey poolKey;
        bytes32 orderId;
        uint256 lastExecutionTime;
        bool active;
    }

    // ============ State ============
    address public owner;
    address public targetHook; // TWAMMHook address on Unichain
    mapping(bytes32 => Subscription) public subscriptions;
    bytes32[] public activeOrderIds;
    mapping(bytes32 => uint256) public orderIndex;
    bool public initialized;

    // ============ Modifiers ============
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    /**
     * @param _targetHook TWAMMHook address on Unichain Sepolia
     */
    constructor(address _targetHook) payable {
        owner = msg.sender;
        targetHook = _targetHook;
    }

    /**
     * @notice Set up all event subscriptions. Must be called after deployment on RN.
     * @dev Reactive Network doesn't allow service.subscribe() in constructors.
     *      Call once after deployment and funding.
     */
    function initialize() external onlyOwner rnOnly {
        require(!initialized, "Already initialized");
        initialized = true;

        // 1) CRON10 — periodic trigger for chunk execution
        service.subscribe(
            block.chainid,       // Lasna chain
            address(service),    // system contract emits cron events
            CRON10_TOPIC0,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );

        // 2) OrderRegisteredReactive — auto-register new orders in the RVM
        service.subscribe(
            UNICHAIN_SEPOLIA_CHAIN_ID,
            targetHook,
            ORDER_REGISTERED_TOPIC0,
            REACTIVE_IGNORE,     // any orderId
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );

        // 3) OrderCancelled — auto-deregister cancelled orders
        service.subscribe(
            UNICHAIN_SEPOLIA_CHAIN_ID,
            targetHook,
            ORDER_CANCELLED_TOPIC0,
            REACTIVE_IGNORE,     // any orderId
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );

        // 4) OrderCompleted — auto-deregister completed orders
        service.subscribe(
            UNICHAIN_SEPOLIA_CHAIN_ID,
            targetHook,
            ORDER_COMPLETED_TOPIC0,
            REACTIVE_IGNORE,     // any orderId
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
    }

    // ============ react() — RVM entrypoint ============

    function react(IReactive.LogRecord calldata log) external vmOnly {
        if (log.topic_0 == CRON10_TOPIC0) {
            _handleCron();
        } else if (log.topic_0 == ORDER_REGISTERED_TOPIC0) {
            _handleOrderRegistered(log);
        } else if (log.topic_0 == ORDER_CANCELLED_TOPIC0 || log.topic_0 == ORDER_COMPLETED_TOPIC0) {
            _handleOrderRemoved(log);
        }
    }

    // ============ RN-side admin functions ============

    /// @notice Manually subscribe an order (RN state only — useful for testing on the RN side).
    function subscribe(address _targetHook, PoolKey calldata poolKey, bytes32 orderId) external {
        _storeSubscription(_targetHook, poolKey, orderId);
    }

    /// @notice Manually unsubscribe an order (RN state only).
    function unsubscribe(bytes32 orderId) external onlyOwner {
        _removeOrder(orderId);
    }

    /// @notice Manually trigger callbacks (RN state only — emits Callback on RN, NOT delivered by infra).
    /// @dev Useful for local testing. On-chain, only Callbacks emitted from the RVM are delivered.
    function batchExecute(bytes32[] calldata orderIds) external {
        for (uint256 i = 0; i < orderIds.length; i++) {
            bytes32 orderId = orderIds[i];
            Subscription memory sub = subscriptions[orderId];
            if (sub.active) {
                _triggerExecution(sub.targetHook, sub.poolKey, orderId);
            }
        }
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

    // ============ Internal: event handlers ============

    function _handleCron() internal {
        uint256 limit = activeOrderIds.length;
        if (limit > 10) limit = 10;

        for (uint256 i = 0; i < limit; i++) {
            bytes32 orderId = activeOrderIds[i];
            Subscription memory sub = subscriptions[orderId];
            if (!sub.active) continue;

            _triggerExecution(sub.targetHook, sub.poolKey, orderId);
        }
    }

    function _handleOrderRegistered(IReactive.LogRecord calldata log) internal {
        bytes32 orderId = bytes32(log.topic_1);

        // Skip if already registered (idempotent)
        if (subscriptions[orderId].active) return;

        // Decode PoolKey components from event data
        (address c0, address c1, uint24 fee, int24 tickSpacing, address hooks) =
            abi.decode(log.data, (address, address, uint24, int24, address));

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: IHooks(hooks)
        });

        _storeSubscription(hooks, poolKey, orderId);
    }

    function _handleOrderRemoved(IReactive.LogRecord calldata log) internal {
        bytes32 orderId = bytes32(log.topic_1);
        if (subscriptions[orderId].active) {
            _removeOrder(orderId);
        }
    }

    // ============ Internal: state management ============

    function _triggerExecution(address _targetHook, PoolKey memory poolKey, bytes32 orderId) internal {
        // NOTE: Reactive infra overwrites the first address arg in the payload
        // with the RVM ID (= deployer EOA). The address(this) here is just a placeholder.
        bytes memory payload =
            abi.encodeWithSelector(ITWAMMHook.executeTWAMMChunkReactive.selector, address(this), poolKey, orderId);

        emit Callback(UNICHAIN_SEPOLIA_CHAIN_ID, _targetHook, CALLBACK_GAS_LIMIT, payload);
        emit ExecutionTriggered(poolKey.toId(), orderId, block.timestamp);
    }

    function _storeSubscription(address _targetHook, PoolKey memory poolKey, bytes32 orderId) internal {
        PoolId poolId = poolKey.toId();

        subscriptions[orderId] = Subscription({
            targetHook: _targetHook,
            poolKey: poolKey,
            orderId: orderId,
            lastExecutionTime: 0,
            active: true
        });

        orderIndex[orderId] = activeOrderIds.length;
        activeOrderIds.push(orderId);

        emit Subscribed(poolId, orderId);
    }

    function _removeOrder(bytes32 orderId) internal {
        Subscription storage sub = subscriptions[orderId];
        if (!sub.active) return;

        PoolId poolId = sub.poolKey.toId();
        sub.active = false;

        uint256 index = orderIndex[orderId];
        uint256 lastIndex = activeOrderIds.length - 1;
        if (index != lastIndex) {
            bytes32 lastOrderId = activeOrderIds[lastIndex];
            activeOrderIds[index] = lastOrderId;
            orderIndex[lastOrderId] = index;
        }
        activeOrderIds.pop();
        delete orderIndex[orderId];

        emit Unsubscribed(poolId, orderId);
    }
}
