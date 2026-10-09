import { PushpinFilled, PushpinOutlined } from '@ant-design/icons';
import { Button, Flex, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { ReactNode } from 'react';
import Jazzicon, { jsNumberForAddress } from 'react-jazzicon';
import styled, { keyframes } from 'styled-components';

import { AGENTS, AgentType, NA, POLYGON_SCAN_URL } from 'constants/index';
import { NOT_RANKED_COPY, RankBy } from 'constants/leaderboard';
import { COLOR } from 'constants/theme';
import type { LeaderboardRow } from 'types/leaderboard';

const { Text, Title } = Typography;

const GOLD = '#ffc53d';
const POSITIVE = '#3be37f';
const NEGATIVE = '#ff6b6b';
const TABLE_SCROLL_WIDTH = 1040;

const flash = keyframes`
  from { background: ${COLOR.WHITE_TRANSPARENT_50}; }
  to { background: ${COLOR.WHITE_TRANSPARENT_10}; }
`;

const StyledTable = styled(Table<LeaderboardRow>)`
  .ant-table,
  .ant-table-container,
  .ant-table-header,
  .ant-table-summary {
    background: transparent;
  }
  .ant-table-sticky-holder,
  .ant-table-header {
    backdrop-filter: blur(10px);
  }
  .pinned-row > td {
    background: ${COLOR.WHITE_TRANSPARENT_10};
  }
  .pinned-row-flash > td {
    animation: ${flash} 2s ease-out;
  }
`;

export type PinnedRow = LeaderboardRow & { flash?: boolean };

const formatUsd = (value: number) =>
  `$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const Signed = ({ value, children }: { value: number; children: ReactNode }) => (
  <Text style={{ color: value > 0 ? POSITIVE : value < 0 ? NEGATIVE : undefined }}>
    {value > 0 ? '+' : value < 0 ? '-' : ''}
    {children}
  </Text>
);

const formatPercent = (value: number) =>
  `${Math.abs(value * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

const METRIC_COLUMN_COUNT = 7;

const RankedHeader = ({ label, isRanked }: { label: string; isRanked: boolean }) =>
  isRanked ? <span style={{ color: GOLD }}>🏆 {label}</span> : <>{label}</>;

const AgentName = ({ row, agentType }: { row: LeaderboardRow; agentType: AgentType }) => {
  const label = (
    <Flex gap={12} align="center" component="span">
      <Jazzicon diameter={24} seed={jsNumberForAddress(row.address)} />
      <b>{row.name || `${row.address.slice(0, 6)}…${row.address.slice(-4)}`}</b>
    </Flex>
  );
  // /agents/[id] resolves Omen agents only, so a Polystrat agent links to its Safe
  return agentType === AGENTS.OMENSTRAT ? (
    <Link href={`/agents/${row.address}`}>{label}</Link>
  ) : (
    <a href={`${POLYGON_SCAN_URL}/address/${row.address}`} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
};

type ColumnOptions = {
  agentType: AgentType;
  rankBy: RankBy;
  isPinned: (address: string) => boolean;
  onTogglePin: (address: string) => void;
};

/** A metric cell, or for an agent not ranked in the window one cell with the reason */
const metricCell = (render: (row: LeaderboardRow) => ReactNode, isFirstMetric: boolean) => ({
  render: (_: unknown, row: LeaderboardRow) =>
    row.notRankedReason ? (
      <Text type="secondary">{NOT_RANKED_COPY[row.notRankedReason]}</Text>
    ) : (
      render(row)
    ),
  onCell: (row: LeaderboardRow) =>
    row.notRankedReason ? { colSpan: isFirstMetric ? METRIC_COLUMN_COUNT : 0 } : {},
});

const getColumns = ({ agentType, rankBy, isPinned, onTogglePin }: ColumnOptions) =>
  [
    {
      key: 'pin',
      width: 56,
      render: (_: unknown, row: LeaderboardRow) => {
        const pinned = isPinned(row.address);
        return (
          <Tooltip title={pinned ? 'Unpin' : 'Pin to top'} trigger="hover">
            <Button
              type="text"
              size="small"
              aria-label={pinned ? 'Unpin' : 'Pin to top'}
              icon={pinned ? <PushpinFilled /> : <PushpinOutlined />}
              onClick={() => onTogglePin(row.address)}
            />
          </Tooltip>
        );
      },
    },
    {
      title: 'Rank',
      key: 'rank',
      width: 64,
      className: 'text-end',
      render: (_: unknown, row: LeaderboardRow) => <Text type="secondary">{row.rank ?? '—'}</Text>,
    },
    {
      title: 'Agent',
      key: 'agent',
      width: 220,
      render: (_: unknown, row: LeaderboardRow) => <AgentName row={row} agentType={agentType} />,
    },
    {
      title: <RankedHeader label="ROI" isRanked={rankBy === 'roi'} />,
      key: 'roi',
      className: 'text-end',
      ...metricCell((row) => <Signed value={row.roi!}>{formatPercent(row.roi!)}</Signed>, true),
    },
    {
      title: <RankedHeader label="PnL" isRanked={rankBy === 'pnl'} />,
      key: 'pnl',
      className: 'text-end',
      ...metricCell((row) => <Signed value={row.pnl!}>{formatUsd(row.pnl!)}</Signed>, false),
    },
    {
      title: 'Accuracy',
      key: 'accuracy',
      className: 'text-end',
      ...metricCell(
        (row) => (row.accuracy === null ? NA : `${Math.round(row.accuracy * 100)}%`),
        false,
      ),
    },
    {
      title: 'Brier score',
      key: 'brierScore',
      className: 'text-end',
      ...metricCell((row) => (row.brierScore === null ? NA : row.brierScore.toFixed(2)), false),
    },
    {
      title: 'Avg trade size',
      key: 'avgTradeSize',
      className: 'text-end',
      ...metricCell((row) => (row.avgTradeSize === null ? NA : formatUsd(row.avgTradeSize)), false),
    },
    {
      title: 'Volume',
      key: 'volume',
      className: 'text-end',
      ...metricCell((row) => formatUsd(row.volume ?? 0), false),
    },
    {
      title: 'Trades',
      key: 'trades',
      className: 'text-end',
      ...metricCell((row) => (row.trades ?? 0).toLocaleString('en-US'), false),
    },
  ] as ColumnsType<LeaderboardRow>;

const NoMatch = ({ search, onClear }: { search: string; onClear: () => void }) => (
  <Flex vertical align="center" gap={8} style={{ padding: '48px 0' }}>
    <Title level={5} className="m-0">
      No agents match “{search}”
    </Title>
    <Text type="secondary">
      Check the spelling, or clear the search to see the full leaderboard.
    </Text>
    <Button onClick={onClear} style={{ marginTop: 8 }}>
      Clear search
    </Button>
  </Flex>
);

type LeaderboardTableProps = ColumnOptions & {
  rows: LeaderboardRow[];
  pinnedRows: PinnedRow[];
  isLoading: boolean;
  search: string;
  onClearSearch: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
};

export const LeaderboardTable = ({
  rows,
  pinnedRows,
  isLoading,
  search,
  onClearSearch,
  hasMore,
  isLoadingMore,
  onLoadMore,
  ...columnOptions
}: LeaderboardTableProps) => {
  const columns = getColumns(columnOptions);

  return (
    <Flex vertical gap={24}>
      <StyledTable
        rowKey="address"
        columns={columns}
        dataSource={rows}
        loading={isLoading}
        pagination={false}
        sticky
        scroll={{ x: TABLE_SCROLL_WIDTH }}
        locale={{
          emptyText: search ? (
            <NoMatch search={search} onClear={onClearSearch} />
          ) : (
            <Text type="secondary">No ranked agents for this period yet.</Text>
          ),
        }}
        summary={() =>
          pinnedRows.length > 0 && (
            <Table.Summary fixed="top">
              {pinnedRows.map((row) => (
                <Table.Summary.Row
                  key={row.address}
                  className={`pinned-row${row.flash ? ' pinned-row-flash' : ''}`}
                >
                  {columns.map((column, index) => {
                    const cellProps = column.onCell?.(row, index) ?? {};
                    if (cellProps.colSpan === 0) return null;
                    return (
                      <Table.Summary.Cell
                        key={String(column.key)}
                        index={index}
                        colSpan={cellProps.colSpan as number | undefined}
                        className={column.className}
                      >
                        {column.render?.(undefined, row, index) as ReactNode}
                      </Table.Summary.Cell>
                    );
                  })}
                </Table.Summary.Row>
              ))}
            </Table.Summary>
          )
        }
      />
      {hasMore && (
        <Flex justify="center">
          <Button size="large" loading={isLoadingMore} onClick={onLoadMore}>
            Load more
          </Button>
        </Flex>
      )}
    </Flex>
  );
};
