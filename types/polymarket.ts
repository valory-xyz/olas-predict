type PolymarketBetResolution = {
  payouts: string[];
  settledPrice: string;
  winningIndex: string;
};

type PolymarketBetMetadata = {
  title: string;
  outcomes: string[];
};

type PolymarketBetQuestion = {
  metadata: PolymarketBetMetadata;
  resolution: PolymarketBetResolution;
};

export type PolymarketBet = {
  id: string;
  transactionHash: string;
  shares: string;
  outcomeIndex: string;
  amount: string;
  question: PolymarketBetQuestion;
};

export type PolymarketBetResponse = {
  bet: PolymarketBet | null;
};
