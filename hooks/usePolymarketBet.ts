import { useQuery } from '@tanstack/react-query';
import { getPolymarketBet } from 'graphql/queries';
import { useMemo } from 'react';

import { TransformedPolymarketBet } from 'types/polymarket';

const USDC_DECIMALS = 6;

export const usePolymarketBet = (betId: string) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['getPolymarketBet', betId],
    queryFn: async () => await getPolymarketBet({ id: betId }),
    enabled: !!betId,
  });

  const transformedData = useMemo((): TransformedPolymarketBet | null => {
    if (!data?.bet) return null;

    const { bet } = data;
    const { question, amount, shares, transactionHash } = bet;
    const outcomeIndex = parseInt(bet.outcomeIndex);
    const position = question.metadata.outcomes[outcomeIndex];

    const payoutPerShare = question.resolution.payouts[outcomeIndex];
    const totalPayoutRaw = parseInt(shares) * parseInt(payoutPerShare);
    const betAmount = parseInt(amount) / Math.pow(10, USDC_DECIMALS);
    const amountWon = totalPayoutRaw / Math.pow(10, USDC_DECIMALS);

    return {
      question: question.metadata.title,
      position,
      transactionHash,
      betAmount,
      amountWon,
      betAmountFormatted: `$${betAmount.toFixed(2)}`,
      amountWonFormatted: `$${amountWon.toFixed(2)}`,
      multiplier: (amountWon / betAmount).toFixed(2),
    };
  }, [data]);

  return { data: transformedData, isLoading, error };
};
