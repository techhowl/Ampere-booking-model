import { describe, expect, it } from 'vitest';
import { goalAppHref } from './goal-app';

const BASE = 'https://enquiry.ampere-electric.com/testride';

describe('the Goal App hand-off link', () => {
  it('is the configured address when the visit carried no campaign', () => {
    expect(goalAppHref(BASE, null)).toBe(BASE);
  });

  it('carries the utm parameters along', () => {
    const href = new URL(goalAppHref(BASE, { utm_source: 'google', utm_campaign: 'magnus max' }));
    expect(href.searchParams.get('utm_source')).toBe('google');
    expect(href.searchParams.get('utm_campaign')).toBe('magnus max');
  });

  it('carries nothing that is not a utm parameter', () => {
    const href = new URL(goalAppHref(BASE, { phone: '9876543210', utm_source: 'meta' }));
    expect([...href.searchParams.keys()]).toEqual(['utm_source']);
  });

  it('keeps a parameter the address already sets', () => {
    const href = new URL(goalAppHref(`${BASE}?utm_source=ampere_buy`, { utm_source: 'google' }));
    expect(href.searchParams.get('utm_source')).toBe('ampere_buy');
  });
});
