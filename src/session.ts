/**
 * Ki0xk Session Management
 *
 * Demonstrates Yellow Network's session-based state channels:
 * 1. Session Start (Channel Open) - User starts interaction
 * 2. Session Activity (Off-chain) - Multiple cash insertions, instant
 * 3. Session End (Channel Close) - Settle to user's chosen chain
 *
 * This is the flow Yellow Network wants to see:
 * - Create channel → off-chain operations → close/settle
 */

import { getClearNode } from "./clearnode.js";
import { bridgeToChain } from "./arc/bridge.js";
import { calculateFee, type FeeBreakdown } from "./arc/fees.js";
import { getChainByKey } from "./arc/chains.js";
import { createPinWallet } from "./settlement.js";
import { logger } from "./logger.js";
import { config } from "./config.js";
import { kioskAddress } from "./wallet.js";
import * as crypto from "crypto";
import * as fs from "fs";

// Session storage
const SESSION_FILE = "./sessions.json";

// Yellow sandbox ytest.usd token
const YTEST_USD_TOKEN = "0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb";
const BASE_SEPOLIA_CHAIN_ID = 84532;

export interface KioskSession {
  id: string;
  channelId?: string;

  // User info
  userIdentifier?: string; // ENS, address, or NFC ID

  // Balance tracking
  totalDeposited: string;  // Total cash inserted
  currentBalance: string;  // Current session balance

  // Timestamps
  startedAt: number;
  lastActivityAt: number;
  endedAt?: number;

  // Status
  status: "ACTIVE" | "SETTLING" | "SETTLED" | "FAILED";

  // Settlement info (when session ends)
  destinationAddress?: string;
  destinationChain?: string;
  bridgeTxHash?: string;
  fee?: FeeBreakdown;

  // Error tracking
  error?: string;
}

export interface SessionStartResult {
  success: boolean;
  sessionId: string;
  channelId?: string;
  message: string;
}

export interface SessionDepositResult {
  success: boolean;
  newBalance: string;
  totalDeposited: string;
  message: string;
}

export interface SessionEndResult {
  success: boolean;
  settledAmount: string;
  fee: FeeBreakdown;
  bridgeTxHash?: string;
  destinationChain: string;
  message: string;
}

export interface SessionPinResult {
  success: boolean;
  pin: string;
  walletId: string;
  amount: string;
  message: string;
}

// ============================================================================
// Session Storage
// ============================================================================

function loadSessions(): KioskSession[] {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8"));
    }
  } catch {
    // Ignore
  }
  return [];
}

function saveSessions(sessions: KioskSession[]): void {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2));
}

