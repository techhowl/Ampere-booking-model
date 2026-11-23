import type { NextConfig } from 'next';

/*
 * Content-Security-Policy, in REPORT-ONLY mode for now (security audit V-09).
 *
 * Report-only cannot break the page: the browser logs what it would have
 * blocked and blocks nothing. Watch the console on UAT through a full journey
 * (and once Turnstile and Juspay are live), then rename the header to
 * Content-Security-Policy to enforce it.
 *
 * 'unsafe-inline' scripts: the App Router inlines its bootstrap scripts, and
 * nonces would need middleware on every request. Turnstile is listed ahead of
 * its keys arriving. 'unsafe-eval' only in `next dev`, which needs it.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  'frame-src https://challenges.cloudflare.com',
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

/**
 * Headers every deployment gets, not only the droplet behind Caddy. Before,
 * UAT on Vercel served none of them. Caddy sets the same values in production
 * and its `header` directive replaces rather than duplicates them. HSTS stays
 * with Caddy and Vercel, which own TLS.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self)' },
  { key: 'Content-Security-Policy-Report-Only', value: csp },
];

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
  /*
   * Nothing here uses next/image (product photos are pre-sized WebP), so the
   * optimiser endpoint /_next/image does nothing for us. Unoptimised, it is
   * not served at all, which takes it out of reach of image-decoding bugs such
   * as GHSA-2464-fhr4-w9xw (security audit V-12).
   */
  images: { unoptimized: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
