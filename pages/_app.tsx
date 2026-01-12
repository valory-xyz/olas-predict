import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import App, { type AppContext, type AppProps } from 'next/app';
import { WagmiProvider } from 'wagmi';

import ErrorBoundary from 'components/ErrorBoundary';
import { Layout } from 'components/Layout';
import { SEO } from 'components/SEO';
import { AutonolasThemeProvider } from 'components/Theme';
import { GlobalStyle } from 'components/Theme/GlobalStyle';
import { wagmiConfig } from 'constants/wagmiConfig';

const queryClient = new QueryClient();

const PredictApp = ({ Component, pageProps }: AppProps) => (
  <>
    <GlobalStyle />
    <SEO />

    <AutonolasThemeProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <Layout>
            <ErrorBoundary>
              <Component {...pageProps} />
            </ErrorBoundary>
          </Layout>
          <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
        </QueryClientProvider>
      </WagmiProvider>
    </AutonolasThemeProvider>
  </>
);

export default PredictApp;

// Force SSR globally so pages render head/meta tags server-side
PredictApp.getInitialProps = async (appContext: AppContext) => {
  const appProps = await App.getInitialProps(appContext);
  return { ...appProps };
};
