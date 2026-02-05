/**
 * Arc Bridge Kit Integration
 *
 * Bridges USDC from Arc Testnet to user's selected chain
 * Uses Circle's CCTP for cross-chain transfers
 */

import { BridgeKit } from "@circle-fin/bridge-kit";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { createPublicClient, http, formatUnits, type Hash, type Chain } from "viem";
import {
  baseSepolia,
  sepolia,
  arbitrumSepolia,
  polygonAmoy,
  optimismSepolia,
  avalancheFuji,
  lineaSepolia,
} from "viem/chains";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { calculateFee, type FeeBreakdown } from "./fees.js";
import { SUPPORTED_CHAINS, type ChainInfo } from "./chains.js";

// Bridge Kit instance (singleton)
let bridgeKit: BridgeKit | null = null;

function getBridgeKit(): BridgeKit {
  if (!bridgeKit) {
    // Suppress verbose BridgeKit logging by setting environment
    const originalDebug = process.env.DEBUG;
    process.env.DEBUG = "";
    bridgeKit = new BridgeKit();
    if (originalDebug !== undefined) {
      process.env.DEBUG = originalDebug;
    }
  }
  return bridgeKit;
}

// Map chain keys to viem chain objects
const VIEM_CHAINS: Record<string, Chain> = {
  base: baseSepolia,
  ethereum: sepolia,
  arbitrum: arbitrumSepolia,
  polygon: polygonAmoy,
  optimism: optimismSepolia,
  avalanche: avalancheFuji,
  linea: lineaSepolia,
};

/**
 * Wait for transaction confirmation and return status
 */
async function waitForTxConfirmation(
  txHash: string,
  chainKey: string,
  timeoutMs: number = 15000
): Promise<{ status: "success" | "reverted" | "pending"; confirmations?: bigint }> {
  const chain = VIEM_CHAINS[chainKey];
  const chainInfo = SUPPORTED_CHAINS[chainKey];

  if (!chain || !chainInfo) {
    return { status: "pending" };
  }

  try {
    const publicClient = createPublicClient({
      chain,
      transport: http(chainInfo.rpcUrl),
    });

    logger.info("Waiting for transaction confirmation...", { chain: chainInfo.name });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash as Hash,
      timeout: timeoutMs,
    });

    const confirmations = await publicClient.getTransactionConfirmations({
      transactionReceipt: receipt,
    });

    logger.info("Transaction confirmed", {
      status: receipt.status,
      confirmations: confirmations.toString(),
    });

    return {
      status: receipt.status,
      confirmations,
    };
  } catch (error) {
    // Timeout or other error - transaction may still be pending
    logger.warn("Could not confirm transaction", {
      error: error instanceof Error ? error.message : "timeout",
    });
    return { status: "pending" };
  }
}

export interface BridgeResult {
  success: boolean;
  txHash?: string;
  txStatus?: "success" | "reverted" | "pending";
  explorerUrl?: string;
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

    // Execute bridge
    const result = await kit.bridge(bridgeConfig);

    // Extract from steps array (BridgeKit returns steps: [{name, state, txHash, data}])
    const steps = (result as any)?.steps || [];

    // Find the mint step (final step on destination chain) or last successful step
    const mintStep = steps.find((s: any) => s.name === "mint" && s.state === "success");
    const lastSuccessStep = steps.filter((s: any) => s.state === "success").pop();
    const relevantStep = mintStep || lastSuccessStep;

    // Extract txHash and explorerUrl from step
    const txHash = relevantStep?.txHash
      || relevantStep?.data?.txHash
      || (result as any)?.txHash
      || null;

    const explorerUrl = relevantStep?.data?.explorerUrl
      || (txHash ? `${chainInfo.explorerUrl}/tx/${txHash}` : null);

    // Log steps summary
    const stepsSummary = steps.map((s: any) => `${s.name}:${s.state}`).join(" → ");
    logger.info("Bridge steps", { flow: stepsSummary });

    if (!txHash) {
      logger.warn("Bridge completed but no txHash in steps", {
        stepsCount: steps.length,
        steps: stepsSummary
      });
      return {
        success: true,
        txStatus: "pending",
        sourceChain: "Arc_Testnet",
        destinationChain: chainInfo.name,
        amount: feeBreakdown.netAmount.toString(),
        fee: feeBreakdown,
      };
    }

    // Get status from step (already confirmed by BridgeKit)
    const txStatus = relevantStep?.state === "success" ? "success" :
                     relevantStep?.state === "failed" ? "reverted" : "pending";

    logger.info("Bridge complete!", {
      txHash: txHash.slice(0, 20) + "...",
      status: txStatus,
    });

    return {
      success: txStatus === "success" || txStatus === "pending",
      txHash,
      txStatus,
      explorerUrl: explorerUrl || undefined,
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
