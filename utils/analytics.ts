import type { AgentType } from 'constants/index';

/**
 * Plausible custom events and their props. Each name must also be added as a custom-event goal
 * in the Plausible dashboard. Props never carry wallet addresses or search text.
 */
export type AnalyticsEvents = {
  /** A "Run your own agent" link was clicked; `page` is the route it was on (e.g. `/agents/[id]`) */
  'Run Your Own Agent': { location: RunYourOwnAgentLocation; page: string };
  /** A leaderboard search was committed (typing paused or Enter pressed) */
  'Leaderboard Search': { agent_type: AgentType };
  /** An agent was pinned or unpinned on the leaderboard */
  'Leaderboard Pin': { action: 'pin' | 'unpin'; agent_type: AgentType };
};

export type AnalyticsEventName = keyof AnalyticsEvents;

export type RunYourOwnAgentLocation = 'side_menu' | 'top_menu' | 'mobile_menu' | 'agents_page';

export type PlausibleFn = (
  eventName: string,
  options?: { props?: Record<string, string>; u?: string },
) => void;

/**
 * Sends one custom event through `plausible`, with its props. The event's URL is the page with a
 * normalized path and no query: Plausible would otherwise send the full URL, e.g. an agent's
 * address on `/agents/{id}`.
 */
export const trackEvent = <E extends AnalyticsEventName>(
  plausible: PlausibleFn,
  eventName: E,
  props: AnalyticsEvents[E],
  page: Pick<Location, 'origin' | 'pathname'>,
) => plausible(eventName, { props, u: `${page.origin}${normalizePageviewPath(page.pathname)}` });

/** Leaderboard searches count once typing has paused this long (or on Enter) */
export const SEARCH_TRACK_DELAY_MS = 1000;

/**
 * Turns search keystrokes into committed searches: `update` (on every change) commits the
 * trimmed term once it has not changed for `delayMs`, `flush` (on Enter) commits it at once.
 * An empty term or the term committed last is never committed.
 */
export const createSearchTracker = (onCommit: () => void, delayMs = SEARCH_TRACK_DELAY_MS) => {
  let pending: string | null = null;
  let handle: ReturnType<typeof setTimeout> | null = null;
  let lastCommitted = '';

  const cancel = () => {
    if (handle !== null) clearTimeout(handle);
    handle = null;
    pending = null;
  };

  const flush = () => {
    const term = pending;
    cancel();
    if (!term || term === lastCommitted) return;
    lastCommitted = term;
    onCommit();
  };

  const update = (value: string) => {
    cancel();
    const term = value.trim();
    if (!term) {
      // Clearing the search lets the same term count again when typed afresh
      lastCommitted = '';
      return;
    }
    pending = term;
    handle = setTimeout(flush, delayMs);
  };

  return { update, flush, cancel };
};

/** Dynamic routes are reported by their pattern, so addresses never reach Plausible */
export const normalizePageviewPath = (pathname: string): string =>
  pathname
    .replace(/^\/questions\/[^/]+/, '/questions/[id]')
    .replace(/^\/agents\/[^/]+/, '/agents/[id]');

/**
 * Pageview tracking for Next's router: `track(url)` sends one pageview, except for a shallow
 * route change that keeps the path (the leaderboard writing its filters to the URL), which is
 * the same page view.
 */
export const createPageviewTracker = (sendPageview: (path: string) => void) => {
  let lastPath: string | null = null;
  return (url: string, { shallow = false }: { shallow?: boolean } = {}) => {
    const pathname = url.startsWith('http') ? new URL(url).pathname : url.split(/[?#]/)[0];
    const path = normalizePageviewPath(pathname);
    if (shallow && path === lastPath) return;
    lastPath = path;
    sendPageview(path);
  };
};
