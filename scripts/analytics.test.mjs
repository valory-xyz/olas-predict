// Tests of the Plausible tracking helpers (`utils/analytics.ts`): custom events, the leaderboard
// search debounce and the pageview tracker. `next-plausible` is stubbed (see `test:leaderboard`).
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

mock.module('next-plausible', {
  namedExports: { usePlausible: () => () => {} },
});

const {
  SEARCH_TRACK_DELAY_MS,
  createPageviewTracker,
  createSearchTracker,
  normalizePageviewPath,
  trackEvent,
} = await import('../utils/analytics.ts');

const spy = () => {
  const calls = [];
  const fn = (...args) => calls.push(args);
  fn.calls = calls;
  return fn;
};

test('trackEvent sends each event with its name and props', () => {
  const plausible = spy();
  trackEvent(plausible, 'Run Your Own Agent', {
    location: 'top_menu',
    page: '/leaderboard',
  });
  trackEvent(plausible, 'Leaderboard Search', { agent_type: 'polystrat' });
  trackEvent(plausible, 'Leaderboard Pin', {
    action: 'pin',
    agent_type: 'omenstrat',
  });
  trackEvent(plausible, 'Leaderboard Pin', {
    action: 'unpin',
    agent_type: 'omenstrat',
  });
  assert.deepEqual(plausible.calls, [
    ['Run Your Own Agent', { props: { location: 'top_menu', page: '/leaderboard' } }],
    ['Leaderboard Search', { props: { agent_type: 'polystrat' } }],
    ['Leaderboard Pin', { props: { action: 'pin', agent_type: 'omenstrat' } }],
    ['Leaderboard Pin', { props: { action: 'unpin', agent_type: 'omenstrat' } }],
  ]);
});

test('trackEvent reports the page normalized, so no agent address reaches Plausible', () => {
  const plausible = spy();
  trackEvent(
    plausible,
    'Run Your Own Agent',
    { location: 'side_menu', page: '/agents/[id]' },
    {
      origin: 'https://predict.olas.network',
      pathname: '/agents/0x0e2d480987a12c54b7d6c692a0c06f6b730ffdc8',
    },
  );
  trackEvent(
    plausible,
    'Leaderboard Pin',
    { action: 'pin', agent_type: 'omenstrat' },
    { origin: 'https://predict.olas.network', pathname: '/leaderboard' },
  );
  assert.deepEqual(plausible.calls, [
    [
      'Run Your Own Agent',
      {
        props: { location: 'side_menu', page: '/agents/[id]' },
        u: 'https://predict.olas.network/agents/[id]',
      },
    ],
    [
      'Leaderboard Pin',
      {
        props: { action: 'pin', agent_type: 'omenstrat' },
        u: 'https://predict.olas.network/leaderboard',
      },
    ],
  ]);
});

test('search tracker: typing commits one search after the pause, not per keystroke', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const onCommit = spy();
  const tracker = createSearchTracker(onCommit);
  for (const value of ['a', 'ag', 'age', 'agen', 'agent']) {
    tracker.update(value);
    t.mock.timers.tick(SEARCH_TRACK_DELAY_MS - 1);
  }
  assert.equal(onCommit.calls.length, 0);
  t.mock.timers.tick(1);
  assert.equal(onCommit.calls.length, 1);
  // The same term again (e.g. a trailing space) is not a new search
  tracker.update('agent ');
  t.mock.timers.tick(SEARCH_TRACK_DELAY_MS);
  assert.equal(onCommit.calls.length, 1);
  tracker.update('agents');
  t.mock.timers.tick(SEARCH_TRACK_DELAY_MS);
  assert.equal(onCommit.calls.length, 2);
});

test('search tracker: Enter commits at once; empty and cancelled searches never count', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const onCommit = spy();
  const tracker = createSearchTracker(onCommit);
  tracker.update('bob');
  tracker.flush();
  assert.equal(onCommit.calls.length, 1);
  t.mock.timers.tick(SEARCH_TRACK_DELAY_MS);
  assert.equal(onCommit.calls.length, 1);
  tracker.flush();
  assert.equal(onCommit.calls.length, 1);

  tracker.update('   ');
  t.mock.timers.tick(SEARCH_TRACK_DELAY_MS);
  tracker.flush();
  assert.equal(onCommit.calls.length, 1);

  // Clearing lets the same term count again; an unmount (cancel) drops a pending one
  tracker.update('bob');
  t.mock.timers.tick(SEARCH_TRACK_DELAY_MS);
  assert.equal(onCommit.calls.length, 2);
  tracker.update('carol');
  tracker.cancel();
  t.mock.timers.tick(SEARCH_TRACK_DELAY_MS);
  assert.equal(onCommit.calls.length, 2);
});

test('pageviews: a leaderboard filter change (shallow, same path) adds no pageview', () => {
  const send = spy();
  const track = createPageviewTracker(send);
  track('/leaderboard');
  track('/leaderboard?agentType=polystrat', { shallow: true });
  track('/leaderboard?agentType=polystrat&window=30d', { shallow: true });
  track('/leaderboard?agentType=polystrat&window=30d&rankBy=pnl', {
    shallow: true,
  });
  assert.deepEqual(send.calls, [['/leaderboard']]);
});

test('pageviews: real navigations still count once each, with normalized paths', () => {
  const send = spy();
  const track = createPageviewTracker(send);
  track('/questions?state=opened');
  track('/leaderboard?agentType=omenstrat');
  track('/leaderboard'); // the Leaderboard menu link while on it: a real navigation
  track('/agents/0xAbC0000000000000000000000000000000000001');
  track('https://predict.olas.network/questions/0xdef?x=1');
  // A shallow change to another path is a new page
  track('/questions', { shallow: true });
  assert.deepEqual(send.calls, [
    ['/questions'],
    ['/leaderboard'],
    ['/leaderboard'],
    ['/agents/[id]'],
    ['/questions/[id]'],
    ['/questions'],
  ]);
  assert.equal(normalizePageviewPath('/leaderboard'), '/leaderboard');
});
