import { Row, Typography } from 'antd';
import { TraderAgent } from 'graphql/types';

import { Card } from 'components/shared/styles';
import { getTimeAgo } from 'utils/time';

import { RoiCard } from './RoiCard';
import { StatisticCard } from './StatisticCard';
import { SuccessRateCard } from './SuccessRateCard';

const { Title } = Typography;

type AgentStatisticsProps = {
  agent: TraderAgent;
};

export const AgentStatistics = ({ agent }: AgentStatisticsProps) => {
  return (
    <Card type="ongoing">
      <Title level={4} className="m-0">
        Agent statistics
      </Title>
      <Row>
        <StatisticCard title="Trades made" value={agent.totalBets.toLocaleString()} />
        <SuccessRateCard agent={agent} />
      </Row>
      <Row>
        {/* <StatisticCard title="Total earnings" value="TBD" /> */}
        <StatisticCard title="Created" value={getTimeAgo(Number(agent.blockTimestamp) * 1000)} />
        <RoiCard agent={agent} />
      </Row>
    </Card>
  );
};
