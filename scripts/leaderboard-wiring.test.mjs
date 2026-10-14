/* global globalThis, Map, Promise */
// Tests of the leaderboard's wiring: the builder state machine with its sources stubbed, the
// Blob-backed reads with `@vercel/blob` and `fetch` stubbed, and the API route handlers. Needs
// `--experimental-test-module-mocks` (see the `test:leaderboard` script).
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { SECONDS_PER_DAY, getDayStart } from '../utils/leaderboard/metrics.ts';

// ---- Stubs ----------------------------------------------------------------------------------

/** A clock the tests can move forward; timers keep real time */
let clockOffset = 0;
const realNow = Date.now;
Date.now = () => realNow() + clockOffset;

const realSources = await import('../utils/leaderboard/sources.ts');
/** The stubbed fetchers; each test sets the ones it needs */
const sources = {};
const stubbed =
  (name) =>
  (...args) => {
    if (!sources[name]) throw new Error(`Unexpected source call: ${name}`);
    return sources[name](...args);
  };
mock.module('../utils/leaderboard/sources.ts', {
  namedExports: {
    ...realSources,
    fetchTraderAgents: stubbed('fetchTraderAgents'),
    fetchDailyStatistics: stubbed('fetchDailyStatistics'),
    fetchTokenUris: stubbed('fetchTokenUris'),
    fetchServiceMetadata: stubbed('fetchServiceMetadata'),
    fetchMechRequests: stubbed('fetchMechRequests'),
    fetchOmenMarketAnswers: stubbed('fetchOmenMarketAnswers'),
    fetchPolymarketQuestions: stubbed('fetchPolymarketQuestions'),
    fetchMarketBets: stubbed('fetchMarketBets'),
  },
});

class BlobNotFoundError extends Error {}
/** The stubbed Blob store: pathname -> { body, uploadedAt, contentType, size? } */
const blobs = new Map();
const blobApi = { head: null, put: null };
mock.module('@vercel/blob', {
  namedExports: {
    BlobNotFoundError,
    head: (...args) => blobApi.head(...args),
    put: (...args) => blobApi.put(...args),
  },
});
const resetBlobApi = () => {
  blobs.clear();
  blobApi.head = async (pathname) => {
    const blob = blobs.get(pathname);
    if (!blob) throw new BlobNotFoundError();
    return {
      url: `https://blob.test/${pathname}`,
      uploadedAt: blob.uploadedAt,
      size: blob.size ?? Buffer.byteLength(blob.body),
    };
  };
  blobApi.put = async (pathname, body) => {
    blobs.set(pathname, { body, uploadedAt: new Date(), contentType: 'application/json' });
  };
};
resetBlobApi();

const originalFetch = globalThis.fetch;
/** Serves blob bodies from `blobs`; `override(url)` may answer instead */
let fetchOverride = null;
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (fetchOverride) {
    const answer = await fetchOverride(url);
    if (answer) return answer;
  }
  if (url.host === 'blob.test') {
    const blob = blobs.get(url.pathname.slice(1));
    if (!blob) return new Response('not found', { status: 404 });
    return new Response(blob.body, { headers: { 'content-type': blob.contentType } });
  }
  return originalFetch(input);
};

const { buildLeaderboard } = await import('../utils/leaderboard/builder.ts');
const { PopulationDropError } = await import('../utils/leaderboard/population.ts');
const snapshotModule = await import('../utils/leaderboard/snapshot.ts');
const { createEmptyState, readBuilderState, readSnapshot, resetSnapshotMemo, BlobReadError } =
  snapshotModule;
const { default: listHandler } = await import('../pages/api/leaderboard/index.ts');
const { default: agentsHandler } = await import('../pages/api/leaderboard/agents.ts');
const { default: refreshHandler } = await import('../pages/api/leaderboard/refresh.ts');

// ---- Fixtures -------------------------------------------------------------------------------

const now = () => Math.floor(Date.now() / 1000);
const today = () => getDayStart(now());
const FAR = () => Date.now() + 60_000;
const A = `0x${'a'.repeat(40)}`;
const B = `0x${'b'.repeat(40)}`;
const C = `0x${'c'.repeat(40)}`;

