import { useCallback, useEffect, useRef, useState } from 'react';

import { AgentType } from 'constants/index';
import { PINNED_AGENTS_STORAGE_KEY } from 'constants/leaderboard';
import type { PinnedAgent } from 'types/leaderboard';
import { parseAddress } from 'utils/leaderboard/params';
import { parseStoredPins } from 'utils/leaderboard/pins';

const readPins = (): PinnedAgent[] => {
  try {
    return parseStoredPins(localStorage.getItem(PINNED_AGENTS_STORAGE_KEY));
  } catch {
    return [];
  }
};

/** `false` when the browser refuses to store the pins (e.g. storage disabled or full) */
const writePins = (pins: PinnedAgent[]) => {
  try {
    localStorage.setItem(PINNED_AGENTS_STORAGE_KEY, JSON.stringify(pins));
    return true;
  } catch (error) {
    console.error('Leaderboard: pins could not be saved', error);
    return false;
  }
};

const isSamePin = (pin: PinnedAgent, address: string, agentType: AgentType) =>
  pin.address === address && pin.agentType === agentType;

/**
 * Agents pinned on this machine, of every agent type. Read on the client only, after mount,
 * so server and client render the same markup. `isLoaded` is false until then. Changes apply
 * to the pins in memory first, so they hold for this visit even when storage refuses them
 * (`onSaveFailed` is told); pins changed in another tab are picked up as they are saved.
 */
export const usePinnedAgents = ({ onSaveFailed }: { onSaveFailed?: () => void } = {}) => {
  const [pins, setPins] = useState<PinnedAgent[]>([]);
  const pinsRef = useRef<PinnedAgent[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const onSaveFailedRef = useRef(onSaveFailed);
  onSaveFailedRef.current = onSaveFailed;

  useEffect(() => {
    const apply = (next: PinnedAgent[]) => {
      pinsRef.current = next;
      setPins(next);
    };
    apply(readPins());
    setIsLoaded(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key === PINNED_AGENTS_STORAGE_KEY) apply(parseStoredPins(event.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((change: (current: PinnedAgent[]) => PinnedAgent[]) => {
    const next = change(pinsRef.current);
    if (next === pinsRef.current) return;
    pinsRef.current = next;
    setPins(next);
    if (!writePins(next)) onSaveFailedRef.current?.();
  }, []);

  const isPinned = useCallback(
    (address: string, agentType: AgentType) =>
      pins.some((pin) => isSamePin(pin, address.toLowerCase(), agentType)),
    [pins],
  );

  const addPin = useCallback(
    (address: string, agentType: AgentType) => {
      const parsed = parseAddress(address);
      if (!parsed) return;
      update((current) =>
        current.some((pin) => isSamePin(pin, parsed, agentType))
          ? current
          : [...current, { address: parsed, agentType, pinnedAt: Date.now() }],
      );
    },
    [update],
  );

  const removePin = useCallback(
    (address: string, agentType: AgentType) => {
      const target = address.toLowerCase();
      update((current) =>
        current.some((pin) => isSamePin(pin, target, agentType))
          ? current.filter((pin) => !isSamePin(pin, target, agentType))
          : current,
      );
    },
    [update],
  );

  return { pins, isLoaded, isPinned, addPin, removePin };
};
