import { useRouter } from 'next/router';

import { ACHIEVEMENT_TYPES } from 'constants/index';
import { AchievementData } from 'types/achievement';

import { Payout } from './Payout';

type OmenstratAchievementCardProps = {
  achievementData: AchievementData | null;
  achievementDataError: boolean;
};

export const OmenstratAchievementCard = ({
  achievementData,
  achievementDataError,
}: OmenstratAchievementCardProps) => {
  const router = useRouter();
  const { type } = router.query;

  if (!router.isReady || !type) return null;

  if (type === ACHIEVEMENT_TYPES.PAYOUT)
    return <Payout achievementData={achievementData} achievementDataError={achievementDataError} />;

  return null;
};
