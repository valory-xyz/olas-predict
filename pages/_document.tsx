import { Head, Html, Main, NextScript } from 'next/document';

import { SEO_CONFIG } from 'constants/seo';

export default function Document() {
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

        {/* Canonical (fallback) */}
        <link rel="canonical" href={SEO_CONFIG.baseUrl} />

        {/* Basic description (fallback) */}
        <meta name="title" content={SEO_CONFIG.defaultTitle} />
        <meta name="description" content={SEO_CONFIG.description} />

        {/* Open Graph (fallback for crawlers that don't run JS) */}
        <meta property="og:type" content={SEO_CONFIG.ogType} />
        <meta property="og:site_name" content={SEO_CONFIG.defaultTitle} />
        <meta property="og:title" content={SEO_CONFIG.defaultTitle} />
        <meta property="og:description" content={SEO_CONFIG.description} />
        <meta property="og:url" content={SEO_CONFIG.baseUrl} />
        <meta property="og:image" content={`${SEO_CONFIG.baseUrl}${SEO_CONFIG.ogImage}`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="600" />

        {/* Twitter (fallback) */}
        <meta name="twitter:card" content={SEO_CONFIG.twitterCard} />
        <meta name="twitter:site" content={SEO_CONFIG.twitterSite} />
        <meta name="twitter:title" content={SEO_CONFIG.defaultTitle} />
        <meta name="twitter:description" content={SEO_CONFIG.description} />
        <meta name="twitter:image" content={`${SEO_CONFIG.baseUrl}${SEO_CONFIG.ogImage}`} />

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
