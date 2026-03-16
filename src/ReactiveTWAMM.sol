// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ITWAMMHook} from "./interfaces/ITWAMMHook.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/types/PoolId.sol";
import {AbstractReactive} from "reactive-lib/abstract-base/AbstractReactive.sol";
import {IReactive} from "reactive-lib/interfaces/IReactive.sol";

/**
 * @title ReactiveTWAMM
 * @notice Reactive Network contract that monitors and triggers TWAMM execution
 * @dev Inherits from AbstractReactive for proper Reactive Network integration
 *      (vm detection, payment handling, subscription management)
 */
contract ReactiveTWAMM is AbstractReactive {
    using PoolIdLibrary for PoolKey;

    uint256 public constant UNICHAIN_SEPOLIA_CHAIN_ID = 1301;
    uint64 public constant CALLBACK_GAS_LIMIT = 1_200_000;
    uint256 public constant CRON10_TOPIC0 = 0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687;

    // ============ Errors ============
    error ReactiveTWAMM__InvalidOrder();
    error ReactiveTWAMM__ConditionsNotMet();

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
        bool usePriceCondition;
        address priceFeed;
        uint256 targetPrice;
        bool aboveTarget;
    }

    // ============ State ============
    address public owner;
    mapping(bytes32 => Subscription) public subscriptions;
    bytes32[] public activeOrderIds;
    mapping(bytes32 => uint256) public orderIndex;
    bool public cronSubscribed;

    // ============ Modifiers ============
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() payable {
        owner = msg.sender;
    }

    // ============ External Functions ============

    function subscribe(address targetHook, PoolKey calldata poolKey, bytes32 orderId) external {
        _storeSubscription(targetHook, poolKey, orderId, false, address(0), 0, false);
    }

    function subscribeWithPriceCondition(
        address targetHook,
        PoolKey calldata poolKey,
        bytes32 orderId,
        address priceFeed,
        uint256 targetPrice,
        bool aboveTarget
    ) external onlyOwner {
        _storeSubscription(targetHook, poolKey, orderId, true, priceFeed, targetPrice, aboveTarget);
    }

    function unsubscribe(bytes32 orderId) external onlyOwner {
        Subscription storage sub = subscriptions[orderId];
        if (!sub.active) revert ReactiveTWAMM__InvalidOrder();

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

        emit Unsubscribed(sub.poolKey.toId(), orderId);
    }

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

    function react(IReactive.LogRecord calldata log) external vmOnly {
        if (log.topic_0 != CRON10_TOPIC0) return;

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

    /// @notice Bootstrap cron subscription with REACTIVE_IGNORE wildcards.
    function ensureCronSubscription() external onlyOwner rnOnly {
        require(!cronSubscribed, "Already subscribed");
        service.subscribe(
            block.chainid,
            address(service),
            CRON10_TOPIC0,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
        cronSubscribed = true;
    }


    // ============ View Functions ============

    function checkExecutionConditions(bytes32 orderId) public view returns (bool canExecute) {
        Subscription memory sub = subscriptions[orderId];
        if (!sub.active) return false;
        return true;
    }

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

    function _triggerExecution(address targetHook, PoolKey memory poolKey, bytes32 orderId) internal {
        // NOTE: Reactive Network infra overwrites the first address arg in the payload
        // with the RVM ID (= deployer EOA). The address(this) here is just a placeholder.
        // The destination hook must set authorizedReactiveRvmId to the deployer EOA, not this contract.
        bytes memory payload =
            abi.encodeWithSelector(ITWAMMHook.executeTWAMMChunkReactive.selector, address(this), poolKey, orderId);

        emit Callback(UNICHAIN_SEPOLIA_CHAIN_ID, targetHook, CALLBACK_GAS_LIMIT, payload);
        emit ExecutionTriggered(poolKey.toId(), orderId, block.timestamp);
    }

    function _storeSubscription(
        address targetHook,
        PoolKey calldata poolKey,
        bytes32 orderId,
        bool usePriceCondition,
        address priceFeed,
        uint256 targetPrice,
        bool aboveTarget
    ) internal {
        PoolId poolId = poolKey.toId();

        subscriptions[orderId] = Subscription({
            targetHook: targetHook,
            poolKey: poolKey,
            orderId: orderId,
            lastExecutionTime: 0,
            active: true,
            usePriceCondition: usePriceCondition,
            priceFeed: priceFeed,
            targetPrice: targetPrice,
            aboveTarget: aboveTarget
        });

        orderIndex[orderId] = activeOrderIds.length;
        activeOrderIds.push(orderId);

        emit Subscribed(poolId, orderId);
    }
}
