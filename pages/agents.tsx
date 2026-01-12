import { Card, Flex, Typography } from 'antd';
import { ArrowRight } from 'lucide-react';
import type { GetServerSideProps } from 'next';
import styled from 'styled-components';

import { CreatorAgents } from 'components/CreatorAgents';
import { MechAgents } from 'components/MechAgents';
import { SEO } from 'components/SEO';
import { TraderAgents } from 'components/TraderAgents';
import { SEO_CONFIG } from 'constants/seo';
import { COLOR } from 'constants/theme';
import { useScreen } from 'hooks/useScreen';

const { Title, Paragraph } = Typography;

const StyledCard = styled(Card)`
  border: 1px solid ${COLOR.WHITE_TRANSPARENT_5};
  background: ${COLOR.WHITE_TRANSPARENT_10};
  backdrop-filter: blur(6px);
  .ant-card-body {
    padding: 20px 32px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
`;

const RunYourAgentHint = () => (
  <StyledCard>
    <Title level={4} className="m-0">
      Excited to run your own AI agent?
    </Title>
    <Paragraph type="secondary" className="m-0">
      <b>Pearl</b> is an all-in-one application designed to streamline your entry into the world of
      autonomous agents.
    </Paragraph>
    <a target="_blank" className="flex items-center" href=" https://olas.network/operate">
      <b>Run your own agent </b>
      <ArrowRight className="ml-4" size={20} />
    </a>
  </StyledCard>
);

const AgentsPage = () => {
  const { isMobile } = useScreen();
  return (
    <>
      <SEO
        title={SEO_CONFIG.pages.agents.title}
        description={SEO_CONFIG.pages.agents.description}
      />
      <Flex vertical gap={isMobile ? 16 : 40} align="center" className="flex-auto">
        <TraderAgents />
        <RunYourAgentHint />
        <CreatorAgents />
        <MechAgents />
      </Flex>
    </>
  );
};

export default AgentsPage;

// Force SSR so default meta tags are present in the HTML crawlers fetch
export const getServerSideProps: GetServerSideProps = async () => ({
  props: {},
});
