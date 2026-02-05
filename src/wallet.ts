import {
  createWalletClient,
  createPublicClient,
  http,
  type WalletClient,
  type PublicClient,
  type Chain,
  formatEther,
  formatUnits,
  erc20Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { config } from "./config.js";
import { logger } from "./logger.js";

// Base Sepolia chain config (built into viem, but we can customize)
const chain: Chain = {
  ...baseSepolia,
  rpcUrls: {
    default: { http: [config.RPC_URL] },
  },
};

// Create account from private key
const account = privateKeyToAccount(config.PRIVATE_KEY as `0x${string}`);

// Public client for reading chain state
export const publicClient: PublicClient = createPublicClient({
  chain,
  transport: http(config.RPC_URL),
});

// Wallet client for signing transactions
export const walletClient: WalletClient = createWalletClient({
  account,
  chain,
  transport: http(config.RPC_URL),
});

// Export the kiosk address
export const kioskAddress = account.address;

// Utility: Get ETH balance
export async function getEthBalance(): Promise<bigint> {
  const balance = await publicClient.getBalance({ address: kioskAddress });
  return balance;
}

// Utility: Get USDC balance (6 decimals)
export async function getUsdcBalance(): Promise<bigint> {
  const balance = await publicClient.readContract({
    address: config.USDC_ADDRESS as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [kioskAddress],
  });
  return balance;
}

// Format USDC (6 decimals)
export function formatUsdc(amount: bigint): string {
  return formatUnits(amount, 6);
}

// Utility: Get formatted balance info
export async function getWalletInfo(): Promise<{
  address: string;
  ethBalance: string;
  usdcBalance: string;
  chainId: number;
}> {
  const [ethBal, usdcBal] = await Promise.all([getEthBalance(), getUsdcBalance()]);
  return {
    address: kioskAddress,
    ethBalance: formatEther(ethBal),
    usdcBalance: formatUsdc(usdcBal),
    chainId: config.CHAIN_ID,
  };
}

// Log wallet info on init
export async function initWallet(): Promise<void> {
  logger.info("Initializing kiosk wallet...");

  try {
    const info = await getWalletInfo();
    logger.info("Wallet initialized", {
      address: info.address,
      eth: `${info.ethBalance} ETH`,
      usdc: `${info.usdcBalance} USDC`,
      chain: `Base Sepolia (${info.chainId})`,
    });

    if (parseFloat(info.ethBalance) === 0) {
      logger.warn("Wallet has no ETH! Need gas for transactions.");
    }
    if (parseFloat(info.usdcBalance) === 0) {
      logger.warn("Wallet has no USDC! Get testnet USDC to fund the kiosk.");
    }
  } catch (error) {
    logger.error("Failed to initialize wallet", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
