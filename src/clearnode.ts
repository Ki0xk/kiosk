import { Client } from "yellow-ts";
import {
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
  createGetConfigMessageV2,
  createGetLedgerBalancesMessage,
  createGetChannelsMessageV2,
  createGetAssetsMessageV2,
  createCreateChannelMessage,
  createResizeChannelMessage,
  createCloseChannelMessage,
  createTransferMessage,
  createECDSAMessageSigner,
  createEIP712AuthMessageSigner,
  type MessageSigner,
  type RPCResponse,
  RPCMethod,
} from "@erc7824/nitrolite";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { kioskAddress, walletClient } from "./wallet.js";

// Main wallet signer for transactions
const mainSigner: MessageSigner = createECDSAMessageSigner(
  config.PRIVATE_KEY as `0x${string}`
);

// Session key - ephemeral key for this session
const sessionPrivateKey = generatePrivateKey();
const sessionAccount = privateKeyToAccount(sessionPrivateKey);
const sessionSigner: MessageSigner = createECDSAMessageSigner(sessionPrivateKey);

const APP_NAME = "ki0xk";
const APP_SCOPE = "kiosk";

export class ClearNodeClient {
  private client: Client;
  private authenticated = false;
  private requestId = 0;
  private networkConfig: unknown = null;

  constructor() {
    this.client = new Client({
      url: config.CLEARNODE_WS_URL,
    });
  }

  private nextRequestId(): number {
    return ++this.requestId;
  }

  async connect(): Promise<void> {
    logger.info("Connecting to ClearNode...", { url: config.CLEARNODE_WS_URL });
    await this.client.connect();
    logger.info("Connected to ClearNode");

    // Set up message listener for push messages
    this.client.listen(async (message: RPCResponse) => {
      this.handlePushMessage(message);
    });
  }

  private handlePushMessage(message: RPCResponse): void {
    // Only handle push messages (ones without request correlation)
    switch (message.method) {
      case RPCMethod.BalanceUpdate:
        logger.debug("Balance update (push)");
        break;
      case RPCMethod.ChannelsUpdate:
        logger.debug("Channels update (push)");
        break;
      case RPCMethod.Error:
        logger.error("ClearNode error (push)", { params: message.params });
        break;
    }
  }

  async getConfig(): Promise<unknown> {
    logger.info("Fetching ClearNode config...");
    const message = createGetConfigMessageV2(this.nextRequestId());
    const response = await this.client.sendMessage(JSON.parse(message));
    this.networkConfig = response;
    logger.info("Config received");
    return response;
  }

  async getAssets(chainId?: number): Promise<unknown> {
    logger.info("Fetching supported assets...", { chainId });
    const message = createGetAssetsMessageV2(chainId, this.nextRequestId());
    const response = await this.client.sendMessage(JSON.parse(message));
    logger.info("Supported assets", { response });
    return response;
  }

  async authenticate(): Promise<void> {
    logger.info("Starting authentication...", {
      address: kioskAddress,
      sessionKey: sessionAccount.address
    });

    // Auth request params
    // Note: Sandbox uses "ytest.usd" as the test stablecoin (0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb)
    const authParams = {
      address: kioskAddress,
      session_key: sessionAccount.address,
      application: APP_NAME,
      allowances: [{ asset: "ytest.usd", amount: "1000000000" }], // 1000 ytest.usd allowance
      expires_at: BigInt(Math.floor(Date.now() / 1000) + 86400), // 24 hours
      scope: APP_SCOPE,
    };

    // Step 1: Send auth request
    const authRequestMsg = await createAuthRequestMessage(
      authParams,
      this.nextRequestId()
    );
    const challengeResponse = await this.client.sendMessage(JSON.parse(authRequestMsg));

    // Extract challenge message from response
    // Response format: { method, requestId, params: { challengeMessage } }
    const responseData = challengeResponse as any;
    const challenge = responseData?.params?.challengeMessage
      || responseData?.params?.challenge_message
      || responseData?.res?.[2]?.challenge_message;

    if (!challenge) {
      logger.error("No challenge in response", { challengeResponse });
      throw new Error("Auth challenge not received");
    }


    // Step 2: Create EIP-712 signer and sign challenge with MAIN wallet
    const eip712Signer = createEIP712AuthMessageSigner(
      walletClient,
      authParams,
      { name: APP_NAME }
    );

    const authVerifyMsg = await createAuthVerifyMessageFromChallenge(
      eip712Signer,
      challenge,
      this.nextRequestId()
    );

    // Step 3: Send verification
    const verifyResponse = await this.client.sendMessage(JSON.parse(authVerifyMsg));

    // Check for auth error
    const verifyData = verifyResponse as any;
    if (verifyData?.method === "error" || verifyData?.params?.error) {
      const errorMsg = verifyData?.params?.error || "Authentication failed";
      logger.error("Auth verification failed", { error: errorMsg });
      throw new Error(errorMsg);
    }

    this.authenticated = true;
    logger.info("Authentication successful!", { sessionKey: sessionAccount.address });
  }

  async getLedgerBalances(): Promise<unknown> {
    if (!this.authenticated) {
      throw new Error("Not authenticated");
    }

    logger.info("Fetching ledger balances...");
    const message = await createGetLedgerBalancesMessage(
      sessionSigner, // Use session signer after auth
      kioskAddress,
      this.nextRequestId()
    );
    const response = await this.client.sendMessage(JSON.parse(message));
    logger.info("Ledger balances", { response });
    return response;
  }

  async getChannels(): Promise<unknown> {
    logger.debug("Fetching channels...");
    const message = createGetChannelsMessageV2(
      kioskAddress,
      undefined,
      this.nextRequestId()
    );
    const response = await this.client.sendMessage(JSON.parse(message));
    logger.debug("Channels response received");
    return response;
  }

