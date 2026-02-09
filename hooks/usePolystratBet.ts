import { useQuery } from '@tanstack/react-query';
import { getPolymarketData } from 'graphql/queries';
import { useMemo } from 'react';

import { NA } from 'constants/index';
import { TransformedPolymarketBet } from 'types/polymarket';

const USDC_DECIMALS = 6;

export const usePolystratBet = (betId: string) => {
  const {
    data: polymarketData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['getPolymarketData', betId],
    queryFn: async () => await getPolymarketData({ id: betId }),
    enabled: !!betId,
  });

  const transformedData = useMemo((): TransformedPolymarketBet | null => {
    const marketParticipant = polymarketData?.marketParticipants?.[0];
    const bet = marketParticipant?.bets?.[0];

    if (!marketParticipant || !bet) return null;

    const { question, amount, transactionHash } = bet ?? {};
    const outcomeIndex = parseInt(bet.outcomeIndex);
    const position = question?.metadata?.outcomes?.[outcomeIndex] || NA;

    const betAmount = parseInt(amount) / Math.pow(10, USDC_DECIMALS);
    const amountWon = parseInt(marketParticipant.totalPayout) / Math.pow(10, USDC_DECIMALS);

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

  return { data: transformedData, isLoading, error };
};
