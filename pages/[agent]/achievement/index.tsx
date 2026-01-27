import capitalize from 'lodash/capitalize';
import { GetServerSideProps } from 'next';
import Error from 'next/error';

import { AchievementCard } from 'components/AchievementCard';
import { ACHIEVEMENT_TYPES, AGENTS, AchievementType } from 'constants/index';
import { fetchAchievementOgImage } from 'utils/achievements';

type AchievementPageProps = {
  agent?: string;
  type?: AchievementType;
};

const AchievementPage = ({ agent, type }: AchievementPageProps) => {
  const normalizedAgent = agent?.toLowerCase();

  if (!normalizedAgent || !type) return <Error statusCode={404} />;

  if (!Object.values(AGENTS).some((agent) => agent.toLowerCase() === normalizedAgent))
    return <Error statusCode={404} />;

  if (!Object.values(ACHIEVEMENT_TYPES).includes(type)) return <Error statusCode={404} />;

  return <AchievementCard agent={agent} />;
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
      seoConfig: {
        title: `${capitalize(agent as string)} Achievement`,
        ogImage,
        noIndex: true,
      },
      agent: agent as string,
      type: type as AchievementType,
    },
  };
};

export default AchievementPage;
