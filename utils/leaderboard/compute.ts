/** Pure assembly of a ranked snapshot from each agent's inputs. */
import type { AgentType } from 'constants/index';
import {
  CHAIN_ID_BY_AGENT_TYPE,
  LEADERBOARD_SNAPSHOT_SCHEMA_VERSION,
  LEADERBOARD_WINDOWS,
  LEADERBOARD_WINDOW_DAYS,
  type LeaderboardWindow,
  MECH_FEE_USD,
  MIN_SETTLED_BETS_PER_WINDOW,
  MIN_SETTLED_COST_USD,
} from 'constants/leaderboard';
import type { LeaderboardSnapshot, SnapshotAgent, SnapshotWindowEntry } from 'types/leaderboard';
import { generateAgentName } from 'utils/agentName';

import {
  type AgentDay,
  type MarketTallies,
  type MarketTitles,
  type WindowMetrics,
  attributeMechFees,
  computeWindowMetrics,
  getWindowStart,
} from './metrics';
import { type RankCandidate, assignRanks, getNotRankedReason } from './ranking';

export type AgentInputs = {
  address: string;
  serviceId: string;
  days: AgentDay[];
  requests: [string, number][];
  tallies: MarketTallies;
};

/** Ranks agents in every window and assembles the snapshot */
export const computeSnapshot = ({
  agentType,
  agents,
  marketTitles,
  nowSeconds,
  sourceHeight,
}: {
  agentType: AgentType;
  agents: AgentInputs[];
  marketTitles: MarketTitles;
  nowSeconds: number;
  sourceHeight: number | null;
}): LeaderboardSnapshot => {
  const chainId = CHAIN_ID_BY_AGENT_TYPE[agentType];

  const prepared = agents.map((agent) => {
    const feesByDay = attributeMechFees(
      agent.days,
      agent.requests.map(([titleKey, timestamp]) => ({ titleKey, timestamp })),
      marketTitles,
    );
    const hasSettledActivity = agent.days.some(
      (day) => day.brierCount > 0 || day.tradedSettled > 0,
    );
    const metrics = Object.fromEntries(
      LEADERBOARD_WINDOWS.map((window) => [
        window,
        computeWindowMetrics({
          days: agent.days,
          feesByDay,
          tallies: agent.tallies,
          windowStart: getWindowStart(nowSeconds, LEADERBOARD_WINDOW_DAYS[window]),
          mechFee: MECH_FEE_USD,
        }),
      ]),
    ) as Record<LeaderboardWindow, WindowMetrics>;
    return { ...agent, hasSettledActivity, metrics };
  });

  const windows = LEADERBOARD_WINDOWS.map((window) => {
    const candidates: RankCandidate[] = prepared.map((agent) => ({
      address: agent.address,
      metrics: agent.metrics[window],
      hasSettledActivity: agent.hasSettledActivity,
    }));
    const reasons = new Map(
      candidates.map((c) => [
        c.address,
        getNotRankedReason(c, {
          minSettledBets: MIN_SETTLED_BETS_PER_WINDOW,
          minSettledCost: MIN_SETTLED_COST_USD,
        }),
      ]),
    );
    const eligible = candidates.filter((c) => reasons.get(c.address) === null);
    return {
      window,
      reasons,
      totalRanked: eligible.length,
      roiRanks: assignRanks(eligible, 'roi'),
      pnlRanks: assignRanks(eligible, 'pnl'),
    };
  });

  const snapshotAgents: SnapshotAgent[] = prepared.map((agent) => ({
    address: agent.address,
    serviceId: agent.serviceId,
    name: generateAgentName(chainId, BigInt(agent.serviceId)),
    hasSettledActivity: agent.hasSettledActivity,
    windows: Object.fromEntries(
      windows.map(({ window, reasons, roiRanks, pnlRanks }) => {
        const notRankedReason = reasons.get(agent.address) ?? null;
        const { roi, pnl, accuracy, brierScore, avgTradeSize, volume, trades } =
          agent.metrics[window];
        const metrics = { roi, pnl, accuracy, brierScore, avgTradeSize, volume, trades };
        const entry: SnapshotWindowEntry = {
          metrics: notRankedReason ? null : metrics,
          rankByRoi: roiRanks.get(agent.address) ?? null,
          rankByPnl: pnlRanks.get(agent.address) ?? null,
          notRankedReason,
        };
        return [window, entry];
      }),
    ) as Record<LeaderboardWindow, SnapshotWindowEntry>,
  }));

  return {
    schemaVersion: LEADERBOARD_SNAPSHOT_SCHEMA_VERSION,
    agentType,
    updatedAt: new Date(nowSeconds * 1000).toISOString(),
    sourceHeight,
    totalRanked: Object.fromEntries(windows.map((w) => [w.window, w.totalRanked])) as Record<
      LeaderboardWindow,
      number
    >,
    agents: snapshotAgents,
  };
};
