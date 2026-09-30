import { useQuery } from '@tanstack/react-query';
import { getPolymarketData } from 'graphql/queries';
import { useMemo } from 'react';

import { NA } from 'constants/index';
import { TransformedPolymarketBet } from 'types/polymarket';
import { toSquidBetId } from 'utils/polymarket';

const USDC_DECIMALS = 6;
// Positional, not read from the market metadata: the squid's `metadata.outcomes` is
// ordered independently of the `outcomeIndex` on a bet (it commonly reads
// `["No", "Yes"]`), so indexing into it mislabels the position. Index 0 is Yes.
const OUTCOMES = ['Yes', 'No'];

export const usePolystratBet = (betId: string) => {
  const squidBetId = useMemo(() => toSquidBetId(betId), [betId]);

  const {
    data: polymarketData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['getPolymarketData', squidBetId],
    queryFn: async () => await getPolymarketData({ id: squidBetId as string }),
    enabled: !!squidBetId,
  });

  const transformedData = useMemo((): TransformedPolymarketBet | null => {
    const bet = polymarketData?.betById;

    if (!bet) return null;

    const { question, amount, transactionHash, outcomeIndex, marketParticipant } = bet;
    const position = OUTCOMES[parseInt(outcomeIndex)] || NA;

    const betAmount = parseInt(amount) / Math.pow(10, USDC_DECIMALS);
    const amountWon = parseInt(marketParticipant?.totalPayout ?? '0') / Math.pow(10, USDC_DECIMALS);

    return {
      question: question?.metadata?.title || NA,
      position,
      transactionHash,
      betAmount,
      amountWon,
      betAmountFormatted: `$${betAmount.toFixed(2)}`,
      amountWonFormatted: `$${amountWon.toFixed(2)}`,
      multiplier: amountWon > 0 ? (amountWon / betAmount).toFixed(2) : '0.00',
    };
  }, [polymarketData]);

  // A bet id we cannot map onto the squid can never resolve — surface it as "no data"
  // rather than leaving the card in a permanent loading state.
  if (!squidBetId) return { data: null, isLoading: false, error: null };

  return { data: transformedData, isLoading, error };
};
