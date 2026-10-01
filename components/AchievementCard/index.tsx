import { AGENTS, AchievementType } from 'constants/index';
import type { AchievementData } from 'types/achievement';

import { OmenstratAchievementCard } from './Omenstrat';
import { PolystratAchievementCard } from './Polystrat';

type AchievementCardProps = {
  agent?: string;
  type: AchievementType;
  betId: string;
  achievementData?: AchievementData | null;
  achievementDataError?: boolean;
};

export const AchievementCard = ({
  agent,
  type,
  betId,
  achievementData,
  achievementDataError,
}: AchievementCardProps) => {
  if (!agent) return null;

  if (agent.toLowerCase() === AGENTS.POLYSTRAT)
    return <PolystratAchievementCard type={type} betId={betId} />;

  if (agent.toLowerCase() === AGENTS.OMENSTRAT)
    return (
      <OmenstratAchievementCard
        type={type}
        achievementData={achievementData ?? null}
        achievementDataError={achievementDataError ?? false}
      />
    );

  return null;
};
