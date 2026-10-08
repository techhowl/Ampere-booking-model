import type { Metadata, Viewport } from 'next';
import { DM_Sans } from 'next/font/google';
import './globals.css';

/**
 * DM Sans — a geometric sans close in feel to the Hoves family the Figma uses,
 * and available free. Loaded through next/font, which self-hosts it at build
 * time: no request to Google at runtime, no layout shift when it swaps in.
 *
 * When Ampere's licensed brand font arrives, replace this import and point
 * --font-sans at it. Nothing else needs to change.
 */
const sans = DM_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-dm-sans',
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  title: 'Buy an Ampere Scooter',
  description: 'Book a test ride or buy your Ampere electric scooter.',
  // Paid-traffic landing page on a subdomain. Keep it out of the index until
  // the marketing site routes /buy here.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#040910',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" className={sans.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
