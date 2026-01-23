import Error from 'next/error';
import { useRouter } from 'next/router';

import { AchievementCard } from 'components/AchievementCard';
import { SEO } from 'components/SEO';
import { AGENTS } from 'constants/index';

const AchievementPage = () => {
  const router = useRouter();
  const { agent: agentParam } = router.query;
  const type = router.query.type as string | undefined;

  const agentSlug = Array.isArray(agentParam) ? agentParam[0] : agentParam;
  const normalizedAgent = agentSlug?.toLowerCase();

  if (!router.isReady || !normalizedAgent) return null;

  if (!normalizedAgent || !type) return <Error statusCode={404} />;

  if (!Object.values(AGENTS).some((agent) => agent.toLowerCase() === normalizedAgent))
    return <Error statusCode={404} />;

  return (
    <>
      <SEO title={`${agentSlug} Achievement`} noIndex />
      <AchievementCard />
    </>
  );
};

export default AchievementPage;
