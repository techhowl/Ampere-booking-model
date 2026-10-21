import { getModel, isValidColourCode } from '@/lib/catalog/catalog';
import type { Prefill } from './prefill';

/**
 * Where the customer is in the journey, kept so a refresh lands them back on
 * the same step with the same choices.
 *
 * A cookie rather than browser storage, so the server can render the right
 * step on the first paint instead of flashing step one. It holds codes only —
 * step, model, colour, dealer, intent, a booking id — nothing that identifies
 * a person. Who the customer is lives in the signed, HttpOnly amp_lead cookie
 * and the database; this one is only a bookmark, and every value in it is
 * checked again on the way back in.
 *
 * Scoped to /buy, and given the same idle lifetime as the journey, so it dies
 * with it.
 */

export const JOURNEY_COOKIE = 'amp_journey';

export const STEPS = ['details', 'scooter', 'dealer', 'journey', 'finish'] as const;
export type StepId = (typeof STEPS)[number];

export interface JourneyState {
  step: StepId;
  model: string | null;
  colour: string | null;
  /** Only meaningful when it matches the dealer recorded on the lead. */
  dealer: string | null;
  intent: 'buy' | 'testride' | null;
  /** A test ride booked in this journey, so a refresh shows its confirmation. */
  booking: string | null;
  /** The link it began from — see prefillSignature(). */
  from: string;
}

/**
 * The product context the page was opened with. A refresh carries the same
 * one, so the saved journey applies. Arriving again from a different product
 * page carries a different one, and that product wins over the bookmark.
 */
export function prefillSignature(prefill: Pick<Prefill, 'modelCode' | 'colourCode' | 'intent'>): string {
  return [prefill.modelCode ?? '', prefill.colourCode ?? '', prefill.intent].join('|');
}

export function encodeJourney(state: JourneyState): string {
  return encodeURIComponent(JSON.stringify(state));
}

const CODE = /^[A-Za-z0-9_-]{1,64}$/;

/** Anything malformed, tampered with or stale-shaped comes back null. */
export function decodeJourney(raw: string | null | undefined): JourneyState | null {
  if (!raw || raw.length > 2048) return null;

  let value: unknown;
  try {
    value = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;

  const step = STEPS.find((s) => s === v.step);
  if (!step) return null;

  const model = typeof v.model === 'string' && getModel(v.model) ? v.model : null;
  const colour =
    typeof v.colour === 'string' && isValidColourCode(model, v.colour) ? v.colour : null;
  const code = (x: unknown) => (typeof x === 'string' && CODE.test(x) ? x : null);
  const intent = v.intent === 'buy' || v.intent === 'testride' ? v.intent : null;
  const from = typeof v.from === 'string' && v.from.length <= 200 ? v.from : '';

  return { step, model, colour, dealer: code(v.dealer), intent, booking: code(v.booking), from };
}

/** Browser only. Secure whenever the page itself is. */
export function writeJourneyCookie(state: JourneyState, maxAgeSeconds: number): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${JOURNEY_COOKIE}=${encodeJourney(state)}; Path=/buy; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

export function clearJourneyCookie(): void {
  document.cookie = `${JOURNEY_COOKIE}=; Path=/buy; Max-Age=0; SameSite=Lax`;
}
