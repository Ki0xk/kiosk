/**
 * Supported EVM chains for Arc Bridge Kit
 * Only testnets for hackathon, EVM-only (no Solana)
 */

export interface ChainInfo {
  name: string;
  bridgeKitName: string;
  chainId: number;
  isTestnet: boolean;
  explorerUrl: string;
  rpcUrl: string;
}

export const SUPPORTED_CHAINS: Record<string, ChainInfo> = {
  arc: {
    name: "Arc Testnet",
    bridgeKitName: "Arc_Testnet",
    chainId: 0, // TBD - Arc testnet chain ID
    isTestnet: true,
    explorerUrl: "https://explorer.arc.network",
    rpcUrl: "https://rpc-testnet.arc.network",
  },
  base: {
    name: "Base Sepolia",
    bridgeKitName: "Base_Sepolia",
    chainId: 84532,
    isTestnet: true,
    explorerUrl: "https://sepolia.basescan.org",
    rpcUrl: "https://sepolia.base.org",
  },
  ethereum: {
    name: "Ethereum Sepolia",
    bridgeKitName: "Ethereum_Sepolia",
    chainId: 11155111,
    isTestnet: true,
    explorerUrl: "https://sepolia.etherscan.io",
    rpcUrl: "https://rpc.sepolia.org",
  },
  arbitrum: {
    name: "Arbitrum Sepolia",
    bridgeKitName: "Arbitrum_Sepolia",
    chainId: 421614,
    isTestnet: true,
    explorerUrl: "https://sepolia.arbiscan.io",
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
  },
  polygon: {
    name: "Polygon Amoy",
    bridgeKitName: "Polygon_Amoy_Testnet",
    chainId: 80002,
    isTestnet: true,
    explorerUrl: "https://amoy.polygonscan.com",
    rpcUrl: "https://rpc-amoy.polygon.technology",
  },
  optimism: {
    name: "Optimism Sepolia",
    bridgeKitName: "OP_Sepolia",
    chainId: 11155420,
    isTestnet: true,
    explorerUrl: "https://sepolia-optimism.etherscan.io",
    rpcUrl: "https://sepolia.optimism.io",
  },
  avalanche: {
    name: "Avalanche Fuji",
    bridgeKitName: "Avalanche_Fuji",
    chainId: 43113,
    isTestnet: true,
    explorerUrl: "https://testnet.snowtrace.io",
    rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
  },
  linea: {
    name: "Linea Sepolia",
    bridgeKitName: "Linea_Sepolia",
    chainId: 59141,
    isTestnet: true,
    explorerUrl: "https://sepolia.lineascan.build",
    rpcUrl: "https://rpc.sepolia.linea.build",
  },
};

// Chain keys for CLI selection
export const CHAIN_OPTIONS = Object.keys(SUPPORTED_CHAINS).filter(k => k !== "arc");

export function getChainByKey(key: string): ChainInfo | undefined {
  return SUPPORTED_CHAINS[key.toLowerCase()];
}

export function getChainByBridgeKitName(name: string): ChainInfo | undefined {
  return Object.values(SUPPORTED_CHAINS).find(c => c.bridgeKitName === name);
}

export function formatChainList(): string {
  return CHAIN_OPTIONS
    .map((key, i) => `  ${i + 1}. ${SUPPORTED_CHAINS[key].name}`)
    .join("\n");
}
