import { InfoCircleOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Flex, Tooltip, Typography } from 'antd';
import { getMechSender, getOpenMarkets, getStakingService } from 'graphql/queries';
import { TraderAgent } from 'graphql/types';
import { useMemo } from 'react';

import { NA } from 'constants/index';
import { getMidnightUtcTimestampDaysAgo } from 'utils/time';

import { useOlasInUsdPrice } from '../../hooks/useOlasInUsdPrice';
import { StatisticCard } from './StatisticCard';

const { Text, Paragraph } = Typography;

const DEFAULT_MECH_FEE = BigInt('10000000000000000'); // 0.01
const QUESTION_DATA_SEPARATOR = '\u241f';
const PREDICT_MARKET_DURATION_DAYS = 4;

type RoiCardProps = {
  agent: TraderAgent;
};

export const RoiCard = ({ agent }: RoiCardProps) => {
  const marketOpenTimestamp = useMemo(
    () => getMidnightUtcTimestampDaysAgo(PREDICT_MARKET_DURATION_DAYS),
    [],
  );

  const { data: mechSender, isLoading: isMechSenderLoading } = useQuery({
    queryKey: ['mechSender', agent.id, marketOpenTimestamp],
    queryFn: async () =>
      getMechSender({ id: agent.id.toLocaleLowerCase(), timestamp_gt: marketOpenTimestamp }),
  });

  const { data: openMarkets, isLoading: isOpenMarketsLoading } = useQuery({
    queryKey: ['openMarkets', marketOpenTimestamp],
    queryFn: async () => getOpenMarkets({ timestamp_gt: marketOpenTimestamp }),
  });

  const { data: stakingService, isLoading: isStakingServiceLoading } = useQuery({
    queryKey: ['stakingService', agent.serviceId],
    queryFn: async () => getStakingService({ id: agent.serviceId.toString() }),
  });

  const { data: olasInUsdPrice } = useOlasInUsdPrice();

  const roi = useMemo(() => {
    if (!mechSender || !mechSender.sender || !openMarkets || !stakingService || !olasInUsdPrice)
      return null;
    const totalMechRequests = mechSender.sender.totalRequests;
    const lastFourDaysRequests = mechSender.sender.requests;
    const openMarketTitles = openMarkets.questions.map((question) => {
      // An example of question: 'Will ... happen by Jul 2, 2025?␟\"Yes\",\"No\"␟weather␟en_US",
      // so to get the title we need to split the question content by separator
      const fields = question.question.split(QUESTION_DATA_SEPARATOR, 4);
      return fields[0];
    });

    // The Mech subgraph calculates totalRequests for all markets.
    // To calculate ROI correctly, we need to subtract the requests
    // made for markets that are still open.
    let requestsToSubtract = 0;
    lastFourDaysRequests.forEach((request) => {
      if (openMarketTitles.find((title) => title === request.questionTitle)) {
        requestsToSubtract += 1;
      }
    });

    const totalCosts =
      BigInt(agent.totalTraded) +
      BigInt(agent.totalFees) +
      BigInt(totalMechRequests - requestsToSubtract) * DEFAULT_MECH_FEE;

    if (totalCosts === BigInt(0)) return null;
    const totalMarketPayout = BigInt(agent.totalPayout);
    const totalOlasRewardsPayoutInUsd =
      (BigInt(stakingService.service?.olasRewardsEarned || BigInt(0)) * olasInUsdPrice) /
      BigInt(1e18);

    const partialRoi = ((totalMarketPayout - totalCosts) * BigInt(100)) / totalCosts;
    const finalRoi =
      ((totalMarketPayout + totalOlasRewardsPayoutInUsd - totalCosts) * BigInt(100)) / totalCosts;

    return { partialRoi, finalRoi };
  }, [
    agent.totalFees,
    agent.totalPayout,
    agent.totalTraded,
    mechSender,
    olasInUsdPrice,
    openMarkets,
    stakingService,
  ]);

  const isLoading = isMechSenderLoading || isOpenMarketsLoading || isStakingServiceLoading;

  return (
    <StatisticCard
      title={
        <Text type="secondary">
          Total ROI
          {!isLoading && roi && (
            <Tooltip
              color="black"
              styles={{ body: { width: 365 } }}
              title={
                <>
                  <Paragraph type="secondary">
                    Total ROI shows your agent&apos;s overall earnings, including profits from
                    predictions and staking rewards, minus all related costs such as trade amounts,
                    gas fees, and Mech request fees.
                  </Paragraph>
                  <Paragraph type="secondary">
                    Partial ROI accounts only for prediction market related activity, excluding
                    staking rewards.
                  </Paragraph>
                  <Flex justify="space-between">
                    <Text>Partial ROI</Text>
                    <Text>{`${roi.partialRoi}%`}</Text>
                  </Flex>
                </>
              }
            >
              <InfoCircleOutlined style={{ marginLeft: 6 }} />
            </Tooltip>
          )}
        </Text>
      }
      value={roi ? `${roi.finalRoi}%` : NA}
      isLoading={isMechSenderLoading || isOpenMarketsLoading || isStakingServiceLoading}
    />
  );
};
