// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/interfaces/IPoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "@uniswap/v4-core/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/interfaces/IHooks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TWAMMHook} from "../src/TWAMMHook.sol";
import {TestToken} from "../src/TestToken.sol";

/**
 * @title E2E Reactive TWAMM Test
 * @notice Full end-to-end test across Unichain + Lasna. Run in 3 steps:
 *
 *  Step 1 (Unichain): Deploy tokens, init pool, add liquidity, submit order
 *    forge script script/E2EReactiveTest.s.sol:E2E_Step1_SubmitOrder \
 *      --rpc-url $UNICHAIN_RPC --broadcast -vvv
 *
 *  Step 2 (Lasna): Subscribe the order + batchExecute to trigger callback
 *    ORDER_ID=<from step 1> TOKEN0=<from step 1> TOKEN1=<from step 1> \
 *    forge script script/E2EReactiveTest.s.sol:E2E_Step2_ReactiveExecute \
 *      --rpc-url https://lasna-rpc.rnk.dev --broadcast -vvv
 *
 *  Step 3 (Unichain): Check if the callback landed
 *    ORDER_ID=<from step 1> \
 *    forge script script/E2EReactiveTest.s.sol:E2E_Step3_VerifyDelivery \
 *      --rpc-url $UNICHAIN_RPC -vvv
 *
 *  Required env: PRIVATE_KEY, TWAMM_HOOK, LASNA_REACTIVE_TWAMM
 */

// ================================================================
//  Step 1: Unichain - submit a real TWAMM order
// ================================================================

