import { ACHIEVEMENT_TYPES, AchievementType } from 'constants/index';
import { AchievementData } from 'types/achievement';

import { Payout } from './Payout';

type OmenstratAchievementCardProps = {
  type: AchievementType;
  achievementData: AchievementData | null;
  achievementDataError: boolean;
};

export const OmenstratAchievementCard = ({
  type,
  achievementData,
  achievementDataError,
}: OmenstratAchievementCardProps) => {
  if (type === ACHIEVEMENT_TYPES.PAYOUT)
    return <Payout achievementData={achievementData} achievementDataError={achievementDataError} />;

  return null;
};
