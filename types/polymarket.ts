type PolymarketBetMetadata = {
  title: string;
};

type PolymarketBetQuestion = {
  metadata: PolymarketBetMetadata | null;
};

type PolymarketBettor = {
  id: string;
};

type PolymarketMarketParticipant = {
  totalPayout: string;
};

export type PolymarketBet = {
  transactionHash: string;
  outcomeIndex: string;
  amount: string;
  bettor: PolymarketBettor | null;
  marketParticipant: PolymarketMarketParticipant | null;
  question: PolymarketBetQuestion | null;
};

// The squid resolves a single entity by id via `betById`, which returns null when missing.
export type PolymarketDataResponse = {
  betById: PolymarketBet | null;
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
