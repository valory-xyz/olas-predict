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
const MIN_ACHIEVEMENT_MULTIPLIER_NUMERATOR = BigInt(3);
const MIN_ACHIEVEMENT_MULTIPLIER_DENOMINATOR = BigInt(2);

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
      if (row.amount <= BigInt(0) || row.shares <= BigInt(0)) continue;
      const buy: FifoBuy = {
        ...row,
        originalCost: row.amount,
        originalShares: row.shares,
        remainingShares: row.shares,
        allocatedCost: BigInt(0),
        allocatedProceeds: BigInt(0),
      };
      buys.set(row.id, buy);
      queue.push(buy);
      continue;
    }

    const sharesSold = row.shares < BigInt(0) ? -row.shares : row.shares;
    if (row.amount >= BigInt(0) || sharesSold <= BigInt(0)) continue;
    let remainingToAllocate = sharesSold;
    while (remainingToAllocate > BigInt(0) && queue.length > 0) {
      const buy = queue[0];
      const taken =
        remainingToAllocate < buy.remainingShares ? remainingToAllocate : buy.remainingShares;
      buy.allocatedProceeds += (-row.amount * taken) / sharesSold;
      buy.allocatedCost += (buy.originalCost * taken) / buy.originalShares;
      buy.remainingShares -= taken;
      remainingToAllocate -= taken;
      if (buy.remainingShares <= BigInt(0)) queue.shift();
    }
  }

  return buys;
};

export const isAchievementMultiplierEligible = (amountWon: bigint, cost: bigint): boolean =>
  cost > BigInt(0) &&
  amountWon * MIN_ACHIEVEMENT_MULTIPLIER_DENOMINATOR > cost * MIN_ACHIEVEMENT_MULTIPLIER_NUMERATOR;
