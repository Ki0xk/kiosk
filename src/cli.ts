#!/usr/bin/env node
/**
 * Ki0xk CLI - Terminal testing tool for the kiosk ATM
 *
 * Commands:
 *   npm run cli balances    - Show Yellow + Arc balances
 *   npm run cli settle      - Settle USDC to user's chain
 *   npm run cli bridge      - Direct bridge without Yellow
 *   npm run cli resolve     - Resolve ENS name to address
 *   npm run cli pin-create  - Create a PIN-protected deposit
 *   npm run cli pin-claim   - Claim funds with PIN
 */

import { createPublicClient, http, isAddress } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import * as readline from "readline";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { initWallet, kioskAddress } from "./wallet.js";
import { getClearNode } from "./clearnode.js";
import {
  getKioskBalances,
  formatBalances,
  settleToChain,
  createPinWallet,
  claimPinWallet,
  loadPinWallets,
  savePinWallets,
  retryPendingBridges,
  getPendingWalletsSummary,
} from "./settlement.js";
import {
  startSession,
  depositToSession,
  endSession,
  sessionToPin,
  getSession,
  getActiveSessions,
  getAllSessions,
  getSessionSummary,
  formatSession,
} from "./session.js";
import { bridgeToChain, getArcBalance } from "./arc/bridge.js";
import { calculateFee, formatFeeBreakdown } from "./arc/fees.js";
import { SUPPORTED_CHAINS, CHAIN_OPTIONS, formatChainList, getChainByKey } from "./arc/chains.js";

// ENS resolution client (uses mainnet for ENS)
const ensClient = createPublicClient({
  chain: mainnet,
  transport: http("https://eth.llamarpc.com"),
});

// ============================================================================
// Helper Functions
// ============================================================================

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

