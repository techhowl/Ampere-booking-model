import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The page is served at ampere-electric.com/buy via the marketing site's
  // proxy, but hosted on buy.ampere-electric.com. Keep asset paths absolute.
  poweredByHeader: false,
  /*
   * Emits .next/standalone — a self-contained server with only the node_modules
   * it actually imports. The droplet image is then a few hundred MB instead of
   * carrying a full pnpm store, and the runtime stage needs no package manager
   * at all.
   */
  // Vercel (the UAT copy) builds its own way; VERCEL is set during its build.
  output: process.env.VERCEL ? undefined : 'standalone',
};

export default nextConfig;
