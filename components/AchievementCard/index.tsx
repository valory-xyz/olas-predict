import { useRouter } from 'next/router';

import { PolystratAchievementCard } from './Polystrat';

export const AchievementCard = () => {
  const router = useRouter();
  const { agent } = router.query;

  if (!router.isReady || !agent) return null;

  if (agent === 'polystrat') return <PolystratAchievementCard />;

  return null;
};