async function promptChainSelection(): Promise<string> {
  console.log("\nSelect target chain:");
  console.log(formatChainList());
  console.log();

  const choice = await prompt("Enter number: ");
  const index = parseInt(choice) - 1;

  if (index >= 0 && index < CHAIN_OPTIONS.length) {
    return CHAIN_OPTIONS[index];
  }

  console.log("Invalid selection, defaulting to Base Sepolia");
  return "base";
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

async function resolveDestination(input: string): Promise<string | null> {
  if (isAddress(input)) {
    console.log(`Valid address: ${input}`);
    return input;
  }

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

  console.log(`Invalid address format: ${input}`);
  return null;
}

// ============================================================================
// ClearNode Connection
// ============================================================================

async function connectClearNode() {
  await initWallet();
  const clearNode = getClearNode();

  if (!clearNode.isAuthenticated) {
    console.log("\nConnecting to ClearNode...");
    await clearNode.connect();
    await clearNode.getConfig();
    console.log("Authenticating...");
    await clearNode.authenticate();
    console.log("Authenticated!\n");
  }

  return clearNode;
}

// ============================================================================
// Commands
// ============================================================================

async function cmdBalances(): Promise<void> {
  await initWallet();
  console.log("\nFetching balances...");

  const balances = await getKioskBalances();
  console.log(formatBalances(balances));

  // Show pending wallets summary
  const pending = getPendingWalletsSummary();
  if (pending.pending > 0 || pending.pendingBridge > 0) {
    console.log(`\n⏳ Pending PIN wallets: ${pending.pending}`);
    console.log(`🔄 Pending bridges: ${pending.pendingBridge}`);
    console.log(`💰 Total pending value: ${pending.totalValue} USDC`);
  }
}

async function cmdSettle(args: string[]): Promise<void> {
  const dest = args[0] || (await prompt("Destination (address/ENS): "));
  const chainKey = args[1] || (await promptChainSelection());
  const amt = args[2] || (await prompt("Amount (default 0.01): ")) || "0.01";

  // Resolve destination
  const resolved = await resolveDestination(dest);
  if (!resolved) {
    console.log("\n❌ Invalid destination");
    return;
  }

  // Get chain info
  const chainInfo = getChainByKey(chainKey);
  if (!chainInfo) {
    console.log("\n❌ Invalid chain");
    return;
  }

  // Show fee breakdown
  const feeBreakdown = calculateFee(parseFloat(amt));
  console.log(formatFeeBreakdown(feeBreakdown, chainInfo.name));

  // Confirm
  const confirm = await prompt("\nProceed? (y/n): ");
  if (confirm.toLowerCase() !== "y") {
    console.log("Cancelled.");
    return;
  }

  // Execute settlement
  console.log("\n🚀 Processing settlement...");
  const result = await settleToChain(resolved, chainKey, amt);

  if (result.success) {
    console.log("\n✅ " + result.message);
    if (result.bridgeResult?.txHash) {
      const status = result.bridgeResult.txStatus === "success" ? "✓ confirmed" :
                     result.bridgeResult.txStatus === "reverted" ? "✗ reverted" : "⏳ pending";
      console.log(`📜 TX: ${result.bridgeResult.txHash.slice(0, 20)}... [${status}]`);
      if (result.bridgeResult.explorerUrl) {
        console.log(`🔗 ${result.bridgeResult.explorerUrl}`);
      }
    }
  } else {
    console.log("\n⚠️ " + result.message);
    if (result.fallbackPin) {
      console.log(`\n🎫 Fallback PIN created: ${result.fallbackPin}`);
      console.log(`   Wallet ID: ${result.fallbackId}`);
      console.log("   Use this PIN to retry the bridge later.");
    }
  }
}

async function cmdBridge(args: string[]): Promise<void> {
  const dest = args[0] || (await prompt("Destination address: "));
  const chainKey = args[1] || (await promptChainSelection());
  const amt = args[2] || (await prompt("Amount (default 0.01): ")) || "0.01";

  // Validate address
  if (!isAddress(dest)) {
    console.log("\n❌ Invalid address (must be 0x...)");
    return;
  }

  const chainInfo = getChainByKey(chainKey);
  if (!chainInfo) {
    console.log("\n❌ Invalid chain");
    return;
  }

  // Show fee
  const feeBreakdown = calculateFee(parseFloat(amt));
  console.log(formatFeeBreakdown(feeBreakdown, chainInfo.name));

  console.log("\n🌉 Initiating bridge (Arc → " + chainInfo.name + ")...");

  const result = await bridgeToChain(
    dest,
    chainKey,
    amt,
    config.FEE_RECIPIENT_ADDRESS
  );

  if (result.success) {
    console.log("\n✅ Bridge successful!");
    if (result.txHash) {
      const status = result.txStatus === "success" ? "✓ confirmed" :
                     result.txStatus === "reverted" ? "✗ reverted" : "⏳ pending";
      console.log(`📜 TX: ${result.txHash.slice(0, 20)}... [${status}]`);
    }
    if (result.explorerUrl) {
      console.log(`🔗 ${result.explorerUrl}`);
    }
  } else {
    console.log("\n❌ Bridge failed: " + result.error);
  }
}

async function cmdPinCreate(args: string[]): Promise<void> {
  const amount = args[0] || (await prompt("Amount to lock (default 0.01): ")) || "0.01";

  const wallet = createPinWallet(amount);

  console.log("\n" + "═".repeat(50));
  console.log("🎫 PIN WALLET CREATED");
  console.log("═".repeat(50));
  console.log(`\n   Wallet ID: ${wallet.id}`);
  console.log(`   PIN:       ${wallet.pin}`);
  console.log(`   Amount:    ${wallet.amount} USDC`);
  console.log("\n   ⚠️  SAVE THIS PIN - it cannot be recovered!");
  console.log("\n   To claim, run: npm run cli pin-claim");
  console.log("═".repeat(50));
}

async function cmdPinClaim(): Promise<void> {
  const wallets = loadPinWallets();
  const claimable = wallets.filter((w) => w.status === "PENDING" || w.status === "PENDING_BRIDGE");

  if (claimable.length === 0) {
    console.log("\n❌ No claimable PIN wallets found");
    return;
  }

  console.log("\nClaimable PIN Wallets:");
  console.log("─".repeat(60));
  claimable.forEach((w) => {
    const status = w.status === "PENDING_BRIDGE" ? "🔄 Retry needed" : "⏳ Pending";
    console.log(`  ID: ${w.id} | Amount: ${w.amount} USDC | ${status}`);
  });
  console.log();

  const walletId = await prompt("Enter Wallet ID: ");
  const pin = await prompt("Enter PIN: ");
  const dest = await prompt("Destination (address/ENS): ");
  const chainKey = await promptChainSelection();

  // Resolve destination
  const resolved = await resolveDestination(dest);
  if (!resolved) {
    console.log("\n❌ Invalid destination");
    return;
  }

  console.log("\n🚀 Processing claim...");

  try {
    const result = await claimPinWallet(walletId, pin, resolved, chainKey);

    if (result.success) {
      console.log("\n✅ " + result.message);
      if (result.bridgeResult?.txHash) {
        const status = result.bridgeResult.txStatus === "success" ? "✓ confirmed" :
                       result.bridgeResult.txStatus === "reverted" ? "✗ reverted" : "⏳ pending";
        console.log(`📜 TX: ${result.bridgeResult.txHash.slice(0, 20)}... [${status}]`);
        if (result.bridgeResult.explorerUrl) {
          console.log(`🔗 ${result.bridgeResult.explorerUrl}`);
        }
      }
      console.log("🎉 PIN wallet claimed successfully!");
    } else {
      console.log("\n⚠️ " + result.message);
    }
  } catch (error) {
    console.log("\n❌ " + (error instanceof Error ? error.message : error));
  }
}

async function cmdPinList(): Promise<void> {
  const wallets = loadPinWallets();

  if (wallets.length === 0) {
    console.log("\nNo PIN wallets found");
    return;
  }

  console.log("\nPIN Wallets:");
  console.log("─".repeat(80));

  for (const w of wallets) {
    let statusIcon = "";
    switch (w.status) {
      case "PENDING":
        statusIcon = "⏳";
        break;
      case "PENDING_BRIDGE":
        statusIcon = "🔄";
        break;
      case "SETTLED":
        statusIcon = "✅";
        break;
      case "FAILED":
        statusIcon = "❌";
        break;
    }

    console.log(`${statusIcon} ID: ${w.id} | Amount: ${w.amount} USDC | Status: ${w.status}`);
    if (w.destination) {
      console.log(`   → ${w.destination} (${w.targetChain})`);
    }
    if (w.bridgeTxHash) {
      console.log(`   TX: ${w.bridgeTxHash}`);
    }
  }

  // Summary
  const summary = getPendingWalletsSummary();
  console.log("─".repeat(80));
  console.log(`Total: ${wallets.length} | Pending: ${summary.pending} | Bridge pending: ${summary.pendingBridge} | Settled: ${summary.settled} | Failed: ${summary.failed}`);
}

async function cmdRetry(): Promise<void> {
  console.log("\n🔄 Retrying pending bridges...");

  const result = await retryPendingBridges();

  console.log(`\nAttempted: ${result.attempted}`);
  console.log(`Succeeded: ${result.succeeded}`);
  console.log(`Failed: ${result.failed}`);
}

// ============================================================================
// Session Commands (Yellow Network Channel Lifecycle)
// ============================================================================

async function cmdSessionStart(args: string[]): Promise<void> {
  const userIdentifier = args[0] || undefined;

  console.log("\n🚀 Starting new session...");
  if (userIdentifier) {
    console.log(`   User: ${userIdentifier}`);
  }

  const result = await startSession(userIdentifier);

  if (result.success) {
    console.log("\n✅ " + result.message);
    console.log(`\n📋 Session ID: ${result.sessionId}`);
    if (result.channelId) {
      console.log(`📺 Channel ID: ${result.channelId}`);
    }
    console.log("\nUse 'session-deposit' to add funds (cash insertions)");
  } else {
    console.log("\n⚠️ " + result.message);
    console.log(`📋 Session ID: ${result.sessionId} (no channel)`);
  }
}

async function cmdSessionDeposit(args: string[]): Promise<void> {
  const sessionId = args[0] || (await prompt("Session ID: "));
  const amount = args[1] || (await prompt("Amount (default 0.01): ")) || "0.01";

  console.log(`\n💵 Processing cash deposit to session ${sessionId}...`);

  const result = await depositToSession(sessionId, amount);

  if (result.success) {
    console.log("\n✅ " + result.message);
  } else {
    console.log("\n⚠️ " + result.message);
  }

  console.log(`\n   Current Balance: ${result.newBalance} USDC`);
  console.log(`   Total Deposited: ${result.totalDeposited} USDC`);
}

async function cmdSessionEnd(args: string[]): Promise<void> {
  const sessionId = args[0] || (await prompt("Session ID: "));
  const dest = args[1] || (await prompt("Destination (address/ENS): "));
  const chainKey = args[2] || (await promptChainSelection());

  // Resolve destination
  const resolved = await resolveDestination(dest);
  if (!resolved) {
    console.log("\n❌ Invalid destination");
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    console.log("\n❌ Session not found");
    return;
  }

  console.log(`\n🏁 Ending session ${sessionId}...`);
  console.log(`   Balance: ${session.currentBalance} USDC`);
  console.log(`   Destination: ${resolved}`);
  console.log(`   Chain: ${chainKey}`);

  const confirm = await prompt("\nProceed? (y/n): ");
  if (confirm.toLowerCase() !== "y") {
    console.log("Cancelled.");
    return;
  }

  console.log("\n⏳ Closing channel and bridging...");

  const result = await endSession(sessionId, resolved, chainKey);

  if (result.success) {
    console.log("\n✅ " + result.message);
    if (result.bridgeTxHash) {
      console.log(`📜 Bridge TX: ${result.bridgeTxHash}`);
    }
    console.log(`💰 Net amount: ${result.settledAmount} USDC`);
    console.log(`💸 Fee: ${result.fee.fee} USDC (${result.fee.feePercentage}%)`);
  } else {
    console.log("\n❌ " + result.message);
  }
}

async function cmdSessionPin(args: string[]): Promise<void> {
  const sessionId = args[0] || (await prompt("Session ID: "));

  const session = getSession(sessionId);
  if (!session) {
    console.log("\n❌ Session not found");
    return;
  }

  if (session.status !== "ACTIVE") {
    console.log(`\n❌ Session is not active (status: ${session.status})`);
    return;
  }

  console.log(`\n🎫 Converting session ${sessionId} to PIN wallet...`);
  console.log(`   Balance: ${session.currentBalance} USDC`);

  const confirm = await prompt("\nGenerate PIN instead of settling now? (y/n): ");
  if (confirm.toLowerCase() !== "y") {
    console.log("Cancelled.");
    return;
  }

  console.log("\n⏳ Closing channel and generating PIN...");

  const result = await sessionToPin(sessionId);

  if (result.success) {
    console.log("\n" + "═".repeat(50));
    console.log("🎫 PIN WALLET CREATED");
    console.log("═".repeat(50));
    console.log(`\n   Wallet ID: ${result.walletId}`);
    console.log(`   PIN:       ${result.pin}`);
    console.log(`   Amount:    ${result.amount} USDC`);
    console.log("\n   ⚠️  SAVE THIS PIN - it cannot be recovered!");
    console.log("\n   To claim later: npm run cli pin-claim");
    console.log("═".repeat(50));
  } else {
    console.log("\n❌ " + result.message);
  }
}

async function cmdSessionStatus(args: string[]): Promise<void> {
  const sessionId = args[0];

  if (sessionId) {
    const session = getSession(sessionId);
    if (!session) {
      console.log("\n❌ Session not found");
      return;
    }
    console.log(formatSession(session));
    return;
  }

  // Show all sessions summary
  const summary = getSessionSummary();
  const active = getActiveSessions();

  console.log("\n" + "═".repeat(50));
  console.log("Ki0xk Sessions Summary");
  console.log("═".repeat(50));
  console.log(`Active:    ${summary.active}`);
  console.log(`Settling:  ${summary.settling}`);
  console.log(`Settled:   ${summary.settled}`);
  console.log(`Failed:    ${summary.failed}`);
  console.log(`\nActive Value: ${summary.totalValue} USDC`);

  if (active.length > 0) {
    console.log("\n─".repeat(50));
    console.log("Active Sessions:");
    for (const s of active) {
      const duration = Math.floor((Date.now() - s.startedAt) / 1000 / 60);
      console.log(`  ${s.id} | ${s.currentBalance} USDC | ${duration}m | ${s.channelId ? "📺" : "⚠️"}`);
    }
  }

  console.log("═".repeat(50));
}

async function cmdSessionList(): Promise<void> {
  const sessions = getAllSessions();

  if (sessions.length === 0) {
    console.log("\nNo sessions found");
    return;
  }

  console.log("\nAll Sessions:");
  console.log("─".repeat(80));

  for (const s of sessions) {
    let statusIcon = "";
    switch (s.status) {
      case "ACTIVE": statusIcon = "🟢"; break;
      case "SETTLING": statusIcon = "🔄"; break;
      case "SETTLED": statusIcon = "✅"; break;
      case "FAILED": statusIcon = "❌"; break;
    }

    console.log(`${statusIcon} ${s.id} | ${s.currentBalance.padStart(8)} USDC | ${s.status.padEnd(10)} | ${s.channelId ? "Channel: " + s.channelId.slice(0, 10) + "..." : "No channel"}`);

    if (s.destinationChain) {
      console.log(`   → ${s.destinationAddress?.slice(0, 20)}... (${s.destinationChain})`);
    }
  }

  console.log("─".repeat(80));
}

async function cmdResolve(args: string[]): Promise<void> {
  const name = args[0] || (await prompt("Enter ENS name or address: "));
  const resolved = await resolveDestination(name);

  if (resolved) {
    console.log(`\n✅ Resolved: ${resolved}`);
  } else {
    console.log(`\n❌ Could not resolve: ${name}`);
  }
}

async function cmdChains(): Promise<void> {
  console.log("\nSupported Chains (Testnet):");
  console.log("─".repeat(50));

  for (const key of CHAIN_OPTIONS) {
    const chain = SUPPORTED_CHAINS[key];
    console.log(`  ${key.padEnd(12)} → ${chain.name} (${chain.chainId})`);
  }

  console.log("─".repeat(50));
  console.log("Source: Arc Testnet (liquidity hub)");
}

async function cmdTest(): Promise<void> {
  console.log("\n🧪 Running test flow...\n");

  // 1. Check balances
  console.log("1. Checking balances...");
  await cmdBalances();

  // 2. Test ENS
  console.log("\n2. Testing ENS resolution...");
  const vitalik = await resolveENS("vitalik.eth");
  console.log(`   vitalik.eth → ${vitalik}`);

  // 3. Show chains
  console.log("\n3. Available chains:");
  await cmdChains();

  console.log("\n✅ Test flow complete!");
}

// ============================================================================
// Main CLI
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const cmdArgs = args.slice(1);

  console.log("═".repeat(50));
  console.log("Ki0xk CLI - Kiosk + Arc Bridge");
  console.log("═".repeat(50));

  if (config.MOCK_MODE) {
    console.log("⚠️  Running in MOCK_MODE\n");
  }

  try {
    switch (command) {
      case "balances":
      case "balance":
        await cmdBalances();
        break;

      case "settle":
        await cmdSettle(cmdArgs);
        break;

      case "bridge":
        await cmdBridge(cmdArgs);
        break;

      case "resolve":
        await cmdResolve(cmdArgs);
        break;

      case "chains":
        await cmdChains();
        break;

      case "pin-create":
        await cmdPinCreate(cmdArgs);
        break;

      case "pin-claim":
        await cmdPinClaim();
        break;

      case "pin-list":
        await cmdPinList();
        break;

      case "retry":
        await cmdRetry();
        break;

      case "test":
        await cmdTest();
        break;

      // Session commands (Yellow Network channel lifecycle)
      case "session-start":
        await cmdSessionStart(cmdArgs);
        break;

      case "session-deposit":
        await cmdSessionDeposit(cmdArgs);
        break;

      case "session-end":
        await cmdSessionEnd(cmdArgs);
        break;

      case "session-pin":
        await cmdSessionPin(cmdArgs);
        break;

      case "session-status":
      case "session":
        await cmdSessionStatus(cmdArgs);
        break;

      case "session-list":
      case "sessions":
        await cmdSessionList();
        break;

      default:
        console.log(`
Usage: npm run cli <command> [args]

Balances & Status:
  balances             Show Yellow + Arc balances
  chains               List supported chains

Sessions (Yellow Network Channels):
  session-start [user]           Start new session (opens channel)
  session-deposit <id> [amt]     Add funds (off-chain state update)
  session-end <id> <dest> [chain] End session (close channel + bridge)
  session-pin <id>               End session with PIN (no wallet needed)
  session-status [id]            Show session status
  sessions                       List all sessions

Settlement (Direct - no session):
  settle <dest> [chain] [amt]   Full settlement flow
  bridge <dest> [chain] [amt]   Direct Arc bridge only

ENS:
  resolve <name>       Resolve ENS or validate address

PIN Wallets:
  pin-create [amt]     Create PIN-protected deposit
  pin-claim            Claim funds with PIN + chain selection
  pin-list             List all PIN wallets
  retry                Retry pending bridges

Testing:
  test                 Run full test flow

Session Flow Examples:
  # User WITH wallet:
  npm run cli session-start              # Open channel
  npm run cli session-deposit S1234 5.00 # User inserts $5 cash
  npm run cli session-deposit S1234 2.50 # User inserts more cash
  npm run cli session-end S1234 0x... base # Close + bridge to Base

  # User WITHOUT wallet (first-timer):
  npm run cli session-start              # Open channel
  npm run cli session-deposit S1234 10.00 # User inserts cash
  npm run cli session-pin S1234          # Get PIN, settle later
  # Later: npm run cli pin-claim         # User returns with wallet

Examples:
  npm run cli balances
  npm run cli session-start
  npm run cli settle 0x8439...fC base 0.01
  npm run cli chains
`);
    }
  } catch (error) {
    console.error("\n❌ Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }

  process.exit(0);
}

main();
