// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ReactiveTWAMM} from "../src/ReactiveTWAMM.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/interfaces/IHooks.sol";

contract ReactiveTWAMMTest is Test {
    ReactiveTWAMM internal reactive;

    address internal owner = address(this);
    address internal callback = address(0xBEEF);
    address internal targetHook = address(0x1234);

    bytes32 internal constant ORDER_ID = keccak256("order-1");

    PoolKey internal poolKey = PoolKey({
        currency0: Currency.wrap(address(0x11)),
        currency1: Currency.wrap(address(0x22)),
        fee: 3000,
        tickSpacing: 60,
        hooks: IHooks(address(0))
    });

    function setUp() public {
        reactive = new ReactiveTWAMM(callback);
    }

    function test_SubscribeAndExecuteViaReactiveCallback() public {
        reactive.subscribe(targetHook, poolKey, ORDER_ID);

        vm.prank(callback);
        reactive.executeTWAMMChunk(ORDER_ID);

        ReactiveTWAMM.Subscription memory sub = reactive.getSubscription(ORDER_ID);
        assertTrue(sub.active);
        assertGt(sub.lastExecutionTime, 0);
    }

    function test_RevertIf_ExecuteCalledByNonCallback() public {
        reactive.subscribe(targetHook, poolKey, ORDER_ID);

        vm.prank(address(0xCAFE));
        vm.expectRevert(ReactiveTWAMM.ReactiveTWAMM__UnauthorizedCallback.selector);
        reactive.executeTWAMMChunk(ORDER_ID);
    }

    function test_BatchExecute_DoesNotRevertForActiveSubscription() public {
        reactive.subscribe(targetHook, poolKey, ORDER_ID);

        bytes32[] memory ids = new bytes32[](1);
        ids[0] = ORDER_ID;

        reactive.batchExecute(ids);

        // Subscription remains active and discoverable.
        ReactiveTWAMM.Subscription memory sub = reactive.getSubscription(ORDER_ID);
        assertTrue(sub.active);
    }
}
