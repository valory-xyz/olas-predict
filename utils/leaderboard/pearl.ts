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
