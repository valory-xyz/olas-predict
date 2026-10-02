type PolymarketBetMetadata = {
  title: string;
};

type PolymarketBetQuestion = {
  metadata: PolymarketBetMetadata | null;
  resolution: { winningIndex: string | null } | null;
};

export type PolymarketParticipantBet = {
  id: string;
  outcomeIndex: string;
  amount: string;
  shares: string;
  isBuy: boolean;
  blockTimestamp: string;
};

type PolymarketBettor = {
  id: string;
};

type PolymarketMarketParticipant = {
  totalPayout: string;
  bets: PolymarketParticipantBet[];
};

export type PolymarketBet = {
  id: string;
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