const day = (date, markets, overrides = {}) => ({
  date,
  tradedSettled: 0,
  profit: 1,
  brierSum: 1,
  brierCount: markets.length * 5,
  markets,
  ...overrides,
});

const PEARL_METADATA = {
  name: 'service/valory/polymarket_trader/bafy',
  description: '[Pearl service] valory/polymarket_trader',
};
const OTHER_METADATA = { name: 'service/valory/polymarket_trader/bafy', description: 'Quickstart' };

/** A Polystrat world: A and B are Pearl agents, C is not; each has settled markets */
const polystratWorld = () => {
  const metadataByUri = {
    'ipfs://a': PEARL_METADATA,
    'ipfs://b': PEARL_METADATA,
    'ipfs://c': OTHER_METADATA,
  };
  const world = {
    agents: [
      { address: A, serviceId: '1' },
      { address: B, serviceId: '2' },
      { address: C, serviceId: '3' },
    ],
    uris: { 1: 'ipfs://a', 2: 'ipfs://b', 3: 'ipfs://c' },
    metadataByUri,
    daysByAgent: new Map([
      [A, [day(today(), ['q1', 'q2'], { profit: 4 })]],
      [B, [day(today() - SECONDS_PER_DAY, ['q3'], { profit: -1 })]],
      [C, [day(today(), ['q4'])]],
    ]),
    questions: {
      q1: { title: 'Q1?', winningIndex: 1 },
      q2: { title: 'Q2?', winningIndex: 0 },
      q3: { title: 'Q3?', winningIndex: 1 },
      q4: { title: 'Q4?', winningIndex: 1 },
    },
    bets: {
      [A]: {
        q1: { outcomeIndexes: [1, 1], buyCost: 6, buys: 2 },
        q2: { outcomeIndexes: [1], buyCost: 2, buys: 1 },
      },
      [B]: { q3: { outcomeIndexes: [1], buyCost: 10, buys: 1 } },
    },
    mech: { [A]: [{ title: 'Q1?', timestamp: now() - 3600 }], [B]: [] },
    sourceHeight: 1000,
    calls: [],
  };
  Object.assign(sources, {
    fetchTraderAgents: async () => ({ agents: world.agents, sourceHeight: world.sourceHeight }),
    fetchDailyStatistics: async () => ({ daysByAgent: world.daysByAgent, omenTitles: {} }),
    fetchTokenUris: async (_type, ids) => ({
      uris: new Map(ids.filter((id) => world.uris[id]).map((id) => [id, world.uris[id]])),
      failed: [],
    }),
    fetchServiceMetadata: async (services) => {
      if (services.length) world.calls.push(['metadata', services.map(([id]) => id)]);
      return {
        metadata: new Map(services.map(([id, uri]) => [id, world.metadataByUri[uri]])),
        failed: [],
      };
    },
    fetchPolymarketQuestions: async (ids) => ({
      found: new Map(
        ids.filter((id) => world.questions[id]).map((id) => [id, world.questions[id]]),
      ),
      checked: ids,
    }),
    fetchMarketBets: async (_type, bettor, markets) => {
      world.calls.push(['bets', bettor, markets]);
      const mine = world.bets[bettor] ?? {};
      return {
        bets: new Map(markets.filter((m) => mine[m]).map((m) => [m, mine[m]])),
        fetchedMarkets: markets,
      };
    },
    fetchMechRequests: async (_type, address, since) => {
      world.calls.push(['mech', address, since]);
      return {
        requests: (world.mech[address] ?? []).filter(({ timestamp }) => timestamp >= since),
        complete: true,
      };
    },
  });
  return world;
};

// ---- Builder --------------------------------------------------------------------------------

