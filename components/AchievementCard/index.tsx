import { useRouter } from 'next/router';

import { AGENTS } from 'constants/index';

import { PolystratAchievementCard } from './Polystrat';

export const AchievementCard = () => {
  const router = useRouter();
  const { agent } = router.query;

  if (!router.isReady || !agent) return null;

  if (agent === AGENTS.POLYSTRAT) return <PolystratAchievementCard />;

  return null;
};
