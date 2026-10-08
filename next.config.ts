import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The page is served at ampere-electric.com/buy via the marketing site's
  // proxy, but hosted on buy.ampere-electric.com. Keep asset paths absolute.
  poweredByHeader: false,
};

export default nextConfig;
