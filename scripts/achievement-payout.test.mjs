import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allocateBetsFifo,
  getOmenBuyPayout,
  isAchievementMultiplierEligible,
} from '../utils/betPayout.ts';

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
    row({ id: 'buy-2', amount: 1_000_000, shares: 2_000_000, isBuy: true, logIndex: 2 }),
  ]);

  const first = bets.get('buy-1');
  const second = bets.get('buy-2');
  assert.equal(first.remainingShares, 3_000_000n);
  assert.equal(second.remainingShares, 2_000_000n);
  assert.equal(isAchievementMultiplierEligible(first.remainingShares, first.originalCost), true);
  assert.equal(isAchievementMultiplierEligible(second.remainingShares, second.originalCost), true);
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

test('a fully sold profitable Omen buy qualifies on realized proceeds', () => {
  const bets = allocateBetsFifo([
    row({ id: 'buy', amount: 1_000, shares: 1_000, isBuy: true, logIndex: 1 }),
    row({ id: 'sell', amount: -1_600, shares: -1_000, isBuy: false, logIndex: 2 }),
  ]);
  const buy = bets.get('buy');

  assert.equal(buy.remainingShares, 0n);
  assert.equal(buy.allocatedProceeds, 1_600n);
  assert.equal(isAchievementMultiplierEligible(buy.allocatedProceeds, buy.originalCost), true);
});

test('Omen payouts match the trader multi-buy allocation fixture', () => {
  const bets = allocateBetsFifo([
    row({ id: 'sell-1', amount: -1_000, shares: -2_000, isBuy: false, timestamp: 3 }),
    row({ id: 'buy-2', amount: 1_000, shares: 2_000, isBuy: true, timestamp: 2 }),
    row({ id: 'buy-1', amount: 2_000, shares: 4_000, isBuy: true, timestamp: 1 }),
  ]);
  assert.equal(getOmenBuyPayout(bets, 'buy-1', 4_000n, 0, false), 3_000n);
  assert.equal(getOmenBuyPayout(bets, 'buy-2', 4_000n, 0, false), 2_000n);
});

test('eligibility uses the three-decimal amounts persisted by trader', () => {
  assert.equal(isAchievementMultiplierEligible(1_500_600n, 1_000_400n, 6), true);
  assert.equal(isAchievementMultiplierEligible(1_500_000n, 1_000_000n, 6), false);
  assert.equal(
    isAchievementMultiplierEligible(1_500_600_000_000_000_000n, 1_000_400_000_000_000_000n, 18),
    true,
  );
});
