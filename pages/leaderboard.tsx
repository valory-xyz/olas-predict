import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';

import { Leaderboard } from 'components/Leaderboard';
import { SEO } from 'components/SEO';
import { AgentType } from 'constants/index';
import {
  DEFAULT_AGENT_TYPE,
  DEFAULT_RANK_BY,
  DEFAULT_WINDOW,
  LEADERBOARD_QUERY_PARAMS,
  LeaderboardWindow,
  RankBy,
} from 'constants/leaderboard';
import { SEO_CONFIG } from 'constants/seo';
import { parseAddress, parseAgentType, parseRankBy, parseWindow } from 'utils/leaderboard/params';

const LeaderboardPage = () => {
  const router = useRouter();
  const { query, isReady } = router;

  // Invalid or missing values fall back to the defaults
  const agentType =
    parseAgentType(query[LEADERBOARD_QUERY_PARAMS.AGENT_TYPE]) ?? DEFAULT_AGENT_TYPE;
  const rankBy = parseRankBy(query[LEADERBOARD_QUERY_PARAMS.RANK_BY]) ?? DEFAULT_RANK_BY;
  const window = parseWindow(query[LEADERBOARD_QUERY_PARAMS.WINDOW]) ?? DEFAULT_WINDOW;

  const setQuery = useCallback(
    (changes: Record<string, string | undefined>) => {
      const next = { ...router.query, ...changes };
      Object.keys(next).forEach((key) => next[key] === undefined && delete next[key]);
      router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true });
    },
    [router],
  );

  // Deep link from Pearl: take the pin once, then drop it from the URL so a reload does not
  // repeat the arrival. An invalid pin is ignored.
  const [arrivalAddress, setArrivalAddress] = useState<string | null>(null);
  const pinParam = query[LEADERBOARD_QUERY_PARAMS.PIN];
  useEffect(() => {
    if (!isReady || pinParam === undefined) return;
    setArrivalAddress(parseAddress(pinParam));
    setQuery({ [LEADERBOARD_QUERY_PARAMS.PIN]: undefined });
  }, [isReady, pinParam, setQuery]);

  return (
    <>
      <SEO
        title={SEO_CONFIG.pages.leaderboard.title}
        description={SEO_CONFIG.pages.leaderboard.description}
      />
      {isReady && (
        <Leaderboard
          agentType={agentType}
          rankBy={rankBy}
          window={window}
          arrivalAddress={arrivalAddress}
          onAgentTypeChange={(value: AgentType) =>
            setQuery({ [LEADERBOARD_QUERY_PARAMS.AGENT_TYPE]: value })
          }
          onRankByChange={(value: RankBy) =>
            setQuery({ [LEADERBOARD_QUERY_PARAMS.RANK_BY]: value })
          }
          onWindowChange={(value: LeaderboardWindow) =>
            setQuery({ [LEADERBOARD_QUERY_PARAMS.WINDOW]: value })
          }
        />
      )}
    </>
  );
};

export default LeaderboardPage;
