/**
 * @type {import('next').NextConfig}
 */
import { withPlausibleProxy } from 'next-plausible';

export default withPlausibleProxy()({
  reactStrictMode: true,
  // Next 14 collects per-page module data via worker subprocesses with a
  // default 60s timeout. On Windows the worker startup overhead plus the
  // wagmi/walletconnect import tree can push `_app` past that limit. Linux
  // CI is faster but the higher ceiling costs nothing.
  staticPageGenerationTimeout: 300,
  compiler: {
    styledComponents: true,
  },
  webpack(config) {
    // eslint-disable-next-line no-param-reassign
    config.resolve.fallback = {
      fs: false,
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none';",
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
  redirects() {
    return [
      {
        source: '/',
        destination: '/questions?state=opened',
        permanent: false,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ipfs.io',
        port: '',
        pathname: '/ipfs/**',
      },
    ],
  },
});
