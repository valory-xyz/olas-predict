import { useQuery } from '@tanstack/react-query';
import { getPolymarketData } from 'graphql/queries';
import { useMemo } from 'react';

import { NA } from 'constants/index';
import { TransformedPolymarketBet } from 'types/polymarket';
import { allocateBetsFifo, isAchievementMultiplierEligible } from 'utils/betPayout';
import { toSquidBetId } from 'utils/polymarket';

const USDC_DECIMALS = 6;
// Positional, not read from the market metadata: the squid's `metadata.outcomes` is
// ordered independently of the `outcomeIndex` on a bet (it commonly reads
// `["No", "Yes"]`), so indexing into it mislabels the position. Index 0 is Yes.
const OUTCOMES = ['Yes', 'No'];
const FULLY_SOLD_EPSILON = BigInt(10_000);

const getSquidLogIndex = (id: string): number => {
  const suffix = id.slice(id.lastIndexOf('_') + 1);
  return /^\d+$/.test(suffix) ? Number(suffix) : 0;
};

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
    const betAmountRaw = BigInt(amount);
    const betAmount = Number(betAmountRaw) / 10 ** USDC_DECIMALS;
    const winningIndex = question?.resolution?.winningIndex;
    if (winningIndex == null || !marketParticipant) return null;
    if (Number(winningIndex) < 0) return null;

    const allocated = allocateBetsFifo(
      marketParticipant.bets.map((row) => ({
        id: row.id,
        outcomeIndex: Number(row.outcomeIndex),
        amount: BigInt(row.amount),
        shares: BigInt(row.shares),
        blockNumber: BigInt(row.blockNumber),
        blockTimestamp: BigInt(row.blockTimestamp),
        logIndex: getSquidLogIndex(row.id),
        isBuy: row.isBuy,
      })),
    );
    const target = allocated.get(bet.id);
    if (!target) return null;
    const fullySoldProfit = target.remainingShares <= FULLY_SOLD_EPSILON;
    if (!fullySoldProfit && Number(winningIndex) !== Number(outcomeIndex)) return null;

    const amountWonRaw =
      target.allocatedProceeds + (fullySoldProfit ? BigInt(0) : target.remainingShares);
    if (!isAchievementMultiplierEligible(amountWonRaw, betAmountRaw, 6)) return null;
    const amountWon = Number(amountWonRaw) / 10 ** USDC_DECIMALS;

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