  /**
   * Check if a specific channel exists and is open/resizing
   */
  async channelExists(channelId: string): Promise<boolean> {
    try {
      const channels = await this.getChannels();
      const channelList = (channels as any)?.params?.channels || [];
      return channelList.some((ch: any) =>
        (ch.channelId === channelId || ch.channel_id === channelId) &&
        (ch.status === "open" || ch.status === "resizing" || ch.status === "ACTIVE")
      );
    } catch {
      return false;
    }
  }

  async createChannel(tokenAddress: string, chainId: number = 84532): Promise<string> {
    if (!this.authenticated) {
      throw new Error("Not authenticated");
    }

    logger.debug("Creating channel...", { chainId });

    const message = await createCreateChannelMessage(
      sessionSigner,
      {
        chain_id: chainId,
        token: tokenAddress as `0x${string}`,
      },
      this.nextRequestId()
    );

    // Send the raw JSON string directly to avoid BigInt serialization issues
    const response = await this.client.sendMessage(message);
    logger.debug("Channel created");

    const responseData = response as any;
    if (responseData?.method === "error" || responseData?.params?.error) {
      throw new Error(responseData?.params?.error || "Channel creation failed");
    }

    const channelId = responseData?.params?.channelId || responseData?.params?.channel_id;
    return channelId;
  }

  async resizeChannel(
    channelId: string,
    allocateAmount: bigint,
    fundsDestination: string
  ): Promise<unknown> {
    if (!this.authenticated) {
      throw new Error("Not authenticated");
    }

    logger.info("Resizing channel...", { channelId, allocateAmount: allocateAmount.toString() });

    const message = await createResizeChannelMessage(
      sessionSigner,
      {
        channel_id: channelId as `0x${string}`,
        allocate_amount: allocateAmount,
        funds_destination: fundsDestination as `0x${string}`,
      },
      this.nextRequestId()
    );

    const response = await this.client.sendMessage(message);
    logger.info("Resize response", { response });

    const responseData = response as any;
    if (responseData?.method === "error" || responseData?.params?.error) {
      throw new Error(responseData?.params?.error || "Resize failed");
    }

    return response;
  }

  /**
   * Close a channel. Use this to remove blocking channels that prevent transfers.
   * Funds in the channel will be returned to the custody contract for withdrawal.
   */
  async closeChannel(channelId: string, fundsDestination: string): Promise<unknown> {
    if (!this.authenticated) {
      throw new Error("Not authenticated");
    }

    logger.debug("Sending close channel request...");

    const message = await createCloseChannelMessage(
      sessionSigner,
      channelId as `0x${string}`,
      fundsDestination as `0x${string}`,
      this.nextRequestId()
    );

    const response = await this.client.sendMessage(message);
    logger.debug("Close channel response received");

    const responseData = response as any;
    if (responseData?.method === "error" || responseData?.params?.error) {
      throw new Error(responseData?.params?.error || "Close channel failed");
    }

    return response;
  }

  async transfer(destination: string, asset: string, amount: string): Promise<unknown> {
    if (!this.authenticated) {
      throw new Error("Not authenticated");
    }

    logger.info("Initiating transfer...", { destination, asset, amount });

    const message = await createTransferMessage(
      sessionSigner,
      {
        destination: destination as `0x${string}`,
        allocations: [{ asset, amount }],
      },
      this.nextRequestId()
    );

    // Send raw JSON string to avoid BigInt issues
    const response = await this.client.sendMessage(message);
    logger.info("Transfer response", { response });

    const responseData = response as any;
    if (responseData?.method === "error" || responseData?.params?.error) {
      throw new Error(responseData?.params?.error || "Transfer failed");
    }

    return response;
  }

  /**
   * ATM-specific transfer: Send ytest.usd from unified balance to destination wallet.
   * This is the main function for Ki0xk cash-to-crypto operation.
   *
   * IMPORTANT: This will fail if any channel has non-zero balance.
   * The ATM should work entirely from unified balance, not channels.
   *
   * @param destinationWallet - 0x-prefixed wallet address or ENS name
   * @param amountUsd - Amount in human-readable format (e.g., "10.50" for 10.50 USD)
   */
  async sendToWallet(destinationWallet: string, amountUsd: string): Promise<unknown> {
    if (!this.authenticated) {
      throw new Error("Not authenticated - call authenticate() first");
    }

    // Validate amount
    const numAmount = parseFloat(amountUsd);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error(`Invalid amount: ${amountUsd}`);
    }

    logger.info("Ki0xk Transfer", {
      destination: destinationWallet,
      amount: `${amountUsd} ytest.usd`,
    });

    try {
      const result = await this.transfer(destinationWallet, "ytest.usd", amountUsd);
      logger.info("Transfer complete!", { destination: destinationWallet, amount: amountUsd });
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check for the specific "non-zero channel" error
      if (errorMsg.includes("non-zero allocation") || errorMsg.includes("non-zero amount")) {
        logger.error("Transfer blocked by channel balance!", {
          error: errorMsg,
          hint: "Empty all channels to zero before transferring. Use resizeChannel with negative allocate_amount."
        });
      }

      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
    this.authenticated = false;
    logger.info("Disconnected from ClearNode");
  }

  get isAuthenticated(): boolean {
    return this.authenticated;
  }

  get config(): unknown {
    return this.networkConfig;
  }
}

// Singleton
let instance: ClearNodeClient | null = null;

export function getClearNode(): ClearNodeClient {
  if (!instance) {
    instance = new ClearNodeClient();
  }
  return instance;
}
