import { Flex, Typography, message } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';

import { Card } from 'components/shared/styles';
import { AgentType } from 'constants/index';
import { LeaderboardWindow, RankBy } from 'constants/leaderboard';
import { LeaderboardRequestError, useLeaderboard } from 'hooks/useLeaderboard';
import { useLeaderboardAgents } from 'hooks/useLeaderboardAgents';
import { usePinnedAgents } from 'hooks/usePinnedAgents';
import type { LeaderboardAgentRecord, LeaderboardRow } from 'types/leaderboard';

import { LeaderboardControls } from './LeaderboardControls';
import { LeaderboardTable, PinnedRow } from './LeaderboardTable';

const { Title, Text } = Typography;

const SEARCH_DEBOUNCE_MS = 300;
const ARRIVAL_FLASH_MS = 2000;
const ARRIVAL_TOAST_SECONDS = 5;

// The shared card hides overflow, which would break the sticky header and pinned rows
const LeaderboardCard = styled(Card)`
  overflow: visible;
`;

const toPinnedRow = (record: LeaderboardAgentRecord, rankBy: RankBy): LeaderboardRow => ({
  address: record.address,
  name: record.name ?? '',
  rank: rankBy === 'roi' ? record.rankByRoi : record.rankByPnl,
  notRankedReason: record.notRankedReason,
  roi: record.metrics?.roi ?? null,
  pnl: record.metrics?.pnl ?? null,
  accuracy: record.metrics?.accuracy ?? null,
  brierScore: record.metrics?.brierScore ?? null,
  avgTradeSize: record.metrics?.avgTradeSize ?? null,
  volume: record.metrics?.volume ?? null,
  trades: record.metrics?.trades ?? null,
});

const useDebouncedValue = (value: string, delayMs: number) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timeout);
  }, [value, delayMs]);
  return debounced;
};

type LeaderboardProps = {
  agentType: AgentType;
  rankBy: RankBy;
  window: LeaderboardWindow;
  /** Safe arriving through the "See full leaderboard" deep link, to pin and highlight */
  arrivalAddress: string | null;
  onAgentTypeChange: (agentType: AgentType) => void;
  onRankByChange: (rankBy: RankBy) => void;
  onWindowChange: (window: LeaderboardWindow) => void;
};

export const Leaderboard = ({
  agentType,
  rankBy,
  window,
  arrivalAddress,
  onAgentTypeChange,
  onRankByChange,
  onWindowChange,
}: LeaderboardProps) => {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS);

  // Messages from the hook render inside the theme, so they match the dark page
  const [messageApi, messageHolder] = message.useMessage();
  const {
    pins,
    isLoaded: arePinsLoaded,
    isPinned,
    addPin,
    removePin,
  } = usePinnedAgents({
    onSaveFailed: () => messageApi.warning('Pins cannot be saved in this browser.'),
  });
  const pinnedAddresses = useMemo(
    () => pins.filter((pin) => pin.agentType === agentType).map((pin) => pin.address),
    [pins, agentType],
  );

  const list = useLeaderboard({ agentType, rankBy, window, search });
  const pinned = useLeaderboardAgents({ agentType, window, addresses: pinnedAddresses });

  // Deep link: pin the arriving agent (once), flash its row and greet it by name
  const [flashAddress, setFlashAddress] = useState<string | null>(null);
  const handledArrival = useRef<string | null>(null);
  useEffect(() => {
    if (!arrivalAddress || !arePinsLoaded || handledArrival.current === arrivalAddress) return;
    handledArrival.current = arrivalAddress;
    addPin(arrivalAddress, agentType);
    setFlashAddress(arrivalAddress);
  }, [arrivalAddress, arePinsLoaded, addPin, agentType]);

  const arrivalRecord = pinned.data?.find((record) => record.address === flashAddress);
  useEffect(() => {
    if (!flashAddress || !arrivalRecord) return;
    messageApi.success(
      arrivalRecord.name
        ? `Your agent ${arrivalRecord.name} is pinned to the top`
        : 'Your agent is pinned to the top',
      ARRIVAL_TOAST_SECONDS,
    );
    const timeout = setTimeout(() => setFlashAddress(null), ARRIVAL_FLASH_MS);
    return () => clearTimeout(timeout);
    // Greet once per arrival, not on every refetch of the pinned agents
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashAddress, Boolean(arrivalRecord)]);

  // Pinned rows: ranked ones by rank under the current settings, then the not-ranked ones
  const pinnedRows: PinnedRow[] = useMemo(() => {
    const rows = (pinned.data ?? []).map((record) => ({
      ...toPinnedRow(record, rankBy),
      flash: record.address === flashAddress,
    }));
    return [
      ...rows.filter((row) => row.rank !== null).sort((a, b) => a.rank! - b.rank!),
      ...rows.filter((row) => row.rank === null),
    ];
  }, [pinned.data, rankBy, flashAddress]);

  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.agents) ?? [], [list.data]);
  const firstPage = list.data?.pages[0];

  const onTogglePin = useCallback(
    (address: string) =>
      isPinned(address, agentType) ? removePin(address, agentType) : addPin(address, agentType),
    [isPinned, addPin, removePin, agentType],
  );

  const isUnavailable = list.error instanceof LeaderboardRequestError && list.error.status === 503;
  // The snapshot changed under "Load more": the list is starting over from the first page
  const isRestarting = list.error instanceof LeaderboardRequestError && list.error.status === 409;
  // A failed "Load more" keeps the rows already loaded
  const hasListFailed = list.isError && !list.data && !isRestarting;
  // Covers retries too: until a page arrives the table shows a spinner, not an empty state
  const isListLoading = !list.data && (list.isPending || list.isFetching || isRestarting);

  return (
    <Flex vertical gap={24} className="flex-auto">
      {messageHolder}
      <Title level={2} className="m-0 text-center">
        Leaderboard
      </Title>
      <LeaderboardControls
        agentType={agentType}
        rankBy={rankBy}
        window={window}
        search={searchInput}
        onAgentTypeChange={onAgentTypeChange}
        onRankByChange={onRankByChange}
        onWindowChange={onWindowChange}
        onSearchChange={setSearchInput}
      />
      <LeaderboardCard type="ongoing">
        {hasListFailed ? (
          <Text type="secondary" className="text-center">
            {isUnavailable
              ? 'Leaderboard data is not available yet. Please check back later.'
              : 'Something went wrong while loading the leaderboard. Please try again.'}
          </Text>
        ) : (
          <>
            {firstPage && (
              <Text type="secondary">
                {search
                  ? `${firstPage.totalResults.toLocaleString('en-US')} of ${firstPage.totalRanked.toLocaleString('en-US')} ranked agents match`
                  : `${firstPage.totalRanked.toLocaleString('en-US')} ranked agents`}
              </Text>
            )}
            {pinned.isError && (
              <Text type="danger">Pinned agents could not be loaded. Please try again later.</Text>
            )}
            <LeaderboardTable
              rows={rows}
              pinnedRows={pinnedRows}
              isLoading={isListLoading}
              search={search}
              onClearSearch={() => setSearchInput('')}
              hasMore={!!list.hasNextPage}
              isLoadingMore={list.isFetchingNextPage}
              hasLoadMoreFailed={list.isFetchNextPageError}
              onLoadMore={() => list.fetchNextPage()}
              agentType={agentType}
              rankBy={rankBy}
              isPinned={(address) => isPinned(address, agentType)}
              onTogglePin={onTogglePin}
            />
          </>
        )}
      </LeaderboardCard>
    </Flex>
  );
};
