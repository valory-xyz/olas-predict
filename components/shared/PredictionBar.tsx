import { Flex, Skeleton, Typography } from 'antd';
import { FixedProductMarketMaker } from 'graphql/types';
import { AnswerType } from 'types';

import { NA } from 'constants/index';
import { useAgentsBets } from 'hooks/useAgentsBets';
import { convertToPercentage } from 'utils/questions';

import { LeftLine, OutcomesValues, ProgressBarContainer, RightLine } from './styles';

const { Text } = Typography;

const CAPTIONS_BY_TYPE = {
  ongoing: 'According to AI agents the likelihoods are:',
  predicted_right: 'Most agents got it right!',
  predicted_wrong: 'Most agents got it wrong.',
};

type PredictionBarProps = {
  marketId: FixedProductMarketMaker['id'];
  type: AnswerType;
  outcomeTokenMarginalPrices: FixedProductMarketMaker['outcomeTokenMarginalPrices'];
  outcomes: FixedProductMarketMaker['outcomes'];
};

type ProgressBarProps = {
  leftPercentage: number;
  hasOutcomePercentages: boolean;
  type: AnswerType;
  outcomes: FixedProductMarketMaker['outcomes'];
};

const ELLIPSIS_TEXT_STYLE = { maxWidth: '30%' };

const ProgressBar = ({
  leftPercentage,
  type,
  outcomes,
  hasOutcomePercentages,
}: ProgressBarProps) => {
  const rightPercentage = (100 - leftPercentage).toFixed(2);

  return (
    <ProgressBarContainer>
      <RightLine>
        <LeftLine width={leftPercentage} type={type} />
      </RightLine>
      <OutcomesValues type={type}>
        <Text ellipsis style={ELLIPSIS_TEXT_STYLE}>
          {outcomes?.[0] || ''} {hasOutcomePercentages ? leftPercentage : NA}%
        </Text>
        <Text ellipsis style={ELLIPSIS_TEXT_STYLE}>
          {outcomes?.[1] || ''} {hasOutcomePercentages ? rightPercentage : NA}%
        </Text>
      </OutcomesValues>
    </ProgressBarContainer>
  );
};

const getAgentsBetsText = (agentsNum: number, totalBets: string) =>
  `${agentsNum} AI agent${agentsNum == 1 ? '' : 's'} traded $${totalBets}`;

const AgentsBets = ({ marketId }: { marketId: FixedProductMarketMaker['id'] }) => {
  const { data, isLoading } = useAgentsBets(marketId);

  if (isLoading)
    return (
      <Flex justify="space-between">
        <Skeleton.Input active size="small" />
        <Skeleton.Input active size="small" />
      </Flex>
    );

  if (!data) return null;

  return (
    <Flex justify="space-between">
      {Object.values(data).map(({ agents, totalBets }, index) => (
        <Text type="secondary" key={index} className={index === 0 ? 'text-start' : 'text-end'}>
          {getAgentsBetsText(agents.length, totalBets.toFixed(2))}
        </Text>
      ))}
    </Flex>
  );
};

export const PredictionBar = ({
  marketId,
  type,
  outcomeTokenMarginalPrices,
  outcomes,
}: PredictionBarProps) => {
  let leftPercentage;
  if (outcomeTokenMarginalPrices?.[0]) {
    leftPercentage = convertToPercentage(outcomeTokenMarginalPrices[0]);
  }

  return (
    <Flex vertical gap={14}>
      <Text type="secondary">{CAPTIONS_BY_TYPE[type]}</Text>
      <ProgressBar
        leftPercentage={leftPercentage || 50}
        hasOutcomePercentages={typeof leftPercentage === 'number'}
        type={type}
        outcomes={outcomes}
      />
      <AgentsBets marketId={marketId} />
    </Flex>
  );
};
