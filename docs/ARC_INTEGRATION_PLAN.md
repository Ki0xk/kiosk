# Arc Bridge Kit Integration Plan

## Executive Summary

Integrate Circle's Arc Bridge Kit to enable Ki0xk users to receive real USDC on their preferred blockchain, while using Yellow Network as the off-chain accounting layer.

**Key Insight**: Yellow doesn't support all chains, so we use Arc as the universal liquidity hub to bridge USDC to any supported EVM chain.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Ki0xk Architecture                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────────┐    ┌────────────────────────┐    │
│  │   CUSTOMER   │    │    Ki0xk KIOSK   │    │    YELLOW NETWORK      │    │
│  │              │    │                  │    │    (Accounting Layer)  │    │
│  │  Cash Input  │───▶│  Records tx in   │───▶│  - Off-chain ledger    │    │
│  │  QR / ENS    │    │  Yellow as       │    │  - Instant internal    │    │
│  │  Chain Select│    │  ytest.usd       │    │  - Zero gas            │    │
│  └──────────────┘    └────────┬─────────┘    └────────────────────────┘    │
│                               │                                             │
│                               ▼                                             │
│                    ┌──────────────────────┐                                 │
│                    │   ARC BRIDGE KIT     │                                 │
│                    │   (Settlement Layer) │                                 │
│                    │                      │                                 │
│                    │  Arc Testnet USDC    │                                 │
│                    │         │            │                                 │
│                    │    CCTP Bridge       │                                 │
│                    │         │            │                                 │
│                    └─────────┼────────────┘                                 │
│                              │                                              │
│            ┌─────────────────┼─────────────────┐                           │
│            ▼                 ▼                 ▼                            │
│     ┌───────────┐     ┌───────────┐     ┌───────────┐                      │
│     │   Base    │     │ Arbitrum  │     │  Polygon  │   ... more chains    │
│     │  Sepolia  │     │  Sepolia  │     │   Amoy    │                      │
│     │   USDC    │     │   USDC    │     │   USDC    │                      │
│     └─────┬─────┘     └─────┬─────┘     └─────┬─────┘                      │
│           │                 │                 │                            │
│           └─────────────────┼─────────────────┘                            │
│                             ▼                                              │
│                    ┌──────────────────┐                                    │
│                    │  USER'S WALLET   │                                    │
│                    │  (Real USDC)     │                                    │
│                    └──────────────────┘                                    │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer Responsibilities

### 1. Yellow Network (Accounting Layer)
- **Purpose**: Off-chain transaction recording, instant internal transfers
- **Token**: `ytest.usd` (sandbox) / USDC (production)
- **Operations**:
  - Record all kiosk transactions
  - Track admin balances
  - Internal transfers between kiosk operators
  - PIN wallet accounting
- **Why**: Zero gas, instant, perfect for high-frequency small transactions

### 2. Arc Bridge Kit (Settlement Layer)
- **Purpose**: Real USDC liquidity and cross-chain bridging
- **Token**: Real USDC on Arc Testnet
- **Operations**:
  - Hold kiosk operator's USDC liquidity
  - Bridge to user's selected chain via CCTP
  - Collect transfer fees
- **Why**: Universal liquidity hub, supports 18+ EVM chains

### 3. ENS (Resolution Layer)
- **Purpose**: Human-readable addresses
- **Operations**:
  - Resolve ENS names to addresses
  - Already integrated in CLI

---

## Supported Target Chains (Testnet - EVM Only)

| Chain | Chain ID | Bridge Kit Name |
|-------|----------|-----------------|
| Arc Testnet | TBD | `Arc_Testnet` |
| Base Sepolia | 84532 | `Base_Sepolia` |
| Ethereum Sepolia | 11155111 | `Ethereum_Sepolia` |
| Arbitrum Sepolia | 421614 | `Arbitrum_Sepolia` |
| Polygon Amoy | 80002 | `Polygon_Amoy_Testnet` |
| Optimism Sepolia | 11155420 | `OP_Sepolia` |
| Avalanche Fuji | 43113 | `Avalanche_Fuji` |
| Linea Sepolia | 59141 | `Linea_Sepolia` |

*Note: Solana excluded per requirements (ENS is EVM-only)*

---

## Fee Structure

### Transfer Fee
- **Rate**: 0.001% of transaction amount
- **Example**: $100 transfer → $0.001 fee
- **Minimum**: Consider a floor (e.g., $0.0001) for tiny transactions
- **Circle's Cut**: 10% of collected fees go to Circle

### Fee Calculation
```typescript
const FEE_RATE = 0.00001; // 0.001%
const MIN_FEE = 0.0001;   // Minimum fee in USDC

function calculateFee(amount: number): number {
  const fee = amount * FEE_RATE;
  return Math.max(fee, MIN_FEE);
}
```

