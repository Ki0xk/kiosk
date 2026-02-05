/**
 * Arc Bridge Kit Integration
 *
 * Bridges USDC from Arc Testnet to user's selected chain
 * Uses Circle's CCTP for cross-chain transfers
 */

import { BridgeKit } from "@circle-fin/bridge-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, http, formatUnits } from "viem";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { calculateFee, type FeeBreakdown } from "./fees.js";
import { SUPPORTED_CHAINS, type ChainInfo } from "./chains.js";

// Bridge Kit instance (singleton)
let bridgeKit: BridgeKit | null = null;

function getBridgeKit(): BridgeKit {
  if (!bridgeKit) {
    bridgeKit = new BridgeKit();
  }
  return bridgeKit;
}

// Arc Testnet USDC contract (to check balance)
const ARC_TESTNET_RPC = "https://rpc-testnet.arc.network"; // May need adjustment
const ARC_USDC_ADDRESS = "0x..." as const; // TBD - Get from Circle docs

export interface BridgeResult {
  success: boolean;
  txHash?: string;
  sourceChain: string;
  destinationChain: string;
  amount: string;
  fee: FeeBreakdown;
  error?: string;
}

export interface ArcBalance {
  usdc: string;
  usdcRaw: bigint;
}

/**
 * Get USDC balance on Arc Testnet
 */
export async function getArcBalance(): Promise<ArcBalance> {
  try {
    // For now, we'll use a simplified approach
    // In production, query the USDC contract on Arc
    const kit = getBridgeKit();
    const adapter = createViemAdapterFromPrivateKey({
      privateKey: config.PRIVATE_KEY as `0x${string}`,
    });

    // Get balance through adapter
    // Note: Bridge Kit may provide balance checking utilities
    // For hackathon, we'll estimate or use a placeholder

    logger.debug("Checking Arc balance...");

    // Placeholder - in production, query USDC contract
    // const balance = await publicClient.readContract({
    //   address: ARC_USDC_ADDRESS,
    //   abi: erc20Abi,
    //   functionName: "balanceOf",
    //   args: [walletAddress],
    // });

    return {
      usdc: "0.00", // Will be updated when we have Arc RPC
      usdcRaw: 0n,
    };
  } catch (error) {
    logger.error("Failed to get Arc balance", { error });
    return {
      usdc: "0.00",
      usdcRaw: 0n,
    };
  }
}

/**
 * Bridge USDC from Arc Testnet to destination chain
 */
export async function bridgeToChain(
  destinationAddress: string,
  targetChainKey: string,
  amount: string,
  feeRecipient?: string
): Promise<BridgeResult> {
  const kit = getBridgeKit();
  const chainInfo = SUPPORTED_CHAINS[targetChainKey];

  if (!chainInfo) {
    throw new Error(`Unsupported chain: ${targetChainKey}`);
  }

  // Calculate fee
  const feeBreakdown = calculateFee(parseFloat(amount));

  logger.info("Initiating Arc Bridge", {
    destination: destinationAddress,
    chain: chainInfo.name,
    grossAmount: amount,
    netAmount: feeBreakdown.netAmount,
    fee: feeBreakdown.fee,
  });

  try {
    // Create adapter from private key
    const adapter = createViemAdapterFromPrivateKey({
      privateKey: config.PRIVATE_KEY as `0x${string}`,
    });

    // Build bridge config
    const bridgeConfig: any = {
      from: {
        adapter,
        chain: "Arc_Testnet",
      },
      to: {
        adapter,
        chain: chainInfo.bridgeKitName,
        recipientAddress: destinationAddress,
      },
      amount: feeBreakdown.netAmount.toString(),
    };

    // Add fee collection if recipient provided
    if (feeRecipient && feeBreakdown.fee > 0) {
      bridgeConfig.config = {
        customFee: {
          value: feeBreakdown.fee.toString(),
          recipientAddress: feeRecipient,
        },
      };
    }

    logger.debug("Bridge config", { bridgeConfig });

    // Execute bridge
    const result = await kit.bridge(bridgeConfig);

    // Extract txHash from result (may be nested in different properties)
    const txHash = (result as any)?.txHash
      || (result as any)?.transactionHash
      || (result as any)?.hash
      || (result as any)?.tx?.hash
      || "pending";

    logger.info("Bridge successful!", {
      txHash,
      chain: chainInfo.name,
      result,
    });

    return {
      success: true,
      txHash,
      sourceChain: "Arc_Testnet",
      destinationChain: chainInfo.name,
      amount: feeBreakdown.netAmount.toString(),
      fee: feeBreakdown,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("Bridge failed", { error: errorMsg, chain: chainInfo.name });

    return {
      success: false,
      sourceChain: "Arc_Testnet",
      destinationChain: chainInfo.name,
      amount: feeBreakdown.netAmount.toString(),
      fee: feeBreakdown,
      error: errorMsg,
    };
  }
}

/**
 * Check if we have enough liquidity for a transfer
 */
export async function checkLiquidity(amount: string): Promise<{
  sufficient: boolean;
  available: string;
  required: string;
}> {
  const arcBalance = await getArcBalance();
  const required = parseFloat(amount);
  const available = parseFloat(arcBalance.usdc);

  return {
    sufficient: available >= required,
    available: arcBalance.usdc,
    required: amount,
  };
}
