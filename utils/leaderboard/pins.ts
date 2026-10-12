/** Parsing of the pinned agents kept in `localStorage`. */
import { LEADERBOARD_AGENT_TYPES } from 'constants/leaderboard';
import type { PinnedAgent } from 'types/leaderboard';

import { parseAddress } from './params';

const toPin = (value: unknown): PinnedAgent | null => {
  if (!value || typeof value !== 'object') return null;
  const { address, agentType, pinnedAt } = value as Record<string, unknown>;
  const parsedAddress = typeof address === 'string' ? parseAddress(address) : null;
  const parsedType = LEADERBOARD_AGENT_TYPES.find((type) => type === agentType);
  if (!parsedAddress || !parsedType) return null;
  return {
    address: parsedAddress,
    agentType: parsedType,
    pinnedAt: typeof pinnedAt === 'number' && Number.isFinite(pinnedAt) ? pinnedAt : 0,
  };
};

/**
 * The pins in a stored value: entries that are not a valid pin are dropped one by one,
 * addresses are lower-cased and duplicates kept once. Anything unreadable is no pins.
 */
export const parseStoredPins = (raw: string | null): PinnedAgent[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  return parsed.flatMap((entry) => {
    const pin = toPin(entry);
    if (!pin) return [];
    const key = `${pin.agentType}:${pin.address}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [pin];
  });
};
