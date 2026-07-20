import { useQuery } from '@tanstack/react-query';
import { Flex, Tag, Typography } from 'antd';
import { getAgentLastTradeTimestamp } from 'graphql/queries';
import { TraderAgent } from 'graphql/types';
import { ChartSpline } from 'lucide-react';
import Jazzicon, { jsNumberForAddress } from 'react-jazzicon';

import { Card } from 'components/shared/styles';
import { COLOR } from 'constants/theme';
import { useScreen } from 'hooks/useScreen';
import { generateName } from 'utils/agents';
import { getTimeAgo } from 'utils/time';

const { Title, Text } = Typography;

type AgentDetailsCardProps = {
  agent: TraderAgent;
};

export const AgentDetailsCard = ({ agent }: AgentDetailsCardProps) => {
  const { isMobile } = useScreen();

  const { data: lastActivityTimestamp } = useQuery({
    queryKey: ['getAgentLastTradeTimestamp', agent.id],
    queryFn: async () => getAgentLastTradeTimestamp({ creator: `${agent.id}`.toLowerCase() }),
    select: (data) => data.fpmmTrades[0]?.creationTimestamp,
  });

  return (
    <Card type="ongoing">
      <Flex gap={24}>
        <Jazzicon
          diameter={isMobile ? 48 : 128}
          seed={jsNumberForAddress(agent.id)}
          paperStyles={{ borderRadius: '50%' }}
        />
        <Flex vertical gap={8}>
          <Title level={4} className="m-0 mb-8">
            {generateName(agent.id)}
          </Title>
          <Text type="secondary">Specialization</Text>
          <Flex>
            <Tag icon={<ChartSpline size={20} color={COLOR.PRIMARY} />}>Trader</Tag>
          </Flex>
        </Flex>
        <Text type="secondary" className="ml-auto">
          {lastActivityTimestamp && `Last active ${getTimeAgo(lastActivityTimestamp * 1000)}`}
        </Text>
      </Flex>
    </Card>
  );
};