### Fee Display
User sees before confirming:
```
Amount:     10.00 USDC
Fee:         0.0001 USDC (0.001%)
You receive: 9.9999 USDC
Chain:       Base Sepolia
```

---

## User Flow

### Flow A: Direct Transfer (Has Wallet)

```
1. Customer inserts $10 cash
2. Scans QR code / enters ENS / types address
3. Selects target chain (e.g., "Base")
4. Confirms transaction details + fee
5. Kiosk:
   a. Records in Yellow (accounting)
   b. Initiates Arc Bridge transfer
6. Customer receives 9.9999 USDC on Base (~30-60 seconds)
```

### Flow B: PIN Wallet (No Wallet Yet)

```
1. Customer inserts $10 cash
2. Selects "No wallet? Get a PIN"
3. Kiosk generates PIN, stores in Yellow accounting
4. Prints receipt with PIN
5. Later, customer:
   a. Downloads wallet app
   b. Visits ki0xk.com or returns to kiosk
   c. Enters PIN + wallet address + selects chain
   d. Kiosk bridges USDC to their wallet
```

---

## Technical Implementation

### New Dependencies

```bash
npm install @circle-fin/bridge-kit @circle-fin/adapter-viem-v2
```

### New Files

```
src/
├── arc/
│   ├── bridge.ts       # Bridge Kit wrapper
│   ├── chains.ts       # Supported chains config
│   └── fees.ts         # Fee calculation
├── settlement.ts       # Orchestrates Yellow + Arc
└── cli.ts              # Updated with chain selection
```

### Environment Variables

```env
# Existing
PRIVATE_KEY=0x...
CLEARNODE_WS_URL=wss://clearnet-sandbox.yellow.com/ws

# New for Arc
ARC_PRIVATE_KEY=0x...       # Can be same as PRIVATE_KEY
FEE_RECIPIENT_ADDRESS=0x... # Where fees are collected
```

### Core Bridge Function

```typescript
// src/arc/bridge.ts
import { BridgeKit } from "@circle-fin/bridge-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";

const kit = new BridgeKit();

export async function bridgeToChain(
  destinationAddress: string,
  targetChain: string,
  amount: string,
  feeRecipient: string
): Promise<BridgeResult> {
  const adapter = createViemAdapterFromPrivateKey({
    privateKey: process.env.ARC_PRIVATE_KEY!,
  });

  const fee = calculateFee(parseFloat(amount));
  const netAmount = (parseFloat(amount) - fee).toFixed(6);

  const result = await kit.bridge({
    from: { adapter, chain: "Arc_Testnet" },
    to: {
      adapter,
      chain: targetChain,
      recipientAddress: destinationAddress
    },
    amount: netAmount,
    config: {
      customFee: {
        value: fee.toString(),
        recipientAddress: feeRecipient,
      },
    },
  });

  return result;
}
```

### Settlement Orchestrator

```typescript
// src/settlement.ts
import { getClearNode } from "./clearnode.js";
import { bridgeToChain } from "./arc/bridge.js";
import { resolveDestination } from "./ens.js";

export async function settleToChain(
  destination: string,      // Address or ENS
  targetChain: string,      // "Base_Sepolia", etc.
  amountUsd: string         // "10.00"
): Promise<SettlementResult> {
  // 1. Resolve destination (ENS if needed)
  const resolvedAddress = await resolveDestination(destination);
  if (!resolvedAddress) throw new Error("Invalid destination");

  // 2. Record in Yellow (accounting)
  const clearNode = getClearNode();
  await clearNode.transfer(
    resolvedAddress,
    "ytest.usd",
    amountUsd
  );

  // 3. Bridge real USDC via Arc
  const bridgeResult = await bridgeToChain(
    resolvedAddress,
    targetChain,
    amountUsd,
    process.env.FEE_RECIPIENT_ADDRESS!
  );

  return {
    yellowTxId: "...",
    bridgeTxHash: bridgeResult.txHash,
    destinationChain: targetChain,
    amount: amountUsd,
    fee: calculateFee(parseFloat(amountUsd)),
  };
}
```

### CLI Update

```typescript
// Updated npm run cli settle command
case "settle": {
  const dest = args[1] || await prompt("Destination (address/ENS): ");
  const chain = args[2] || await promptChainSelection();
  const amt = args[3] || await prompt("Amount (default 0.01): ") || "0.01";

  await settleToChain(dest, chain, amt);
  break;
}

async function promptChainSelection(): Promise<string> {
  console.log("\nSelect target chain:");
  console.log("  1. Base Sepolia");
  console.log("  2. Arbitrum Sepolia");
  console.log("  3. Polygon Amoy");
  console.log("  4. Ethereum Sepolia");
  console.log("  5. Optimism Sepolia");

  const choice = await prompt("Enter number: ");
  // Map to chain name...
}
```

