import { useQuery } from '@tanstack/react-query';
import { getPolymarketBet, getPolymarketMarketParticipant } from 'graphql/queries';
import { useMemo } from 'react';

import { TransformedPolymarketBet } from 'types/polymarket';

const USDC_DECIMALS = 6;

const getMarketParticipantId = (bettorId?: string, questionId?: string) => {
  if (!bettorId || !questionId) return null;
  return `${bettorId}_${questionId}`;
};

export const usePolystratBet = (betId: string) => {
  const {
    data: betData,
    isLoading: isBetLoading,
    error: betError,
  } = useQuery({
    queryKey: ['getPolystratBet', betId],
    queryFn: async () => await getPolymarketBet({ id: betId }),
    enabled: !!betId,
  });

  const marketParticipantId = useMemo(
    () => getMarketParticipantId(betData?.bet?.bettor?.id, betData?.bet?.question?.id),
    [betData],
  );

  const { data: participantData, isLoading: isParticipantLoading } = useQuery({
    queryKey: ['getPolymarketMarketParticipant', marketParticipantId],
    queryFn: async () => await getPolymarketMarketParticipant({ id: marketParticipantId! }),
    enabled: !!marketParticipantId,
  });

  const transformedData = useMemo((): TransformedPolymarketBet | null => {
    if (!betData?.bet || !participantData?.marketParticipant) return null;

    const { bet } = betData;
    const { question, amount, transactionHash } = bet;
    const outcomeIndex = parseInt(bet.outcomeIndex);
    const position = question.metadata.outcomes[outcomeIndex];

    const betAmount = parseInt(amount) / Math.pow(10, USDC_DECIMALS);
    const amountWon =
      parseInt(participantData.marketParticipant.totalPayout) / Math.pow(10, USDC_DECIMALS);

    return {
      question: question.metadata.title,
      position,
      transactionHash,
      betAmount,
      amountWon,
      betAmountFormatted: `$${betAmount.toFixed(2)}`,
      amountWonFormatted: `$${amountWon.toFixed(2)}`,
      multiplier: amountWon > 0 ? (amountWon / betAmount).toFixed(2) : '0.00',
    };
  }, [betData, participantData]);

  const isLoading = isBetLoading || isParticipantLoading;
  const error = betError;

  return { data: transformedData, isLoading, error };
};
