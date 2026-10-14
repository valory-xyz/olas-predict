import type { AgentType } from 'constants/index';
import {
  PEARL_SERVICE_DESCRIPTION_PREFIX,
  PEARL_TRADER_SERVICE_PACKAGES,
} from 'constants/leaderboard';

/**
 * How a service's metadata classifies it:
 * - `pearl`: a trader service deployed through Pearl
 * - `other`: well-formed metadata of any other service (Quickstart, other Pearl agents, ...)
 * - `malformed`: metadata without a string `name` and `description`; treated as not Pearl, and
 *   looked up again later in case it was a transient gateway response
 */
export type PearlClassification = 'pearl' | 'other' | 'malformed';

/**
 * Whether a service is a Pearl trader: Pearl's service templates write a description starting
 * with `[Pearl service]` into the on-chain service metadata, and the `name` is the trader's
 * service package for the chain (`service/valory/trader_pearl/<version>` on Gnosis,
 * `service/valory/polymarket_trader/<version>` on Polygon). The prefix alone is not enough:
 * other Pearl agents (e.g. `service/valory/connect`) also use it. The name alone is not enough
 * either: Quickstart deploys the same `trader_pearl` package without the prefix.
 */
export const classifyService = (agentType: AgentType, metadata: unknown): PearlClassification => {
  if (!metadata || typeof metadata !== 'object') return 'malformed';
  const { name, description } = metadata as { name?: unknown; description?: unknown };
  if (typeof name !== 'string' || typeof description !== 'string') return 'malformed';
  const isTraderPackage = name.startsWith(`${PEARL_TRADER_SERVICE_PACKAGES[agentType]}/`);
  return isTraderPackage && description.startsWith(PEARL_SERVICE_DESCRIPTION_PREFIX)
    ? 'pearl'
    : 'other';
};

export const isPearlAgent = (agentType: AgentType, metadata: unknown): boolean =>
  classifyService(agentType, metadata) === 'pearl';

/** What the builder knows about one service's Pearl flag */
export type PearlLookup = {
  /** `null` until a lookup succeeds */
  status: PearlClassification | null;
  /** When the service was last looked up (epoch ms), whatever the outcome */
  checkedAt: number;
  /** Lookups failed in a row (tokenURI or metadata unreadable) */
  failures: number;
  /**
   * The `ServiceRegistry.tokenURI` the status was read from. The URI changes with the service's
   * config hash (`ServiceRegistry.update`, Pearl rewriting an older service's description), and
   * a changed URI is classified again.
   */
  uri?: string;
};

/**
 * A snapshot waits for a service whose lookup failed, so a Pearl agent is not silently left
 * out, but only this many runs in a row: after that the service is reported as unresolved and
 * left out, so one dead metadata link cannot stall the leaderboard.
 */
export const PEARL_LOOKUP_MAX_FAILURES = 3;
/** How long an unresolved service waits before it is looked up again */
export const PEARL_LOOKUP_RETRY_MS = 6 * 60 * 60 * 1000;
/** How long malformed metadata is trusted before it is read again */
export const PEARL_MALFORMED_RECHECK_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a service still needs a (first, repeated or periodic) lookup. `uri` is its current
 * tokenURI when this run could read it: a classified service whose URI changed (or was never
 * stored) is looked up again, with the same retry pacing as a failed first lookup.
 */
export const needsPearlLookup = (
  lookup: PearlLookup | undefined,
  now: number,
  uri?: string,
): boolean => {
  if (!lookup) return true;
  const isRetryDue =
    lookup.failures < PEARL_LOOKUP_MAX_FAILURES || now - lookup.checkedAt >= PEARL_LOOKUP_RETRY_MS;
  if (lookup.status !== null && uri !== undefined && lookup.uri !== uri) return isRetryDue;
  if (lookup.status === 'pearl' || lookup.status === 'other') return false;
  if (lookup.status === 'malformed') return now - lookup.checkedAt >= PEARL_MALFORMED_RECHECK_MS;
  return isRetryDue;
};

/** Whether a snapshot must wait for this service's lookup */
export const isPearlLookupPending = (lookup: PearlLookup | undefined): boolean =>
  !lookup || (lookup.status === null && lookup.failures < PEARL_LOOKUP_MAX_FAILURES);

/** Whether the service gave up on lookups: left out of the snapshot, and reported */
export const isPearlLookupUnresolved = (lookup: PearlLookup | undefined): boolean =>
  !!lookup && lookup.status === null && lookup.failures >= PEARL_LOOKUP_MAX_FAILURES;

/**
 * The lookup after one attempt: `classification` (read from `uri`) on success, `null` when it
 * failed. A failed re-check keeps the previous answer and the URI it was read from, so a
 * changed URI is tried again.
 */
export const recordPearlLookup = (
  previous: PearlLookup | undefined,
  classification: PearlClassification | null,
  now: number,
  uri?: string,
): PearlLookup => {
  if (classification) {
    return { status: classification, checkedAt: now, failures: 0, ...(uri ? { uri } : {}) };
  }
  return {
    status: previous?.status ?? null,
    checkedAt: now,
    failures: (previous?.failures ?? 0) + 1,
    ...(previous?.uri ? { uri: previous.uri } : {}),
  };
};
