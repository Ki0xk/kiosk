# Ki0xk Kiosk

Physical-first crypto infrastructure for cash economies and high-frequency venues.

## Two Realities, One Solution

**Tienditas & Kioscos** — Corner stores across Mexico, Argentina, and LATAM where millions transact daily with cash. No bank accounts, no smartphones required.

**Festivals & Events** — Temporary venues where speed matters, NFC wristbands replace wallets, and thousands of micro-transactions happen in hours.

Powered by [Yellow Network](https://yellow.org) state channels, Ki0xk enables instant cash-to-USDC without exposing users to blockchain complexity.

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
                        Off-chain transfer
                        via Yellow Network
                        (instant, zero gas)
```

### The Flow

| Step | User Action | System Action |
|------|-------------|---------------|
| 1 | Insert cash | Value recorded |
| 2 | Scan QR / Say ENS / Tap NFC | Destination identified |
| 3 | Done | USDC transferred instantly |

**No wallets to download. No seed phrases. No gas fees. No waiting.**

---

## Architecture

Ki0xk uses Yellow Network's **Unified Balance** for instant off-chain transfers:

- **Deposit once** → Funds enter Yellow (on-chain)
- **Transfer many times** → Off-chain, instant, zero gas
- **Withdraw when needed** → Back to on-chain (optional)

This is perfect for high-frequency, low-value transactions like tiendita purchases or festival payments.

### Why Not Channels?

Yellow's protocol has a rule: channels with balance block transfers. For ATM operations, we skip channels entirely and work directly with unified balance. Simpler, faster, no blocking.

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
npm run cli balance
npm run cli send 0xDestination 0.01
```

---

## CLI Commands

```bash
npm run cli <command>

# Balance & Status
balance              Check unified balance (ytest.usd)
channels             Check for blocking channels

# Transfers
send <dest> [amt]    Send ytest.usd (default: 0.01)
resolve <name>       Resolve ENS or validate address

# PIN Wallets (for users without wallets)
pin-create [amt]     Create PIN-protected deposit
pin-claim            Claim funds with PIN
pin-list             List PIN wallets

# Testing
test                 Run full test flow
```

### Examples

```bash
# Check your balance
npm run cli balance
# 💰 Unified Balance: 10.00 ytest.usd

# Send to an address
npm run cli send 0x843914e5BBdbE92296F2c3D895D424301b3517fC 0.01
# ✅ Transfer complete!

# Send to an ENS name
npm run cli send vitalik.eth 0.01

# Create a PIN wallet for a first-timer
npm run cli pin-create 5.00
# 🎫 PIN: 847291 | Wallet ID: A3F2
```

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
2. Ki0xk generates 6-digit PIN
3. Prints receipt: "PIN: 847291"
4. Later: download any wallet app
5. Visit ki0xk.com, enter PIN
6. Funds transfer to real wallet
```

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PRIVATE_KEY` | Kiosk operator wallet | **Required** |
| `CHAIN_ID` | Target chain | `84532` (Base Sepolia) |
| `RPC_URL` | Chain RPC | `https://sepolia.base.org` |
| `CLEARNODE_WS_URL` | Yellow endpoint | `wss://clearnet-sandbox.yellow.com/ws` |
| `MOCK_MODE` | Skip ClearNode | `false` |
| `LOG_LEVEL` | Verbosity | `info` |

---

## Network Details

### Sandbox (Testing)

| Contract | Address |
|----------|---------|
| Custody | `0x019B65A265EB3363822f2752141b3dF16131b262` |
| Adjudicator | `0x7c7ccbc98469190849BCC6c926307794fDfB11F2` |
| Broker | `0xc7E6827ad9DA2c89188fAEd836F9285E6bFdCCCC` |
| ytest.usd | `0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb` |

### Supported Chains

- Base Sepolia (84532)
- Ethereum Sepolia (11155111)
- Polygon Amoy (80002)
- Linea Sepolia (59141)

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
│   ├── clearnode.ts    # Yellow Network client
│   ├── wallet.ts       # Viem wallet setup
│   ├── config.ts       # Environment validation
│   └── logger.ts       # Structured logging
├── scripts/
│   └── test-transfer.sh
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Blockchain**: viem (Base Sepolia)
- **State Channels**: @erc7824/nitrolite
- **WebSocket**: yellow-ts
- **Validation**: Zod
- **ENS**: viem/ens

---

## Roadmap

- [x] ClearNode connection and auth
- [x] Unified balance transfers
- [x] ENS resolution
- [x] CLI testing tool
- [x] PIN wallet system
- [ ] QR code scanner integration
- [ ] NFC wristband support
- [ ] Coin acceptor (Arduino)
- [ ] Bill acceptor
- [ ] Touch screen UI
- [ ] Vendor terminal mode
- [ ] Multi-kiosk dashboard

---

## Team

Built by a team from **Mexico** and **Argentina** who understand cash economies, crypto curiosity blocked by CEX/KYC barriers, and the gap between crypto's promise and actual adoption in LATAM.

We're not building for theoretical users. We're building for our neighbors.

---

## Hackathon

Part of **Ki0xk**, built for HackMoney.

Demonstrates:
- Real Yellow Network / Nitrolite integration
- Off-chain instant transfers
- Cash-to-crypto UX design
- Physical-first infrastructure

---

## License

Apache 2.0
