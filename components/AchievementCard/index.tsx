import { AGENTS } from 'constants/index';

import { PolystratAchievementCard } from './Polystrat';

type AchievementCardProps = {
  agent?: string;
};

export const AchievementCard = ({ agent }: AchievementCardProps) => {
  if (!agent) return null;

  if (agent.toLowerCase() === AGENTS.POLYSTRAT) return <PolystratAchievementCard />;

  return null;
};