contract E2E_Step1_SubmitOrder is Script {
    address constant DEFAULT_POOL_MANAGER = 0x00B036B58a818B1BC34d502D3fE730Db729e62AC;

    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint160 constant SQRT_PRICE_X96 = 79228162514264337593543950336; // 1:1

    function run() external {
        uint256 pk = _loadPk();
        address deployer = vm.addr(pk);
        address hookAddr = vm.envAddress("TWAMM_HOOK");
        address poolManager = _envOr("UNICHAIN_POOL_MANAGER", DEFAULT_POOL_MANAGER);

        console2.log("========================================");
        console2.log("  E2E Step 1: Submit Order (Unichain)");
        console2.log("========================================");
        console2.log("Hook:", hookAddr);
        console2.log("Deployer:", deployer);

        vm.startBroadcast(pk);

        // Deploy fresh test tokens
        bytes32 saltA = keccak256(abi.encodePacked("e2e-a", block.chainid, block.timestamp));
        bytes32 saltB = keccak256(abi.encodePacked("e2e-b", block.chainid, block.timestamp));
        TestToken tokenA = new TestToken{salt: saltA}("E2E Token A", "E2EA");
        TestToken tokenB = new TestToken{salt: saltB}("E2E Token B", "E2EB");

        (address token0, address token1) =
            address(tokenA) < address(tokenB) ? (address(tokenA), address(tokenB)) : (address(tokenB), address(tokenA));

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hookAddr)
        });

        // Init pool
        IPoolManager(poolManager).initialize(key, SQRT_PRICE_X96);
        console2.log("Pool initialized");

        // Mint tokens
        tokenA.mint(deployer, 10_000 ether);
        tokenB.mint(deployer, 10_000 ether);

        // Add liquidity so swaps can execute
        PoolModifyLiquidityTest liqRouter = new PoolModifyLiquidityTest(IPoolManager(poolManager));
        IERC20(token0).approve(address(liqRouter), type(uint256).max);
        IERC20(token1).approve(address(liqRouter), type(uint256).max);
        liqRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -887220, tickUpper: 887220, liquidityDelta: int256(uint256(5_000e18)), salt: bytes32(0)
            }),
            ""
        );
        console2.log("Liquidity added");

        // Submit TWAMM order: 10 tokens over 5 minutes = 5 chunks
        TestToken inToken = token0 == address(tokenA) ? tokenA : tokenB;
        Currency tokenIn = Currency.wrap(address(inToken));
        Currency tokenOut = Currency.wrap(token0 == address(tokenA) ? address(tokenB) : address(tokenA));

        inToken.approve(hookAddr, 10 ether);
        bytes32 orderId = TWAMMHook(hookAddr).submitTWAMMOrder(key, 10 ether, 5 minutes, tokenIn, tokenOut, 0);

        vm.stopBroadcast();

        // NOTE: The orderId logged below is from simulation and will NOT match
        // the on-chain orderId (which depends on block.timestamp at mining time).
        // Use the extract command below to get the real orderId from the tx receipt.
        console2.log("");
        console2.log("========================================");
        console2.log("  ORDER SUBMITTED");
        console2.log("========================================");
        console2.log("TOKEN0:", token0);
        console2.log("TOKEN1:", token1);
        console2.log("");
        console2.log("WARNING: The ORDER_ID from simulation != on-chain ORDER_ID");
        console2.log("Extract the real ORDER_ID from the broadcast receipt:");
        console2.log("");
        console2.log(
            "  ORDER_ID=$(cast receipt <SUBMIT_TX_HASH> --rpc-url $UNICHAIN_RPC --json | jq -r '.logs[] | select(.topics[0]==\"0xd62d1062fda743ecb668340496b32002059e7be8e51ee5b543eaf7b01e626d22\") | .topics[1]')"
        );
        console2.log("");
        console2.log("The submit tx is the LAST transaction in the broadcast output above.");
        console2.log("");
        console2.log("Then run Step 2 on Lasna:");
        console2.log("  ORDER_ID=$ORDER_ID TOKEN0=<above> TOKEN1=<above> \\");
        console2.log("  forge script script/E2EReactiveTest.s.sol:E2E_Step2_ReactiveExecute \\");
        console2.log("    --rpc-url https://lasna-rpc.rnk.dev --broadcast --slow -vvv");
    }

    function _envOr(string memory key, address fb) internal view returns (address) {
        try vm.envAddress(key) returns (address a) {
            return a;
        } catch {
            return fb;
        }
    }

    function _loadPk() internal view returns (uint256) {
        string memory raw = vm.envString("PRIVATE_KEY");
        bytes memory b = bytes(raw);
        if (b.length >= 2 && b[0] == bytes1("0") && (b[1] == bytes1("x") || b[1] == bytes1("X"))) {
            return vm.parseUint(raw);
        }
        return vm.parseUint(string(abi.encodePacked("0x", raw)));
    }
}

// ================================================================
//  Step 2: Verify Reactive auto-registration
// ================================================================
//
//  With the refactored ReactiveTWAMM, orders are auto-registered in the
//  RVM when it observes OrderRegisteredReactive events from Unichain.
//  No manual subscribe() or batchExecute() is needed — the CRON trigger
//  in react() handles execution automatically.
//
//  This step now just checks that the Lasna contract is healthy.

interface IReactiveTWAMM {
    function owner() external view returns (address);
    function targetHook() external view returns (address);
    function getActiveOrderCount() external view returns (uint256);
}

contract E2E_Step2_ReactiveExecute is Script {
    function run() external view {
        address reactiveAddr = vm.envAddress("LASNA_REACTIVE_TWAMM");
        address hookAddr = vm.envAddress("TWAMM_HOOK");

        IReactiveTWAMM reactive = IReactiveTWAMM(reactiveAddr);

        console2.log("========================================");
        console2.log("  E2E Step 2: Verify Reactive (Lasna)");
        console2.log("========================================");
        console2.log("ReactiveTWAMM:", reactiveAddr);
        console2.log("Target hook:", hookAddr);
        console2.log("Owner:", reactive.owner());
        console2.log("Configured target hook:", reactive.targetHook());
        console2.log("Balance:", reactiveAddr.balance);
        console2.log("Active orders (RN side):", reactive.getActiveOrderCount());
        console2.log("");
        console2.log("NOTE: Orders auto-register in the RVM when OrderRegisteredReactive");
        console2.log("events are observed from Unichain. The CRON subscription triggers");
        console2.log("react() which emits Callback events delivered by Reactive infra.");
        console2.log("");
        console2.log("Wait ~60s for Reactive infra to deliver, then run Step 3:");
        console2.log("  ORDER_ID=<from step 1> \\");
        console2.log("  forge script script/E2EReactiveTest.s.sol:E2E_Step3_VerifyDelivery \\");
        console2.log("    --rpc-url $UNICHAIN_RPC -vvv");
    }
}

