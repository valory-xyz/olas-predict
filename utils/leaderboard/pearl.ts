import { PEARL_SERVICE_DESCRIPTION_PREFIX } from 'constants/leaderboard';

/**
 * Whether a service was deployed through Pearl: Pearl's service templates write a description
 * starting with `[Pearl service]` into the on-chain service metadata.
 */
export const isPearlAgent = (metadata: unknown): boolean => {
  if (!metadata || typeof metadata !== 'object') return false;
  const { description } = metadata as { description?: unknown };
  return (
    typeof description === 'string' && description.startsWith(PEARL_SERVICE_DESCRIPTION_PREFIX)
  );
};
