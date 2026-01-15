import { useQuery } from '@tanstack/react-query';
import { Flex, Skeleton, Typography } from 'antd';
import { ArrowUpRight } from 'lucide-react';
import styled from 'styled-components';

import { NA, OLAS_GNOSIS_REGISTRY_QUERY_URL } from 'constants/index';
import { COLOR, MEDIA_QUERY } from 'constants/theme';
import { fetchPredictDaa7dAvg } from 'utils/registry';

const Root = styled(Flex)`
  width: 100%;
  border-radius: 12px;
  background: ${COLOR.BLACK_TRANSPARENT_30};
  backdrop-filter: blur(3px);
  will-change: backdrop-filter;
  padding: 16px 32px;

  ${MEDIA_QUERY.laptop} {
    padding: 16px 24px;
  }

  a,
  .ant-skeleton-element {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }
`;

const { Text } = Typography;

export const LiveAgentsBanner = () => {
  const { data: liveAgents, isLoading: isLiveAgentsLoading } = useQuery({
    queryKey: ['getLiveAgents'],
    staleTime: Infinity,
    queryFn: async () => {
      const result = await fetchPredictDaa7dAvg();
      return result.status === 'success' ? result.value : null;
    },
  });

  return (
    <Root align="center" wrap gap={4}>
      <Text italic>AI agents predict the future</Text>
      {isLiveAgentsLoading ? (
        <Skeleton.Input size="small" />
      ) : (
        <a target="_blank" href={OLAS_GNOSIS_REGISTRY_QUERY_URL}>
          {liveAgents || NA} live agents <ArrowUpRight size={16} />
        </a>
      )}
    </Root>
  );
};