test('the builder classifies services, tallies settled markets and ranks Pearl agents', async () => {
  const world = polystratWorld();
  const state = createEmptyState();
  const { snapshot, unresolvedServices } = await buildLeaderboard('polystrat', state, FAR());
  assert.deepEqual(unresolvedServices, []);
  assert.ok(snapshot);
  assert.deepEqual(
    snapshot.agents.map(({ address }) => address),
    [A, B],
  );
  assert.deepEqual(snapshot.excluded, [C]);
  assert.equal(state.pearl['1'].uri, 'ipfs://a');
  assert.equal(state.pearl['3'].status, 'other');
  // [won, counted, buy cost, buys]
  assert.deepEqual(state.tallies[A], { q1: [2, 2, 6, 2], q2: [0, 1, 2, 1] });
  assert.equal(state.tallies[C], undefined);
  const a7 = snapshot.agents[0].windows['7d'];
  assert.equal(a7.metrics.trades, 3);
  assert.equal(a7.metrics.volume, 8);
  // One mech fee, charged on q1's settlement day
  assert.ok(Math.abs(a7.metrics.pnl - (4 - 0.01)) < 1e-9);
  assert.equal(a7.rankByRoi, 1);
  assert.equal(state.population.pearlAgents, 2);
  assert.equal(state.mech[A].requests.length, 1);

  // An unchanged second run reads no metadata or bets again, and re-reads a day of requests
  world.calls.length = 0;
  const again = await buildLeaderboard('polystrat', state, FAR());
  assert.ok(again.snapshot);
  assert.deepEqual(
    world.calls.filter(([kind]) => kind !== 'mech'),
    [],
  );
  const mechSince = world.calls.find(([, address]) => address === A)[2];
  assert.equal(mechSince, state.mech[A].syncedTo - SECONDS_PER_DAY);
  assert.equal(state.mech[A].requests.length, 1);
});

test('the builder reclassifies a service whose tokenURI changed', async () => {
  const world = polystratWorld();
  const state = createEmptyState();
  await buildLeaderboard('polystrat', state, FAR());
  world.uris[3] = 'ipfs://c2';
  world.metadataByUri['ipfs://c2'] = PEARL_METADATA;
  world.calls.length = 0;
  const { snapshot } = await buildLeaderboard('polystrat', state, FAR());
  assert.deepEqual(
    world.calls.find(([kind]) => kind === 'metadata'),
    ['metadata', ['3']],
  );
  assert.equal(state.pearl['3'].status, 'pearl');
  assert.ok(snapshot.agents.some(({ address }) => address === C));
});

test('a chunk cut by the deadline is retried without a miss; a market without bets is', async () => {
  const world = polystratWorld();
  const state = createEmptyState();
  sources.fetchMarketBets = async () => ({ bets: new Map(), fetchedMarkets: [] });
  const cut = await buildLeaderboard('polystrat', state, FAR());
  assert.equal(cut.snapshot, null);
  assert.deepEqual(state.pendingMarkets, {});

  // Bets came back for q1 only: q2 has no bets yet, so it is a miss with a back-off
  sources.fetchMarketBets = async (_type, bettor, markets) => ({
    bets: new Map(bettor === A ? [['q1', world.bets[A].q1]] : [['q3', world.bets[B].q3]]),
    fetchedMarkets: markets,
  });
  await buildLeaderboard('polystrat', state, FAR());
  assert.equal(state.pendingMarkets.q2[1], 1);
  assert.ok(state.pendingMarkets.q2[0] > Date.now());
  assert.equal(state.tallies[A].q2, undefined);
});

test('an unavailable mech source holds the snapshot back and keeps the stored requests', async () => {
  const world = polystratWorld();
  const state = createEmptyState();
  await buildLeaderboard('polystrat', state, FAR());
  const stored = structuredClone(state.mech[A]);
  sources.fetchMechRequests = async () => {
    throw new Error('HTTP 503');
  };
  const { snapshot } = await buildLeaderboard('polystrat', state, FAR());
  assert.equal(snapshot, null);
  assert.deepEqual(state.mech[A], stored);
  void world;
});

test('a run whose sources shrank prunes and publishes nothing', async () => {
  const world = polystratWorld();
  const state = createEmptyState();
  await buildLeaderboard('polystrat', state, FAR());
  const before = structuredClone(state);
  const days = world.daysByAgent;
  world.daysByAgent = new Map();
  await assert.rejects(buildLeaderboard('polystrat', state, FAR()), PopulationDropError);
  assert.deepEqual(state.tallies, before.tallies);
  assert.deepEqual(state.mech, before.mech);
  assert.ok(state.population.suspectSince);
  // The source height going back is refused too
  world.daysByAgent = days;
  world.sourceHeight = 10;
  await assert.rejects(buildLeaderboard('polystrat', state, FAR()), /height/);
});

