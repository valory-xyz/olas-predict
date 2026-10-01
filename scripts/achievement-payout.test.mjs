import assert from 'node:assert/strict';
import test from 'node:test';

import { allocateBetsFifo, isAchievementMultiplierEligible } from '../utils/betPayout.ts';

const row = ({
  id,
  amount,
  shares,
  isBuy,
  logIndex = 0,
  blockNumber = 1,
  timestamp = 1,
  outcomeIndex = 0,
}) => ({
  id,
  outcomeIndex,
  amount: BigInt(amount),
  shares: BigInt(shares),
  blockNumber: BigInt(blockNumber),
  blockTimestamp: BigInt(timestamp),
  logIndex,
  isBuy,
});

test('winning buys retain their own shares and do not receive the participant total', () => {
  const bets = allocateBetsFifo([
    row({ id: 'buy-1', amount: 1_000_000, shares: 3_000_000, isBuy: true, logIndex: 1 }),
    row({ id: 'buy-2', amount: 1_000_000, shares: 1_400_000, isBuy: true, logIndex: 2 }),
  ]);

  const first = bets.get('buy-1');
  const second = bets.get('buy-2');
  assert.equal(first.remainingShares, 3_000_000n);
  assert.equal(second.remainingShares, 1_400_000n);
  assert.equal(isAchievementMultiplierEligible(first.remainingShares, first.originalCost), true);
  assert.equal(isAchievementMultiplierEligible(second.remainingShares, second.originalCost), false);
});

test('sell proceeds and sold shares are allocated FIFO within the outcome', () => {
  const bets = allocateBetsFifo([
    row({ id: 'buy-1', amount: 1_000, shares: 3_000, isBuy: true, logIndex: 1 }),
    row({ id: 'buy-2', amount: 1_000, shares: 2_000, isBuy: true, logIndex: 2 }),
    row({ id: 'sell', amount: -600, shares: -2_000, isBuy: false, logIndex: 3 }),
  ]);

  assert.equal(bets.get('buy-1').remainingShares, 1_000n);
  assert.equal(bets.get('buy-1').allocatedProceeds, 600n);
  assert.equal(bets.get('buy-2').remainingShares, 2_000n);
  assert.equal(bets.get('buy-2').allocatedProceeds, 0n);
});

test('same-block events follow log index, and the 1.5x cutoff is strict', () => {
  const bets = allocateBetsFifo([
    row({ id: 'sell', amount: -100, shares: -100, isBuy: false, logIndex: 2 }),
    row({ id: 'buy', amount: 50, shares: 100, isBuy: true, logIndex: 1 }),
  ]);

  assert.equal(bets.get('buy').remainingShares, 0n);
  assert.equal(isAchievementMultiplierEligible(150n, 100n), false);
  assert.equal(isAchievementMultiplierEligible(151n, 100n), true);
});
