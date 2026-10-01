/** FIFO allocation for buy and sell events in one market participant's history. */
export type FifoBetRow = {
  id: string;
  outcomeIndex: number;
  amount: bigint;
  shares: bigint;
  blockNumber: bigint;
  blockTimestamp: bigint;
  logIndex: number;
  isBuy: boolean;
};

export type FifoBuy = FifoBetRow & {
  originalCost: bigint;
  originalShares: bigint;
  remainingShares: bigint;
  allocatedCost: bigint;
  allocatedProceeds: bigint;
};

// Keep the strict multiplier threshold aligned with the agents' achievement checkers.
const MIN_ACHIEVEMENT_MULTIPLIER_NUMERATOR = 3n;
const MIN_ACHIEVEMENT_MULTIPLIER_DENOMINATOR = 2n;

export const allocateBetsFifo = (rows: FifoBetRow[]): Map<string, FifoBuy> => {
  const sortedRows = [...rows].sort((a, b) => {
    if (a.blockTimestamp !== b.blockTimestamp) return a.blockTimestamp < b.blockTimestamp ? -1 : 1;
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
    return a.logIndex - b.logIndex;
  });
  const buys = new Map<string, FifoBuy>();
  const queues = new Map<number, FifoBuy[]>();

  for (const row of sortedRows) {
    const queue = queues.get(row.outcomeIndex) ?? [];
    queues.set(row.outcomeIndex, queue);

    if (row.isBuy) {
      if (row.amount <= 0n || row.shares <= 0n) continue;
      const buy: FifoBuy = {
        ...row,
        originalCost: row.amount,
        originalShares: row.shares,
        remainingShares: row.shares,
        allocatedCost: 0n,
        allocatedProceeds: 0n,
      };
      buys.set(row.id, buy);
      queue.push(buy);
      continue;
    }

    const sharesSold = row.shares < 0n ? -row.shares : row.shares;
    if (row.amount >= 0n || sharesSold <= 0n) continue;
    let remainingToAllocate = sharesSold;
    while (remainingToAllocate > 0n && queue.length > 0) {
      const buy = queue[0];
      const taken =
        remainingToAllocate < buy.remainingShares ? remainingToAllocate : buy.remainingShares;
      buy.allocatedProceeds += (-row.amount * taken) / sharesSold;
      buy.allocatedCost += (buy.originalCost * taken) / buy.originalShares;
      buy.remainingShares -= taken;
      remainingToAllocate -= taken;
      if (buy.remainingShares <= 0n) queue.shift();
    }
  }

  return buys;
};

export const isAchievementMultiplierEligible = (amountWon: bigint, cost: bigint): boolean =>
  cost > 0n &&
  amountWon * MIN_ACHIEVEMENT_MULTIPLIER_DENOMINATOR > cost * MIN_ACHIEVEMENT_MULTIPLIER_NUMERATOR;
