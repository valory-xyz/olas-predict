/* global globalThis, Promise */
import assert from 'node:assert/strict';
import test from 'node:test';

import { INVALID_ANSWER_HEX } from '../constants/index.ts';
import {
  LEADERBOARD_STATE_SCHEMA_VERSION,
  MECH_FEE_USD,
  MIN_SETTLED_BETS_PER_WINDOW,
} from '../constants/leaderboard.ts';
import { generateAgentName } from '../utils/agentName.ts';
import { computeSnapshot } from '../utils/leaderboard/compute.ts';
import {
  SECONDS_PER_DAY,
  attributeMechFees,
  computeWindowMetrics,
  getWindowStart,
  tallyOmenBets,
  tallyPolymarketBets,
  toMarketTally,
} from '../utils/leaderboard/metrics.ts';
import { pageById } from '../utils/leaderboard/paging.ts';
import {
  findRepeatedParam,
  getLeaderboardUrl,
  getListRestart,
  parseAddress,
  parseAgentType,
  parseInteger,
  parseRankBy,
  parseSnapshotParam,
  parseWindow,
  shouldRestartFromSnapshot,
} from '../utils/leaderboard/params.ts';
import {
  PEARL_LOOKUP_MAX_FAILURES,
  PEARL_LOOKUP_RETRY_MS,
  PEARL_MALFORMED_RECHECK_MS,
  classifyService,
  isPearlAgent,
  isPearlLookupPending,
  isPearlLookupUnresolved,
  needsPearlLookup,
  recordPearlLookup,
} from '../utils/leaderboard/pearl.ts';
import {
  PENDING_MARKET_MAX_RECHECK_MS,
  needsMarketCheck,
  recordMarketMiss,
  recordMarketWait,
} from '../utils/leaderboard/pending.ts';
import { parseStoredPins } from '../utils/leaderboard/pins.ts';
import {
  ACCEPT_POPULATION_DROP_AFTER_RUNS,
  checkPopulation,
} from '../utils/leaderboard/population.ts';
import { assignRanks, getNotRankedReason, searchByName } from '../utils/leaderboard/ranking.ts';
import { isCronAuthorized } from '../utils/leaderboard/respond.ts';
import { HttpStatusError, isTransientError, withRetry } from '../utils/leaderboard/retry.ts';
import {
  fetchMechRequests,
  mapWithConcurrency,
  raceDeadline,
} from '../utils/leaderboard/sources.ts';
import { isValidBuilderState, isValidSnapshot } from '../utils/leaderboard/validate.ts';
import { getAgentRecords, getLeaderboardPage } from '../utils/leaderboard/views.ts';

const DAY = SECONDS_PER_DAY;
const TODAY = 1791504000; // 2026-10-09 00:00 UTC
const NOW = TODAY + 12 * 3600;

const day = (date, overrides = {}) => ({
  date,
  tradedSettled: 0,
  profit: 0,
  brierSum: 0,
  brierCount: 0,
  markets: [],
  ...overrides,
});

const metricsFor = (days, { requests = [], titles = {}, tallies = {}, windowDays = 7 } = {}) =>
  computeWindowMetrics({
    days,
    feesByDay: attributeMechFees(days, requests, titles),
    tallies,
    windowStart: getWindowStart(NOW, windowDays),
    mechFee: MECH_FEE_USD,
  });

test('a mech request for a settled market lands on its profit day', () => {
  const days = [day(TODAY - DAY, { profit: 1, markets: ['m1'] })];
  const fees = attributeMechFees(days, [{ titleKey: 't1', timestamp: TODAY - 3 * DAY }], {
    m1: 't1',
  });
  assert.deepEqual([...fees], [[TODAY - DAY, 1]]);
});

test('an unplaced mech request lands on its own day and makes that day negative', () => {
  const requestTime = TODAY - 2 * DAY + 100;
  const metrics = metricsFor([day(TODAY - DAY, { profit: 1, markets: ['m1'] })], {
    requests: [{ titleKey: 'open-market', timestamp: requestTime }],
    titles: { m1: 't1' },
  });
  const fees = attributeMechFees([], [{ titleKey: 'open-market', timestamp: requestTime }], {});
  assert.deepEqual([...fees], [[TODAY - 2 * DAY, 1]]);
  assert.equal(metrics.pnl, 1 - MECH_FEE_USD);

  const mechOnly = metricsFor([], { requests: [{ titleKey: 'x', timestamp: requestTime }] });
  assert.equal(mechOnly.pnl, -MECH_FEE_USD);
});

test('a request without a question title is charged on its own day', () => {
  const fees = attributeMechFees(
    [day(TODAY - DAY, { markets: ['m1'] })],
    [{ titleKey: '', timestamp: TODAY - 3 * DAY + 5 }],
    { m1: 't1', m2: '' },
  );
  assert.deepEqual([...fees], [[TODAY - 3 * DAY, 1]]);
});

test('a request made after the settlement day stays on its own day', () => {
  const fees = attributeMechFees(
    [day(TODAY - 3 * DAY, { markets: ['m1'] })],
    [{ titleKey: 't1', timestamp: TODAY - DAY }],
    { m1: 't1' },
  );
  assert.deepEqual([...fees], [[TODAY - DAY, 1]]);
});

test('P&L is the window sum of daily profit minus attributed mech fees', () => {
  const days = [
    day(TODAY, { profit: 5, tradedSettled: 10, markets: ['m1'] }),
    day(TODAY - DAY, { profit: -2, tradedSettled: 4, markets: ['m2'] }),
  ];
  const metrics = metricsFor(days, {
    requests: [
      { titleKey: 't1', timestamp: TODAY - 2 * DAY },
      { titleKey: 't2', timestamp: TODAY - 2 * DAY },
    ],
    titles: { m1: 't1', m2: 't2' },
  });
  assert.equal(metrics.pnl, 3 - 2 * MECH_FEE_USD);
});

test('ROI divides P&L by the gross buy cost of the settled markets plus mech fees', () => {
  // The agent bought for 10 (fees included) and sold part before settlement: the source's
  // settled cost is net of the sale
  const days = [day(TODAY, { profit: 2, tradedSettled: -3, markets: ['m1'] })];
  const metrics = metricsFor(days, {
    tallies: { m1: [1, 1, 10, 1] },
    requests: [{ titleKey: 't1', timestamp: TODAY - DAY }],
    titles: { m1: 't1' },
  });
  assert.equal(metrics.settledCost, 10 + MECH_FEE_USD);
  assert.equal(metrics.roi, (2 - MECH_FEE_USD) / (10 + MECH_FEE_USD));
});

