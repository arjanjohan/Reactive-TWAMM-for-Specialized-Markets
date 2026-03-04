# 🎯 Reactive TWAMM for Specialized Markets

Time-weighted automated market maker (TWAMM) hook for Uniswap v4 that uses Reactive Network to automate large trades in illiquid specialized markets (RWA, prediction markets, exotic derivatives) on Unichain's low-latency chain.

## 💡 Hook Idea

From Atrium Academy: Build hooks that focus on **Specialized Markets** - non-standard AMM use cases that go beyond basic token swaps.

**What counts as "Specialized Markets":**
- Prediction markets
- Derivatives (options, perps)
- Real World Assets (RWA)
- Custom curves for specific asset types
- Time-weighted execution strategies
- Cross-chain/market arbitrage


## Reactive TWAMM for Specialized Markets

**Concept:**
Time-Weighted AMM hook that uses Reactive Network to automate large trades in illiquid markets (RWA, prediction markets, exotic derivatives).

**Why it wins:**
- ✅ Directly uses Reactive Network for automation (their exact use case)
- ✅ Leverages Unichain's 200ms latency for execution
- ✅ Fits "Specialized Markets" theme perfectly
- ✅ Matches Reactive's blog post example exactly
- ✅ Your Canopy experience with automated strategies transfers

**How it works:**
1. User initiates large trade in illiquid pool
2. Hook breaks trade into smaller chunks over time (TWAMM)
3. Reactive contracts monitor price on other chains
4. When conditions met, Reactive triggers execution via Unichain's low latency
5. Gas-efficient batching via Reactive's parallel EVM

**Sponsor alignment:**
- Reactive: Cross-chain automation + TWAMM execution
- Unichain: Low-latency execution + v4 hooks

## 🛠️ Technical Architecture

### Components:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  User Frontend  │───▶│  Uniswap v4 Hook │◀───│  Reactive       │
│                 │     │  (TWAMM Logic)   │     │  Contract       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                 │                        │
                                 ▼                        ▼
                        ┌──────────────────┐     ┌──────────────────┐
                        │   Unichain       │     │  Cross-Chain     │
                        │   Uniswap v4     │     │  Price Feeds     │
                        └──────────────────┘     └──────────────────┘
```

1. **Uniswap v4 Hook Contract**
   - `afterSwap()` - Track trade chunks
   - `afterInitialize()` - Set up TWAMM params
   - Custom: `executeTWAMMChunk()` - Called by Reactive

2. **Reactive Smart Contract**
   - Listens for: Price events, time intervals
   - Triggers: TWAMM execution on Unichain
   - Cross-chain: Monitors Base/Arbitrum for reference prices

3. **Frontend (Optional for hackathon)**
   - Show TWAMM progress
   - Display cross-chain price feeds
   - Reactive execution logs

### Data Flow:

```
User deposits large trade
    ↓
v4 Hook stores TWAMM params
    ↓
Reactive monitors (time + price on other chains)
    ↓
Conditions met → Reactive triggers execution
    ↓
Unichain hook executes next chunk
    ↓
Repeat until trade complete
```

### Smart Contracts

#### 1. TWAMMHook.sol (Uniswap v4)

**Functions:**
```solidity
// Initialize TWAMM for a pool
function afterInitialize(PoolKey, uint160, int24, bytes calldata) external override;

// Intercept swaps to track TWAMM chunks
function afterSwap(
    address,
    PoolKey calldata key,
    IPoolManager.SwapParams calldata params,
    BalanceDelta delta,
    bytes calldata hookData
) external override returns (bytes4, int128);

// Core TWAMM logic
function executeTWAMMChunk(PoolKey calldata key, bytes32 orderId) external;
function submitTWAMMOrder(PoolKey calldata key, uint256 amount, uint256 duration) external payable;
function cancelTWAMMOrder(bytes32 orderId) external;
```

**Storage:**
```solidity
struct TWAMMOrder {
    address owner;
    uint256 totalAmount;
    uint256 executedAmount;
    uint256 totalChunks;
    uint256 executedChunks;
    uint256 startTime;
    uint256 endTime;
    uint256 lastExecutionTime;
    bool active;
}

mapping(bytes32 => TWAMMOrder) public orders;
mapping(PoolId => bool) public twammEnabled;
```

#### 2. ReactiveTWAMM.sol (Reactive Network)

**Functions:**
```solidity
// Reactive callback - triggered when conditions met
function executeTWAMMChunk(bytes32 orderId) external;

// Subscribe to events
function subscribeToPool(address pool, bytes32 orderId) external;

// Check if conditions met
function checkExecutionConditions(
    bytes32 orderId,
    uint256 currentPrice,
    uint256 targetTime
) external view returns (bool);
```

**Reactive pattern:**
```solidity
// On Reactive Network
function checkAndExecute(bytes32 orderId, address targetHook) external {
    require(checkExecutionConditions(orderId), "Conditions not met");
    // Trigger cross-chain execution
    reactiveCallback(targetHook, abi.encodeWithSelector(
        TWAMMHook.executeTWAMMChunk.selector,
        orderId
    ));
}
```

## 🤔 Open Questions

1. Which specialized market to focus on? Options:
   - RWA (Real World Assets like real estate tokens)
   - Prediction markets
   - Exotic derivatives (volatility, baskets)
   - Low-liquidity long-tail assets

2. Simple frontend or just contracts?