function generateSessionId(): string {
  return "S" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

// ============================================================================
// Session Lifecycle
// ============================================================================

/**
 * Start a new kiosk session
 *
 * This creates a Yellow Network channel for the session.
 * All subsequent operations happen off-chain until settlement.
 */
export async function startSession(userIdentifier?: string): Promise<SessionStartResult> {
  const sessionId = generateSessionId();

  logger.info("Starting new kiosk session", { sessionId, userIdentifier });

  try {
    // Connect and authenticate with ClearNode
    const clearNode = getClearNode();
    if (!clearNode.isAuthenticated) {
      await clearNode.connect();
      await clearNode.getConfig();
      await clearNode.authenticate();
    }

    // Create a channel for this session
    const channelId = await clearNode.createChannel(
      YTEST_USD_TOKEN,
      BASE_SEPOLIA_CHAIN_ID
    );
    logger.info("Yellow channel created", { channelId: channelId?.slice(0, 20) + "..." });

    // Create session record
    const session: KioskSession = {
      id: sessionId,
      channelId,
      userIdentifier,
      totalDeposited: "0",
      currentBalance: "0",
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      status: "ACTIVE",
    };

    const sessions = loadSessions();
    sessions.push(session);
    saveSessions(sessions);

    return {
      success: true,
      sessionId,
      channelId,
      message: `Session ${sessionId} started. Channel: ${channelId}`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to start session", { sessionId, error: errorMsg });

    // Create session even if channel failed (for tracking)
    const session: KioskSession = {
      id: sessionId,
      userIdentifier,
      totalDeposited: "0",
      currentBalance: "0",
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      status: "ACTIVE",
      error: errorMsg,
    };

    const sessions = loadSessions();
    sessions.push(session);
    saveSessions(sessions);

    return {
      success: false,
      sessionId,
      message: `Session started but channel creation failed: ${errorMsg}`,
    };
  }
}

/**
 * Add funds to an active session (user inserted cash)
 *
 * This is an OFF-CHAIN operation using Yellow's state channels.
 * No gas fees, instant update.
 */
export async function depositToSession(
  sessionId: string,
  amount: string
): Promise<SessionDepositResult> {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === sessionId && s.status === "ACTIVE");

  if (!session) {
    throw new Error(`Session ${sessionId} not found or not active`);
  }

  const depositAmount = parseFloat(amount);
  if (isNaN(depositAmount) || depositAmount <= 0) {
    throw new Error(`Invalid deposit amount: ${amount}`);
  }

  logger.info("Processing cash deposit", { sessionId, amount });

  try {
    // If we have a channel, resize it to add funds
    // This is the off-chain state update
    if (session.channelId) {
      const clearNode = getClearNode();

      // Authenticate if needed (each CLI call is a fresh process)
      if (!clearNode.isAuthenticated) {
        await clearNode.connect();
        await clearNode.getConfig();
        await clearNode.authenticate();
      }

      // Convert to micro units (6 decimals for USDC)
      const microAmount = BigInt(Math.floor(depositAmount * 1_000_000));

      logger.info("Resizing channel (off-chain state update)", {
        sessionId,
        channelId: session.channelId,
        amount: microAmount.toString(),
      });

      await clearNode.resizeChannel(
        session.channelId,
        microAmount,
        kioskAddress // Funds come from kiosk's unified balance
      );

      logger.info("Channel resized successfully", { sessionId });
    }

    // Update session balance
    const currentBalance = parseFloat(session.currentBalance);
    const totalDeposited = parseFloat(session.totalDeposited);

    session.currentBalance = (currentBalance + depositAmount).toFixed(2);
    session.totalDeposited = (totalDeposited + depositAmount).toFixed(2);
    session.lastActivityAt = Date.now();

    saveSessions(sessions);

    return {
      success: true,
      newBalance: session.currentBalance,
      totalDeposited: session.totalDeposited,
      message: `Deposited ${amount} USDC. Session balance: ${session.currentBalance}`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("Deposit failed", { sessionId, error: errorMsg });

    // Still update local balance even if channel resize fails
    // (for demo purposes - in production would handle differently)
    const currentBalance = parseFloat(session.currentBalance);
    const totalDeposited = parseFloat(session.totalDeposited);
    session.currentBalance = (currentBalance + depositAmount).toFixed(2);
    session.totalDeposited = (totalDeposited + depositAmount).toFixed(2);
    session.lastActivityAt = Date.now();
    session.error = errorMsg;
    saveSessions(sessions);

    return {
      success: false,
      newBalance: session.currentBalance,
      totalDeposited: session.totalDeposited,
      message: `Balance updated but channel sync failed: ${errorMsg}`,
    };
  }
}

/**
 * End session and settle to user's chain
 *
 * This closes the Yellow channel and bridges real USDC via Arc.
 */
export async function endSession(
  sessionId: string,
  destinationAddress: string,
  targetChainKey: string
): Promise<SessionEndResult> {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === sessionId && s.status === "ACTIVE");

  if (!session) {
    throw new Error(`Session ${sessionId} not found or not active`);
  }

  const chainInfo = getChainByKey(targetChainKey);
  if (!chainInfo) {
    throw new Error(`Unsupported chain: ${targetChainKey}`);
  }

  const settleAmount = parseFloat(session.currentBalance);
  if (settleAmount <= 0) {
    throw new Error("No balance to settle");
  }

  const feeBreakdown = calculateFee(settleAmount);

  logger.info("Ending session", {
    sessionId,
    destination: destinationAddress,
    chain: chainInfo.name,
    amount: session.currentBalance,
    fee: feeBreakdown.fee,
  });

  session.status = "SETTLING";
  session.destinationAddress = destinationAddress;
  session.destinationChain = targetChainKey;
  session.fee = feeBreakdown;
  saveSessions(sessions);

  try {
    // Step 1: Close the Yellow channel (on-chain settlement)
    if (session.channelId) {
      const clearNode = getClearNode();

      // Authenticate if needed (each CLI call is a fresh process)
      if (!clearNode.isAuthenticated) {
        await clearNode.connect();
        await clearNode.getConfig();
        await clearNode.authenticate();
      }

      // Check if channel still exists before closing
      const exists = await clearNode.channelExists(session.channelId);
      if (exists) {
        logger.info("Closing Yellow channel...");
        await clearNode.closeChannel(session.channelId, kioskAddress);
        logger.info("Channel closed");
      } else {
        logger.info("Channel auto-closed (zero-balance)");
      }
    }

    // Step 2: Bridge real USDC via Arc to user's chain
    logger.info("Bridging via Arc...", {
      sessionId,
      destination: destinationAddress,
      chain: chainInfo.name,
      amount: feeBreakdown.netAmount,
    });

    const feeRecipient = config.FEE_RECIPIENT_ADDRESS || undefined;
    const bridgeResult = await bridgeToChain(
      destinationAddress,
      targetChainKey,
      session.currentBalance,
      feeRecipient
    );

    if (bridgeResult.success) {
      session.status = "SETTLED";
      session.bridgeTxHash = bridgeResult.txHash;
      session.endedAt = Date.now();
      saveSessions(sessions);

      logger.info("Session settled successfully!", {
        sessionId,
        txHash: bridgeResult.txHash,
        chain: chainInfo.name,
      });

      return {
        success: true,
        settledAmount: feeBreakdown.netAmount.toString(),
        fee: feeBreakdown,
        bridgeTxHash: bridgeResult.txHash,
        destinationChain: chainInfo.name,
        message: `Session settled! ${feeBreakdown.netAmount} USDC sent to ${chainInfo.name}`,
      };
    } else {
      session.status = "FAILED";
      session.error = bridgeResult.error;
      session.endedAt = Date.now();
      saveSessions(sessions);

      return {
        success: false,
        settledAmount: "0",
        fee: feeBreakdown,
        destinationChain: chainInfo.name,
        message: `Bridge failed: ${bridgeResult.error}`,
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    session.status = "FAILED";
    session.error = errorMsg;
    session.endedAt = Date.now();
    saveSessions(sessions);

    logger.error("Session settlement failed", { sessionId, error: errorMsg });

    return {
      success: false,
      settledAmount: "0",
      fee: feeBreakdown,
      destinationChain: chainInfo.name,
      message: `Settlement failed: ${errorMsg}`,
    };
  }
}

/**
 * Convert session to PIN wallet (user doesn't have wallet yet)
 *
 * This closes the Yellow channel and creates a PIN wallet.
 * User can claim later with the PIN and choose their destination chain.
 *
 * Flow:
 * 1. Close Yellow channel (funds return to kiosk)
 * 2. Create PIN wallet with the session balance
 * 3. User gets PIN to claim later
 */
export async function sessionToPin(sessionId: string): Promise<SessionPinResult> {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === sessionId && s.status === "ACTIVE");

  if (!session) {
    throw new Error(`Session ${sessionId} not found or not active`);
  }

  const amount = parseFloat(session.currentBalance);
  if (amount <= 0) {
    throw new Error("No balance to convert to PIN");
  }

  logger.info("Converting session to PIN wallet", {
    sessionId,
    amount: session.currentBalance,
  });

  try {
    // Step 1: Close the Yellow channel
    if (session.channelId) {
      const clearNode = getClearNode();

      // Authenticate if needed (each CLI call is a fresh process)
      if (!clearNode.isAuthenticated) {
        await clearNode.connect();
        await clearNode.getConfig();
        await clearNode.authenticate();
      }

      // Check if channel still exists before closing
      const exists = await clearNode.channelExists(session.channelId);
      if (exists) {
        logger.info("Closing Yellow channel...");
        await clearNode.closeChannel(session.channelId, kioskAddress);
        logger.info("Channel closed");
      } else {
        logger.info("Channel auto-closed (zero-balance)");
      }
    }

    // Step 2: Create PIN wallet
    const pinWallet = createPinWallet(session.currentBalance);

    // Step 3: Mark session as settled (converted to PIN)
    session.status = "SETTLED";
    session.endedAt = Date.now();
    saveSessions(sessions);

    logger.info("Session converted to PIN wallet", {
      sessionId,
      pinWalletId: pinWallet.id,
    });

    return {
      success: true,
      pin: pinWallet.pin,
      walletId: pinWallet.id,
      amount: session.currentBalance,
      message: `Session converted to PIN wallet. PIN: ${pinWallet.pin}`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("Failed to convert session to PIN", { sessionId, error: errorMsg });

    // Still try to create PIN wallet even if channel close failed
    try {
      const pinWallet = createPinWallet(session.currentBalance);
      session.status = "SETTLED";
      session.error = `Channel close failed but PIN created: ${errorMsg}`;
      session.endedAt = Date.now();
      saveSessions(sessions);

      return {
        success: true,
        pin: pinWallet.pin,
        walletId: pinWallet.id,
        amount: session.currentBalance,
        message: `PIN created (channel close had issues): ${pinWallet.pin}`,
      };
    } catch (pinError) {
      session.status = "FAILED";
      session.error = errorMsg;
      session.endedAt = Date.now();
      saveSessions(sessions);

      return {
        success: false,
        pin: "",
        walletId: "",
        amount: session.currentBalance,
        message: `Failed to create PIN: ${errorMsg}`,
      };
    }
  }
}

// ============================================================================
// Session Queries
// ============================================================================

export function getSession(sessionId: string): KioskSession | undefined {
  const sessions = loadSessions();
  return sessions.find((s) => s.id === sessionId);
}

export function getActiveSessions(): KioskSession[] {
  const sessions = loadSessions();
  return sessions.filter((s) => s.status === "ACTIVE");
}

export function getAllSessions(): KioskSession[] {
  return loadSessions();
}

export function getSessionSummary(): {
  active: number;
  settling: number;
  settled: number;
  failed: number;
  totalValue: string;
} {
  const sessions = loadSessions();

  const counts = {
    active: 0,
    settling: 0,
    settled: 0,
    failed: 0,
  };

  let totalActiveValue = 0;

  for (const s of sessions) {
    switch (s.status) {
      case "ACTIVE":
        counts.active++;
        totalActiveValue += parseFloat(s.currentBalance);
        break;
      case "SETTLING":
        counts.settling++;
        break;
      case "SETTLED":
        counts.settled++;
        break;
      case "FAILED":
        counts.failed++;
        break;
    }
  }

  return {
    ...counts,
    totalValue: totalActiveValue.toFixed(2),
  };
}

/**
 * Format session info for display
 */
export function formatSession(session: KioskSession): string {
  const duration = Math.floor((Date.now() - session.startedAt) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;

  let output = `
╔═══════════════════════════════════════════════════════╗
║              Ki0xk Session: ${session.id.padEnd(26)}║
╠═══════════════════════════════════════════════════════╣
║  Status:        ${session.status.padEnd(38)}║
║  Balance:       ${(session.currentBalance + " USDC").padEnd(38)}║
║  Deposited:     ${(session.totalDeposited + " USDC").padEnd(38)}║
║  Duration:      ${(minutes + "m " + seconds + "s").padEnd(38)}║`;

  if (session.channelId) {
    output += `\n║  Channel:       ${session.channelId.slice(0, 30).padEnd(38)}║`;
  }

  if (session.userIdentifier) {
    output += `\n║  User:          ${session.userIdentifier.slice(0, 30).padEnd(38)}║`;
  }

  if (session.destinationChain) {
    output += `\n║  Dest Chain:    ${session.destinationChain.padEnd(38)}║`;
  }

  if (session.bridgeTxHash) {
    output += `\n║  Bridge TX:     ${session.bridgeTxHash.slice(0, 30).padEnd(38)}║`;
  }

  if (session.error) {
    output += `\n║  Error:         ${session.error.slice(0, 30).padEnd(38)}║`;
  }

  output += `\n╚═══════════════════════════════════════════════════════╝`;

  return output;
}