test('a market settled on two days adds its buy cost once, on its last day', () => {
  const days = [
    day(TODAY - DAY, { tradedSettled: 4, markets: ['m1'] }),
    day(TODAY, { tradedSettled: 6, markets: ['m1'] }),
  ];
  assert.equal(metricsFor(days, { tallies: { m1: [1, 1, 10, 1] } }).settledCost, 10);
});

test('without a market buy cost, the day falls back to its non-negative settled cost', () => {
  const days = [
    day(TODAY, { tradedSettled: 10, markets: ['m1', 'm2'] }),
    day(TODAY - DAY, { tradedSettled: -5, markets: ['m3'] }),
    day(TODAY - 2 * DAY, { tradedSettled: 3 }),
  ];
  // m1 known (4), m2 unknown: max(4, 10); m3 unknown and net negative: 0; no markets: 3
  assert.equal(metricsFor(days, { tallies: { m1: [1, 1, 4, 1] } }).settledCost, 13);
});

test('a fallback day leaves out the buy cost of a market counted on a later settlement', () => {
  // m1 settles on day 1 and again on day 3 (answer changed); day 1 also has m2 without a tally
  const days = [
    day(TODAY - 2 * DAY, { tradedSettled: 12, markets: ['m1', 'm2'] }),
    day(TODAY, { tradedSettled: 10, markets: ['m1'] }),
  ];
  // Day 1: max(0, 12 - 10) for m2; day 3: m1's buy cost once
  assert.equal(metricsFor(days, { tallies: { m1: [1, 1, 10, 1] } }).settledCost, 2 + 10);
  // Never below zero when the later market's buy cost exceeds the day's net
  const small = [day(TODAY - DAY, { tradedSettled: 4, markets: ['m1', 'm2'] }), days[1]];
  assert.equal(metricsFor(small, { tallies: { m1: [1, 1, 10, 1] } }).settledCost, 10);
});

const RANK_RULE = { minSettledBets: MIN_SETTLED_BETS_PER_WINDOW };

test('an agent needs a settled cost above zero to be ranked, however small', () => {
  const reason = (settledCost) =>
    getNotRankedReason(
      {
        address: '0x1',
        hasSettledActivity: true,
        metrics: { roi: 0, pnl: 0, trades: 6, settledBets: 6, settledCost },
      },
      RANK_RULE,
    );
  assert.equal(reason(0), 'not_enough_trades_in_window');
  assert.equal(reason(-1), 'not_enough_trades_in_window');
  assert.equal(reason(0.01), null);
});

test('window bounds include the cutoff day and exclude the day before, for 7D and 1Y', () => {
  for (const windowDays of [7, 365]) {
    const cutoff = TODAY - (windowDays - 1) * DAY;
    const metrics = metricsFor([day(cutoff, { profit: 1 }), day(cutoff - DAY, { profit: 100 })], {
      windowDays,
    });
    assert.equal(metrics.pnl, 1, `${windowDays}d`);
  }
});

test('trades, volume and average trade size are the buys on the markets settled in the window', () => {
  const days = [
    day(TODAY, { tradedSettled: 1, markets: ['m1', 'm2'] }),
    day(TODAY - DAY, { markets: ['m3'] }),
    // Settled before the window: left out
    day(TODAY - 10 * DAY, { markets: ['m4'] }),
    // Untallied: in the ROI fallback only
    day(TODAY - 2 * DAY, { tradedSettled: 5, markets: ['m5'] }),
  ];
  const metrics = metricsFor(days, {
    // [won, counted (sells included), buy cost, buys]
    tallies: { m1: [1, 3, 6, 2], m2: [0, 1, 1, 1], m3: [1, 1, 1, 1], m4: [1, 1, 50, 9] },
  });
  assert.equal(metrics.trades, 4);
  assert.equal(metrics.volume, 8);
  assert.equal(metrics.avgTradeSize, 2);
  assert.equal(metrics.settledCost, 8 + 5);
  assert.equal(metricsFor([]).avgTradeSize, null);
  assert.equal(metricsFor([]).volume, 0);
});

test('Brier score is the window sum over the settled bet count, or null without bets', () => {
  const metrics = metricsFor([
    day(TODAY, { brierSum: 0.4, brierCount: 2 }),
    day(TODAY - DAY, { brierSum: 0.2, brierCount: 2 }),
  ]);
  assert.ok(Math.abs(metrics.brierScore - 0.15) < 1e-12);
  assert.equal(metricsFor([day(TODAY)]).brierScore, null);
});

test('accuracy sums the tallies of markets settled in the window', () => {
  const metrics = metricsFor(
    [day(TODAY, { markets: ['m1', 'm2'] }), day(TODAY - 30 * DAY, { markets: ['m3'] })],
    { tallies: { m1: [1, 2, 1, 1], m2: [2, 2, 1, 1], m3: [0, 5, 1, 1] } },
  );
  assert.equal(metrics.accuracy, 0.75);
  assert.equal(metricsFor([day(TODAY, { markets: ['m9'] })]).accuracy, null);
});

test('a market settled on two days counts towards accuracy once, on its last day', () => {
  const days = [
    day(TODAY - 2 * DAY, { markets: ['m1'] }),
    day(TODAY - DAY, { markets: ['m1', 'm2'] }),
  ];
  const tallies = { m1: [1, 1, 1, 1], m2: [0, 1, 1, 1] };
  assert.equal(metricsFor(days, { tallies }).accuracy, 0.5);
});

test('Omen tallies count only finalized, non-arbitrated, valid answers', () => {
  const base = {
    outcomeIndexes: [1, 1, 0],
    currentAnswer: `0x${'0'.repeat(63)}1`,
    answerFinalizedTimestamp: NOW - 1,
    isPendingArbitration: false,
    nowSeconds: NOW,
    invalidAnswerHex: INVALID_ANSWER_HEX,
  };
  assert.deepEqual(tallyOmenBets(base), [2, 3]);
  assert.equal(tallyOmenBets({ ...base, answerFinalizedTimestamp: NOW + 1 }), null);
  assert.equal(tallyOmenBets({ ...base, answerFinalizedTimestamp: null }), null);
  assert.equal(tallyOmenBets({ ...base, isPendingArbitration: true }), null);
  assert.equal(tallyOmenBets({ ...base, currentAnswer: null }), null);
  assert.deepEqual(tallyOmenBets({ ...base, currentAnswer: INVALID_ANSWER_HEX }), [0, 0]);
});