test('a re-syncing source is refused however long it lasts, and never empties the board', async () => {
  const world = polystratWorld();
  const state = createEmptyState();
  const first = await buildLeaderboard('polystrat', state, FAR());
  assert.equal(first.snapshot.agents.length, 2);
  const before = structuredClone(state);
  const days = world.daysByAgent;
  try {
    // Re-syncing: an older height and no statistics, run after run, for more than a day
    world.sourceHeight = 10;
    world.daysByAgent = new Map();
    for (let run = 0; run < 5; run++) {
      await assert.rejects(buildLeaderboard('polystrat', state, FAR()), /height went back/);
      clockOffset += 8 * 3600_000;
    }
    // Half-synced: an older height with one of the two agents
    world.sourceHeight = 500;
    world.daysByAgent = new Map([[A, days.get(A)]]);
    for (let run = 0; run < 4; run++) {
      await assert.rejects(buildLeaderboard('polystrat', state, FAR()), /height went back/);
    }
    assert.deepEqual(state.mech, before.mech);
    assert.deepEqual(state.tallies, before.tallies);
    assert.deepEqual(state.population, before.population);

    // Caught up past the stored height but with one agent: refused until it lasted a day,
    // whatever the number of runs
    world.sourceHeight = 1100;
    for (let run = 0; run < 4; run++) {
      await assert.rejects(buildLeaderboard('polystrat', state, FAR()), PopulationDropError);
    }
    assert.deepEqual(state.mech, before.mech);
    clockOffset += 24 * 3600_000;
    const accepted = await buildLeaderboard('polystrat', state, FAR());
    assert.deepEqual(
      accepted.snapshot.agents.map(({ address }) => address),
      [A],
    );
    assert.equal(state.population.suspectSince, null);

    // No Pearl agents at all, at a rising height: refused even after a day
    world.sourceHeight = 1200;
    world.daysByAgent = new Map([[C, days.get(C)]]);
    await assert.rejects(buildLeaderboard('polystrat', state, FAR()), /without Pearl agents/);
    clockOffset += 48 * 3600_000;
    await assert.rejects(buildLeaderboard('polystrat', state, FAR()), /without Pearl agents/);
    assert.ok(state.mech[A]);
  } finally {
    clockOffset = 0;
  }
});

test('an Omen market waiting out its answer timeout is due at finalization, without a miss', async () => {
  const world = polystratWorld();
  const finalizesAt = now() + 6 * 3600;
  world.agents = [{ address: A, serviceId: '1' }];
  world.metadataByUri['ipfs://a'] = {
    ...PEARL_METADATA,
    name: 'service/valory/trader_pearl/bafy',
    description: '[Pearl service] trader',
  };
  world.daysByAgent = new Map([[A, [day(today(), ['0xm1'])]]]);
  sources.fetchDailyStatistics = async () => ({
    daysByAgent: world.daysByAgent,
    omenTitles: { '0xm1': 'M1?' },
  });
  sources.fetchOmenMarketAnswers = async (ids) => ({
    found: new Map(
      ids.map((id) => [
        id,
        {
          currentAnswer: '0x1',
          answerFinalizedTimestamp: finalizesAt,
          isPendingArbitration: false,
        },
      ]),
    ),
    checked: ids,
  });
  const state = createEmptyState();
  const { snapshot } = await buildLeaderboard('omenstrat', state, FAR());
  assert.ok(snapshot);
  assert.deepEqual(state.pendingMarkets['0xm1'], [finalizesAt * 1000, 0]);
});

// ---- Blob reads -----------------------------------------------------------------------------

const SNAPSHOT_PATH = 'leaderboard/polystrat/snapshot.json';
const STATE_PATH = 'leaderboard/polystrat/builder-state.json';

