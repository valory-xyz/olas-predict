import Head from 'next/head';
import { useRouter } from 'next/router';

import { SEO_CONFIG } from 'constants/seo';

interface SEOProps {
  title?: string;
  description?: string;
  ogImage?: string;
  ogType?: string;
  noIndex?: boolean;
  canonical?: string;
}

export const SEO = ({
  title,
  description = SEO_CONFIG.description,
  ogImage = SEO_CONFIG.ogImage,
  ogType = SEO_CONFIG.ogType,
  noIndex = false,
  canonical,
}: SEOProps) => {
  const router = useRouter();

  // Generate full title
  const fullTitle = title
    ? SEO_CONFIG.titleTemplate.replace('%s', title)
    : SEO_CONFIG.defaultTitle;

  // Generate canonical URL (remove query params for clean URLs)
  const pathWithoutQuery = router.asPath.split('?')[0];
  const canonicalUrl = canonical || `${SEO_CONFIG.baseUrl}${pathWithoutQuery}`;

  // Generate full OG image URL
  const fullOgImage = ogImage.startsWith('http') ? ogImage : `${SEO_CONFIG.baseUrl}${ogImage}`;

  return (
    <Head>
      {/* Primary Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="title" content={fullTitle} />
      <meta name="description" content={description} />

      {/* Canonical URL */}
      <link rel="canonical" href={canonicalUrl} />

      {/* Robots */}
      {noIndex && <meta name="robots" content="noindex,nofollow" />}

      {/* Open Graph / Facebook */}
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={fullOgImage} />
      <meta property="og:site_name" content={SEO_CONFIG.defaultTitle} />

      {/* Twitter */}
      <meta property="twitter:card" content={SEO_CONFIG.twitterCard} />
      <meta property="twitter:url" content={canonicalUrl} />
      <meta property="twitter:title" content={fullTitle} />
      <meta property="twitter:description" content={description} />
      <meta property="twitter:image" content={fullOgImage} />
      <meta property="twitter:site" content={SEO_CONFIG.twitterSite} />
    </Head>
  );
};