test('Polymarket tallies skip unresolved and invalid (winningIndex < 0) questions', () => {
  assert.deepEqual(tallyPolymarketBets({ outcomeIndexes: [0, 1, 0], winningIndex: 0 }), [2, 3]);
  assert.equal(tallyPolymarketBets({ outcomeIndexes: [0], winningIndex: null }), null);
  assert.deepEqual(tallyPolymarketBets({ outcomeIndexes: [0], winningIndex: -1 }), [0, 0]);
});

test('a final market without returned bets is left untallied, so it is retried', () => {
  const score = (outcomeIndexes) => tallyPolymarketBets({ outcomeIndexes, winningIndex: 1 });
  assert.equal(toMarketTally(undefined, score), null);
  assert.deepEqual(
    toMarketTally({ outcomeIndexes: [1, 0], buyCost: 3, buys: 1 }, score),
    [1, 2, 3, 1],
  );
  // Not final: nothing to store either
  assert.equal(
    toMarketTally({ outcomeIndexes: [1], buyCost: 3, buys: 1 }, () => null),
    null,
  );
});

const candidate = (address, settledBets, { roi = 0, pnl = 0, trades = 0, active = true } = {}) => ({
  address,
  hasSettledActivity: active,
  metrics: { roi, pnl, trades, settledBets, settledCost: 10 },
});

test('not-ranked reasons follow lifetime activity and settled bets in the window', () => {
  assert.equal(MIN_SETTLED_BETS_PER_WINDOW, 5);
  const reason = (c) => getNotRankedReason(c, RANK_RULE);
  assert.equal(reason(candidate('a', 0, { active: false })), 'not_ranked_yet');
  assert.equal(reason(candidate('a', 0)), 'not_enough_trades_in_window');
  assert.equal(reason(candidate('a', 4)), 'not_enough_trades_in_window');
  assert.equal(reason(candidate('a', 5)), null);
});

test('ranks are highest first, ties broken by trades then address', () => {
  const ranks = assignRanks(
    [
      candidate('0xc', 5, { roi: 0.1, trades: 10 }),
      candidate('0xb', 5, { roi: 0.5, trades: 1 }),
      candidate('0xa', 5, { roi: 0.1, trades: 10 }),
      candidate('0xd', 5, { roi: 0.1, trades: 20 }),
    ].map(({ address, metrics }) => ({ address, metrics })),
    'roi',
  );
  assert.deepEqual(
    [...ranks],
    [
      ['0xb', 1],
      ['0xd', 2],
      ['0xa', 3],
      ['0xc', 4],
    ],
  );
});

test('search is a case-insensitive substring match, ranked matches first', () => {
  const rows = [
    { name: 'velvet-pine81', rank: 104 },
    { name: 'mellow-orbit42', rank: 1 },
    { name: 'velvet-moss03', rank: null },
    { name: 'velvet-arc11', rank: 3 },
  ];
  assert.deepEqual(
    searchByName(rows, ' VELV ').map((row) => row.name),
    ['velvet-arc11', 'velvet-pine81', 'velvet-moss03'],
  );
  assert.deepEqual(searchByName(rows, 'nomatch'), []);
});

test('the Pearl filter needs the trader package name and the [Pearl service] prefix', () => {
  const pearlOmen = {
    name: 'service/valory/trader_pearl/0.1.0',
    description: '[Pearl service] valory/trader_pearl',
  };
  assert.equal(isPearlAgent('omenstrat', pearlOmen), true);
  assert.equal(
    isPearlAgent('polystrat', {
      name: 'service/valory/polymarket_trader/0.1.0',
      description: '[Pearl service] Trader agent for polymarket prediction markets',
    }),
    true,
  );
  // The package is per chain
  assert.equal(isPearlAgent('polystrat', pearlOmen), false);
  // Quickstart deploys the same package without the prefix
  assert.equal(
    isPearlAgent('omenstrat', {
      name: 'service/valory/trader_pearl/0.1.0',
      description: 'Trader agent for omen prediction markets',
    }),
    false,
  );
  // Other Pearl agents carry the prefix too
  assert.equal(
    isPearlAgent('omenstrat', {
      name: 'service/valory/connect/0.1.0',
      description: '[Pearl service] An agent that provides ...',
    }),
    false,
  );
  assert.equal(
    isPearlAgent('omenstrat', { ...pearlOmen, name: 'service/valory/trader_pearl_x/0.1.0' }),
    false,
  );
  assert.equal(
    isPearlAgent('omenstrat', { ...pearlOmen, description: 'x [Pearl service]' }),
    false,
  );
  assert.equal(classifyService('omenstrat', {}), 'malformed');
  assert.equal(classifyService('omenstrat', null), 'malformed');
  assert.equal(classifyService('omenstrat', { name: 'a', description: 'b' }), 'other');
});

test('a failed Pearl lookup holds the snapshot back, then gives up and is retried later', () => {
  const t0 = 1_000_000;
  assert.equal(needsPearlLookup(undefined, t0), true);
  assert.equal(isPearlLookupPending(undefined), true);

  let lookup;
  for (let run = 1; run < PEARL_LOOKUP_MAX_FAILURES; run++) {
    lookup = recordPearlLookup(lookup, null, t0 + run);
    assert.equal(isPearlLookupPending(lookup), true, `run ${run}`);
    assert.equal(needsPearlLookup(lookup, t0 + run), true);
  }
  lookup = recordPearlLookup(lookup, null, t0);
  assert.equal(lookup.failures, PEARL_LOOKUP_MAX_FAILURES);
  assert.equal(isPearlLookupPending(lookup), false);
  assert.equal(isPearlLookupUnresolved(lookup), true);
  assert.equal(needsPearlLookup(lookup, t0 + PEARL_LOOKUP_RETRY_MS - 1), false);
  assert.equal(needsPearlLookup(lookup, t0 + PEARL_LOOKUP_RETRY_MS), true);

  const resolved = recordPearlLookup(lookup, 'pearl', t0 + PEARL_LOOKUP_RETRY_MS);
  assert.deepEqual(resolved, {
    status: 'pearl',
    checkedAt: t0 + PEARL_LOOKUP_RETRY_MS,
    failures: 0,
  });
  assert.equal(isPearlLookupUnresolved(resolved), false);
  assert.equal(needsPearlLookup(resolved, Number.MAX_SAFE_INTEGER), false);
});