const validSnapshot = (updatedAt) => ({
  schemaVersion: 1,
  agentType: 'polystrat',
  updatedAt,
  sourceHeight: 1,
  totalRanked: { '7d': 0, '30d': 0, '90d': 0, '1y': 0 },
  agents: [],
  excluded: [],
});

const storeSnapshot = (updatedAt, uploadedAt = new Date()) =>
  blobs.set(SNAPSHOT_PATH, {
    body: JSON.stringify(validSnapshot(updatedAt)),
    uploadedAt,
    contentType: 'application/json',
  });

test('readSnapshot memoizes, shares one Blob check and falls back to the last good', async () => {
  resetBlobApi();
  resetSnapshotMemo();
  let heads = 0;
  const head = blobApi.head;
  blobApi.head = async (...args) => {
    heads += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return head(...args);
  };
  const S1 = '2026-10-13T10:00:00.000Z';
  storeSnapshot(S1);
  const reads = await Promise.all(Array.from({ length: 20 }, () => readSnapshot('polystrat')));
  assert.equal(heads, 1);
  assert.ok(reads.every(({ snapshot, isStale }) => snapshot.updatedAt === S1 && !isStale));
  // Memoized: no further check
  await readSnapshot('polystrat');
  assert.equal(heads, 1);
  // A client that saw a newer snapshot: not before 5 s from the last check, then once for all
  const newer = '2026-10-13T11:00:00.000Z';
  await readSnapshot('polystrat', { minUpdatedAt: newer });
  assert.equal(heads, 1);
  clockOffset += 6_000;
  await Promise.all(
    Array.from({ length: 5 }, () => readSnapshot('polystrat', { minUpdatedAt: newer })),
  );
  assert.equal(heads, 2);
  await readSnapshot('polystrat', { minUpdatedAt: newer });
  assert.equal(heads, 2);

  // Blob fails: the last good snapshot, marked stale
  resetSnapshotMemo();
  await readSnapshot('polystrat');
  blobApi.head = async () => {
    throw new Error('Blob down');
  };
  clockOffset += 120_000;
  const stale = await readSnapshot('polystrat');
  assert.equal(stale.snapshot.updatedAt, S1);
  assert.equal(stale.isStale, true);
});

test('a blob body of the wrong size or type is a failed read, never "start over"', async () => {
  resetBlobApi();
  resetSnapshotMemo();
  const state = { ...createEmptyState(), titles: { q: 'k' } };
  blobs.set(STATE_PATH, {
    body: JSON.stringify(state),
    uploadedAt: new Date(),
    contentType: 'application/json',
  });
  assert.deepEqual((await readBuilderState('polystrat')).titles, { q: 'k' });
  // Cut short: shorter than the size head reported
  blobs.get(STATE_PATH).size = Buffer.byteLength(blobs.get(STATE_PATH).body) + 10;
  await assert.rejects(readBuilderState('polystrat'), BlobReadError);
  // An HTML page answered with 200
  blobs.set(STATE_PATH, {
    body: '<html></html>',
    uploadedAt: new Date(),
    contentType: 'text/html',
  });
  await assert.rejects(readBuilderState('polystrat'), BlobReadError);
  // A complete body that is not JSON: starts over
  blobs.set(STATE_PATH, {
    body: '{"oops',
    uploadedAt: new Date(),
    contentType: 'application/json',
  });
  assert.deepEqual((await readBuilderState('polystrat')).titles, {});
  // A failed request throws
  fetchOverride = (url) => (url.host === 'blob.test' ? new Response('x', { status: 502 }) : null);
  try {
    await assert.rejects(readBuilderState('polystrat'), /HTTP 502/);
  } finally {
    fetchOverride = null;
  }
});

test('a Blob head that keeps retrying times out instead of hanging', async () => {
  resetBlobApi();
  resetSnapshotMemo();
  let aborted = false;
  blobApi.head = (_pathname, { abortSignal }) =>
    new Promise((_, reject) => {
      abortSignal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('aborted'));
      });
    });
  const started = Date.now();
  await assert.rejects(readSnapshot('polystrat'), /timed out/);
  assert.ok(Date.now() - started < 8000);
  assert.equal(aborted, true);
});

