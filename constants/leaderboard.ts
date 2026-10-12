import type { Address } from 'viem';

import { AGENTS, type AgentType } from 'constants/index';

export const LEADERBOARD_WINDOWS = ['7d', '30d', '90d', '1y'] as const;
export type LeaderboardWindow = (typeof LEADERBOARD_WINDOWS)[number];

export const LEADERBOARD_WINDOW_DAYS: Record<LeaderboardWindow, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

export const LEADERBOARD_WINDOW_LABELS: Record<LeaderboardWindow, string> = {
  '7d': '7D',
  '30d': '30D',
  '90d': '90D',
  '1y': '1Y',
};

export const RANK_BY = ['roi', 'pnl'] as const;
export type RankBy = (typeof RANK_BY)[number];

export const LEADERBOARD_AGENT_TYPES: AgentType[] = [AGENTS.OMENSTRAT, AGENTS.POLYSTRAT];

export const DEFAULT_AGENT_TYPE: AgentType = AGENTS.OMENSTRAT;
export const DEFAULT_WINDOW: LeaderboardWindow = '7d';
export const DEFAULT_RANK_BY: RankBy = 'roi';

export const LEADERBOARD_PAGE_SIZE = 30;
export const LEADERBOARD_MAX_LIMIT = 100;
export const LEADERBOARD_MAX_ADDRESSES = 50;

/** An agent is ranked in a window only with at least this many settled bets there */
export const MIN_SETTLED_BETS_PER_WINDOW = 5;
/**
 * ... and at least this much settled cost there (the ROI denominator: gross buy cost of the
 * markets settled in the window plus mech fees, in USD), so ROI is not a ratio of dust
 */
export const MIN_SETTLED_COST_USD = 1;

export const NOT_RANKED_REASONS = {
  NOT_RANKED_YET: 'not_ranked_yet',
  NOT_ENOUGH_TRADES_IN_WINDOW: 'not_enough_trades_in_window',
} as const;
export type NotRankedReason = (typeof NOT_RANKED_REASONS)[keyof typeof NOT_RANKED_REASONS];

export const NOT_RANKED_COPY: Record<NotRankedReason, string> = {
  not_ranked_yet: 'Not ranked yet. Keep your agent running. It gets ranked after enough trades.',
  not_enough_trades_in_window:
    "Not enough trades in this period. Try a different period to see your agent's rank.",
};

export const LEADERBOARD_QUERY_PARAMS = {
  AGENT_TYPE: 'agentType',
  RANK_BY: 'rankBy',
  WINDOW: 'window',
  PIN: 'pin',
} as const;

export const LEADERBOARD_PATH = '/leaderboard';

export const PINNED_AGENTS_STORAGE_KEY = 'olas-predict.leaderboard.pins.v1';

/** Fixed fee per mech request in USD, the same constant the trader agent uses */
export const MECH_FEE_USD = 0.01;
export const QUESTION_DATA_SEPARATOR = '␟';

export const TOKEN_DECIMALS: Record<AgentType, number> = {
  omenstrat: 18, // xDAI
  polystrat: 6, // USDC
};

export const CHAIN_ID_BY_AGENT_TYPE: Record<AgentType, number> = {
  omenstrat: 100,
  polystrat: 137,
};

export const SERVICE_REGISTRY_ADDRESSES: Record<number, Address> = {
  100: '0x9338b5153AE39BB89f50468E608eD9d764B755fD',
  137: '0xE3607b00E75f6405248323A9417ff6b39B244b50',
};

/** The description prefix Pearl's service templates write into the service metadata */
export const PEARL_SERVICE_DESCRIPTION_PREFIX = '[Pearl service]';

/** The trader's service package per agent type: the `name` in its service metadata */
export const PEARL_TRADER_SERVICE_PACKAGES: Record<AgentType, string> = {
  omenstrat: 'service/valory/trader_pearl',
  polystrat: 'service/valory/polymarket_trader',
};

export const LEADERBOARD_BLOB_PREFIX = 'leaderboard';
export const LEADERBOARD_SNAPSHOT_SCHEMA_VERSION = 1;
// 2: Pearl flags re-evaluated with the trader package name
export const LEADERBOARD_STATE_SCHEMA_VERSION = 2;
