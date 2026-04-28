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
  // past 60s. The Linux CI baseline on Next 15 is ~5-6s per page (well
  // within the default), so this knob primarily helps local Windows
  // runs and provides headroom on cold-cache CI runs. Revisit if a
  // future bump to this number is being considered to mask a real perf
  // regression in `_app` import cost rather than worker startup.
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
