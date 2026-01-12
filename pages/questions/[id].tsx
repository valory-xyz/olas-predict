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

type QuestionPageProps = {
  initialMarket?: FixedProductMarketMaker | null;
  initialError?: boolean;
};

const QuestionPage = ({ initialMarket }: QuestionPageProps) => {
  const router = useRouter();
  const id = router.query.id;

  const { data, isLoading, isFetched, isError } = useQuery({
    enabled: !!id,
    queryKey: ['getMarket', id],
    queryFn: async () => getMarket({ id: `${id}`.toLowerCase() }),
    initialData: initialMarket ? { fixedProductMarketMaker: initialMarket } : undefined,
  });

  const market = data?.fixedProductMarketMaker;
  const seoTitle = market?.title || 'Prediction Market';
  const seoDescription = market ? getMarketDescription(market.title, market.outcomes) : undefined;

  if (isLoading && !initialMarket)
    return (
      <>
        <SEO title="Loading..." />
        <Flex vertical>
          <LoaderCard />
        </Flex>
      </>
    );

  if (isError && !initialMarket)
    return (
      <>
        <SEO title="Error" noIndex />
        <LoadingError />
      </>
    );

  if (isFetched) {
    if (!market)
      return (
        <>
          <SEO title="Market Not Found" noIndex />
          <QuestionNotFoundError />
        </>
      );
    if (isMarketInvalid(market) || isMarketBroken(market))
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
          <QuestionDetailsCard market={market} />
          <Probability marketId={market.id} outcomes={market.outcomes} />
          <MarketActivity marketId={market.id} />
        </Flex>
      </>
    );
  }
  return null;
};

export default QuestionPage;

export const getServerSideProps: GetServerSideProps<QuestionPageProps> = async (context) => {
  const { id } = context.params || {};
  if (!id || typeof id !== 'string') {
    return { props: { initialMarket: null, initialError: true } };
  }
  try {
    const data = await getMarket({ id: id.toLowerCase() });
    const market = data?.fixedProductMarketMaker;
    if (!market) {
      return { props: { initialMarket: null } };
    }
    return { props: { initialMarket: market } };
  } catch {
    return { props: { initialMarket: null, initialError: true } };
  }
};
