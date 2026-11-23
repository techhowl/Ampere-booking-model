import type { PrismaClient } from '@prisma/client';
import { env } from '@/lib/env';
import { pilotActive } from '@/lib/dealers/offered';
import { findNearbyDealers } from '@/lib/dealers/nearby';
import { isValidPincode } from '@/lib/phone-format';
import { PINCODE_INVALID_MESSAGE } from '@/lib/schemas/lead';
import { goalAppHref } from './goal-app';
import type { Prefill, RawSearchParams } from './prefill';

/**
 * The pincode popup, while the Zoho pilot runs.
 *
 * Only 11 dealers are on this page during the pilot. Everyone else is still
 * booked through Goal App, which the main site's "Book a test ride" used to
 * open directly and which we cannot change. So the main site opens this page,
 * and before anything else it asks one question, the pincode:
 *
 *   a pilot dealer within reach   the journey, with that pincode filled in
 *   none                          straight to Goal App (GOAL_APP_URL)
 *
 * Asked first so a customer outside the pilot never types their name and
 * number here only to type them again on Goal App, and so no lead is saved
 * here for a dealer this page does not serve. The pincode alone identifies
 * nobody; the lead is still written the moment name, phone and pincode are
 * all present, in step one, as before.
 *
 * Decided on the server: the popup is a plain GET form back to /buy, so it
 * works before any JavaScript has loaded, the answer arrives with the first
 * paint, and the list of pilot dealers never reaches the browser. "Within
 * reach" is exactly what the dealer step will offer (findNearbyDealers), so a
 * customer let through always finds a dealer there.
 *
 * Only while the pilot setting and GOAL_APP_URL are both set. At the big-bang
 * release PILOT_DEALER_CRM_IDS goes and the popup goes with it.
 */

export type GateDecision =
  /** No popup: the journey as usual. */
  | { kind: 'journey' }
  /** The popup, with what the link carried kept in hidden fields. */
  | { kind: 'ask'; error: string | null; carried: [string, string][] }
  /** No pilot dealer near this pincode. */
  | { kind: 'goal-app'; href: string };

export function pincodeGateActive(): boolean {
  return pilotActive() && env.goalAppUrl !== null;
}

export async function decideGate(
  prisma: PrismaClient,
  params: RawSearchParams,
  prefill: Prefill,
): Promise<GateDecision> {
  const goalApp = env.goalAppUrl;
  if (!goalApp || !pilotActive()) return { kind: 'journey' };

  const asked = first(params.pincode)?.trim() ?? '';
  if (!asked) return { kind: 'ask', error: null, carried: carriedParams(params, prefill) };
  if (!isValidPincode(asked)) {
    return { kind: 'ask', error: PINCODE_INVALID_MESSAGE, carried: carriedParams(params, prefill) };
  }

  const { dealers } = await findNearbyDealers(prisma, asked);
  return dealers.length > 0
    ? { kind: 'journey' }
    : { kind: 'goal-app', href: goalAppHref(goalApp, prefill.utm) };
}

const MAX_CARRIED = 40;
const MAX_KEY = 64;
const MAX_VALUE = 255;

/**
 * Everything the link arrived with, so it survives the popup: the scooter,
 * the campaign's utm_* and click ids, src. Not the pincode, which the popup
 * asks for itself.
 *
 * A scooter worked out from the Referer header is written in as ?model=: once
 * the popup is submitted the referring page is /buy, and the product page the
 * customer came from would be lost.
 */
export function carriedParams(params: RawSearchParams, prefill: Prefill): [string, string][] {
  const carried: [string, string][] = [];
  for (const [key, raw] of Object.entries(params)) {
    if (key === 'pincode' || key.length > MAX_KEY) continue;
    const value = first(raw)?.trim();
    if (!value) continue;
    carried.push([key, value.slice(0, MAX_VALUE)]);
    if (carried.length >= MAX_CARRIED) break;
  }
  if (prefill.modelFrom === 'referrer' && prefill.modelCode && !carried.some(([k]) => k === 'model')) {
    carried.push(['model', prefill.modelCode]);
  }
  return carried;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
