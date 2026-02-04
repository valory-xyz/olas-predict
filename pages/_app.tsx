import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import PlausibleProvider from 'next-plausible';
import { type AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { WagmiProvider } from 'wagmi';

import ErrorBoundary from 'components/ErrorBoundary';
import { Layout } from 'components/Layout';
import { SEO } from 'components/SEO';
import { AutonolasThemeProvider } from 'components/Theme';
import { GlobalStyle } from 'components/Theme/GlobalStyle';
import { wagmiConfig } from 'constants/wagmiConfig';

const queryClient = new QueryClient();

type PlausibleFunction = (
  event: string,
  options?: { url?: string; props?: Record<string, unknown> },
) => void;

type WindowWithPlausible = Window & {
  plausible?: PlausibleFunction;
};

/**
 * Normalizes dynamic routes for Plausible tracking
 * - /questions/{id} -> /questions/[id]
 * - /agents/{id} -> /agents/[id]
 * - Other routes remain unchanged
 */
const normalizePath = (pathname: string): string =>
  pathname
    .replace(/^\/questions\/[^/]+/, '/questions/[id]')
    .replace(/^\/agents\/[^/]+/, '/agents/[id]');

/**
 * Component that tracks pageviews with normalized paths
 */
const PageViewTracker = () => {
  const router = useRouter();

  useEffect(() => {
    const handleRouteChange = (url: string) => {
      const pathname = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0];

      const normalizedPath = normalizePath(pathname);

      const windowWithPlausible = window as WindowWithPlausible;
      if (windowWithPlausible.plausible) {
        windowWithPlausible.plausible('pageview', { url: normalizedPath });
      }
    };

    // Track initial pageview when router is ready
    if (router.isReady) {
      handleRouteChange(router.asPath);
    }

    // Track route changes
    router.events.on('routeChangeComplete', handleRouteChange);

    return () => {
      router.events.off('routeChangeComplete', handleRouteChange);
    };
  }, [router]);

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
    <PlausibleProvider
      domain="predict.olas.network"
      manualPageviews
      trackOutboundLinks
      taggedEvents
    >
      <GlobalStyle />
      <SEO {...seoConfig} />
      <PageViewTracker />

      <AutonolasThemeProvider>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            {isAchievementPage ? content : <Layout>{content}</Layout>}
            <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
          </QueryClientProvider>
        </WagmiProvider>
      </AutonolasThemeProvider>
    </PlausibleProvider>
  );
};

export default PredictApp;