// ================================================================
//  Step 3: Unichain - verify callback delivery
// ================================================================

contract E2E_Step3_VerifyDelivery is Script {
    function run() external view {
        address hookAddr = vm.envAddress("TWAMM_HOOK");
        bytes32 orderId = vm.envBytes32("ORDER_ID");

        TWAMMHook hook = TWAMMHook(hookAddr);

        console2.log("========================================");
        console2.log("  E2E Step 3: Verify Delivery (Unichain)");
        console2.log("========================================");
        console2.log("TWAMMHook:", hookAddr);
        console2.log("Order ID:");
        console2.logBytes32(orderId);
        console2.log("");

        // Callback config
        console2.log("-- Callback Config --");
        console2.log("reactiveCallbackProxy:", hook.reactiveCallbackProxy());
        console2.log("authorizedReactiveRvmId:", hook.authorizedReactiveRvmId());
        console2.log("");

        // Order state
        console2.log("-- Order State --");
        (uint256 executed, uint256 total) = hook.getOrderProgress(orderId);
        console2.log("Executed chunks:", executed);
        console2.log("Total chunks:", total);
        console2.log("");

        // Diagnosis
        console2.log("-- Diagnosis --");
        if (total == 0) {
            console2.log("FAIL: Order not found on Unichain");
            console2.log("  Check that ORDER_ID matches Step 1 output");
        } else if (executed == 0) {
            console2.log("FAIL: Zero chunks executed");
            console2.log("  Reactive callback did NOT reach Unichain.");
            console2.log("");
            console2.log("  Checklist:");
            console2.log("  1. Did Step 2 batchExecute emit a Callback event? (check -vvv trace)");
            console2.log("  2. Does authorizedReactiveRvmId match the DEPLOYER EOA?");
            console2.log(
                "     (Reactive infra overwrites the first payload arg with deployer EOA, not the contract address)"
            );
            address rvmId = hook.authorizedReactiveRvmId();
            address deployer;
            try vm.envAddress("DEPLOYER_ADDRESS") returns (address a) {
                deployer = a;
            } catch {}
            if (deployer != address(0)) {
                if (rvmId != deployer) {
                    console2.log("  >>> MISMATCH! authorizedReactiveRvmId != DEPLOYER_ADDRESS");
                    console2.log("      Hook expects:", rvmId);
                    console2.log("      Deployer EOA:", deployer);
                    console2.log("  >>> Fix: call setReactiveCallbackConfig(callbackProxy, DEPLOYER_ADDRESS)");
                } else {
                    console2.log("  rvmId matches deployer EOA (OK)");
                }
            }
            console2.log("  3. Is Reactive infra delivering callbacks on Unichain Sepolia?");
            console2.log("  4. Does the Lasna contract have enough balance for gas?");
        } else if (executed < total) {
            console2.log("PARTIAL: %d/%d chunks executed", executed, total);
            console2.log("  Reactive flow is working but incomplete.");
            console2.log("  Run Step 2 again or wait for cron to fire more.");
        } else {
            console2.log("SUCCESS: All %d/%d chunks executed!", executed, total);
            console2.log("  Reactive callback flow is fully operational.");
            uint256 claimable = hook.claimableOutput(orderId);
            console2.log("  Claimable output:", claimable);
        }
        console2.log("");
        console2.log("========================================");
    }
}
