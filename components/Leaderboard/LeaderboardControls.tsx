import { SearchOutlined } from '@ant-design/icons';
import { Flex, Input, Segmented, Typography } from 'antd';
import styled from 'styled-components';

import { AGENTS, AgentType } from 'constants/index';
import {
  LEADERBOARD_WINDOWS,
  LEADERBOARD_WINDOW_LABELS,
  LeaderboardWindow,
  RankBy,
} from 'constants/leaderboard';
import { COLOR, MEDIA_QUERY } from 'constants/theme';

const { Text } = Typography;

const SearchInput = styled(Input)`
  width: 260px;
  border-radius: 38px;
  background: ${COLOR.BLACK_TRANSPARENT_20};

  ${MEDIA_QUERY.mobile} {
    width: 100%;
  }
`;

const AGENT_TYPE_OPTIONS = [
  { label: 'Omenstrat', value: AGENTS.OMENSTRAT },
  { label: 'Polystrat', value: AGENTS.POLYSTRAT },
];

const WINDOW_OPTIONS = LEADERBOARD_WINDOWS.map((window) => ({
  label: LEADERBOARD_WINDOW_LABELS[window],
  value: window,
}));

const RANK_BY_OPTIONS = [
  { label: 'ROI', value: 'roi' },
  { label: 'PnL', value: 'pnl' },
];

type LeaderboardControlsProps = {
  agentType: AgentType;
  rankBy: RankBy;
  window: LeaderboardWindow;
  search: string;
  onAgentTypeChange: (agentType: AgentType) => void;
  onRankByChange: (rankBy: RankBy) => void;
  onWindowChange: (window: LeaderboardWindow) => void;
  onSearchChange: (search: string) => void;
};

export const LeaderboardControls = ({
  agentType,
  rankBy,
  window,
  search,
  onAgentTypeChange,
  onRankByChange,
  onWindowChange,
  onSearchChange,
}: LeaderboardControlsProps) => (
  <Flex gap={16} wrap="wrap" align="center" justify="space-between">
    <Flex gap={16} wrap="wrap" align="center">
      <SearchInput
        allowClear
        placeholder="Search agents..."
        prefix={<SearchOutlined />}
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        aria-label="Search agents"
      />
      <Segmented<AgentType>
        options={AGENT_TYPE_OPTIONS}
        value={agentType}
        onChange={onAgentTypeChange}
      />
      <Segmented<LeaderboardWindow>
        options={WINDOW_OPTIONS}
        value={window}
        onChange={onWindowChange}
      />
    </Flex>
    <Flex gap={8} align="center">
      <Text type="secondary">🏆 Rank by</Text>
      <Segmented<RankBy>
        options={RANK_BY_OPTIONS as { label: string; value: RankBy }[]}
        value={rankBy}
        onChange={onRankByChange}
      />
    </Flex>
  </Flex>
);
