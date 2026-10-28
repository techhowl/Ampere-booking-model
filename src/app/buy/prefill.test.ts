import { describe, expect, it } from 'vitest';
import { parsePrefill } from './prefill';

describe('/buy with no parameters', () => {
  it('renders a complete working page, not an error', () => {
    const prefill = parsePrefill({});

    expect(prefill.modelCode).toBeNull();
    expect(prefill.colourCode).toBeNull();
    expect(prefill.intent).toBe('undecided');
    expect(prefill.dropped).toEqual([]);
  });
});

describe('arriving from a product page', () => {
  it('preselects the model and colour', () => {
    const prefill = parsePrefill({
      model: 'nexus-ex-plus',
      colour: 'carbon-knight',
      intent: 'buy',
      src: 'product_hero',
    });

    expect(prefill.modelCode).toBe('nexus-ex-plus');
    expect(prefill.colourCode).toBe('carbon-knight');
    expect(prefill.intent).toBe('buy');
    expect(prefill.src).toBe('product_hero');
  });

  it('accepts the American spelling of colour', () => {
    const prefill = parsePrefill({ model: 'nexus-ex-plus', color: 'carbon-knight' });
    expect(prefill.colourCode).toBe('carbon-knight');
  });

  it("accepts the main site's own page names", () => {
    expect(parsePrefill({ model: 'gmax' }).modelCode).toBe('magnus-gmax');
    expect(parsePrefill({ model: 'reovyb' }).modelCode).toBe('reo-vyb');
    expect(parsePrefill({ model: 'Nexus' }).modelCode).toBe('nexus-ex-plus');
    expect(parsePrefill({ model: 'gmax' }).modelFrom).toBe('link');
  });
});

describe('the two scooter layouts', () => {
  it('lists every version as its own card by default', () => {
    expect(parsePrefill({}).layout).toBe('list');
  });

  it('groups versions under one card with ?view=variants', () => {
    expect(parsePrefill({ view: 'variants', model: 'nexus-ex-plus-intellipack' })).toMatchObject({
      layout: 'variants',
      modelCode: 'nexus-ex-plus-intellipack',
    });
  });

  it('falls back to the list for anything else', () => {
    const prefill = parsePrefill({ view: 'grid' });
    expect(prefill.layout).toBe('list');
    expect(prefill.dropped).toContain('view=grid');
  });
});

describe('arriving from an Intellipack page', () => {
  it('recognises both Intellipack pages', () => {
    const from = (referer: string) => parsePrefill({}, { referer }).modelCode;
    expect(from('https://ampere-electric.com/nexus-ex-plus-intellipack')).toBe('nexus-ex-plus-intellipack');
    expect(from('https://ampere-electric.com/new-magnus-gmax-iot')).toBe('magnus-gmax-intellipack');
  });
});

describe('arriving from a product page without ?model=', () => {
  const from = (referer: string, params = {}) => parsePrefill(params, { referer });

  it('recognises the product page it came from', () => {
    expect(from('https://ampere-electric.com/nexus-ex-plus').modelCode).toBe('nexus-ex-plus');
    expect(from('https://www.ampere-electric.com/gmax?utm_source=x').modelCode).toBe('magnus-gmax');
    expect(from('https://ampere-electric.com/reovyb/').modelFrom).toBe('referrer');
  });

  it('preselects nothing from a page that is not a product', () => {
    expect(from('https://ampere-electric.com/').modelCode).toBeNull();
    expect(from('https://ampere-electric.com/about-us').modelCode).toBeNull();
    expect(from('https://ampere-electric.com/buy?model=gmax').modelCode).toBeNull();
  });

  it('ignores any other site', () => {
    expect(from('https://evil.example/nexus-ex-plus').modelCode).toBeNull();
    expect(from('https://ampere-electric.com.evil.example/gmax').modelCode).toBeNull();
    expect(from('not a url').modelCode).toBeNull();
  });

  it('lets the link win over the referrer', () => {
    const prefill = from('https://ampere-electric.com/gmax', { model: 'reo-vyb' });
    expect(prefill.modelCode).toBe('reo-vyb');
    expect(prefill.modelFrom).toBe('link');
  });

  it('does not fall back to the referrer when the link names a bad model', () => {
    const prefill = from('https://ampere-electric.com/gmax', { model: 'foo' });
    expect(prefill.modelCode).toBeNull();
    expect(prefill.dropped).toContain('model=foo');
  });
});

describe('invalid values are dropped silently', () => {
  it('falls back to no preselection for an unknown model', () => {
    const prefill = parsePrefill({ model: 'foo' });

    expect(prefill.modelCode).toBeNull();
    expect(prefill.dropped).toContain('model=foo');
  });

  it('drops a colour the model does not come in', () => {
    const prefill = parsePrefill({ model: 'nexus-ex-plus', colour: 'ocean-blue' });

    expect(prefill.modelCode).toBe('nexus-ex-plus');
    expect(prefill.colourCode).toBeNull();
    expect(prefill.dropped).toContain('colour=ocean-blue');
  });

  it('drops a colour that arrives without a model', () => {
    const prefill = parsePrefill({ colour: 'carbon-knight' });
    expect(prefill.colourCode).toBeNull();
  });

  it('falls back to undecided for a nonsense intent', () => {
    const prefill = parsePrefill({ intent: 'steal' });

    expect(prefill.intent).toBe('undecided');
    expect(prefill.dropped).toContain('intent=steal');
  });
});

describe('attribution', () => {
  it('collects every utm parameter', () => {
    const prefill = parsePrefill({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'nexus-launch',
      gclid: 'abc123',
      fbclid: 'xyz789',
    });

    expect(prefill.utm).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'nexus-launch',
    });
    expect(prefill.gclid).toBe('abc123');
    expect(prefill.fbclid).toBe('xyz789');
  });

  it('keeps the whole query string, including what it could not parse', () => {
    // The backstop for attribution questions asked a year from now.
    const prefill = parsePrefill({
      model: 'foo',
      some_partner_param: 'kept',
      intent: 'nonsense',
    });

    expect(prefill.sourceRaw).toEqual({
      model: 'foo',
      some_partner_param: 'kept',
      intent: 'nonsense',
    });
  });

  it('leaves utm null rather than empty when there is none', () => {
    expect(parsePrefill({ model: 'nexus' }).utm).toBeNull();
  });
});

describe('hostile input', () => {
  it('takes the first value when a parameter is repeated', () => {
    const prefill = parsePrefill({ model: ['nexus-ex-plus', 'primus'] });
    expect(prefill.modelCode).toBe('nexus-ex-plus');
  });

  it('truncates an absurdly long value rather than storing it', () => {
    const prefill = parsePrefill({ gclid: 'x'.repeat(5000) });
    expect(prefill.gclid).toHaveLength(255);
  });

  it('treats whitespace-only values as absent', () => {
    const prefill = parsePrefill({ src: '   ', gclid: '' });
    expect(prefill.src).toBeNull();
    expect(prefill.gclid).toBeNull();
  });
});
