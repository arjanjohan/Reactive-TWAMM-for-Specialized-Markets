// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/types/Currency.sol";

/**
 * @title ITWAMMHook
 * @notice Interface for the TWAMM Hook
 */
interface ITWAMMHook {
    struct TWAMMOrder {
        address owner;
        Currency tokenIn;
        Currency tokenOut;
        uint256 totalAmount;
        uint256 executedAmount;
        uint256 totalChunks;
        uint256 executedChunks;
        uint256 startTime;
        uint256 endTime;
        uint256 lastExecutionTime;
        uint256 minOutputPerChunk;
        bool active;
        bool cancelled;
    }

    // View functions
    function poolManager() external view returns (address);
    function twammEnabled(PoolId poolId) external view returns (bool);
    function getOrder(bytes32 orderId) external view returns (TWAMMOrder memory);
    function getOrderProgress(bytes32 orderId) external view returns (uint256 executed, uint256 total);

    // State changing
    function submitTWAMMOrder(
        PoolKey calldata key,
        uint256 amount,
        uint256 duration,
        Currency tokenIn,
        Currency tokenOut,
        uint256 minOutputPerChunk
    ) external returns (bytes32 orderId);

    function cancelTWAMMOrder(bytes32 orderId) external;
    function executeTWAMMChunk(PoolKey calldata key, bytes32 orderId) external;
    function executeTWAMMChunkReactive(address reactiveRvmId, PoolKey calldata key, bytes32 orderId) external;
    function claimTWAMMOutput(bytes32 orderId) external returns (uint256 amountOut);
    function claimableOutput(bytes32 orderId) external view returns (uint256 amountOut);
}
