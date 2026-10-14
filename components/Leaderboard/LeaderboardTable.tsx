import { PushpinFilled, PushpinOutlined } from '@ant-design/icons';
import { Button, Flex, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Image from 'next/image';
import Link from 'next/link';
import { CSSProperties, ReactNode } from 'react';
import styled, { keyframes } from 'styled-components';

import { AGENTS, AgentType, NA, POLYGON_SCAN_URL } from 'constants/index';
import { NOT_RANKED_COPY, NOT_RANKED_SHORT_COPY, RankBy } from 'constants/leaderboard';
import { COLOR, MEDIA_QUERY } from 'constants/theme';
import { useScreen } from 'hooks/useScreen';
import type { LeaderboardRow } from 'types/leaderboard';

const { Text, Title } = Typography;

const GOLD = '#ffc53d';
const POSITIVE = '#3be37f';
const NEGATIVE = '#ff6b6b';
/**
 * Opaque stand-ins for the card's translucent background, behind the cells that stay in place
 * while the rest scrolls under them (sticky header, pinned rows, fixed columns)
 */
const STICKY_BG = '#2b1a4d';
const PINNED_BG = '#3a2a5c';
const PINNED_FLASH_BG = '#6a5c86';
/** Hovered rows stand out clearly, as in the design */
const ROW_HOVER_BG = '#3f2d63';
const PINNED_HOVER_BG = '#5b4a7d';
/** Pinned rows stay at the top only up to this many; more lead the list instead */
const MAX_STICKY_PINNED_ROWS = 5;

const flash = keyframes`
  from { background: ${PINNED_FLASH_BG}; }
  to { background: ${PINNED_BG}; }
`;

const StyledTable = styled(Table<LeaderboardRow>)`
  /* The table's own width, for the reason below, whatever the gutters and paddings around it */
  container-type: inline-size;

  /* The reason spans every metric column, wider than a phone: keep it next to the fixed
     agent column and wrap it within the visible width, instead of right-aligning it off-screen */
  .not-ranked-message {
    display: block;
    position: sticky;
    left: var(--leaderboard-fixed-width);
    max-width: calc(100cqw - var(--leaderboard-fixed-width) - 16px);
    text-align: left;
    white-space: normal;
  }
  /* Sticky pinned rows on a phone: one line, so a few of them don't cover the screen */
  .not-ranked-message.compact {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ant-table,
  .ant-table-container,
  .ant-table-summary,
  .ant-table-tbody > tr.ant-table-placeholder,
  .ant-table-tbody > tr.ant-table-placeholder:hover > td {
    background: transparent;
  }
  .ant-table-cell {
    white-space: nowrap;
  }
  .ant-table-thead > tr > th {
    color: ${COLOR.WHITE_TRANSPARENT_50};
    font-weight: 400;
  }
  .ant-table-sticky-holder,
  .ant-table-header,
  .ant-table-thead > tr > th {
    background: ${STICKY_BG};
  }
  /* Fixed columns hide what scrolls under them, only once the table is scrolled sideways */
  .ant-table-tbody > tr > td.ant-table-cell-fix-left {
    background: transparent;
  }
  .ant-table-ping-left .ant-table-tbody > tr > td.ant-table-cell-fix-left {
    background: ${STICKY_BG};
  }
  .pinned-row > td,
  .ant-table-tbody > tr.pinned-row > td.ant-table-cell-fix-left {
    background: ${PINNED_BG};
  }
  .ant-table-tbody > tr.ant-table-row:hover > td,
  .ant-table-tbody > tr.ant-table-row:hover > td.ant-table-cell-fix-left {
    background: ${ROW_HOVER_BG};
  }
  .pinned-row:hover > td,
  .ant-table-tbody > tr.pinned-row:hover > td.ant-table-cell-fix-left {
    background: ${PINNED_HOVER_BG};
  }
  .pinned-row-flash > td,
  .ant-table-tbody > tr.pinned-row-flash > td.ant-table-cell-fix-left {
    animation: ${flash} 2s ease-out;
  }
`;

export type PinnedRow = LeaderboardRow & { flash?: boolean };

/** A row rendered with the one-line not-ranked reason (sticky pinned rows on a phone) */
type CompactRow = LeaderboardRow & { isCompact?: boolean };

/** A dollar amount; a signed figure (PnL) passes its absolute value and `Signed` adds the sign */
const formatUsd = (value: number) =>
  `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

const BRIER_HELP =
  'Average over settled bets of (market price of the chosen outcome when the trade was made − ' +
  'result)², where the result is 1 for a won bet and 0 for a lost one. It is computed from the ' +
  'market price at trade time. Lower is better; 0 is perfect.';

/** The explanation shows on hovering the header; the design has no icon there */
const HeaderWithHelp = ({ label, help }: { label: string; help: string }) => (
  <Tooltip title={help}>
    <span style={{ cursor: 'help' }}>{label}</span>
  </Tooltip>
);

const AgentLabel = styled.span`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;

  > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  ${MEDIA_QUERY.mobile} {
    gap: 8px;
  }
`;

/** Every agent of a type shares that type's icon, as in the design */
const AGENT_ICONS: Record<AgentType, string> = {
  [AGENTS.OMENSTRAT]: '/images/omenstrat-icon.png',
  [AGENTS.POLYSTRAT]: '/images/polystrat-icon.png',
};

const AgentIcon = styled(Image)`
  flex-shrink: 0;
  border-radius: 6px;
`;

const getDisplayName = (row: LeaderboardRow) =>
  row.name || `${row.address.slice(0, 6)}…${row.address.slice(-4)}`;

const AgentName = ({ row, agentType }: { row: LeaderboardRow; agentType: AgentType }) => {
  const name = getDisplayName(row);
  const label = (
    <AgentLabel title={name}>
      <AgentIcon src={AGENT_ICONS[agentType]} width={24} height={24} alt="" aria-hidden />
      <span>{name}</span>
    </AgentLabel>
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
  render: (_: unknown, row: CompactRow) => {
    if (!row.notRankedReason) return render(row);
    if (!row.isCompact) {
      return (
        <Text type="secondary" className="not-ranked-message">
          {NOT_RANKED_COPY[row.notRankedReason]}
        </Text>
      );
    }
    return (
      <Tooltip title={NOT_RANKED_COPY[row.notRankedReason]}>
        <Text type="secondary" className="not-ranked-message compact">
          {NOT_RANKED_SHORT_COPY[row.notRankedReason]}
        </Text>
      </Tooltip>
    );
  },
  onCell: (row: LeaderboardRow) =>
    row.notRankedReason ? { colSpan: isFirstMetric ? METRIC_COLUMN_COUNT : 0 } : {},
});

/** Width of the columns fixed on the left (pin, rank, agent) */
const getFixedWidth = (isMobile: boolean) => {
  const { pin, rank, agent } = getWidths(isMobile);
  return pin + rank + agent;
};

/** Column widths, so that all columns fit a 1440px screen and the agent stays in view on mobile */
const getWidths = (isMobile: boolean) => ({
  pin: isMobile ? 36 : 44,
  rank: isMobile ? 40 : 56,
  agent: isMobile ? 150 : 190,
  roi: 104,
  pnl: 112,
  accuracy: 92,
  brierScore: 120,
  avgTradeSize: 128,
  volume: 120,
  trades: 76,
});

const getColumns = ({
  agentType,
  rankBy,
  isPinned,
  onTogglePin,
  isMobile,
}: ColumnOptions & { isMobile: boolean }) => {
  const widths = getWidths(isMobile);
  return [
    {
      key: 'pin',
      width: widths.pin,
      fixed: 'left',
      render: (_: unknown, row: LeaderboardRow) => {
        const pinned = isPinned(row.address);
        const action = pinned ? 'Unpin' : 'Pin to top';
        return (
          <Tooltip title={action} trigger="hover">
            <Button
              type="text"
              size="small"
              aria-label={`${pinned ? 'Unpin' : 'Pin'} ${getDisplayName(row)}`}
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
      width: widths.rank,
      fixed: 'left',
      align: 'right',
      render: (_: unknown, row: LeaderboardRow) => <Text type="secondary">{row.rank ?? '—'}</Text>,
    },
    {
      title: 'Agent',
      key: 'agent',
      width: widths.agent,
      fixed: 'left',
      ellipsis: true,
      render: (_: unknown, row: LeaderboardRow) => <AgentName row={row} agentType={agentType} />,
    },
    {
      title: <RankedHeader label="ROI" isRanked={rankBy === 'roi'} />,
      key: 'roi',
      width: widths.roi,
      align: 'right',
      ...metricCell((row) => <Signed value={row.roi!}>{formatPercent(row.roi!)}</Signed>, true),
    },
    {
      title: <RankedHeader label="PnL" isRanked={rankBy === 'pnl'} />,
      key: 'pnl',
      width: widths.pnl,
      align: 'right',
      ...metricCell(
        (row) => <Signed value={row.pnl!}>{formatUsd(Math.abs(row.pnl!))}</Signed>,
        false,
      ),
    },
    {
      title: 'Accuracy',
      key: 'accuracy',
      width: widths.accuracy,
      align: 'right',
      ...metricCell(
        (row) => (row.accuracy === null ? NA : `${Math.round(row.accuracy * 100)}%`),
        false,
      ),
    },
    {
      title: <HeaderWithHelp label="Brier score" help={BRIER_HELP} />,
      key: 'brierScore',
      width: widths.brierScore,
      align: 'right',
      ...metricCell((row) => (row.brierScore === null ? NA : row.brierScore.toFixed(2)), false),
    },
    {
      title: 'Avg trade size',
      key: 'avgTradeSize',
      width: widths.avgTradeSize,
      align: 'right',
      ...metricCell((row) => (row.avgTradeSize === null ? NA : formatUsd(row.avgTradeSize)), false),
    },
    {
      title: 'Volume',
      key: 'volume',
      width: widths.volume,
      align: 'right',
      ...metricCell((row) => formatUsd(row.volume ?? 0), false),
    },
    {
      title: 'Trades',
      key: 'trades',
      width: widths.trades,
      align: 'right',
      ...metricCell((row) => (row.trades ?? 0).toLocaleString('en-US'), false),
    },
  ] as ColumnsType<LeaderboardRow>;
};

const getScrollWidth = (isMobile: boolean) =>
  Object.values(getWidths(isMobile)).reduce((sum, width) => sum + width, 0);

const NoMatch = ({ search, onClear }: { search: string; onClear: () => void }) => (
  <Flex vertical align="center" gap={8} style={{ padding: '48px 0' }}>
    <Title level={5} className="m-0">
      No ranked agents match “{search}”
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
  hasLoadMoreFailed: boolean;
  onLoadMore: () => void;
};

type TableRow = LeaderboardRow & { rowKey: string; isPinnedRow?: boolean; flash?: boolean };

const pinnedRowClassName = (row: PinnedRow) => `pinned-row${row.flash ? ' pinned-row-flash' : ''}`;

export const LeaderboardTable = ({
  rows,
  pinnedRows,
  isLoading,
  search,
  onClearSearch,
  hasMore,
  isLoadingMore,
  hasLoadMoreFailed,
  onLoadMore,
  ...columnOptions
}: LeaderboardTableProps) => {
  const { isMobile = false } = useScreen();
  const columns = getColumns({ ...columnOptions, isMobile });

  // A few pins stay at the top while scrolling; a long list of them would cover the
  // leaderboard, so then they lead the list instead
  const arePinsSticky = pinnedRows.length <= MAX_STICKY_PINNED_ROWS;
  const dataSource: TableRow[] = [
    ...(arePinsSticky
      ? []
      : pinnedRows.map((row) => ({ ...row, rowKey: `pinned:${row.address}`, isPinnedRow: true }))),
    ...rows.map((row) => ({ ...row, rowKey: row.address })),
  ];

  return (
    <Flex vertical gap={24}>
      <StyledTable
        rowKey={(row) => (row as TableRow).rowKey}
        rowClassName={(row) =>
          (row as TableRow).isPinnedRow ? pinnedRowClassName(row as TableRow) : ''
        }
        columns={columns}
        dataSource={dataSource}
        loading={isLoading}
        pagination={false}
        size="middle"
        sticky
        style={
          {
            '--leaderboard-fixed-width': `${getFixedWidth(isMobile)}px`,
          } as CSSProperties
        }
        scroll={{ x: getScrollWidth(isMobile) }}
        tableLayout="fixed"
        locale={{
          emptyText: isLoading ? (
            // The spinner says it all; an empty-state message would be wrong while loading
            <div style={{ height: 120 }} />
          ) : search ? (
            <NoMatch search={search} onClear={onClearSearch} />
          ) : (
            <Text type="secondary">No ranked agents for this period yet.</Text>
          ),
        }}
        summary={() =>
          arePinsSticky &&
          pinnedRows.length > 0 && (
            <Table.Summary fixed="top">
              {pinnedRows.map((row) => (
                <Table.Summary.Row key={row.address} className={pinnedRowClassName(row)}>
                  {columns.map((column, index) => {
                    const cellProps = column.onCell?.(row, index) ?? {};
                    if (cellProps.colSpan === 0) return null;
                    return (
                      <Table.Summary.Cell
                        key={String(column.key)}
                        index={index}
                        colSpan={cellProps.colSpan as number | undefined}
                        className={column.className}
                        align={column.align}
                      >
                        {
                          column.render?.(
                            undefined,
                            isMobile ? ({ ...row, isCompact: true } as CompactRow) : row,
                            index,
                          ) as ReactNode
                        }
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
        <Flex vertical align="center" gap={8}>
          {hasLoadMoreFailed && (
            <Text type="danger">More agents could not be loaded. Please try again.</Text>
          )}
          <Button size="large" loading={isLoadingMore} onClick={onLoadMore}>
            Load more
          </Button>
        </Flex>
      )}
    </Flex>
  );
};
