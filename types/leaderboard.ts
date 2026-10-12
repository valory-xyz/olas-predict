import type { AgentType } from 'constants/index';
import type { LeaderboardWindow, NotRankedReason, RankBy } from 'constants/leaderboard';

export type LeaderboardMetrics = {
  /** Decimal fraction, −0.56 = −56% */
  roi: number;
  /** USD */
  pnl: number;
  accuracy: number | null;
  brierScore: number | null;
  avgTradeSize: number | null;
  volume: number;
  trades: number;
};

/** One agent's figures for one window, as stored in the snapshot */
export type SnapshotWindowEntry = {
  metrics: LeaderboardMetrics | null;
  rankByRoi: number | null;
  rankByPnl: number | null;
  notRankedReason: NotRankedReason | null;
};

export type SnapshotAgent = {
  address: string;
  serviceId: string;
  name: string;
  /** Whether the agent has any settled trading activity in the snapshot */
  hasSettledActivity: boolean;
  windows: Record<LeaderboardWindow, SnapshotWindowEntry>;
};

export type LeaderboardSnapshot = {
  schemaVersion: number;
  agentType: AgentType;
  updatedAt: string;
  /** Block (Omen) or squid height (Polymarket) the snapshot was built at */
  sourceHeight: number | null;
  totalRanked: Record<LeaderboardWindow, number>;
  agents: SnapshotAgent[];
  /**
   * Safes of active trader agents of this type that are not Pearl agents: never ranked, and
   * reported as `not_eligible`. Absent in snapshots written before it existed.
   */
  excluded?: string[];
};

export type LeaderboardRow = {
  address: string;
  name: string;
  rank: number | null;
  notRankedReason: NotRankedReason | null;
  roi: number | null;
  pnl: number | null;
  accuracy: number | null;
  brierScore: number | null;
  avgTradeSize: number | null;
  volume: number | null;
  trades: number | null;
};

export type LeaderboardListResponse = {
  agentType: AgentType;
  rankBy: RankBy;
  window: LeaderboardWindow;
  totalRanked: number;
  totalResults: number;
  offset: number;
  limit: number;
  updatedAt: string;
  agents: LeaderboardRow[];
};

export type LeaderboardAgentRecord = {
  address: string;
  name: string | null;
  ranked: boolean;
  notRankedReason: NotRankedReason | null;
  rankByRoi: number | null;
  rankByPnl: number | null;
  metrics: LeaderboardMetrics | null;
  leaderboardUrl: string;
};

export type LeaderboardAgentsResponse = {
  agentType: AgentType;
  window: LeaderboardWindow;
  totalRanked: number;
  updatedAt: string;
  agents: LeaderboardAgentRecord[];
};

export type LeaderboardErrorResponse = { error: string };

export type PinnedAgent = {
  address: string;
  agentType: AgentType;
  pinnedAt: number;
};