test('malformed metadata is not Pearl and is read again after a while', () => {
  const lookup = recordPearlLookup(undefined, 'malformed', 0);
  assert.equal(isPearlLookupPending(lookup), false);
  assert.equal(needsPearlLookup(lookup, PEARL_MALFORMED_RECHECK_MS - 1), false);
  assert.equal(needsPearlLookup(lookup, PEARL_MALFORMED_RECHECK_MS), true);
  // A failed re-check keeps the earlier answer and does not hold the snapshot back
  const failed = recordPearlLookup(lookup, null, PEARL_MALFORMED_RECHECK_MS);
  assert.equal(failed.status, 'malformed');
  assert.equal(isPearlLookupPending(failed), false);
  assert.equal(needsPearlLookup(recordPearlLookup(undefined, 'other', 0), 1e15), false);
});

test('stored pins: invalid entries dropped one by one, addresses lower-cased, no duplicates', () => {
  const upper = '0xFE94203ab2c1c22fe8585cbebf865f7b69eb7027';
  const lower = upper.toLowerCase();
  const pins = parseStoredPins(
    JSON.stringify([
      { address: upper, agentType: 'omenstrat', pinnedAt: 1 },
      { address: lower, agentType: 'omenstrat', pinnedAt: 2 },
      { address: lower, agentType: 'polystrat' },
      { address: '0xnope', agentType: 'omenstrat', pinnedAt: 3 },
      { address: lower, agentType: 'other', pinnedAt: 4 },
      null,
      'x',
    ]),
  );
  assert.deepEqual(pins, [
    { address: lower, agentType: 'omenstrat', pinnedAt: 1 },
    { address: lower, agentType: 'polystrat', pinnedAt: 0 },
  ]);
  assert.deepEqual(parseStoredPins('{not json'), []);
  assert.deepEqual(parseStoredPins('{"a":1}'), []);
  assert.deepEqual(parseStoredPins(null), []);
});

test("agent names match Pearl's generateAgentName", () => {
  // Produced once with olas-operate-app frontend/utils/generateAgentName
  const fixtures = [
    [100, 1, 'tuwim-kakon68'],
    [100, 592, 'latron-majan66'],
    [100, 1549, 'nornor-cilzo96'],
    [100, 2265, 'lelwo-hifa62'],
    [137, 32, 'pasus-benmo18'],
    [137, 66, 'pussel-ditu89'],
  ];
  for (const [chainId, serviceId, name] of fixtures) {
    assert.equal(generateAgentName(chainId, serviceId), name, `${chainId}/${serviceId}`);
  }
});

test('the deep link carries agent type, ROI, window and the pinned Safe', () => {
  assert.equal(
    getLeaderboardUrl('polystrat', '30d', '0xabc'),
    'https://predict.olas.network/leaderboard?agentType=polystrat&rankBy=roi&window=30d&pin=0xabc',
  );
  assert.equal(
    parseAddress('0xFE94203ab2c1c22fe8585cbebf865f7b69eb7027'),
    '0xfe94203ab2c1c22fe8585cbebf865f7b69eb7027',
  );
  assert.equal(parseAddress('0xnope'), null);
});

const entry = (rankByRoi, rankByPnl, notRankedReason = null) => ({
  metrics: notRankedReason
    ? null
    : {
        roi: 0.1,
        pnl: 1,
        accuracy: null,
        brierScore: null,
        avgTradeSize: null,
        volume: 1,
        trades: 5,
      },
  rankByRoi,
  rankByPnl,
  notRankedReason,
});

const snapshot = {
  schemaVersion: 1,
  agentType: 'omenstrat',
  updatedAt: '2026-10-09T12:00:00.000Z', // NOW
  sourceHeight: 1,
  totalRanked: { '7d': 2, '30d': 2, '90d': 2, '1y': 2 },
  excluded: ['0x8'],
  agents: [
    ['0x1', 'alpha', entry(2, 1)],
    ['0x2', 'beta', entry(1, 2)],
    ['0x3', 'alpine', entry(null, null, 'not_enough_trades_in_window')],
  ].map(([address, name, windowEntry]) => ({
    address,
    serviceId: '1',
    name,
    hasSettledActivity: true,
    windows: { '7d': windowEntry, '30d': windowEntry, '90d': windowEntry, '1y': windowEntry },
  })),
};

test('the list holds ranked agents only, in order of the selected criterion', () => {
  const page = (rankBy) =>
    getLeaderboardPage({ snapshot, window: '7d', rankBy, search: '', offset: 0, limit: 30 });
  assert.deepEqual(
    page('roi').agents.map((row) => row.address),
    ['0x2', '0x1'],
  );
  assert.deepEqual(
    page('pnl').agents.map((row) => row.address),
    ['0x1', '0x2'],
  );
  assert.equal(page('roi').totalResults, 2);
  const second = getLeaderboardPage({
    snapshot,
    window: '7d',
    rankBy: 'roi',
    search: '',
    offset: 1,
    limit: 1,
  });
  assert.deepEqual(
    second.agents.map((row) => row.address),
    ['0x1'],
  );
});

test('search lists only ranked matches, with their rank in the full leaderboard', () => {
  const { agents, totalResults } = getLeaderboardPage({
    snapshot,
    window: '7d',
    rankBy: 'roi',
    search: 'alp',
    offset: 0,
    limit: 30,
  });
  assert.deepEqual(
    agents.map((row) => [row.address, row.rank]),
    [['0x1', 2]],
  );
  assert.equal(totalResults, 1);
});

// The fixture's short addresses, as full lowercased addresses for the validator
const fullAddress = (address) => `0x${address.slice(2).padStart(40, '0')}`;
const storedSnapshot = {
  ...snapshot,
  excluded: snapshot.excluded.map(fullAddress),
  agents: snapshot.agents.map((agent) => ({ ...agent, address: fullAddress(agent.address) })),
};

