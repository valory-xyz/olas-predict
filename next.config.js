/**
 * @type {import('next').NextConfig}
 */
import { withPlausibleProxy } from 'next-plausible';

export default withPlausibleProxy()({
  reactStrictMode: true,
  // Next 14+ collects per-page module data in worker subprocesses. The
  // default 60s timeout was insufficient on Windows during the Next 14
  // migration spike — cold local builds saw 26-28s per page and the
  // first-startup `_app` import via the wagmi/walletconnect tree pushed
  // past 60s. wagmi has since been dropped (the app went viem-only —
  // see `constants/viemConfig.ts` and SUPPLY-CHAIN-SECURITY.md §5a), so
  // the original `_app` cost is gone. The Linux CI baseline on Next 15
  // is ~5-6s per page (well within the default), so this knob now
  // mostly provides headroom for cold-cache CI runs. Could probably
  // be lowered to the default; left at 300 for now since it's harmless.
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
