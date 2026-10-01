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

// Trader persists bet_amount and total_payout rounded to three decimals, then
// applies a strict >1.5 threshold to those persisted values. Mirror that here.
const pow10 = (exponent: number): bigint => {
  let value = BigInt(1);
  for (let i = 0; i < exponent; i += 1) value *= BigInt(10);
  return value;
};

const roundToMilliUnits = (value: bigint, decimals: number): bigint => {
  if (decimals < 3) return value * pow10(3 - decimals);
  const divisor = pow10(decimals - 3);
  const quotient = value / divisor;
  const remainder = value % divisor;
  const twiceRemainder = remainder * BigInt(2);
  return twiceRemainder > divisor ||
    (twiceRemainder === divisor && quotient % BigInt(2) !== BigInt(0))
    ? quotient + BigInt(1)
    : quotient;
};

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

export const isAchievementMultiplierEligible = (
  amountWon: bigint,
  cost: bigint,
  decimals = 0,
): boolean => {
  const roundedWon = roundToMilliUnits(amountWon, decimals);
  const roundedCost = roundToMilliUnits(cost, decimals);
  return roundedCost > BigInt(0) && roundedWon * BigInt(2) > roundedCost * BigInt(3);
};

/** Trader's Omen payout: sell proceeds plus remaining cost's share of winnings. */
export const getOmenBuyPayout = (
  buys: Map<string, FifoBuy>,
  buyId: string,
  totalPayout: bigint,
  winningIndex: number,
  fullySold: boolean,
): bigint | null => {
  const buy = buys.get(buyId);
  if (!buy) return null;
  if (fullySold) return buy.allocatedProceeds > buy.allocatedCost ? buy.allocatedProceeds : null;
  if (buy.outcomeIndex !== winningIndex || totalPayout <= BigInt(0)) return null;
  const winningCost = [...buys.values()]
    .filter((item) => item.outcomeIndex === winningIndex)
    .reduce((sum, item) => {
      const cost = item.originalCost - item.allocatedCost;
      return sum + (cost > BigInt(0) ? cost : BigInt(0));
    }, BigInt(0));
  if (winningCost <= BigInt(0)) return null;
  const remainingCost = buy.originalCost - buy.allocatedCost;
  return buy.allocatedProceeds + (totalPayout * remainingCost) / winningCost;
};
