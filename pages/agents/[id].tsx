import { useQuery } from '@tanstack/react-query';
import { Flex } from 'antd';
import { getTraderAgent } from 'graphql/queries';
import { useRouter } from 'next/router';

import { AgentActivity } from 'components/Activity/AgentActivity';
import { AgentDetailsCard } from 'components/AgentDetailsCard';
import { LoaderCard } from 'components/AgentDetailsCard/LoaderCard';
import { AgentStatistics } from 'components/AgentStatistics';
import { AgentNotFoundError, LoadingError } from 'components/ErrorState';
import { SEO } from 'components/SEO';
import { getAgentDescription } from 'constants/seo';
import { generateName } from 'utils/agents';

const AgentPage = () => {
  const router = useRouter();
  const id = Array.isArray(router.query.id) ? router.query.id[0] : router.query.id;
  const { data, isLoading, isFetched, isError } = useQuery({
    enabled: !!id,
    queryKey: ['getAgent', id],
    queryFn: async () => getTraderAgent({ id: `${id}`.toLowerCase() }),
    select: (data) => data.traderAgent,
  });

  if (isLoading) {
    return (
      <>
        <SEO title="Loading Agent..." />
        <Flex vertical>
          <LoaderCard />
        </Flex>
      </>
    );
  }

  if (isError) {
    return (
      <>
        <SEO title="Error" noIndex />
        <LoadingError />
      </>
    );
  }

  if (isFetched) {
    if (!data) {
      return (
        <>
          <SEO title="Agent Not Found" noIndex />
          <AgentNotFoundError />
        </>
      );
    }

    const seoTitle = id ? `Agent ${generateName(id)}` : 'AI Agent';
    const seoDescription = data ? getAgentDescription(data.id) : undefined;

    return (
      <>
        <SEO title={seoTitle} description={seoDescription} />
        <Flex vertical gap={40} align="center" className="flex-auto">
          <AgentDetailsCard agent={data} />
          <AgentStatistics agent={data} />
          <AgentActivity agentId={data.id} />
        </Flex>
      </>
    );
  }
  return null;
};

export default AgentPage;
