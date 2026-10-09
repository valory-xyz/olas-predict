import { useCallback, useEffect, useState } from 'react';

import { AgentType } from 'constants/index';
import { LEADERBOARD_AGENT_TYPES, PINNED_AGENTS_STORAGE_KEY } from 'constants/leaderboard';
import type { PinnedAgent } from 'types/leaderboard';

const isPinnedAgent = (value: unknown): value is PinnedAgent => {
  if (!value || typeof value !== 'object') return false;
  const { address, agentType, pinnedAt } = value as Record<string, unknown>;
  return (
    typeof address === 'string' &&
    LEADERBOARD_AGENT_TYPES.some((type) => type === agentType) &&
    typeof pinnedAt === 'number'
  );
};

/** Pins from `localStorage`; a malformed value resets to no pins */
const readPins = (): PinnedAgent[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PINNED_AGENTS_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) && parsed.every(isPinnedAgent) ? parsed : [];
  } catch {
    return [];
  }
};

const writePins = (pins: PinnedAgent[]) => {
  try {
    localStorage.setItem(PINNED_AGENTS_STORAGE_KEY, JSON.stringify(pins));
  } catch (error) {
    console.error('Leaderboard: pins could not be saved', error);
  }
};

/**
 * Agents pinned on this machine, of every agent type. Read on the client only, after mount,
 * so server and client render the same markup. `isLoaded` is false until then.
 */
export const usePinnedAgents = () => {
  const [pins, setPins] = useState<PinnedAgent[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setPins(readPins());
    setIsLoaded(true);
  }, []);

  const update = useCallback((change: (current: PinnedAgent[]) => PinnedAgent[]) => {
    // Re-read so a pin added in another tab is not overwritten
    const next = change(readPins());
    writePins(next);
    setPins(next);
  }, []);

  const isPinned = useCallback(
    (address: string, agentType: AgentType) =>
      pins.some((pin) => pin.address === address && pin.agentType === agentType),
    [pins],
  );

  const addPin = useCallback(
    (address: string, agentType: AgentType) =>
      update((current) =>
        current.some((pin) => pin.address === address && pin.agentType === agentType)
          ? current
          : [...current, { address, agentType, pinnedAt: Date.now() }],
      ),
    [update],
  );

  const removePin = useCallback(
    (address: string, agentType: AgentType) =>
      update((current) =>
        current.filter((pin) => !(pin.address === address && pin.agentType === agentType)),
      ),
    [update],
  );

  return { pins, isLoaded, isPinned, addPin, removePin };
};
