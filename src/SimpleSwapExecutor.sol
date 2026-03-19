// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/types/BalanceDelta.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SimpleSwapExecutor is IUnlockCallback {
    IPoolManager public immutable poolManager;

    error OnlyPoolManager();
    error InvalidOperation();
    error InvalidTokenIn();
    error SlippageTooHigh();

    uint256 internal constant OP_SWAP = 1;

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    function swapExactIn(
        PoolKey calldata key,
        Currency tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        uint160 sqrtPriceLimitX96
    ) external returns (uint256 amountOut) {
        bool zeroForOne;
        if (Currency.unwrap(tokenIn) == Currency.unwrap(key.currency0)) {
            zeroForOne = true;
        } else if (Currency.unwrap(tokenIn) == Currency.unwrap(key.currency1)) {
            zeroForOne = false;
        } else {
            revert InvalidTokenIn();
        }

        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: sqrtPriceLimitX96
        });

        bytes memory result = poolManager.unlock(abi.encode(OP_SWAP, msg.sender, key, params, minAmountOut));

        amountOut = abi.decode(result, (uint256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();

        (uint256 op, address payer, PoolKey memory key, IPoolManager.SwapParams memory params, uint256 minAmountOut) =
            abi.decode(data, (uint256, address, PoolKey, IPoolManager.SwapParams, uint256));

        if (op != OP_SWAP) revert InvalidOperation();

        BalanceDelta delta = poolManager.swap(key, params, bytes(""));

        int128 delta0 = delta.amount0();
        int128 delta1 = delta.amount1();

        if (delta0 < 0) {
            uint256 amount0In = uint256(uint128(-delta0));
            poolManager.sync(key.currency0);
            require(
                IERC20(Currency.unwrap(key.currency0)).transferFrom(payer, address(poolManager), amount0In), "transfer0"
            );
            poolManager.settle();
        }

        if (delta1 < 0) {
            uint256 amount1In = uint256(uint128(-delta1));
            poolManager.sync(key.currency1);
            require(
                IERC20(Currency.unwrap(key.currency1)).transferFrom(payer, address(poolManager), amount1In), "transfer1"
            );
            poolManager.settle();
        }

        uint256 amountOut;
        if (params.zeroForOne) {
            if (delta1 <= 0) revert SlippageTooHigh();
            amountOut = uint256(uint128(delta1));
            if (amountOut < minAmountOut) revert SlippageTooHigh();
            poolManager.take(key.currency1, payer, amountOut);
        } else {
            if (delta0 <= 0) revert SlippageTooHigh();
            amountOut = uint256(uint128(delta0));
            if (amountOut < minAmountOut) revert SlippageTooHigh();
            poolManager.take(key.currency0, payer, amountOut);
        }

        return abi.encode(amountOut);
    }
}
