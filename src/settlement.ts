/**
 * Settlement Orchestrator
 *
 * Combines Yellow Network (accounting) with Arc Bridge (settlement)
 *
 * Flow:
 * 1. Record transaction in Yellow (ytest.usd accounting)
 * 2. Bridge real USDC via Arc to user's chain
 * 3. If bridge fails, create PIN wallet for retry
 */

import { getClearNode } from "./clearnode.js";
import { bridgeToChain, checkLiquidity, getArcBalance, type BridgeResult } from "./arc/bridge.js";
import { calculateFee, formatFeeBreakdown, type FeeBreakdown } from "./arc/fees.js";
import { SUPPORTED_CHAINS, getChainByKey } from "./arc/chains.js";
import { logger } from "./logger.js";
import { config } from "./config.js";
import { kioskAddress } from "./wallet.js";
import * as crypto from "crypto";
import * as fs from "fs";

// Yellow sandbox ytest.usd token
const YTEST_USD_TOKEN = "0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb";
const BASE_SEPOLIA_CHAIN_ID = 84532;

// PIN wallet storage
const PIN_WALLET_FILE = "./pin-wallets.json";

export interface PinWallet {
  id: string;
  pinHash: string;
  pin?: string; // Only included on creation
  amount: string;
  createdAt: number;

  // Settlement details
  destination?: string;
  targetChain?: string;

  // Status tracking
  status: "PENDING" | "PENDING_BRIDGE" | "SETTLED" | "FAILED";

  // Bridge failure handling
  bridgeAttempts: number;
  lastBridgeError?: string;
  lastBridgeAttempt?: number;

  // Final settlement
  bridgeTxHash?: string;
  settledAt?: number;
}

export interface SettlementResult {
  success: boolean;
  yellowRecorded: boolean;
  bridgeResult?: BridgeResult;
  fallbackPin?: string;
  fallbackId?: string;
  message: string;
}

export interface KioskBalances {
  yellow: {
    asset: string;
    amount: string;
    raw: string;
  };
  arc: {
    usdc: string;
  };
  timestamp: number;
}

// ============================================================================
// Balance Checking (for frontend display)
// ============================================================================

/**
 * Get all kiosk balances for display
 */
export async function getKioskBalances(): Promise<KioskBalances> {
  // Get Yellow balance
  let yellowBalance = { asset: "ytest.usd", amount: "0.00", raw: "0" };

  try {
    const clearNode = getClearNode();
    if (!clearNode.isAuthenticated) {
      await clearNode.connect();
      await clearNode.getConfig();
      await clearNode.authenticate();
    }

    const balances = await clearNode.getLedgerBalances();
    const data = balances as any;
    const entries = data?.params?.ledgerBalances || data?.params?.balances || [];

    for (const entry of entries) {
      if (entry?.asset === "ytest.usd") {
        const rawAmount = entry?.amount || "0";
        yellowBalance = {
          asset: "ytest.usd",
          amount: (Number(rawAmount) / 1_000_000).toFixed(2),
          raw: rawAmount,
        };
        break;
      }
    }
  } catch (error) {
    logger.error("Failed to get Yellow balance", { error });
  }

  // Get Arc balance
  const arcBalance = await getArcBalance();

  return {
    yellow: yellowBalance,
    arc: {
      usdc: arcBalance.usdc,
    },
    timestamp: Date.now(),
  };
}

/**
 * Format balances for display (frontend/CLI)
 */
export function formatBalances(balances: KioskBalances): string {
  return `
╔═══════════════════════════════════════════════════════╗
║           Ki0xk Kiosk Balances                        ║
╠═══════════════════════════════════════════════════════╣
║  Yellow (Accounting):  ${balances.yellow.amount.padStart(10)} ytest.usd        ║
║  Arc (Liquidity):      ${balances.arc.usdc.padStart(10)} USDC             ║
╠═══════════════════════════════════════════════════════╣
║  Updated: ${new Date(balances.timestamp).toLocaleTimeString().padEnd(42)}║
╚═══════════════════════════════════════════════════════╝`;
}

// ============================================================================
// Settlement Flow
// ============================================================================

/**
 * Full settlement: Yellow channel + Arc bridging
 *
 * Flow:
 * 1. Create PIN wallet first (safety backup)
 * 2. Open Yellow channel
 * 3. Bridge via Arc
 * 4. Close Yellow channel
 * 5. Success → PIN marked settled
 * 6. Failure → PIN ready for retry
 */
