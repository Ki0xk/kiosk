import { config as dotenvConfig } from "dotenv";
import { z } from "zod";

dotenvConfig();

const envSchema = z.object({
  // Chain
  CHAIN_ID: z.coerce.number().default(84532), // Base Sepolia
  RPC_URL: z.string().url().default("https://sepolia.base.org"),

  // Wallet
  PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "Invalid private key format"),

  // ClearNode
  CLEARNODE_WS_URL: z
    .string()
    .url()
    .default("wss://clearnet-sandbox.yellow.com/ws"),

  // Token (Base Sepolia USDC)
  USDC_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format")
    .default("0x036CbD53842c5426634e7929541eC2318f3dCF7e"),

  // Arc Bridge
  FEE_RECIPIENT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format")
    .optional(),

  // App
  MOCK_MODE: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("❌ Invalid environment configuration:");
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();

// Export typed config
export type Config = z.infer<typeof envSchema>;
