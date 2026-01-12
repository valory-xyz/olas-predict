import Document, {
  DocumentContext,
  DocumentInitialProps,
  Head,
  Html,
  Main,
  NextScript,
} from 'next/document';

import { SEO_CONFIG } from 'constants/seo';

type CustomDocumentProps = DocumentInitialProps & {
  canonicalUrl: string;
};

export default class CustomDocument extends Document<CustomDocumentProps> {
  static async getInitialProps(ctx: DocumentContext): Promise<CustomDocumentProps> {
    const initialProps = await Document.getInitialProps(ctx);
    const path = (ctx.asPath || '').split('?')[0] || '/';
    const canonicalUrl = `${SEO_CONFIG.baseUrl}${path}`;
    return { ...initialProps, canonicalUrl };
  }

  render() {
    const canonicalUrl = this.props.canonicalUrl || SEO_CONFIG.baseUrl;
    const fullOgImage = `${SEO_CONFIG.baseUrl}${SEO_CONFIG.ogImage}`;
    return (
      <Html lang="en">
        <Head>
          {/* Character encoding and viewport */}
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />

          {/* Theme color */}
          <meta name="theme-color" content="#000000" />

          {/* Favicon */}
          <link rel="icon" href="/favicon.ico" />

          {/* Canonical (dynamic fallback) */}
          <link rel="canonical" href={canonicalUrl} />

          {/* Basic description (fallback) */}
          <meta name="title" content={SEO_CONFIG.defaultTitle} />
          <meta name="description" content={SEO_CONFIG.description} />

          {/* Open Graph (fallback for crawlers that don't run JS) */}
          <meta property="og:type" content={SEO_CONFIG.ogType} />
          <meta property="og:site_name" content={SEO_CONFIG.defaultTitle} />
          <meta property="og:title" content={SEO_CONFIG.defaultTitle} />
          <meta property="og:description" content={SEO_CONFIG.description} />
          <meta property="og:url" content={canonicalUrl} />
          <meta property="og:image" content={fullOgImage} />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="600" />

          {/* Twitter (fallback) */}
          <meta name="twitter:card" content={SEO_CONFIG.twitterCard} />
          <meta name="twitter:site" content={SEO_CONFIG.twitterSite} />
          <meta name="twitter:title" content={SEO_CONFIG.defaultTitle} />
          <meta name="twitter:description" content={SEO_CONFIG.description} />
          <meta name="twitter:image" content={fullOgImage} />

          {/* Fonts */}
          <link
            href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
            rel="stylesheet"
          />
          <link
            href="https://fonts.googleapis.com/css2?family=Anonymous+Pro:wght@400&display=swap"
            rel="stylesheet"
          />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
