/**
 * Fee calculation for Ki0xk transfers
 *
 * Fee Rate: 0.001% (micro-transaction friendly)
 * No minimum fee to keep it accessible for onboarding
 *
 * Note: Circle keeps 10% of collected fees
 */

// 0.001% = 0.00001
export const FEE_RATE = 0.00001;

export interface FeeBreakdown {
  grossAmount: number;
  fee: number;
  netAmount: number;
  feePercentage: string;
}

/**
 * Calculate fee for a transfer
 */
export function calculateFee(amount: number): FeeBreakdown {
  const fee = amount * FEE_RATE;
  const netAmount = amount - fee;

  return {
    grossAmount: amount,
    fee: parseFloat(fee.toFixed(6)),
    netAmount: parseFloat(netAmount.toFixed(6)),
    feePercentage: "0.001%",
  };
}

/**
 * Format fee breakdown for display
 */
export function formatFeeBreakdown(breakdown: FeeBreakdown, chain: string): string {
  return `
┌─────────────────────────────────────┐
│  Transfer Summary                   │
├─────────────────────────────────────┤
│  Amount:      ${breakdown.grossAmount.toFixed(4).padStart(10)} USDC   │
│  Fee (0.001%): ${breakdown.fee.toFixed(6).padStart(9)} USDC   │
│  You receive: ${breakdown.netAmount.toFixed(4).padStart(10)} USDC   │
│  Chain:       ${chain.padStart(18)}   │
└─────────────────────────────────────┘`;
}
