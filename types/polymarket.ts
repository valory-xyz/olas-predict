type PolymarketBetMetadata = {
  title: string;
  outcomes: string[];
};

type PolymarketBetQuestion = {
  id: string;
  metadata: PolymarketBetMetadata;
};

type PolymarketBettor = {
  id: string;
};

export type PolymarketBet = {
  transactionHash: string;
  outcomeIndex: string;
  amount: string;
  bettor: PolymarketBettor;
  question: PolymarketBetQuestion;
};

export type PolymarketBetResponse = {
  bet: PolymarketBet | null;
};

export type TransformedPolymarketBet = {
  question: string;
  position: string;
  transactionHash: string;
  betAmount: number;
  amountWon: number;
  betAmountFormatted: string;
  amountWonFormatted: string;
  multiplier: string;
};
