import { useRouter } from 'next/router';

import { ACHIEVEMENT_TYPES } from 'constants/index';

import { Payout } from './Payout';

export const PolystratAchievementCard = () => {
  const router = useRouter();
  const { type } = router.query;

  if (!router.isReady || !type) return null;

  if (type === ACHIEVEMENT_TYPES.PAYOUT) return <Payout />;
};