test('a snapshot read back must have the expected shape and agent type', () => {
  const snapshot = storedSnapshot;
  assert.equal(isValidSnapshot(snapshot, 'omenstrat'), true);
  assert.equal(isValidSnapshot(snapshot, 'polystrat'), false);
  assert.equal(isValidSnapshot({ ...snapshot, schemaVersion: 2 }, 'omenstrat'), false);
  assert.equal(isValidSnapshot({ ...snapshot, agents: null }, 'omenstrat'), false);
  assert.equal(isValidSnapshot({ ...snapshot, totalRanked: { '7d': 1 } }, 'omenstrat'), false);
  const windows = { ...snapshot.agents[0].windows };
  delete windows['1y'];
  assert.equal(
    isValidSnapshot({ ...snapshot, agents: [{ ...snapshot.agents[0], windows }] }, 'omenstrat'),
    false,
  );
  assert.equal(isValidSnapshot({ ...snapshot, excluded: 'x' }, 'omenstrat'), false);
  assert.equal(isValidSnapshot({ ...snapshot, excluded: undefined }, 'omenstrat'), true);
  assert.equal(isValidSnapshot(null, 'omenstrat'), false);
});

test('query parameters: case-insensitive options, strict integers, repeated values', () => {
  assert.equal(parseAgentType('PolyStrat'), 'polystrat');
  assert.equal(parseRankBy('PNL'), 'pnl');
  assert.equal(parseWindow('1Y'), '1y');
  assert.equal(parseWindow('2y'), null);
  assert.equal(parseInteger(undefined, 30), 30);
  assert.equal(parseInteger('0', 30), 0);
  assert.equal(parseInteger('25', 30), 25);
  for (const bad of ['002', '-1', '1.5', '', ' 1', '1e3', '9999999999']) {
    assert.equal(parseInteger(bad, 30), null, bad);
  }
  assert.equal(parseInteger(['1', '2'], 30), null);
  assert.equal(
    findRepeatedParam({ window: '7d', search: ['a', 'b'] }, ['window', 'search']),
    'search',
  );
  assert.equal(findRepeatedParam({ window: '7d', other: ['a', 'b'] }, ['window']), null);
});

test('per-address records keep request order and mark unknown Safes not ranked yet', () => {
  const records = getAgentRecords(snapshot, '7d', ['0x9', '0x1', '0x8']);
  assert.deepEqual(
    records.map((record) => [
      record.address,
      record.ranked,
      record.notRankedReason,
      record.rankByRoi,
    ]),
    [
      ['0x9', false, 'not_ranked_yet', null],
      ['0x1', true, null, 2],
      ['0x8', false, 'not_eligible', null],
    ],
  );
  // Snapshots written before `excluded` existed still answer
  const older = { ...snapshot, excluded: undefined };
  assert.equal(getAgentRecords(older, '7d', ['0x8'])[0].notRankedReason, 'not_ranked_yet');
  assert.equal(records[0].name, null);
  assert.equal(records[1].leaderboardUrl, getLeaderboardUrl('omenstrat', '7d', '0x1'));
});

test('computeSnapshot ranks each window and nulls metrics of agents not ranked there', () => {
  // Five settled bets today: ranked in every window
  const settledToday = (profit) =>
    day(TODAY, {
      profit,
      tradedSettled: 10,
      brierCount: 5,
      brierSum: 1,
      markets: ['m1'],
    });
  const tallies = { m1: [1, 1, 10, 1] };
  const agents = [
    { address: '0xa', serviceId: '592', days: [settledToday(1)], requests: [], tallies },
    { address: '0xb', serviceId: '1549', days: [settledToday(3)], requests: [], tallies },
    // Settled activity only 40 days ago: ranked in 90D and 1Y only
    {
      address: '0xc',
      serviceId: '2265',
      days: [day(TODAY - 40 * DAY, { profit: 9, tradedSettled: 10, brierCount: 5 })],
      requests: [],
      tallies: {},
    },
    // Bets placed but nothing settled yet
    {
      address: '0xd',
      serviceId: '1',
      days: [day(TODAY)],
      requests: [],
      tallies: {},
    },
  ];
  const result = computeSnapshot({
    agentType: 'omenstrat',
    agents,
    excluded: ['0xe'],
    marketTitles: {},
    nowSeconds: NOW,
    sourceHeight: 42,
  });
  assert.deepEqual(result.excluded, ['0xe']);
  const byAddress = Object.fromEntries(result.agents.map((agent) => [agent.address, agent]));

  assert.deepEqual(result.totalRanked, { '7d': 2, '30d': 2, '90d': 3, '1y': 3 });
  assert.equal(byAddress['0xb'].windows['7d'].rankByRoi, 1);
  assert.equal(byAddress['0xa'].windows['7d'].rankByRoi, 2);
  assert.equal(byAddress['0xc'].windows['90d'].rankByPnl, 1);
  assert.deepEqual(byAddress['0xc'].windows['7d'], {
    metrics: null,
    rankByRoi: null,
    rankByPnl: null,
    notRankedReason: 'not_enough_trades_in_window',
  });
  assert.equal(byAddress['0xd'].hasSettledActivity, false);
  assert.equal(byAddress['0xd'].windows['1y'].notRankedReason, 'not_ranked_yet');
  assert.equal(byAddress['0xa'].name, 'latron-majan66');
  assert.equal(byAddress['0xb'].windows['7d'].metrics.roi, 0.3);
  assert.equal('settledBets' in byAddress['0xb'].windows['7d'].metrics, false);
  assert.equal(result.sourceHeight, 42);
});

test('the refresh route accepts only the exact cron bearer secret', () => {
  assert.equal(isCronAuthorized('Bearer s3cret', 's3cret'), true);
  assert.equal(isCronAuthorized('Bearer wrong!', 's3cret'), false);
  assert.equal(isCronAuthorized('Bearer s3cret-longer', 's3cret'), false);
  assert.equal(isCronAuthorized(undefined, 's3cret'), false);
  // An unset secret never authorizes, even against an empty bearer
  assert.equal(isCronAuthorized('Bearer ', undefined), false);
  assert.equal(isCronAuthorized('Bearer ', ''), false);
});

test('id paging follows the id cursor and reports a deadline stop as incomplete', async () => {
  const rows = Array.from({ length: 23 }, (_, i) => ({ id: `r${String(i).padStart(6, '0')}` }));
  const fetchPage = async (idGt) => rows.filter((row) => row.id > idGt).slice(0, 5);
  const all = await pageById({
    pageSize: 5,
    isPastDeadline: () => false,
    fetchPage,
  });
  assert.deepEqual(all, { rows, complete: true });
  let pages = 0;
  const cut = await pageById({
    pageSize: 5,
    isPastDeadline: () => pages++ >= 2,
    fetchPage,
  });
  assert.deepEqual(cut, { rows: rows.slice(0, 10), complete: false });
});

