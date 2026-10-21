import { describe, expect, it } from 'vitest';
import { decodeJourney, encodeJourney, prefillSignature, type JourneyState } from './journey-state';

const STATE: JourneyState = {
  step: 'journey',
  model: 'nexus-ex-plus',
  colour: 'carbon-knight',
  dealer: 'AMP-S-001',
  intent: 'buy',
  booking: null,
  from: 'nexus-ex-plus||undecided',
};

describe('the journey bookmark', () => {
  it('round-trips', () => {
    expect(decodeJourney(encodeJourney(STATE))).toEqual(STATE);
  });

  it('holds codes only — nothing that identifies a person', () => {
    expect(Object.keys(STATE).sort()).toEqual(
      ['booking', 'colour', 'dealer', 'from', 'intent', 'model', 'step'].sort(),
    );
  });

  it('drops what it does not recognise rather than trusting it', () => {
    const tampered = decodeJourney(
      encodeJourney({
        ...STATE,
        model: 'no-such-model',
        colour: 'carbon-knight',
        dealer: "x'; DROP TABLE dealers;--",
        intent: 'steal' as never,
      }),
    );
    expect(tampered).toMatchObject({ step: 'journey', model: null, colour: null, dealer: null, intent: null });
  });

  it('drops a colour the model does not come in', () => {
    expect(decodeJourney(encodeJourney({ ...STATE, colour: 'ocean-blue' }))?.colour).toBeNull();
  });

  it('refuses garbage, an unknown step and an oversized value outright', () => {
    for (const raw of [undefined, null, '', 'not json', '%7B', encodeJourney({ ...STATE, step: 'pay' as never })]) {
      expect(decodeJourney(raw), String(raw)).toBeNull();
    }
    expect(decodeJourney('x'.repeat(5000))).toBeNull();
  });

  it('tells a refresh from a new product link', () => {
    const fromNexus = prefillSignature({ modelCode: 'nexus-ex-plus', colourCode: null, intent: 'undecided' });
    const fromReo = prefillSignature({ modelCode: 'reo-vyb', colourCode: null, intent: 'undecided' });
    expect(fromNexus).not.toBe(fromReo);
    expect(fromNexus).toBe(
      prefillSignature({ modelCode: 'nexus-ex-plus', colourCode: null, intent: 'undecided' }),
    );
  });
});
