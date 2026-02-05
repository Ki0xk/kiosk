# Ki0xk Kiosk

Physical-first crypto infrastructure for cash economies and high-frequency venues.

## Two Realities, One Solution

**Tienditas & Kioscos** — Corner stores across Mexico, Argentina, and LATAM where millions transact daily with cash. No bank accounts, no smartphones required.

**Festivals & Events** — Temporary venues where speed matters, NFC wristbands replace wallets, and thousands of micro-transactions happen in hours.

Powered by [Yellow Network](https://yellow.org) for instant accounting and [Circle Arc](https://developers.circle.com/stablecoins/bridge-kit) for cross-chain USDC settlement.

> People don't need to "use crypto."
> They put in cash, tap, and pay.

---

## How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│   Cash / Coin   │ ──▶ │      Ki0xk       │ ──▶ │   Wallet / NFC     │
│   Inserted      │     │   (kiosk node)   │     │   USDC received    │
└─────────────────┘     └──────────────────┘     └────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
              Yellow Network         Arc Bridge
              (accounting)         (real USDC)
              instant, off-chain   any EVM chain
```

### The Flow

| Step | User Action | System Action |
|------|-------------|---------------|
| 1 | Insert cash | Coins counted, value recorded to session |
| 2 | Scan QR / Type ENS / Tap NFC | Destination wallet identified |
| 3 | Select chain | User picks from 7 EVM networks |
| 4 | Done | USDC bridged to destination via Arc CCTP |

**No wallets to download. No seed phrases. No gas fees. No waiting.**

---

## Architecture

Ki0xk uses a **two-layer architecture** for maximum flexibility:

### Layer 1: Yellow Network (State Channels)
- **Session-based channels** — open channel → off-chain operations → close channel
- **Instant off-chain transfers** using ytest.usd
- **No gas fees** for internal operations
- **Real-time balance tracking** for kiosk operations
- Perfect for high-frequency micro-transactions

```
Session Lifecycle:
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Channel   │ ──▶ │  Off-chain  │ ──▶ │   Channel   │
│    Open     │     │  Operations │     │    Close    │
└─────────────┘     └─────────────┘     └─────────────┘
```

### Layer 2: Arc Bridge (Settlement)
- **Real USDC delivery** to user's preferred chain
- **Cross-chain via CCTP** (Circle's Cross-Chain Transfer Protocol)
- **User choice** — Base, Ethereum, Arbitrum, Polygon, Optimism, Avalanche, Linea
- **0.001% fee** — designed for micro-transaction onboarding

```
┌─────────────────────────────────────────────────────────────────┐
│                        Ki0xk Settlement                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Yellow Network                    Arc Bridge                   │
│   ┌─────────────┐                  ┌─────────────┐              │
│   │  ytest.usd  │                  │    USDC     │              │
│   │  accounting │ ───────────────▶ │  bridging   │              │
│   │   (fast)    │                  │  (real $)   │              │
│   └─────────────┘                  └─────────────┘              │
│         │                                │                       │
│         ▼                                ▼                       │
│   Internal record                  User receives                │
│   for kiosk ops                    real USDC on                 │
│                                    their chain                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Why Two Layers?

| Layer | Purpose | Speed | Cost |
|-------|---------|-------|------|
| Yellow | Kiosk accounting, internal ops | Instant | Zero gas |
| Arc | User settlement, real USDC | ~15-30 sec | 0.001% fee |

Yellow handles the fast stuff. Arc delivers the real value.

---

## Quick Start

### Prerequisites

- Node.js 18+
- A funded wallet on Base Sepolia

### Setup

```bash
npm install
cp .env.example .env
# Add your PRIVATE_KEY to .env
```

### Get Test Funds

```bash
# Base Sepolia ETH (for any future on-chain ops)
# https://www.alchemy.com/faucets/base-sepolia

# Yellow sandbox tokens (ytest.usd)
curl -XPOST https://clearnet-sandbox.yellow.com/faucet/requestTokens \
  -H "Content-Type: application/json" \
  -d '{"userAddress":"YOUR_WALLET_ADDRESS"}'
```

### Run

```bash
# Start kiosk daemon
npm run dev

# Or use the CLI for testing
npm run cli balances
npm run cli pin-create 0.01
```

---

## CLI Commands

```bash
npm run cli <command>

# Balance & Status
balances             Show Yellow + Arc balances
chains               List supported destination chains

# Settlement (Yellow Channel + Arc Bridge)
settle <dest> [chain] [amt]   Full settlement flow with channel lifecycle
bridge <dest> [chain] [amt]   Direct Arc bridge only

# Session Management (Yellow Network Channels)
session-start [user]          Start new session (opens Yellow channel)
session-deposit <id> <amt>    Add funds to session (off-chain)
session-end <id> <dest> [chain]   End session and settle to chain
session-pin <id>              Convert session to PIN wallet
session-status <id>           View session details
sessions                      List all sessions

# ENS
resolve <name>       Resolve ENS or validate address

# PIN Wallets (for users without wallets)
pin-create [amt]     Create PIN-protected deposit
pin-claim            Claim funds with PIN + chain selection
pin-list             List all PIN wallets
retry                Retry pending bridges

# Testing
test                 Run full test flow
```

### Examples

```bash
# Check all balances
npm run cli balances
# ╔═══════════════════════════════════════════════════════╗
# ║           Ki0xk Kiosk Balances                        ║
# ╠═══════════════════════════════════════════════════════╣
# ║  Yellow (Accounting):       10.00 ytest.usd          ║
# ║  Arc (Liquidity):            5.00 USDC               ║
# ╚═══════════════════════════════════════════════════════╝

# Settle to Base (full Yellow channel + Arc bridge flow)
npm run cli settle 0x843914e5BBdbE92296F2c3D895D424301b3517fC base 0.01
# [INFO] Opening Yellow channel...
# [INFO] Channel opened {"channelId":"0xcf2c..."}
# [INFO] Bridge steps {"flow":"approve:success → burn:success → fetchAttestation:success → mint:success"}
# [INFO] Bridge complete! {"txHash":"0x9825...","status":"success"}
# [INFO] Channel auto-closed (zero-balance)
# ✅ Settlement complete! 0.01 USDC sent to Base Sepolia
# 📜 TX: 0x9825c894777527... [✓ confirmed]
# 🔗 https://sepolia.basescan.org/tx/0x9825c8947775277333...

# Session-based flow (for kiosk operations)
npm run cli session-start user123
# ✅ Session S1A2B3C4 started. Channel: 0x...

npm run cli session-deposit S1A2B3C4 5.00
# ✅ Deposited 5.00 USDC. Session balance: 5.00

npm run cli session-end S1A2B3C4 0x843914e5BBdbE92296F2c3D895D424301b3517fC base
# ✅ Session settled! 5.00 USDC sent to Base Sepolia

# Settle to ENS name on Arbitrum
npm run cli settle vitalik.eth arbitrum 0.05

# Create a PIN wallet for first-timer
npm run cli pin-create 5.00
# 🎫 PIN: 847291 | Wallet ID: 3A9B0D

# List supported chains
npm run cli chains
# base       → Base Sepolia (84532)
# ethereum   → Ethereum Sepolia (11155111)
# arbitrum   → Arbitrum Sepolia (421614)
# ...
```

---

## PIN Wallet System

For users who don't have a crypto wallet yet. They insert cash, get a PIN receipt, and claim later from any device.

### Format

| Field | Format | Example |
|-------|--------|---------|
| **PIN** | 6 numeric digits (0-9) | `847291` |
| **Wallet ID** | 6 alphanumeric chars (0-9 + A-D) | `3A9B0D` |

Wallet ID charset (0-9, A-D) matches the 4x4 physical keypad on the kiosk hardware. PINs are hashed with SHA-256 before storage — they cannot be recovered.

### Flow

```
Create:
  1. Customer inserts cash
  2. Kiosk generates PIN (6 digits) + Wallet ID (6 chars)
  3. Prints receipt with PIN and Wallet ID
  4. Funds stored in pin-wallets.json

Claim:
  1. Customer enters Wallet ID on kiosk keypad
  2. Enters 6-digit PIN
  3. Chooses destination (QR scan, ENS name, or NFC)
  4. Selects chain (Base, Ethereum, Arbitrum, etc.)
  5. Funds bridged via Arc CCTP to destination
```

### Bridge Failure Recovery

If the cross-chain bridge fails (network issues, liquidity, etc.):

```
1. Settlement initiated
2. Yellow accounting recorded ✓
3. Arc bridge fails ✗
4. System generates PIN: 847291 | Wallet ID: 3A9B0D
5. Customer keeps receipt
6. Later: npm run cli retry
   OR customer returns with PIN
7. Retry bridge with PIN
8. Funds delivered successfully
```

No funds lost — just delayed. PIN system handles retries.

---

## Use Cases

### At a Tiendita (Mexico/Argentina)

```
1. Customer: "Quiero cargar 100 pesos a mi wallet"
2. Inserts cash into Ki0xk
3. Shows QR code or says "miwallet.eth"
4. Receives USDC instantly
5. Can send to family, save, or spend
```

### At a Festival

```
1. Attendee arrives, gets NFC wristband
2. Loads value at Ki0xk station
3. Taps wristband at food/drink vendors
4. Balance updates instantly
5. End of event: withdraw to any wallet
```

### First-Timer (No Wallet)

```
1. Customer inserts cash
2. Ki0xk generates 6-digit PIN + 6-char Wallet ID
3. Prints receipt: "PIN: 847291 | Wallet ID: 3A9B0D"
4. Later: download any wallet app
5. Return to kiosk or visit ki0xk.com
6. Enter Wallet ID + PIN, choose destination chain
7. Funds bridged to real wallet
```

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PRIVATE_KEY` | Kiosk operator wallet | **Required** |
| `CHAIN_ID` | Target chain | `84532` (Base Sepolia) |
| `RPC_URL` | Chain RPC | `https://sepolia.base.org` |
| `CLEARNODE_WS_URL` | Yellow endpoint | `wss://clearnet-sandbox.yellow.com/ws` |
| `FEE_RECIPIENT_ADDRESS` | Where 0.001% fees are collected | Optional |
| `MOCK_MODE` | Skip ClearNode | `false` |
| `LOG_LEVEL` | Verbosity | `info` |

### Fee Structure

Ki0xk charges a minimal **0.001% fee** on settlements — designed for micro-transaction onboarding.

```
Example: User settles 10.00 USDC
├── Gross amount:  10.00 USDC
├── Fee (0.001%):   0.0001 USDC
└── Net to user:    9.9999 USDC
```

Fees are collected via Circle's customFee mechanism in Bridge Kit.

---

## Network Details

### Sandbox (Testing)

| Contract | Address |
|----------|---------|
| Custody | `0x019B65A265EB3363822f2752141b3dF16131b262` |
| Adjudicator | `0x7c7ccbc98469190849BCC6c926307794fDfB11F2` |
| Broker | `0xc7E6827ad9DA2c89188fAEd836F9285E6bFdCCCC` |
| ytest.usd | `0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb` |

### Supported Destination Chains (via Arc)

| Chain | Network | Chain ID |
|-------|---------|----------|
| Base | Sepolia | 84532 |
| Ethereum | Sepolia | 11155111 |
| Arbitrum | Sepolia | 421614 |
| Polygon | Amoy | 80002 |
| Optimism | Sepolia | 11155420 |
| Avalanche | Fuji | 43113 |
| Linea | Sepolia | 59141 |

**Source Chain**: Arc Testnet (USDC liquidity hub)

---

## Why This Matters

Crypto adoption fails in the places that need it most:

| Problem | Ki0xk Solution |
|---------|----------------|
| CEXs require KYC + bank | Cash in, value out |
| Apps need smartphones | Physical kiosk |
| Gas fees kill micro-tx | Off-chain transfers |
| Seed phrases scare people | Operator handles keys |
| Wallets are confusing | QR, ENS, or NFC |

Ki0xk shows crypto can:
- **Leave the browser** and enter tienditas
- **Work with cash** not against it
- **Skip the CEX** — no KYC needed
- **Feel like phone credit** not like finance

---

## Project Structure

```
kiosk/
├── src/
│   ├── index.ts        # Kiosk daemon entry point
│   ├── cli.ts          # CLI testing tool
│   ├── clearnode.ts    # Yellow Network client (channels, auth)
│   ├── session.ts      # Session management (channel lifecycle)
│   ├── settlement.ts   # Yellow + Arc orchestrator + PIN wallets
│   ├── wallet.ts       # Viem wallet setup
│   ├── config.ts       # Environment validation (Zod)
│   ├── logger.ts       # Structured logging (BigInt-safe)
│   └── arc/
│       ├── bridge.ts   # Arc Bridge Kit wrapper (CCTP)
│       ├── chains.ts   # Supported chain configs + RPCs
│       └── fees.ts     # Fee calculation (0.001%)
├── docs/
│   └── ARC_INTEGRATION_PLAN.md
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Blockchain**: viem (Base Sepolia)
- **State Channels**: @erc7824/nitrolite (Yellow Network)
- **Cross-Chain**: @circle-fin/bridge-kit (Arc / CCTP)
- **WebSocket**: yellow-ts
- **Validation**: Zod
- **ENS**: viem/ens

---

## Frontend

The kiosk tablet UI is in a separate repo: **[ki0xk-kiosk-ui](https://github.com/Ki0xk/ki0xk-kiosk-ui)**

Built with Next.js 16, React 19, Tailwind CSS v4, and shadcn/ui. Features:
- Coin slot simulator (matches Arduino Coinslot pulse mapping)
- QR code camera scanner for destination wallets
- On-screen QWERTY keyboard for ENS name input
- Physical-style keypads for PIN (3x4) and Wallet ID (4x4)
- Chain selector for 7 testnet destinations
- Mock API layer shaped to match this backend's return types

---

## Roadmap

- [x] ClearNode connection and auth
- [x] Unified balance transfers
- [x] ENS resolution
- [x] CLI testing tool
- [x] PIN wallet system (6-digit PIN + 6-char wallet ID)
- [x] Arc Bridge Kit integration
- [x] Cross-chain USDC settlement (CCTP)
- [x] Multi-chain support (7 EVM chains)
- [x] Fee collection (0.001%)
- [x] Bridge failure fallback (PIN retry)
- [x] Yellow Network channel lifecycle (create → use → close)
- [x] Session management (session-start, session-deposit, session-end)
- [x] Transaction status tracking (on-chain confirmation)
- [x] Explorer links for all bridge transactions
- [x] Touch screen UI ([ki0xk-kiosk-ui](https://github.com/Ki0xk/ki0xk-kiosk-ui))
- [x] Coin acceptor simulation ([Coinslot](https://github.com/Ki0xk/ki0xk-kiosk-ui) Arduino firmware)
- [x] QR code scanner (html5-qrcode in frontend)
- [ ] HTTP/WebSocket API for frontend integration
- [ ] NFC wristband support
- [ ] Bill acceptor
- [ ] Vendor terminal mode
- [ ] Multi-kiosk dashboard

---

## Team

Built by a team from **Mexico** and **Argentina** who understand cash economies, crypto curiosity blocked by CEX/KYC barriers, and the gap between crypto's promise and actual adoption in LATAM.

We're not building for theoretical users. We're building for our neighbors.

---

## Hackathon

Part of **Ki0xk**, built for HackMoney.

### Integrations

| Sponsor | Integration | Purpose |
|---------|-------------|---------|
| **Yellow Network** | Nitrolite state channels | Off-chain accounting, instant transfers |
| **Circle Arc** | Bridge Kit / CCTP | Cross-chain USDC settlement |
| **ENS** | viem/ens resolution | Human-readable addresses |

### Demonstrates

- **Yellow Network**: Full Nitrolite channel lifecycle (create → operate → close)
- **Circle Arc**: Bridge Kit + CCTP for cross-chain USDC with tx confirmation
- **ENS**: Resolve human-readable names (vitalik.eth) to addresses
- **Physical-first**: Cash economies need kiosks, not apps
- **Two-layer architecture**: Fast state channels + reliable cross-chain settlement
- **Session management**: Real kiosk workflow with channel-wrapped operations

---

## License

Apache 2.0