test('a market left untallied is looked up again with a doubling wait, up to a day', () => {
  const HOUR = 3600_000;
  assert.equal(needsMarketCheck(undefined, 0), true);
  let check = recordMarketMiss(undefined, 0);
  assert.deepEqual(check, [HOUR, 1]);
  // The next hourly run, even if it starts a little early
  assert.equal(needsMarketCheck(check, HOUR - 60_000), true);
  assert.equal(needsMarketCheck(check, HOUR / 2), false);
  check = recordMarketMiss(check, HOUR);
  assert.equal(needsMarketCheck(check, 2 * HOUR), false);
  assert.equal(needsMarketCheck(check, 3 * HOUR), true);
  for (let i = 0; i < 10; i++) check = recordMarketMiss(check, 0);
  assert.equal(needsMarketCheck(check, PENDING_MARKET_MAX_RECHECK_MS - HOUR), false);
  assert.equal(needsMarketCheck(check, PENDING_MARKET_MAX_RECHECK_MS), true);
});

test('the snapshot parameter must be a past canonical ISO timestamp', () => {
  const now = Date.parse('2026-10-13T12:00:00.000Z');
  const valid = '2026-10-13T11:00:00.000Z';
  assert.equal(parseSnapshotParam(valid, now), valid);
  // Small clock differences between instances are tolerated
  assert.equal(parseSnapshotParam('2026-10-13T12:00:30.000Z', now), '2026-10-13T12:00:30.000Z');
  for (const bad of [
    '',
    'z123',
    '2026-10-13T13:00:00.000Z',
    '2026-10-13T11:00:00Z',
    '2026-10-13',
    '1791504000',
    'Tue Oct 13 2026',
    ['2026-10-13T11:00:00.000Z'],
  ]) {
    assert.equal(parseSnapshotParam(bad, now), null, String(bad));
  }
});

test('a 409 restarts the list only from a newer snapshot than the one shown', () => {
  const shown = '2026-10-13T11:00:00.000Z';
  assert.equal(shouldRestartFromSnapshot('2026-10-13T12:00:00.000Z', shown), true);
  assert.equal(shouldRestartFromSnapshot('2026-10-13T10:00:00.000Z', shown), false);
  assert.equal(shouldRestartFromSnapshot(shown, shown), false);
  assert.equal(shouldRestartFromSnapshot(undefined, shown), false);
  assert.equal(shouldRestartFromSnapshot(shown, undefined), true);
});

test('the list restarts only after a failed Load more or with nothing shown, and never spins', () => {
  const S0 = '2026-10-13T10:00:00.000Z';
  const S1 = '2026-10-13T11:00:00.000Z';
  const base = {
    status: 409,
    conflictUpdatedAt: S1,
    shownSnapshot: S0,
    pinnedSnapshot: undefined,
    isLoadMoreError: true,
    hasData: true,
  };
  // Load more found a newer snapshot: start over from it
  assert.deepEqual(getListRestart(base), { snapshot: S1 });
  // A failed background refetch keeps the pages it has
  assert.equal(getListRestart({ ...base, isLoadMoreError: false }), null);
  // The stored snapshot went back: start over from whatever is current, not from S0
  assert.deepEqual(getListRestart({ ...base, conflictUpdatedAt: S0, shownSnapshot: S1 }), {
    snapshot: null,
  });
  // Nothing shown yet: any snapshot the server names will do, so the list never spins
  assert.deepEqual(
    getListRestart({
      ...base,
      conflictUpdatedAt: S0,
      shownSnapshot: undefined,
      pinnedSnapshot: S1,
      isLoadMoreError: false,
      hasData: false,
    }),
    { snapshot: S0 },
  );
  // A pinned first page that kept getting 503 (an instance behind) starts over unpinned
  const behind = { ...base, status: 503, conflictUpdatedAt: undefined, isLoadMoreError: false };
  assert.deepEqual(getListRestart({ ...behind, hasData: false, pinnedSnapshot: S1 }), {
    snapshot: null,
  });
  // An unpinned 503 is a real outage: show it
  assert.equal(getListRestart({ ...behind, hasData: false }), null);
  // A failed Load more for any other reason keeps the rows
  assert.equal(getListRestart({ ...base, status: 503, conflictUpdatedAt: undefined }), null);
  assert.equal(getListRestart({ ...base, status: 500, conflictUpdatedAt: undefined }), null);
});

test('a snapshot window entry pairs ranks and metrics with the absence of a reason', () => {
  const snapshot = storedSnapshot;
  const withEntry = (windowEntry) => ({
    ...snapshot,
    totalRanked: { ...snapshot.totalRanked, '7d': windowEntry.notRankedReason === null ? 2 : 1 },
    agents: [
      {
        ...snapshot.agents[0],
        windows: { ...snapshot.agents[0].windows, '7d': windowEntry },
      },
      // Ranked first in 7D, so its ranks fit whatever the window's total
      {
        ...snapshot.agents[1],
        windows: { ...snapshot.agents[1].windows, '7d': entry(1, 1) },
      },
    ],
  });
  const ranked = entry(1, 2);
  const valid = (windowEntry) => isValidSnapshot(withEntry(windowEntry), 'omenstrat');
  assert.equal(valid(ranked), true);
  assert.equal(valid(entry(null, null, 'not_ranked_yet')), true);
  // Ranked without ranks or metrics
  assert.equal(valid({ ...ranked, rankByRoi: null }), false);
  assert.equal(valid({ ...ranked, metrics: null }), false);
  assert.equal(valid({ ...ranked, metrics: {} }), false);
  assert.equal(valid({ ...ranked, metrics: { ...ranked.metrics, roi: '0.1' } }), false);
  assert.equal(valid({ ...ranked, metrics: { ...ranked.metrics, accuracy: undefined } }), false);
  // A reason with ranks or metrics
  assert.equal(valid({ ...ranked, notRankedReason: 'not_ranked_yet' }), false);
  assert.equal(valid({ ...ranked, notRankedReason: 'other' }), false);
  // Ranks are integers from 1 to the window's totalRanked
  assert.equal(valid(entry(0, 1)), false);
  assert.equal(valid(entry(1.5, 1)), false);
  assert.equal(valid(entry(1, 3)), false);
});

