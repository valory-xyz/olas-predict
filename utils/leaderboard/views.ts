/** Read-only views over a snapshot, used by the public API routes. */
import type { LeaderboardWindow, RankBy } from 'constants/leaderboard';
import type {
  LeaderboardAgentRecord,
  LeaderboardRow,
  LeaderboardSnapshot,
  SnapshotAgent,
} from 'types/leaderboard';

import { getLeaderboardUrl } from './params';
import { searchByName } from './ranking';

const toRow = (agent: SnapshotAgent, window: LeaderboardWindow, rankBy: RankBy): LeaderboardRow => {
  const entry = agent.windows[window];
  return {
    address: agent.address,
    name: agent.name,
    rank: rankBy === 'roi' ? entry.rankByRoi : entry.rankByPnl,
    notRankedReason: entry.notRankedReason,
    roi: entry.metrics?.roi ?? null,
    pnl: entry.metrics?.pnl ?? null,
    accuracy: entry.metrics?.accuracy ?? null,
    brierScore: entry.metrics?.brierScore ?? null,
    avgTradeSize: entry.metrics?.avgTradeSize ?? null,
    volume: entry.metrics?.volume ?? null,
    trades: entry.metrics?.trades ?? null,
  };
};

const rowsMemo = new WeakMap<LeaderboardSnapshot, Map<string, LeaderboardRow[]>>();

/** Every agent in the snapshot as a row, the ranked ones first in rank order */
const getRows = (snapshot: LeaderboardSnapshot, window: LeaderboardWindow, rankBy: RankBy) => {
  let byKey = rowsMemo.get(snapshot);
  if (!byKey) {
    byKey = new Map();
    rowsMemo.set(snapshot, byKey);
  }
  const key = `${window}:${rankBy}`;
  let rows = byKey.get(key);
  if (!rows) {
    rows = snapshot.agents.map((agent) => toRow(agent, window, rankBy));
    const ranked = rows.filter((row) => row.rank !== null).sort((a, b) => a.rank! - b.rank!);
    const notRanked = rows.filter((row) => row.rank === null);
    rows = [...ranked, ...notRanked];
    byKey.set(key, rows);
  }
  return rows;
};

/**
 * The rows for one page of the list: the ranked agents, in rank order, narrowed to the names
 * matching `search` when set (each keeps its rank in the full leaderboard).
 */
export const getLeaderboardPage = ({
  snapshot,
  window,
  rankBy,
  search,
  offset,
  limit,
}: {
  snapshot: LeaderboardSnapshot;
  window: LeaderboardWindow;
  rankBy: RankBy;
  search: string;
  offset: number;
  limit: number;
}) => {
  const rows = getRows(snapshot, window, rankBy);
  const ranked = rows.filter((row) => row.rank !== null);
  const results = search ? searchByName(ranked, search) : ranked;
  return { totalResults: results.length, agents: results.slice(offset, offset + limit) };
};

/** Ranks under both criteria for the given Safes, in request order */
export const getAgentRecords = (
  snapshot: LeaderboardSnapshot,
  window: LeaderboardWindow,
  addresses: string[],
): LeaderboardAgentRecord[] => {
  const byAddress = new Map(snapshot.agents.map((agent) => [agent.address, agent]));
  const excluded = new Set(snapshot.excluded ?? []);
  return addresses.map((address) => {
    const leaderboardUrl = getLeaderboardUrl(snapshot.agentType, window, address);
    const agent = byAddress.get(address);
    if (!agent) {
      return {
        address,
        name: null,
        ranked: false,
        // A known non-Pearl trader is never ranked; any other Safe may be once it trades
        notRankedReason: excluded.has(address) ? 'not_eligible' : 'not_ranked_yet',
        rankByRoi: null,
        rankByPnl: null,
        metrics: null,
        leaderboardUrl,
      };
    }
    const entry = agent.windows[window];
    return {
      address,
      name: agent.name,
      ranked: entry.notRankedReason === null,
      notRankedReason: entry.notRankedReason,
      rankByRoi: entry.rankByRoi,
      rankByPnl: entry.rankByPnl,
      metrics: entry.metrics,
      leaderboardUrl,
    };
  });
};
