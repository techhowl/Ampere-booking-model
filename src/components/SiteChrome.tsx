import { AmpereLogo } from './Brand';

/**
 * Header and footer, following the Figma frames.
 *
 * Header: near-black, logo centred, nav split either side. Footer: the Greaves
 * Electric Mobility block with brand, range and contact columns.
 *
 * ASSET SLOT: `AmpereLogo` draws a stand-in wordmark. Replace its body with
 * Ampere's real mark and both pick it up.
 */

const NAV_LEFT = [
  { label: 'E-Scooters', href: 'https://ampere-electric.com/' },
  { label: 'Ampere Care', href: 'https://ampere-electric.com/ampere-care' },
  { label: 'Dealership', href: 'https://ampere-electric.com/dealer-locator' },
];

const NAV_RIGHT = [
  { label: 'Rider Resources', href: 'https://ampere-electric.com/' },
  { label: 'About Us', href: 'https://ampere-electric.com/about-us' },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 bg-amp-ink">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-5 lg:h-16">
        <nav className="hidden flex-1 items-center gap-7 lg:flex">
          {NAV_LEFT.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="text-[14px] text-white/85 transition-colors hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <a href="https://ampere-electric.com/" className="text-white lg:flex-none">
          <AmpereLogo />
          <span className="sr-only">Ampere Electric home</span>
        </a>

        <nav className="hidden flex-1 items-center justify-end gap-7 lg:flex">
          {NAV_RIGHT.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="text-[14px] text-white/85 transition-colors hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Mobile: the design shows a hamburger. It links out rather than
            opening a menu, because every link here leaves the journey. */}
        <a
          href="https://ampere-electric.com/"
          aria-label="Ampere Electric"
          className="text-white lg:hidden"
        >
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
          </svg>
        </a>
      </div>
    </header>
  );
}

const FOOTER_COLUMNS = [
  {
    title: 'Our Brands',
    links: [
      { label: 'Greaves Electric Mobility', href: 'https://greaveselectricmobility.com/' },
      { label: 'Ampere', href: 'https://ampere-electric.com/' },
      { label: '3 Wheeler', href: 'https://greaveselectricmobility.com/' },
      { label: 'ELE', href: 'https://greaveselectricmobility.com/' },
    ],
  },
  {
    title: 'E-scooter Range',
    links: [
      { label: 'Nexus', href: 'https://ampere-electric.com/nexus-ex-plus' },
      { label: 'Magnus G-Max', href: 'https://ampere-electric.com/gmax' },
      { label: 'Magnus Grand', href: 'https://ampere-electric.com/' },
      { label: 'Magnus Neo', href: 'https://ampere-electric.com/magnus-neo' },
      { label: 'Reo 80', href: 'https://ampere-electric.com/' },
      { label: 'Reo VYB', href: 'https://ampere-electric.com/reovyb' },
    ],
  },
  {
    title: 'More',
    links: [
      { label: 'Dealer Locator', href: 'https://ampere-electric.com/dealer-locator' },
      { label: 'Become a Dealer', href: 'https://ampere-electric.com/' },
      { label: 'Contact', href: 'https://ampere-electric.com/contact-us' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-amp-ink text-white">
      <div className="mx-auto max-w-7xl px-5 py-12">
        <p className="text-[20px] font-bold uppercase leading-[1.05] tracking-tight">
          Greaves
          <br />
          Electric
          <br />
          Mobility
        </p>

        <div className="mt-10 grid gap-10 sm:grid-cols-3">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="text-[13px] text-white/50">{column.title}</p>
              <ul className="mt-4 flex flex-col gap-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="group inline-flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-white/90 transition-colors hover:text-white"
                    >
                      {link.label}
                      <span aria-hidden className="text-white/40 transition-colors group-hover:text-white">
                        ↗
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <a
            href="https://ampere-electric.com/contact-us"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/20 px-5 text-[13px] font-semibold uppercase tracking-wide transition-colors hover:bg-white/10"
          >
            Write to us
          </a>
          <a
            href="tel:+918069809980"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/20 px-5 text-[13px] font-semibold uppercase tracking-wide transition-colors hover:bg-white/10"
          >
            Speak to customer service
          </a>
        </div>

        <p className="mt-10 border-t border-white/10 pt-6 text-[12px] leading-relaxed text-white/40">
          © {new Date().getFullYear()} Greaves Electric Mobility. Prices shown are
          ex-showroom and vary by state.
        </p>
      </div>
    </footer>
  );
}
