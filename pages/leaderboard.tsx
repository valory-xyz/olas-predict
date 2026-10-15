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

const { AGENT_TYPE, RANK_BY, WINDOW, PIN } = LEADERBOARD_QUERY_PARAMS;

const LeaderboardPage = () => {
  const router = useRouter();
  const { query, isReady } = router;

  // Values match case-insensitively; invalid or missing ones fall back to the defaults
  const agentTypeParam = parseAgentType(query[AGENT_TYPE]);
  const rankByParam = parseRankBy(query[RANK_BY]);
  const windowParam = parseWindow(query[WINDOW]);
  const agentType = agentTypeParam ?? DEFAULT_AGENT_TYPE;
  const rankBy = rankByParam ?? DEFAULT_RANK_BY;
  const window = windowParam ?? DEFAULT_WINDOW;

  const setQuery = useCallback(
    (changes: Record<string, string | undefined>) => {
      const next = { ...router.query, ...changes };
      Object.keys(next).forEach((key) => next[key] === undefined && delete next[key]);
      router.replace({ pathname: router.pathname, query: next }, undefined, { shallow: true });
    },
    [router],
  );

  // Deep link from Pearl: take the pin once (lower-cased), then drop it from the URL so a
  // reload does not repeat the arrival. An invalid pin is ignored. The same pass writes the
  // other parameters back in their canonical form (e.g. `rankBy=ROI` becomes `rankBy=roi`) and
  // drops invalid ones.
  const [arrivalAddress, setArrivalAddress] = useState<string | null>(null);
  const pinParam = query[PIN];
  useEffect(() => {
    if (!isReady) return;
    const changes: Record<string, string | undefined> = {};
    if (pinParam !== undefined) {
      setArrivalAddress(parseAddress(pinParam));
      changes[PIN] = undefined;
    }
    (
      [
        [AGENT_TYPE, agentTypeParam],
        [RANK_BY, rankByParam],
        [WINDOW, windowParam],
      ] as const
    ).forEach(([name, parsed]) => {
      const raw = query[name];
      if (raw !== undefined && raw !== parsed) changes[name] = parsed ?? undefined;
    });
    if (Object.keys(changes).length) setQuery(changes);
  }, [isReady, pinParam, query, agentTypeParam, rankByParam, windowParam, setQuery]);

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
          onAgentTypeChange={(value: AgentType) => setQuery({ [AGENT_TYPE]: value })}
          onRankByChange={(value: RankBy) => setQuery({ [RANK_BY]: value })}
          onWindowChange={(value: LeaderboardWindow) => setQuery({ [WINDOW]: value })}
        />
      )}
    </>
  );
};

export default LeaderboardPage;
