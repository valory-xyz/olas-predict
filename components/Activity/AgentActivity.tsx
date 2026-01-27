import { useQuery } from '@tanstack/react-query';
import { Flex, Typography } from 'antd';
import { getUserTrades } from 'graphql/queries';
import {
  FixedProductMarketMaker,
  FpmmTrade,
  FpmmTrade_OrderBy,
  OrderDirection,
  TradeType,
} from 'graphql/types';
import Link from 'next/link';

import { GNOSIS_SCAN_URL, NA } from 'constants/index';
import { getTimeAgo } from 'utils/time';

import { Activity } from './Activity';

const { Text } = Typography;

type AgentActivityProps = {
  agentId: FixedProductMarketMaker['id'];
};

type ActivityItem = {
  id: string;
  question: string;
  questionId: string;
  outcome: string;
  betAmount: string;
  timeAgo: string;
  time: string;
  txHash: string;
};

const getActivityItems = (trades: FpmmTrade[]): ActivityItem[] => {
  return trades.map((item) => {
    const betAmount = parseFloat(item.collateralAmountUSD).toFixed(5);

    const outcomeValue =
      item.fpmm.outcomes && item.outcomeIndex ? item.fpmm.outcomes[item.outcomeIndex] : null;

    return {
      id: item.id,
      question: item.title || NA,
      questionId: item.fpmm.id,
      outcome: outcomeValue || NA,
      betAmount: `$${betAmount}`,
      timeAgo: getTimeAgo(item.creationTimestamp * 1000),
      time: new Date(item.creationTimestamp * 1000).toLocaleString(),
      txHash: item.transactionHash,
    };
  });
};

export const AgentActivity = ({ agentId }: AgentActivityProps) => {
  const { data, isLoading } = useQuery({
    queryKey: ['getUserTrades', agentId],
    queryFn: async () =>
      getUserTrades({
        creator: agentId.toLowerCase(),
        type: TradeType.Buy,
        first: 1000,
        skip: 0,
        orderBy: FpmmTrade_OrderBy.CreationTimestamp,
        orderDirection: OrderDirection.Desc,
      }),
  });

  return (
    <Activity<ActivityItem>
      isLoading={isLoading}
      data={data}
      getActivityItems={getActivityItems}
      timelineItems={(trades) =>
        trades.map((item) => ({
          children: (
            <Flex vertical gap={8} key={item.id}>
              <Text>
                <b>Trader agent</b> placed{' '}
                <a
                  href={`${GNOSIS_SCAN_URL}/tx/${item.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <b>{item.betAmount}</b>
                </a>{' '}
                on <b>{item.outcome}</b>
              </Text>
              <Link href={`/questions/${item.questionId}`}>
                <Text>{item.question}</Text>
              </Link>
              <Text type="secondary" title={item.time}>
                {item.timeAgo}
              </Text>
            </Flex>
          ),
        }))
      }
    />
  );
};
