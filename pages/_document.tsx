import Document, {
  DocumentContext,
  DocumentInitialProps,
  Head,
  Html,
  Main,
  NextScript,
} from 'next/document';

import { SEO } from 'components/SEO';
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
          x
          <SEO canonical={canonicalUrl} />
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
