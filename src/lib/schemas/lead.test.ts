import { describe, expect, it } from 'vitest';
import { ATTRIBUTION_MAX_KEYS, leadIdentitySchema } from './lead';

const base = {
  name: 'Asha Menon',
  phone: '9876543210',
  pincode: '560001',
  consent: { transactional: true, marketing: false },
};

describe('attribution bounds (audit V-04)', () => {
  it('passes a real campaign link through unchanged', () => {
    const utm = { utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'nexus-diwali' };
    const parsed = leadIdentitySchema.parse({ ...base, attribution: { utm, sourceRaw: { model: 'nexus', ...utm } } });
    expect(parsed.attribution?.utm).toEqual(utm);
    expect(parsed.attribution?.sourceRaw).toEqual({ model: 'nexus', ...utm });
  });

  it('trims an oversized map instead of refusing the lead', () => {
    const huge: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) huge[`utm_k${i}${'x'.repeat(100)}`] = 'v'.repeat(5000);

    const result = leadIdentitySchema.safeParse({ ...base, attribution: { utm: huge, sourceRaw: huge } });
    expect(result.success).toBe(true);
    const utm = result.data!.attribution!.utm!;
    expect(Object.keys(utm)).toHaveLength(ATTRIBUTION_MAX_KEYS);
    for (const [key, value] of Object.entries(utm)) {
      expect(key.length).toBeLessThanOrEqual(64);
      expect(value.length).toBeLessThanOrEqual(255);
    }
    expect(Object.keys(result.data!.attribution!.sourceRaw!)).toHaveLength(ATTRIBUTION_MAX_KEYS);
  });

  it('still accepts no attribution at all', () => {
    expect(leadIdentitySchema.safeParse(base).success).toBe(true);
    expect(leadIdentitySchema.safeParse({ ...base, attribution: { utm: null, sourceRaw: null } }).success).toBe(true);
  });
});
