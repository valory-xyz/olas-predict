import capitalize from 'lodash/capitalize';
import { GetServerSideProps } from 'next';

import { AchievementCard } from 'components/AchievementCard';
import { ACHIEVEMENT_TYPES, AGENTS, AchievementType, TIME_IN_SECONDS } from 'constants/index';
import type { AchievementData } from 'types/achievement';
import { fetchAchievementOgImage, fetchOmenAchievementData } from 'utils/achievements';

type AchievementPageProps = {
  seoConfig: { title: string; ogImage: string; noIndex: boolean };
  agent: string;
  type: AchievementType;
  betId: string;
  achievementData: AchievementData | null;
  achievementDataError: boolean;
};

const AchievementPage = ({
  agent,
  type,
  betId,
  achievementData,
  achievementDataError,
}: AchievementPageProps) => {
  return (
    <AchievementCard
      agent={agent}
      type={type}
      betId={betId}
      achievementData={achievementData}
      achievementDataError={achievementDataError}
    />
  );
};

export const getServerSideProps: GetServerSideProps<AchievementPageProps> = async (context) => {
  const { agent, type, betId } = context.query;

  if (
    typeof agent !== 'string' ||
    !Object.values(AGENTS).some((validAgent) => validAgent === agent.toLowerCase()) ||
    typeof type !== 'string' ||
    !Object.values(ACHIEVEMENT_TYPES).includes(type as AchievementType)
  ) {
    return { notFound: true };
  }

  const agentSlug = agent.toLowerCase();

  const [ogImage, achievementDataResult] = await Promise.all([
    fetchAchievementOgImage({ agent: agentSlug, type, query: context.query }),
    (async () => {
      if (agentSlug !== AGENTS.OMENSTRAT) return { data: null, error: false };

      try {
        return {
          data: await fetchOmenAchievementData(typeof betId === 'string' ? betId : ''),
          error: false,
        };
      } catch {
        return { data: null, error: true };
      }
    })(),
  ]);

  const { data: achievementData, error: achievementDataError } = achievementDataResult;

  context.res.setHeader(
    'Cache-Control',
    achievementData
      ? `public, s-maxage=${TIME_IN_SECONDS.TWELVE_HOURS}, stale-while-revalidate=${TIME_IN_SECONDS.ONE_HOUR}`
      : `public, s-maxage=${TIME_IN_SECONDS.ONE_MINUTE}`,
  );

  return {
    props: {
      seoConfig: {
        title: `${capitalize(agentSlug)} Achievement`,
        ogImage,
        noIndex: true,
      },
      agent: agentSlug,
      type: type as AchievementType,
      betId: typeof betId === 'string' ? betId : '',
      achievementData,
      achievementDataError,
    },
  };
};

export default AchievementPage;