// ---- Routes ---------------------------------------------------------------------------------

const call = async (handler, { method = 'GET', query = {}, headers = {} } = {}) => {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await handler({ method, query, headers }, res);
  return res;
};

test('the list route answers 400, 503, 409 and a retryable 503 as documented', async () => {
  resetBlobApi();
  resetSnapshotMemo();
  const list = (query) => call(listHandler, { query: { agentType: 'polystrat', ...query } });
  assert.equal((await call(listHandler, { method: 'POST' })).statusCode, 405);
  assert.equal((await list({ snapshot: 'zzz' })).statusCode, 400);
  // No snapshot yet
  const empty = await list({});
  assert.equal(empty.statusCode, 503);
  assert.equal(empty.headers['cache-control'], 'no-store');

  const S1 = '2026-10-13T10:00:00.000Z';
  storeSnapshot(S1);
  resetSnapshotMemo();
  const ok = await list({});
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.updatedAt, S1);
  // A client behind: start over from S1
  const behind = await list({ snapshot: '2026-10-13T09:00:00.000Z' });
  assert.equal(behind.statusCode, 409);
  assert.equal(behind.body.updatedAt, S1);
  // A client ahead of this instance (checked moments ago): retryable 503, not an older 409
  const ahead = await list({ snapshot: '2026-10-13T11:00:00.000Z' });
  assert.equal(ahead.statusCode, 503);
  assert.equal(ahead.headers['cache-control'], 'no-store');
});

test('the agents route answers the Safes asked for, and the refresh route needs its secret', async () => {
  resetBlobApi();
  resetSnapshotMemo();
  storeSnapshot('2026-10-13T10:00:00.000Z');
  const agents = await call(agentsHandler, {
    query: { agentType: 'polystrat', addresses: `${A},${A.toUpperCase().replace('0X', '0x')}` },
  });
  assert.equal(agents.statusCode, 200);
  assert.deepEqual(
    agents.body.agents.map(({ address, notRankedReason }) => [address, notRankedReason]),
    [[A, 'not_ranked_yet']],
  );
  assert.equal((await call(agentsHandler, { query: { agentType: 'polystrat' } })).statusCode, 400);

  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'secret';
  try {
    assert.equal((await call(refreshHandler, {})).statusCode, 401);
    assert.equal((await call(refreshHandler, { method: 'POST' })).statusCode, 405);
  } finally {
    process.env.CRON_SECRET = previous;
  }
});

test('the refresh saves progress, writes snapshots and fails a type whose save failed', async () => {
  resetBlobApi();
  resetSnapshotMemo();
  polystratWorld();
  // Omen's sources fail; Polystrat builds
  const fetchTraderAgents = sources.fetchTraderAgents;
  sources.fetchTraderAgents = async (agentType, ...rest) => {
    if (agentType === 'omenstrat') throw new Error('subgraph down');
    return fetchTraderAgents(agentType, ...rest);
  };
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'secret';
  try {
    const headers = { authorization: 'Bearer secret' };
    const first = await call(refreshHandler, { headers });
    assert.equal(first.statusCode, 500);
    assert.deepEqual(first.body.updated, ['polystrat']);
    assert.deepEqual(first.body.failed, ['omenstrat']);
    assert.equal(first.body.snapshotAgeSeconds.polystrat, 0);
    assert.ok(blobs.has('leaderboard/polystrat/snapshot.json'));
    assert.ok(blobs.has('leaderboard/polystrat/builder-state.json'));
    // The failed type's progress is saved too
    assert.ok(blobs.has('leaderboard/omenstrat/builder-state.json'));

    // A state save that fails after a good build fails the type
    const put = blobApi.put;
    blobApi.put = async (pathname, ...rest) => {
      if (pathname.endsWith('builder-state.json')) throw new Error('Blob write failed');
      return put(pathname, ...rest);
    };
    const second = await call(refreshHandler, { headers });
    assert.deepEqual(second.body.failed.sort(), ['omenstrat', 'polystrat']);
    blobApi.put = put;
  } finally {
    process.env.CRON_SECRET = previous;
  }
});
