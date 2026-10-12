import assert from 'node:assert/strict';
import test from 'node:test';

import { INVALID_ANSWER_HEX } from '../constants/index.ts';
import {
  MECH_FEE_USD,
  MIN_SETTLED_BETS_PER_WINDOW,
  MIN_SETTLED_COST_USD,
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
} from '../utils/leaderboard/metrics.ts';
import {
  findRepeatedParam,
  getLeaderboardUrl,
  parseAddress,
  parseAgentType,
  parseInteger,
  parseRankBy,
  parseWindow,
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
import { parseStoredPins } from '../utils/leaderboard/pins.ts';
import { assignRanks, getNotRankedReason, searchByName } from '../utils/leaderboard/ranking.ts';
import { isCronAuthorized } from '../utils/leaderboard/respond.ts';
import { isValidSnapshot } from '../utils/leaderboard/validate.ts';
import { getAgentRecords, getLeaderboardPage } from '../utils/leaderboard/views.ts';

const DAY = SECONDS_PER_DAY;
const TODAY = 1791504000; // 2026-10-08 00:00 UTC
const NOW = TODAY + 12 * 3600;

const day = (date, overrides = {}) => ({
  date,
  bets: 0,
  traded: 0,
  tradedSettled: 0,
  feesSettled: 0,
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
  const days = [day(TODAY, { profit: 2, tradedSettled: -3, feesSettled: 0.1, markets: ['m1'] })];
  const metrics = metricsFor(days, {
    tallies: { m1: [1, 1, 10] },
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
  assert.equal(metricsFor(days, { tallies: { m1: [1, 1, 10] } }).settledCost, 10);
});

test('without a market buy cost, the day falls back to its non-negative settled cost', () => {
  const days = [
    day(TODAY, { tradedSettled: 8, feesSettled: 2, markets: ['m1', 'm2'] }),
    day(TODAY - DAY, { tradedSettled: -5, markets: ['m3'] }),
    day(TODAY - 2 * DAY, { tradedSettled: 3 }),
  ];
  // m1 known (4), m2 unknown: max(4, 8 + 2); m3 unknown and net negative: 0; no markets: 3
  assert.equal(metricsFor(days, { tallies: { m1: [1, 1, 4] } }).settledCost, 13);
});

const RANK_RULE = {
  minSettledBets: MIN_SETTLED_BETS_PER_WINDOW,
  minSettledCost: MIN_SETTLED_COST_USD,
};

test('an agent needs a settled cost of at least the minimum to be ranked', () => {
  assert.equal(MIN_SETTLED_COST_USD, 1);
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
  assert.equal(reason(0.99), 'not_enough_trades_in_window');
  assert.equal(reason(1), null);
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

test('volume, trades and average trade size come from the window days', () => {
  const metrics = metricsFor([
    day(TODAY, { bets: 3, traded: 6 }),
    day(TODAY - DAY, { bets: 1, traded: 2 }),
  ]);
  assert.equal(metrics.trades, 4);
  assert.equal(metrics.volume, 8);
  assert.equal(metrics.avgTradeSize, 2);
  assert.equal(metricsFor([]).avgTradeSize, null);
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
    { tallies: { m1: [1, 2, 1], m2: [2, 2, 1], m3: [0, 5, 1] } },
  );
  assert.equal(metrics.accuracy, 0.75);
  assert.equal(metricsFor([day(TODAY, { markets: ['m9'] })]).accuracy, null);
});

test('a market settled on two days counts towards accuracy once, on its last day', () => {
  const days = [
    day(TODAY - 2 * DAY, { markets: ['m1'] }),
    day(TODAY - DAY, { markets: ['m1', 'm2'] }),
  ];
  const tallies = { m1: [1, 1, 1], m2: [0, 1, 1] };
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
  updatedAt: '2026-10-08T12:00:00.000Z',
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

test('a snapshot read back must have the expected shape and agent type', () => {
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
      bets: 5,
      traded: 10,
      markets: ['m1'],
    });
  const tallies = { m1: [1, 1, 10] };
  const agents = [
    { address: '0xa', serviceId: '592', days: [settledToday(1)], requests: [], tallies },
    { address: '0xb', serviceId: '1549', days: [settledToday(3)], requests: [], tallies },
    // Settled activity only 40 days ago: ranked in 90D and 1Y only
    {
      address: '0xc',
      serviceId: '2265',
      days: [day(TODAY - 40 * DAY, { profit: 9, tradedSettled: 10, brierCount: 5, bets: 5 })],
      requests: [],
      tallies: {},
    },
    // Bets placed but nothing settled yet
    {
      address: '0xd',
      serviceId: '1',
      days: [day(TODAY, { bets: 2, traded: 2 })],
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
