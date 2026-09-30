import { AGENTS } from 'constants/index';
import { AchievementData } from 'types/achievement';

import { OmenstratAchievementCard } from './Omenstrat';
import { PolystratAchievementCard } from './Polystrat';

type AchievementCardProps = {
  agent?: string;
  achievementData: AchievementData | null;
  achievementDataError: boolean;
};

export const AchievementCard = ({
  agent,
  achievementData,
  achievementDataError,
}: AchievementCardProps) => {
  if (!agent) return null;

  if (agent.toLowerCase() === AGENTS.POLYSTRAT)
    return (
      <PolystratAchievementCard
        achievementData={achievementData}
        achievementDataError={achievementDataError}
      />
    );

  if (agent.toLowerCase() === AGENTS.OMENSTRAT)
    return (
      <OmenstratAchievementCard
        achievementData={achievementData}
        achievementDataError={achievementDataError}
      />
    );

  return null;
};
