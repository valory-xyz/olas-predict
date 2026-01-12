import { useQuery } from '@tanstack/react-query';
import { Flex } from 'antd';
import { getMarket } from 'graphql/queries';
import { FixedProductMarketMaker } from 'graphql/types';
import type { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';

import { MarketActivity } from 'components/Activity/MarketActivity';
import { LoadingError, QuestionNotFoundError } from 'components/ErrorState';
import { Probability } from 'components/Probability/Probability';
import { QuestionDetailsCard } from 'components/QuestionDetailsCard';
import { LoaderCard } from 'components/QuestionDetailsCard/LoaderCard';
import { SEO } from 'components/SEO';
import { BROKEN_MARKETS, INVALID_ANSWER_HEX } from 'constants/index';
import { getMarketDescription } from 'constants/seo';

const isMarketBroken = (market: FixedProductMarketMaker) =>
  BROKEN_MARKETS.indexOf(market.id) !== -1;

const isMarketInvalid = (market: FixedProductMarketMaker) =>
  market.currentAnswer === INVALID_ANSWER_HEX;

const QuestionPage = () => {
  const router = useRouter();
  const id = router.query.id;

  const { data, isLoading, isFetched, isError } = useQuery({
    enabled: !!id,
    queryKey: ['getMarket', id],
    queryFn: async () => getMarket({ id: `${id}`.toLowerCase() }),
    select: (data) => data.fixedProductMarketMaker,
  });

  const seoTitle = data?.title || 'Prediction Market';
  const seoDescription = data ? getMarketDescription(data.title, data.outcomes) : undefined;

  if (isLoading)
    return (
      <>
        <SEO title="Loading..." />
        <Flex vertical>
          <LoaderCard />
        </Flex>
      </>
    );

  if (isError)
    return (
      <>
        <SEO title="Error" noIndex />
        <LoadingError />
      </>
    );

  if (isFetched) {
    if (!data)
      return (
        <>
          <SEO title="Market Not Found" noIndex />
          <QuestionNotFoundError />
        </>
      );
    if (isMarketInvalid(data) || isMarketBroken(data))
      return (
        <>
          <SEO title="Market Not Found" noIndex />
          <QuestionNotFoundError />
        </>
      );

    return (
      <>
        <SEO title={seoTitle} description={seoDescription} />
        <Flex vertical gap={40} align="center" className="flex-auto">
          <QuestionDetailsCard market={data} />
          <Probability marketId={data.id} outcomes={data.outcomes} />
          <MarketActivity marketId={data.id} />
        </Flex>
      </>
    );
  }
  return null;
};

export default QuestionPage;

// Force SSR so OG/Twitter tags render in the initial HTML for crawlers
export const getServerSideProps: GetServerSideProps = async () => ({
  props: {},
});