test('a snapshot must be consistent: canonical updatedAt, lowercased addresses, ranked count', () => {
  const snapshot = storedSnapshot;
  assert.equal(isValidSnapshot({ ...snapshot, updatedAt: 'yesterday' }, 'omenstrat'), false);
  assert.equal(
    isValidSnapshot({ ...snapshot, updatedAt: '2026-10-09T12:00:00Z' }, 'omenstrat'),
    false,
  );
  const [first, ...rest] = snapshot.agents;
  const mixedCase = { ...first, address: first.address.replace('0x0', '0xA') };
  assert.equal(isValidSnapshot({ ...snapshot, agents: [mixedCase, ...rest] }, 'omenstrat'), false);
  assert.equal(
    isValidSnapshot({ ...snapshot, agents: [{ ...first, address: '0x1' }, ...rest] }, 'omenstrat'),
    false,
  );
  assert.equal(isValidSnapshot({ ...snapshot, excluded: ['0x8'] }, 'omenstrat'), false);
  // totalRanked must count the ranked agents
  assert.equal(
    isValidSnapshot(
      { ...snapshot, totalRanked: { ...snapshot.totalRanked, '30d': 3 } },
      'omenstrat',
    ),
    false,
  );
});

test('a builder state read back must have the expected shape', () => {
  const state = {
    schemaVersion: LEADERBOARD_STATE_SCHEMA_VERSION,
    pearl: {
      1: { status: 'pearl', checkedAt: 1, failures: 0 },
      2: { status: null, checkedAt: 1, failures: 3 },
    },
    mech: {
      '0x1': {
        syncedTo: 5,
        requests: [
          ['abc', 4],
          ['', 5],
        ],
      },
    },
    tallies: { '0x1': { m1: [1, 2, 3.5, 1] } },
    titles: { q1: 'abc' },
    pendingMarkets: { m2: [1, 2] },
  };
  assert.equal(isValidBuilderState(state), true);
  // States saved before pendingMarkets existed
  assert.equal(isValidBuilderState({ ...state, pendingMarkets: undefined }), true);
  for (const bad of [
    null,
    [],
    { ...state, schemaVersion: LEADERBOARD_STATE_SCHEMA_VERSION - 1 },
    { ...state, mech: undefined },
    { ...state, mech: { '0x1': { syncedTo: 5 } } },
    { ...state, mech: { '0x1': { syncedTo: 5, requests: [['abc']] } } },
    { ...state, pearl: { 1: { status: 'maybe', checkedAt: 1, failures: 0 } } },
    { ...state, tallies: { '0x1': { m1: [1, 2] } } },
    { ...state, titles: { q1: 1 } },
    { ...state, pendingMarkets: { m2: [1] } },
  ]) {
    assert.equal(isValidBuilderState(bad), false, JSON.stringify(bad));
  }
});

test('withRetry retries transient errors before the deadline only', async () => {
  const noSleep = async () => {};
  const failing = (errors) => {
    let calls = 0;
    const attempt = async () => {
      calls += 1;
      if (errors.length) throw errors.shift();
      return 'ok';
    };
    return { attempt, calls: () => calls };
  };
  const far = Date.now() + 60_000;
  const flaky = failing([new HttpStatusError(503, 'u'), new TypeError('fetch failed')]);
  assert.equal(await withRetry(flaky.attempt, { deadline: far, sleep: noSleep }), 'ok');
  assert.equal(flaky.calls(), 3);
  // Out of retries
  const down = failing([1, 2, 3].map(() => new HttpStatusError(502, 'u')));
  await assert.rejects(withRetry(down.attempt, { deadline: far, sleep: noSleep }), HttpStatusError);
  assert.equal(down.calls(), 3);
  // Not transient
  const bad = failing([new HttpStatusError(400, 'u')]);
  await assert.rejects(withRetry(bad.attempt, { deadline: far, sleep: noSleep }));
  assert.equal(bad.calls(), 1);
  // A retry that would start after the deadline is not made
  const late = failing([new HttpStatusError(500, 'u')]);
  await assert.rejects(withRetry(late.attempt, { deadline: Date.now() + 500, sleep: noSleep }));
  assert.equal(late.calls(), 1);

  const graphqlError = Object.assign(new Error('x'), { response: { status: 200 } });
  const gatewayError = Object.assign(new Error('x'), { response: { status: 504 } });
  const timeout = Object.assign(new Error('x'), { name: 'TimeoutError' });
  assert.equal(isTransientError(graphqlError), false);
  assert.equal(isTransientError(gatewayError), true);
  assert.equal(isTransientError(timeout), true);
  assert.equal(isTransientError(new HttpStatusError(429, 'u')), true);
  assert.equal(isTransientError(new HttpStatusError(404, 'u')), false);
});

/** Replaces `fetch` for one test with `handler(url)` -> { status, body } */
const withFetch = async (handler, run) => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    const { status = 200, body } = await handler(url);
    return new Response(JSON.stringify(body), { status });
  };
  try {
    return await run(urls);
  } finally {
    globalThis.fetch = original;
  }
};

const scoredRow = (id, requestedAt, title = `Q${id}`) => ({
  request_id: `0x${id}`,
  requested_at: requestedAt,
  question_title: title,
  source: 'mech_offchain',
});

test('mech requests come from mech-analytics scored rows, paged by cursor and chain-scoped', async () => {
  const pages = {
    '': {
      rows: [scoredRow(1, '2026-10-01T10:00:00.5Z'), scoredRow(2, '2026-10-01T11:00:00Z', null)],
      next_cursor: 'c1',
    },
    c1: {
      rows: [scoredRow(2, '2026-10-01T11:00:00Z', null), scoredRow(3, '2026-10-02T00:00:00Z')],
      next_cursor: null,
    },
  };
  await withFetch(
    (url) => ({ body: pages[url.searchParams.get('cursor') ?? ''] }),
    async (urls) => {
      const result = await fetchMechRequests('polystrat', '0xabc', 1791000000, Date.now() + 60_000);
      assert.equal(result.complete, true);
      // De-duplicated by request id, untitled kept as null
      assert.deepEqual(result.requests, [
        { title: 'Q1', timestamp: Date.parse('2026-10-01T10:00:00Z') / 1000 },
        { title: null, timestamp: Date.parse('2026-10-01T11:00:00Z') / 1000 },
        { title: 'Q3', timestamp: Date.parse('2026-10-02T00:00:00Z') / 1000 },
      ]);
      const first = urls[0].searchParams;
      assert.equal(urls[0].pathname, '/v1/data/scored-rows');
      assert.equal(first.get('requester'), '0xabc');
      assert.equal(first.get('chain_id'), '137');
      assert.equal(first.get('since'), new Date(1791000000 * 1000).toISOString());
      assert.equal(first.get('sort'), 'requested_at');
      assert.equal(urls[1].searchParams.get('cursor'), 'c1');
    },
  );
  // A failed answer throws instead of reading as "no requests"
  await withFetch(
    () => ({ status: 404, body: {} }),
    () =>
      assert.rejects(fetchMechRequests('omenstrat', '0xabc', 0, Date.now() + 60_000), /HTTP 404/),
  );
  await withFetch(
    () => ({ body: { detail: 'proxy error' } }),
    () => assert.rejects(fetchMechRequests('omenstrat', '0xabc', 0, Date.now() + 60_000)),
  );
  // Past the deadline: nothing fetched, incomplete
  await withFetch(
    () => assert.fail('no request expected'),
    async () =>
      assert.deepEqual(await fetchMechRequests('omenstrat', '0xabc', 0, Date.now() - 1), {
        requests: [],
        complete: false,
      }),
  );
});