---

## Channel Management (Admin)

### When to Use Channels

Channels are useful for:
- **Admin rebalancing**: Moving large amounts between operators
- **On-chain settlement**: When admin needs to withdraw to custody

### Recommended Approach

For Ki0xk operations:
1. **Keep channels at zero** for transfer operations
2. **Use unified balance** for accounting
3. **Only open channels** when admin needs to:
   - Deposit more funds to Yellow
   - Withdraw from Yellow to custody
   - Rebalance between operators

### Channel Flow (Admin Only)

```
Admin Deposit:
1. Deposit USDC to Custody contract (on-chain)
2. Open channel with broker
3. Resize channel to add funds
4. Resize channel to zero (move to unified balance)
5. Close channel

Admin Withdrawal:
1. Open channel
2. Resize to move from unified balance to channel
3. Close channel (settles on-chain)
4. Withdraw from Custody contract
```

---

## Testing Plan

### Phase 1: Arc Bridge Only
```bash
npm run cli bridge 0xAddress Base_Sepolia 0.01
# Test direct bridging without Yellow
```

### Phase 2: Yellow + Arc Combined
```bash
npm run cli settle 0xAddress Base_Sepolia 0.01
# Test full flow: Yellow accounting + Arc bridging
```

### Phase 3: ENS + Chain Selection
```bash
npm run cli settle vitalik.eth Arbitrum_Sepolia 0.05
# Test ENS resolution + different chain
```

### Phase 4: PIN Wallet + Settlement
```bash
npm run cli pin-create 1.00
npm run cli pin-claim
# Select chain during claim, test full first-timer flow
```

---

## Hackathon Alignment

### Yellow Network Prize ($15,000)
- ✅ Yellow SDK integration
- ✅ Off-chain transaction logic (unified balance transfers)
- ✅ Session-based accounting
- ✅ Settlement via smart contracts (through Arc)
- ✅ Demo video showing user flow

### Arc Prize ($5,000 - Chain Abstracted Apps)
- ✅ Arc as liquidity hub
- ✅ USDC routing across chains
- ✅ User selects destination chain
- ✅ Seamless UX despite crosschain complexity

### ENS Prize ($3,500 - Integration Pool)
- ✅ ENS resolution for destinations
- ✅ Human-readable addresses in DeFi context
- ✅ Functional demo (not hardcoded)

---

## Implementation Order

### Step 1: Bridge Module (2-3 hours)
- [ ] Install Bridge Kit dependencies
- [ ] Create `src/arc/bridge.ts`
- [ ] Create `src/arc/chains.ts`
- [ ] Test direct bridging: Arc → Base Sepolia

### Step 2: Fee System (1 hour)
- [ ] Create `src/arc/fees.ts`
- [ ] Implement 0.001% calculation
- [ ] Test fee deduction

### Step 3: Settlement Orchestrator (2 hours)
- [ ] Create `src/settlement.ts`
- [ ] Integrate Yellow accounting + Arc bridging
- [ ] Add CLI `settle` command

### Step 4: Chain Selection UI (1 hour)
- [ ] Update CLI with chain picker
- [ ] Display fee breakdown
- [ ] Confirm before execution

### Step 5: PIN Wallet Update (1 hour)
- [ ] Add chain selection to PIN claim
- [ ] Store chain preference in PIN wallet

### Step 6: Testing & Documentation (2 hours)
- [ ] End-to-end tests
- [ ] Update README
- [ ] Record demo video

---

## Open Questions

1. **Arc Testnet RPC**: Need to find the exact RPC endpoint and chain ID
2. **Faucet**: Get Arc Testnet USDC from Circle faucet
3. **Bridge Time**: How long does Arc → Base bridge take? (~30-60 sec expected)
4. **Error Handling**: What if bridge fails after Yellow records?
   - Suggestion: Implement retry mechanism or refund flow

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Bridge fails after Yellow records | Queue system with retry; manual refund if needed |
| User enters wrong address | ENS verification; QR preferred; confirmation screen |
| Chain congestion delays | Set user expectation (1-2 min); show tx hash for tracking |
| Fee too small for dust attacks | Minimum fee floor ($0.0001) |

---

## Success Criteria

1. ✅ User can insert cash and receive USDC on chosen chain
2. ✅ ENS names resolve to addresses
3. ✅ Fees are collected correctly
4. ✅ PIN wallet users can claim to any chain
5. ✅ Full flow completes in < 2 minutes
6. ✅ Demo video shows complete journey

---

## Next Steps

1. Review this plan
2. Get Arc Testnet USDC from faucet
3. Start with Step 1 (Bridge Module)
4. Test each step before proceeding
