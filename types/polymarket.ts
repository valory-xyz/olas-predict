type PolymarketBetMetadata = {
  title: string;
  outcomes: string[];
};

type PolymarketBetQuestion = {
  id: string;
  metadata: PolymarketBetMetadata | null;
};

type PolymarketBettor = {
  id: string;
};

export type PolymarketBet = {
  transactionHash: string;
  outcomeIndex: string;
  amount: string;
  bettor: PolymarketBettor;
  question: PolymarketBetQuestion | null;
};

export type PolymarketParticipantData = {
  totalPayout: string;
  bets: PolymarketBet[];
};

export type PolymarketDataResponse = {
  marketParticipants: PolymarketParticipantData[];
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
