/** Card figures returned by pearl-api for a settled prediction bet. */
export type AchievementData = {
  question: string;
  position: string;
  transactionHash: string;
  betAmount: number;
  amountWon: number;
  betAmountFormatted: string;
  amountWonFormatted: string;
  multiplier: string;
  marketImageUrl: string | null;
};
