#!/usr/bin/env node
/**
 * Ki0xk CLI - Terminal testing tool for the kiosk ATM
 *
 * Commands:
 *   npm run cli balance     - Check unified balance
 *   npm run cli resolve     - Resolve ENS name to address
 *   npm run cli send        - Send ytest.usd to address
 *   npm run cli pin-create  - Create a PIN-protected deposit
 *   npm run cli pin-claim   - Claim funds with PIN
 */

import { createPublicClient, http, isAddress } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import * as crypto from "crypto";
import * as fs from "fs";
import * as readline from "readline";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { initWallet, kioskAddress } from "./wallet.js";
import { getClearNode } from "./clearnode.js";

// ENS resolution client (uses mainnet for ENS)
const ensClient = createPublicClient({
  chain: mainnet,
  transport: http("https://eth.llamarpc.com"),
});

// Simple PIN wallet storage (in production, use a proper database)
const PIN_WALLET_FILE = "./pin-wallets.json";

interface PinWallet {
  id: string;
  pinHash: string;
  amount: string;
  createdAt: number;
  claimed: boolean;
  claimedAt?: number;
  claimedTo?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function hashPin(pin: string): string {
  return crypto.createHash("sha256").update(pin).digest("hex");
}

function generatePinWalletId(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function loadPinWallets(): PinWallet[] {
  try {
    if (fs.existsSync(PIN_WALLET_FILE)) {
      return JSON.parse(fs.readFileSync(PIN_WALLET_FILE, "utf-8"));
    }
  } catch {
    // Ignore errors
  }
  return [];
}

function savePinWallets(wallets: PinWallet[]): void {
  fs.writeFileSync(PIN_WALLET_FILE, JSON.stringify(wallets, null, 2));
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ============================================================================
// ENS Resolution
// ============================================================================

async function resolveENS(ensName: string): Promise<string | null> {
  try {
    const normalized = normalize(ensName);
    console.log(`Resolving: ${normalized}`);

    const address = await ensClient.getEnsAddress({
      name: normalized,
    });

    return address;
  } catch (error) {
    console.error("ENS resolution error:", error instanceof Error ? error.message : error);
    return null;
  }
}

// ============================================================================
// Address Resolution (ENS, QR/hex address)
// ============================================================================

async function resolveDestination(input: string): Promise<string | null> {
  // Check if it's already a valid address
  if (isAddress(input)) {
    console.log(`Valid address: ${input}`);
    return input;
  }

  // Check if it looks like an ENS name
  if (input.includes(".")) {
    console.log(`Attempting ENS resolution for: ${input}`);
    const resolved = await resolveENS(input);
    if (resolved) {
      console.log(`Resolved to: ${resolved}`);
      return resolved;
    }
    console.log("ENS resolution failed");
    return null;
  }

  // Invalid input
  console.log(`Invalid address format: ${input}`);
  return null;
}

// ============================================================================
// ClearNode Operations
// ============================================================================

async function connectAndAuth(): Promise<ReturnType<typeof getClearNode>> {
  await initWallet();
  const clearNode = getClearNode();

  console.log("\nConnecting to ClearNode...");
  await clearNode.connect();

  console.log("Fetching config...");
  await clearNode.getConfig();

  console.log("Authenticating...");
  await clearNode.authenticate();
  console.log("Authenticated!\n");

  return clearNode;
}

async function getBalance(): Promise<string> {
  const clearNode = await connectAndAuth();

  console.log("Fetching unified balance...");
  const balances = await clearNode.getLedgerBalances();
  const data = balances as any;

  // Parse balance from response - check multiple possible response formats
  const entries = data?.params?.ledgerBalances
    || data?.params?.balances
    || data?.params?.entries
    || [];

  for (const entry of entries) {
    if (entry?.asset === "ytest.usd" || entry?.symbol === "ytest.usd") {
      const rawAmount = entry?.amount || entry?.balance || "0";
      // Convert from smallest unit (6 decimals) to human-readable
      const humanAmount = (Number(rawAmount) / 1_000_000).toFixed(2);
      console.log(`\n💰 Unified Balance: ${humanAmount} ytest.usd (raw: ${rawAmount})`);
      return humanAmount;
    }
  }

  console.log("\n💰 Unified Balance: 0.00 ytest.usd");
  return "0";
}

async function sendFunds(destination: string, amount: string): Promise<void> {
  const clearNode = await connectAndAuth();

  console.log(`\nSending ${amount} ytest.usd to ${destination}...`);

  try {
    await clearNode.sendToWallet(destination, amount);
    console.log("\n✅ Transfer complete!");
  } catch (error) {
    console.error("\n❌ Transfer failed:", error instanceof Error ? error.message : error);

    if (String(error).includes("non-zero allocation")) {
      console.log("\n⚠️  You have channels with balance blocking transfers.");
      console.log("   Run: npm run cli channels  -- to see blocking channels");
    }
  }
}

// ============================================================================
// PIN Wallet Operations
// ============================================================================

async function createPinWallet(amount: string): Promise<void> {
  // Generate 6-digit PIN
  const pin = Math.floor(100000 + Math.random() * 900000).toString();
  const pinHash = hashPin(pin);
  const id = generatePinWalletId();

  const wallet: PinWallet = {
    id,
    pinHash,
    amount,
    createdAt: Date.now(),
    claimed: false,
  };

  const wallets = loadPinWallets();
  wallets.push(wallet);
  savePinWallets(wallets);

  console.log("\n" + "=".repeat(50));
  console.log("🎫 PIN WALLET CREATED");
  console.log("=".repeat(50));
  console.log(`\n   Wallet ID: ${id}`);
  console.log(`   PIN:       ${pin}`);
  console.log(`   Amount:    ${amount} ytest.usd`);
  console.log("\n   ⚠️  SAVE THIS PIN - it cannot be recovered!");
  console.log("\n   To claim, visit ki0xk.com or use:");
  console.log(`   npm run cli pin-claim`);
  console.log("=".repeat(50));
}

async function claimPinWallet(): Promise<void> {
  const wallets = loadPinWallets();
  const unclaimed = wallets.filter((w) => !w.claimed);

  if (unclaimed.length === 0) {
    console.log("\n❌ No unclaimed PIN wallets found");
    return;
  }

  console.log("\nUnclaimed PIN Wallets:");
  unclaimed.forEach((w) => {
    console.log(`  - ID: ${w.id}, Amount: ${w.amount} ytest.usd, Created: ${new Date(w.createdAt).toLocaleString()}`);
  });

  const walletId = await prompt("\nEnter Wallet ID: ");
  const pin = await prompt("Enter PIN: ");
  const destinationInput = await prompt("Enter destination (address or ENS): ");

  // Find wallet
  const wallet = wallets.find((w) => w.id === walletId && !w.claimed);
  if (!wallet) {
    console.log("\n❌ Wallet not found or already claimed");
    return;
  }

  // Verify PIN
  if (hashPin(pin) !== wallet.pinHash) {
    console.log("\n❌ Invalid PIN");
    return;
  }

  // Resolve destination
  const destination = await resolveDestination(destinationInput);
  if (!destination) {
    console.log("\n❌ Invalid destination");
    return;
  }

  console.log("\n✅ PIN verified! Processing transfer...");

  // Perform transfer
  try {
    await sendFunds(destination, wallet.amount);

    // Mark as claimed
    wallet.claimed = true;
    wallet.claimedAt = Date.now();
    wallet.claimedTo = destination;
    savePinWallets(wallets);

    console.log("\n🎉 PIN Wallet claimed successfully!");
  } catch (error) {
    console.error("\n❌ Claim failed:", error instanceof Error ? error.message : error);
  }
}

async function listPinWallets(): Promise<void> {
  const wallets = loadPinWallets();

  if (wallets.length === 0) {
    console.log("\nNo PIN wallets found");
    return;
  }

  console.log("\nPIN Wallets:");
  console.log("-".repeat(80));

  wallets.forEach((w) => {
    const status = w.claimed ? `✅ Claimed to ${w.claimedTo}` : "⏳ Unclaimed";
    console.log(`ID: ${w.id} | Amount: ${w.amount} | Status: ${status}`);
  });
}

async function checkChannels(): Promise<void> {
  const clearNode = await connectAndAuth();

  console.log("Fetching channels...");
  const channels = await clearNode.getChannels();
  const data = channels as any;
  const channelList = data?.params?.channels || [];

  if (channelList.length === 0) {
    console.log("\n✅ No channels found - transfers are unblocked!");
    return;
  }

  console.log("\nChannels:");
  console.log("-".repeat(80));

  let hasBlocking = false;
  for (const ch of channelList) {
    const amount = ch?.amount || ch?.balance || "0";
    const isBlocking = BigInt(amount) > 0n;
    if (isBlocking) hasBlocking = true;

    const status = isBlocking ? "⚠️  BLOCKING" : "✅ OK";
    console.log(`ID: ${ch?.channel_id || ch?.channelId}`);
    console.log(`   Amount: ${amount} | Status: ${ch?.status} | ${status}`);
  }

  if (hasBlocking) {
    console.log("\n⚠️  Channels with non-zero balance block transfers!");
    console.log("   Close or resize them to enable transfers.");
  }
}

// ============================================================================
// Main CLI
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log("=".repeat(50));
  console.log("Ki0xk CLI - Kiosk Testing Tool");
  console.log("=".repeat(50));

  if (config.MOCK_MODE) {
    console.log("⚠️  Running in MOCK_MODE - ClearNode operations disabled\n");
  }

  try {
    switch (command) {
      case "balance":
        await getBalance();
        break;

      case "resolve": {
        const name = args[1] || (await prompt("Enter ENS name or address: "));
        const resolved = await resolveDestination(name);
        if (resolved) {
          console.log(`\n✅ Resolved: ${resolved}`);
        } else {
          console.log(`\n❌ Could not resolve: ${name}`);
        }
        break;
      }

      case "send": {
        const dest = args[1] || (await prompt("Enter destination (address or ENS): "));
        const amt = args[2] || (await prompt("Enter amount (default 0.01): ")) || "0.01";

        const resolved = await resolveDestination(dest);
        if (!resolved) {
          console.log("\n❌ Invalid destination");
          process.exit(1);
        }

        await sendFunds(resolved, amt);
        break;
      }

      case "pin-create": {
        const amount = args[1] || (await prompt("Enter amount to lock (default 0.01): ")) || "0.01";
        await createPinWallet(amount);
        break;
      }

      case "pin-claim":
        await claimPinWallet();
        break;

      case "pin-list":
        await listPinWallets();
        break;

      case "channels":
        await checkChannels();
        break;

      case "test": {
        // Quick test flow
        console.log("\n🧪 Running test flow...\n");

        // 1. Check balance
        console.log("1. Checking balance...");
        await getBalance();

        // 2. Test ENS resolution
        console.log("\n2. Testing ENS resolution...");
        const vitalik = await resolveENS("vitalik.eth");
        console.log(`   vitalik.eth → ${vitalik}`);

        // 3. Check channels
        console.log("\n3. Checking channels...");
        await checkChannels();

        console.log("\n✅ Test flow complete!");
        break;
      }

      default:
        console.log(`
Usage: npm run cli <command> [args]

Commands:
  balance              Check unified balance (ytest.usd)
  resolve <name>       Resolve ENS name or validate address
  send <dest> [amt]    Send ytest.usd (default: 0.01)
  channels             Check for blocking channels

PIN Wallet (for users without wallets):
  pin-create [amt]     Create PIN-protected deposit
  pin-claim            Claim funds with PIN
  pin-list             List all PIN wallets

Testing:
  test                 Run full test flow

Examples:
  npm run cli balance
  npm run cli resolve vitalik.eth
  npm run cli send 0x1234...abcd 0.01
  npm run cli send vitalik.eth 0.05
  npm run cli pin-create 0.01
  npm run cli test
`);
    }
  } catch (error) {
    console.error("\n❌ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }

  process.exit(0);
}

main();
