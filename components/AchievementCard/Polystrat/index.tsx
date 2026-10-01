import { ACHIEVEMENT_TYPES } from 'constants/index';

import { Payout } from './Payout';

type PolystratAchievementCardProps = {
  type: string;
  betId: string;
};

export const PolystratAchievementCard = ({ type, betId }: PolystratAchievementCardProps) => {
  if (type === ACHIEVEMENT_TYPES.PAYOUT) return <Payout betId={betId} />;
  return null;
};
