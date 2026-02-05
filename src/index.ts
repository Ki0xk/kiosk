import { config } from "./config.js";
import { logger } from "./logger.js";
import { initWallet, getWalletInfo } from "./wallet.js";
import { getClearNode } from "./clearnode.js";

// Parse unified balance from ledger response
function parseUnifiedBalance(ledgerResponse: unknown): string {
  const data = ledgerResponse as any;
  const balances = data?.params?.balances || data?.params?.entries || [];

  for (const balance of balances) {
    // Look for ytest.usd balance
    if (balance?.asset === "ytest.usd" || balance?.symbol === "ytest.usd") {
      return balance?.amount || balance?.balance || "0";
    }
  }
  return "0";
}

// Check if any channels have non-zero balance (blocks transfers)
function hasBlockingChannels(channelsResponse: unknown): boolean {
  const data = channelsResponse as any;
  const channels = data?.params?.channels || [];

  for (const channel of channels) {
    // Check if channel has non-zero amount
    const amount = BigInt(channel?.amount || channel?.balance || "0");
    if (amount > 0n) {
      logger.warn("Channel with non-zero balance detected - this blocks transfers!", {
        channelId: channel?.channel_id || channel?.channelId,
        amount: amount.toString(),
      });
      return true;
    }
  }
  return false;
}

async function main() {
  logger.info("=".repeat(50));
  logger.info("Ki0xk Kiosk Starting...");
  logger.info("=".repeat(50));

  // Step 1: Initialize wallet
  await initWallet();

  // Step 2: Connect to ClearNode
  if (!config.MOCK_MODE) {
    const clearNode = getClearNode();

    try {
      await clearNode.connect();

      // Step 3: Fetch network config
      await clearNode.getConfig();

      // Step 4: Check supported assets (for Base Sepolia)
      await clearNode.getAssets(84532);

      // Step 5: Authenticate
      await clearNode.authenticate();
      logger.info("Authentication complete!");

      // Step 6: Check unified balance (this is where ATM funds live)
      const ledgerBalances = await clearNode.getLedgerBalances();
      const unifiedBalance = parseUnifiedBalance(ledgerBalances);
      logger.info("Unified Balance (ready for transfers)", {
        balance: `${unifiedBalance} ytest.usd`
      });

      // Step 7: Check for blocking channels
      // IMPORTANT: Yellow protocol blocks transfers if ANY channel has non-zero balance
      // For ATM use case, we work directly with unified balance - no channels needed
      const channels = await clearNode.getChannels();
      const hasBlockers = hasBlockingChannels(channels);

      if (hasBlockers) {
        logger.warn("=".repeat(50));
        logger.warn("WARNING: Channels with balance detected!");
        logger.warn("Transfers are BLOCKED until channels are emptied.");
        logger.warn("To fix: resize channels to zero or close them.");
        logger.warn("=".repeat(50));
      } else {
        logger.info("No blocking channels - ready for instant transfers!");
      }

      // NOTE: For ATM operation, we don't create channels.
      // Transfers happen directly from unified balance to destination wallets.
      // This is the simplest and most efficient flow for Ki0xk.

    } catch (error) {
      logger.error("ClearNode operation failed", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  } else {
    logger.info("Running in MOCK_MODE - skipping ClearNode connection");
  }

  // Show final status
  const walletInfo = await getWalletInfo();
  logger.info("=".repeat(50));
  logger.info("Kiosk Ready");
  logger.info(`  Address: ${walletInfo.address}`);
  logger.info(`  ETH:     ${walletInfo.ethBalance}`);
  logger.info(`  Chain:   Base Sepolia (${walletInfo.chainId})`);
  logger.info("=".repeat(50));
  logger.info("ATM Flow: Cash → transfer() → Destination Wallet");
  logger.info("=".repeat(50));
}

// Run
main().catch((error) => {
  logger.error("Fatal error", { error: error.message, stack: error.stack });
  process.exit(1);
});