export async function settleToChain(
  destination: string,
  targetChainKey: string,
  amount: string
): Promise<SettlementResult> {
  const chainInfo = getChainByKey(targetChainKey);
  if (!chainInfo) {
    throw new Error(`Unsupported chain: ${targetChainKey}`);
  }

  const feeBreakdown = calculateFee(parseFloat(amount));

  logger.info("Starting settlement", {
    destination,
    chain: chainInfo.name,
    amount,
    fee: feeBreakdown.fee,
  });

  // Step 1: Create PIN wallet FIRST (safety backup)
  const wallets = loadPinWallets();
  const pin = generatePin();
  const pinWallet: PinWallet = {
    id: generateWalletId(),
    pinHash: hashPin(pin),
    amount,
    createdAt: Date.now(),
    destination,
    targetChain: targetChainKey,
    status: "PENDING_BRIDGE",
    bridgeAttempts: 0,
  };
  wallets.push(pinWallet);
  savePinWallets(wallets);

  logger.info("PIN backup created", { id: pinWallet.id, pin });

  let channelId: string | null = null;

  try {
    // Step 2: Connect and authenticate with Yellow
    const clearNode = getClearNode();
    if (!clearNode.isAuthenticated) {
      await clearNode.connect();
      await clearNode.getConfig();
      await clearNode.authenticate();
    }

    // Step 3: Open Yellow channel
    logger.info("Opening Yellow channel...");
    channelId = await clearNode.createChannel(YTEST_USD_TOKEN, BASE_SEPOLIA_CHAIN_ID);
    logger.info("Channel opened", { channelId });

    // Step 4: Bridge via Arc
    logger.info("Bridging via Arc...", { destination, chain: chainInfo.name });
    const feeRecipient = config.FEE_RECIPIENT_ADDRESS || undefined;
    const bridgeResult = await bridgeToChain(
      destination,
      targetChainKey,
      amount,
      feeRecipient
    );

    // Step 5: Close Yellow channel (best effort)
    if (channelId) {
      const exists = await clearNode.channelExists(channelId);
      if (exists) {
        try {
          logger.info("Closing Yellow channel...");
          await clearNode.closeChannel(channelId, kioskAddress);
          logger.info("Channel closed");
        } catch (closeError) {
          logger.debug("Channel close failed", {
            reason: closeError instanceof Error ? closeError.message : "unknown"
          });
        }
      } else {
        logger.info("Channel auto-closed (zero-balance)");
      }
    }

    // Step 6: Update PIN status based on BRIDGE result (not channel close)
    if (bridgeResult.success) {
      pinWallet.status = "SETTLED";
      pinWallet.bridgeTxHash = bridgeResult.txHash;
      pinWallet.settledAt = Date.now();
      savePinWallets(wallets);

      return {
        success: true,
        yellowRecorded: true,
        bridgeResult,
        message: `Settlement complete! ${feeBreakdown.netAmount} USDC sent to ${chainInfo.name}`,
      };
    } else {
      pinWallet.bridgeAttempts++;
      pinWallet.lastBridgeError = bridgeResult.error;
      pinWallet.lastBridgeAttempt = Date.now();
      savePinWallets(wallets);

      return {
        success: false,
        yellowRecorded: true,
        bridgeResult,
        fallbackPin: pin,
        fallbackId: pinWallet.id,
        message: `Bridge failed. PIN: ${pin} - Use to retry later.`,
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("Settlement failed", { error: errorMsg });

    // Try to close channel if it was opened
    if (channelId) {
      try {
        const clearNode = getClearNode();
        await clearNode.closeChannel(channelId, kioskAddress);
      } catch {
        // Ignore close errors
      }
    }

    // Update PIN wallet with error
    pinWallet.bridgeAttempts++;
    pinWallet.lastBridgeError = errorMsg;
    pinWallet.lastBridgeAttempt = Date.now();
    savePinWallets(wallets);

    return {
      success: false,
      yellowRecorded: false,
      fallbackPin: pin,
      fallbackId: pinWallet.id,
      message: `Settlement failed. PIN: ${pin} - Use to retry later.`,
    };
  }
}

// ============================================================================
// PIN Wallet Management
// ============================================================================

function hashPin(pin: string): string {
  return crypto.createHash("sha256").update(pin).digest("hex");
}

function generatePin(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

// Wallet ID: 6 chars from 0-9 + A-D (matches frontend 4x4 physical keypad)
const WALLET_ID_CHARS = "0123456789ABCD";
const WALLET_ID_LENGTH = 6;

function generateWalletId(): string {
  let result = "";
  for (let i = 0; i < WALLET_ID_LENGTH; i++) {
    result += WALLET_ID_CHARS[crypto.randomInt(WALLET_ID_CHARS.length)];
  }
  return result;
}

export function loadPinWallets(): PinWallet[] {
  try {
    if (fs.existsSync(PIN_WALLET_FILE)) {
      return JSON.parse(fs.readFileSync(PIN_WALLET_FILE, "utf-8"));
    }
  } catch {
    // Ignore
  }
  return [];
}

export function savePinWallets(wallets: PinWallet[]): void {
  fs.writeFileSync(PIN_WALLET_FILE, JSON.stringify(wallets, null, 2));
}

/**
 * Create a PIN wallet for pending bridge (failure fallback)
 */
function createPendingBridgeWallet(params: {
  amount: string;
  destination: string;
  targetChain: string;
  error: string;
}): PinWallet & { pin: string } {
  const pin = generatePin();
  const wallet: PinWallet = {
    id: generateWalletId(),
    pinHash: hashPin(pin),
    amount: params.amount,
    createdAt: Date.now(),
    destination: params.destination,
    targetChain: params.targetChain,
    status: "PENDING_BRIDGE",
    bridgeAttempts: 1,
    lastBridgeError: params.error,
    lastBridgeAttempt: Date.now(),
  };

  const wallets = loadPinWallets();
  wallets.push(wallet);
  savePinWallets(wallets);

  logger.info("Created pending bridge PIN wallet", {
    id: wallet.id,
    destination: params.destination,
    chain: params.targetChain,
  });

  return { ...wallet, pin };
}

/**
 * Create a standard PIN wallet (user deposit without wallet)
 */
export function createPinWallet(amount: string): PinWallet & { pin: string } {
  const pin = generatePin();
  const wallet: PinWallet = {
    id: generateWalletId(),
    pinHash: hashPin(pin),
    amount,
    createdAt: Date.now(),
    status: "PENDING",
    bridgeAttempts: 0,
  };

  const wallets = loadPinWallets();
  wallets.push(wallet);
  savePinWallets(wallets);

  logger.info("Created PIN wallet", { id: wallet.id, amount });

  return { ...wallet, pin };
}

/**
 * Claim PIN wallet - verify PIN and settle to chain
 *
 * Uses Yellow Network channel as settlement wrapper:
 * 1. Verify PIN
 * 2. Open channel (Yellow Network)
 * 3. Bridge via Arc
 * 4. Close channel
 * 5. If bridge fails, PIN still valid for retry
 */
export async function claimPinWallet(
  walletId: string,
  pin: string,
  destination: string,
  targetChainKey: string
): Promise<SettlementResult> {
  const wallets = loadPinWallets();
  const wallet = wallets.find(
    (w) => w.id === walletId && (w.status === "PENDING" || w.status === "PENDING_BRIDGE")
  );

  if (!wallet) {
    throw new Error("Wallet not found or already claimed");
  }

  // Verify PIN
  if (hashPin(pin) !== wallet.pinHash) {
    throw new Error("Invalid PIN");
  }

  const chainInfo = getChainByKey(targetChainKey);
  if (!chainInfo) {
    throw new Error(`Unsupported chain: ${targetChainKey}`);
  }

  // Update wallet with destination info
  wallet.destination = destination;
  wallet.targetChain = targetChainKey;
  savePinWallets(wallets);

  const feeBreakdown = calculateFee(parseFloat(wallet.amount));

  logger.info("Claiming PIN wallet with channel settlement", {
    walletId,
    destination,
    chain: chainInfo.name,
    amount: wallet.amount,
  });

  let channelId: string | null = null;

  try {
    // Step 1: Connect and authenticate
    const clearNode = getClearNode();
    if (!clearNode.isAuthenticated) {
      await clearNode.connect();
      await clearNode.getConfig();
      await clearNode.authenticate();
    }

    // Step 2: Open channel (Yellow Network integration)
    logger.info("Opening Yellow channel for settlement...");
    channelId = await clearNode.createChannel(YTEST_USD_TOKEN, BASE_SEPOLIA_CHAIN_ID);
    logger.info("Channel opened", { channelId });

    // Step 3: Bridge via Arc
    logger.info("Bridging via Arc...", { destination, chain: chainInfo.name });
    const feeRecipient = config.FEE_RECIPIENT_ADDRESS || undefined;
    const bridgeResult = await bridgeToChain(
      destination,
      targetChainKey,
      wallet.amount,
      feeRecipient
    );

    // Step 4: Close channel (best effort)
    if (channelId) {
      const exists = await clearNode.channelExists(channelId);
      if (exists) {
        try {
          logger.info("Closing Yellow channel...");
          await clearNode.closeChannel(channelId, kioskAddress);
          logger.info("Channel closed");
        } catch (closeError) {
          logger.debug("Channel close failed", {
            reason: closeError instanceof Error ? closeError.message : "unknown"
          });
        }
      } else {
        logger.info("Channel auto-closed (zero-balance)");
      }
    }

    if (bridgeResult.success) {
      wallet.status = "SETTLED";
      wallet.bridgeTxHash = bridgeResult.txHash;
      wallet.settledAt = Date.now();
      savePinWallets(wallets);

      return {
        success: true,
        yellowRecorded: true,
        bridgeResult,
        message: `Settlement complete! ${feeBreakdown.netAmount} USDC sent to ${chainInfo.name}`,
      };
    } else {
      wallet.status = "PENDING_BRIDGE";
      wallet.bridgeAttempts++;
      wallet.lastBridgeError = bridgeResult.error;
      wallet.lastBridgeAttempt = Date.now();
      savePinWallets(wallets);

      return {
        success: false,
        yellowRecorded: true,
        bridgeResult,
        message: `Bridge failed: ${bridgeResult.error}. PIN still valid for retry.`,
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("Settlement failed", { walletId, error: errorMsg });

    // Try to close channel if it was opened
    if (channelId) {
      try {
        const clearNode = getClearNode();
        await clearNode.closeChannel(channelId, kioskAddress);
      } catch {
        // Ignore close errors
      }
    }

    wallet.status = "PENDING_BRIDGE";
    wallet.bridgeAttempts++;
    wallet.lastBridgeError = errorMsg;
    wallet.lastBridgeAttempt = Date.now();
    savePinWallets(wallets);

    return {
      success: false,
      yellowRecorded: false,
      message: `Settlement failed: ${errorMsg}. PIN still valid for retry.`,
    };
  }
}

/**
 * Retry pending bridge wallets
 */
export async function retryPendingBridges(): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
}> {
  const wallets = loadPinWallets();
  const pending = wallets.filter(
    (w) => w.status === "PENDING_BRIDGE" && w.bridgeAttempts < 3
  );

  let succeeded = 0;
  let failed = 0;

  for (const wallet of pending) {
    if (!wallet.destination || !wallet.targetChain) continue;

    logger.info("Retrying bridge", { id: wallet.id, attempt: wallet.bridgeAttempts + 1 });

    const feeRecipient = config.FEE_RECIPIENT_ADDRESS || undefined;
    const result = await bridgeToChain(
      wallet.destination,
      wallet.targetChain,
      wallet.amount,
      feeRecipient
    );

    if (result.success) {
      wallet.status = "SETTLED";
      wallet.bridgeTxHash = result.txHash;
      wallet.settledAt = Date.now();
      succeeded++;
      logger.info("Retry succeeded", { id: wallet.id, txHash: result.txHash });
    } else {
      wallet.bridgeAttempts++;
      wallet.lastBridgeError = result.error;
      wallet.lastBridgeAttempt = Date.now();

      if (wallet.bridgeAttempts >= 3) {
        wallet.status = "FAILED";
        failed++;
        logger.error("Retry failed permanently", { id: wallet.id });
      }
    }
  }

  savePinWallets(wallets);

  return {
    attempted: pending.length,
    succeeded,
    failed,
  };
}

/**
 * Get pending PIN wallets summary
 */
export function getPendingWalletsSummary(): {
  pending: number;
  pendingBridge: number;
  settled: number;
  failed: number;
  totalValue: string;
} {
  const wallets = loadPinWallets();

  const counts = {
    pending: 0,
    pendingBridge: 0,
    settled: 0,
    failed: 0,
  };

  let totalPendingValue = 0;

  for (const w of wallets) {
    switch (w.status) {
      case "PENDING":
        counts.pending++;
        totalPendingValue += parseFloat(w.amount);
        break;
      case "PENDING_BRIDGE":
        counts.pendingBridge++;
        totalPendingValue += parseFloat(w.amount);
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
    totalValue: totalPendingValue.toFixed(2),
  };
}
