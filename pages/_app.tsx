import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import PlausibleProvider from 'next-plausible';
import { type AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { useEffect, useRef } from 'react';

import ErrorBoundary from 'components/ErrorBoundary';
import { Layout } from 'components/Layout';
import { SEO } from 'components/SEO';
import { AutonolasThemeProvider } from 'components/Theme';
import { GlobalStyle } from 'components/Theme/GlobalStyle';
import { OLAS_PREDICT_DOMAIN } from 'constants/index';
import { createPageviewTracker } from 'utils/analytics';

const queryClient = new QueryClient();

type PlausibleFunction = (
  event: string,
  options?: { url?: string; props?: Record<string, unknown> },
) => void;

type WindowWithPlausible = Window & {
  plausible?: PlausibleFunction;
};

/**
 * Tracks pageviews with normalized paths (see `createPageviewTracker`): the first one once the
 * router is ready, then one per route change, except shallow ones that keep the path
 */
const PageViewTracker = () => {
  const router = useRouter();
  const { isReady, events } = router;
  const asPathRef = useRef(router.asPath);
  asPathRef.current = router.asPath;

  useEffect(() => {
    if (!isReady) return;

    const track = createPageviewTracker((url) =>
      (window as WindowWithPlausible).plausible?.('pageview', { url }),
    );
    track(asPathRef.current);

    const handleRouteChange = (url: string, { shallow }: { shallow: boolean }) =>
      track(url, { shallow });
    events.on('routeChangeComplete', handleRouteChange);

    return () => {
      events.off('routeChangeComplete', handleRouteChange);
    };
  }, [isReady, events]);

  return null;
};

const PredictApp = ({ Component, pageProps }: AppProps) => {
  const router = useRouter();

  const isAchievementPage = router.pathname.includes('/achievement');

  // Extract SEO config from pageProps, with defaults
  const seoConfig = pageProps.seoConfig || {};

  const content = (
    <ErrorBoundary>
      <Component {...pageProps} />
    </ErrorBoundary>
  );

  return (
    <PlausibleProvider domain={OLAS_PREDICT_DOMAIN} manualPageviews trackOutboundLinks taggedEvents>
      <GlobalStyle />
      <SEO {...seoConfig} />
      <PageViewTracker />

      <AutonolasThemeProvider>
        <QueryClientProvider client={queryClient}>
          {isAchievementPage ? content : <Layout>{content}</Layout>}
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
        </QueryClientProvider>
      </AutonolasThemeProvider>
    </PlausibleProvider>
  );
};

export default PredictApp;