test('a classified service is looked up again when its tokenURI changes', () => {
  const t0 = 1_000_000;
  const other = recordPearlLookup(undefined, 'other', t0, 'ipfs://a');
  assert.deepEqual(other, { status: 'other', checkedAt: t0, failures: 0, uri: 'ipfs://a' });
  assert.equal(needsPearlLookup(other, t0 + 1, 'ipfs://a'), false);
  // tokenURI unread this run: keep the classification
  assert.equal(needsPearlLookup(other, t0 + 1), false);
  assert.equal(needsPearlLookup(other, t0 + 1, 'ipfs://b'), true);
  // Stored before URIs were kept: classify once more
  assert.equal(
    needsPearlLookup({ status: 'pearl', checkedAt: t0, failures: 0 }, t0, 'ipfs://a'),
    true,
  );
  // A failed re-check keeps the answer and the old URI, and is paced like any failed lookup
  let lookup = other;
  for (let run = 1; run <= PEARL_LOOKUP_MAX_FAILURES; run++) {
    lookup = recordPearlLookup(lookup, null, t0 + run);
  }
  assert.deepEqual(lookup, {
    status: 'other',
    checkedAt: t0 + PEARL_LOOKUP_MAX_FAILURES,
    failures: PEARL_LOOKUP_MAX_FAILURES,
    uri: 'ipfs://a',
  });
  assert.equal(isPearlLookupPending(lookup), false);
  assert.equal(needsPearlLookup(lookup, t0 + 10, 'ipfs://b'), false);
  assert.equal(needsPearlLookup(lookup, t0 + PEARL_LOOKUP_RETRY_MS + 10, 'ipfs://b'), true);
  const pearl = recordPearlLookup(lookup, 'pearl', t0 + 20, 'ipfs://b');
  assert.deepEqual(pearl, { status: 'pearl', checkedAt: t0 + 20, failures: 0, uri: 'ipfs://b' });
});

test('mapWithConcurrency starts nothing after an error and waits for the calls in flight', async () => {
  const started = [];
  let finished = 0;
  const run = mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
    started.push(item);
    await new Promise((resolve) => setTimeout(resolve, item === 1 ? 1 : 20));
    if (item === 1) throw new Error('boom');
    finished += 1;
    return item;
  });
  await assert.rejects(run, /boom/);
  // 1 and 2 were in flight; 2 finished before the rejection; nothing else started
  assert.deepEqual(started, [1, 2]);
  assert.equal(finished, 1);
  assert.deepEqual(await mapWithConcurrency([3, 1, 2], 2, async (item) => item * 2), [6, 2, 4]);
});

test('raceDeadline gives up at the deadline', async () => {
  const never = new Promise(() => {});
  const started = Date.now();
  assert.equal(await raceDeadline(never, Date.now() + 30), undefined);
  assert.ok(Date.now() - started < 1000);
  assert.equal(await raceDeadline(Promise.resolve(7), Date.now() + 1000), 7);
});

test('a market waiting for its finalization is due then, without a miss', () => {
  const HOUR = 3_600_000;
  const finalizesAt = 24 * HOUR + HOUR / 2;
  let check = recordMarketWait(undefined, finalizesAt);
  assert.deepEqual(check, [finalizesAt, 0]);
  // Not looked up again before; the first hourly run after finalization is due
  assert.equal(needsMarketCheck(check, 12 * HOUR), false);
  assert.equal(needsMarketCheck(check, 25 * HOUR), true);
  // Rechecked a little early: wait again, still no miss
  check = recordMarketWait(check, finalizesAt);
  assert.equal(check[1], 0);
  // A miss after that backs off from the first step
  assert.deepEqual(recordMarketMiss(check, 25 * HOUR), [26 * HOUR, 1]);
});

test('a run whose sources shrank or went back is refused, then accepted if it lasts', () => {
  const previous = { sourceHeight: 1000, activeAgents: 500, pearlAgents: 100, suspectRuns: 0 };
  const same = { sourceHeight: 1100, activeAgents: 480, pearlAgents: 95 };
  assert.deepEqual(checkPopulation(previous, same), {
    record: { ...same, suspectRuns: 0 },
    refusal: null,
    accepted: null,
  });
  // Nothing to compare with
  assert.equal(checkPopulation(undefined, { ...same, activeAgents: 0 }).refusal, null);
  // A reorg's worth of blocks back is fine; more is not
  assert.equal(checkPopulation(previous, { ...same, sourceHeight: 950 }).refusal, null);
  assert.match(checkPopulation(previous, { ...same, sourceHeight: 800 }).refusal, /height/);
  assert.match(checkPopulation(previous, { ...same, activeAgents: 1 }).refusal, /active agents/);
  assert.match(checkPopulation(previous, { ...same, pearlAgents: 0 }).refusal, /Pearl agents/);

  // A lasting drop is accepted on the last of ACCEPT_POPULATION_DROP_AFTER_RUNS runs
  const shrunk = { sourceHeight: 1200, activeAgents: 100, pearlAgents: 20 };
  let record = previous;
  for (let run = 1; run < ACCEPT_POPULATION_DROP_AFTER_RUNS; run++) {
    const result = checkPopulation(record, shrunk);
    assert.ok(result.refusal);
    // The baseline stays the last accepted run
    assert.equal(result.record.activeAgents, 500);
    record = result.record;
  }
  const last = checkPopulation(record, shrunk);
  assert.equal(last.refusal, null);
  assert.ok(last.accepted);
  assert.deepEqual(last.record, { ...shrunk, suspectRuns: 0 });
});
