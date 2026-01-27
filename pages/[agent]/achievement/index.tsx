import { GetServerSideProps } from 'next';
import Error from 'next/error';
import { useRouter } from 'next/router';

import { AchievementCard } from 'components/AchievementCard';
import { SEO } from 'components/SEO';
import { ACHIEVEMENT_TYPES, AGENTS, AchievementType } from 'constants/index';
import { fetchAchievementOgImage } from 'utils/achievements';

type AchievementPageProps = {
  ogImage?: string;
};

const AchievementPage = ({ ogImage }: AchievementPageProps) => {
  const router = useRouter();
  const { agent: agentParam } = router.query;
  const type = router.query.type as AchievementType | undefined;

  const agentSlug = Array.isArray(agentParam) ? agentParam[0] : agentParam;
  const normalizedAgent = agentSlug?.toLowerCase();

  if (!router.isReady) return null;

  if (!normalizedAgent || !type) return <Error statusCode={404} />;

  if (!Object.values(AGENTS).some((agent) => agent.toLowerCase() === normalizedAgent))
    return <Error statusCode={404} />;

  if (!Object.values(ACHIEVEMENT_TYPES).includes(type)) return <Error statusCode={404} />;

  return (
    <>
      <SEO title={`${agentSlug} Achievement`} noIndex ogImage={ogImage} />
      <AchievementCard />
    </>
  );
};

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { agent, type } = context.query;
  const ogImage = await fetchAchievementOgImage({
    agent: agent as string,
    type: type as AchievementType,
    query: context.query as Record<string, unknown>,
  });

  return {
    props: {
      ogImage,
    },
  };
};

export default AchievementPage;
