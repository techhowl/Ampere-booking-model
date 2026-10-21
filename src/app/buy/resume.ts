import type { PrismaClient } from '@prisma/client';
import { isActive, type LeadSession } from '@/lib/crypto/session';
import { resolvePincode } from '@/lib/dealers/resolve';
import { findNearbyDealers } from '@/lib/dealers/nearby';
import { catalogForPincode, type ModelAvailability } from '@/lib/catalog/availability';
import { getModel } from '@/lib/catalog/catalog';
import { toLeadResponse } from '@/lib/leads/save-lead';
import { describeSlot } from '@/lib/test-rides/slots';
import type { LeadCreatedResponse } from '@/lib/schemas/lead';
import type { NearbyDealer, NearbyDealersResponse } from '@/lib/schemas/dealer';
import type { Booking } from './TestRideStep';
import { decodeJourney, prefillSignature, type StepId } from './journey-state';
import type { Prefill } from './prefill';

/**
 * Picking the journey back up after a refresh. Server-side, so the page
 * renders the right step on the first paint instead of flashing step one.
 *
 * Nothing is resumed unless the signed session cookie is valid AND within the
 * idle limit. Past it, the customer starts again and verifies again — the
 * point of the limit is that the next person on a shared phone does not walk
 * into someone else's verified booking.
 *
 * The journey bookmark is only a hint. Every code in it is checked against the
 * database: the dealer must be the one recorded on the lead, a booking must
 * belong to this lead, and a model or colour must exist.
 */

export interface Resume {
  lead: LeadCreatedResponse;
  name: string;
  verified: boolean;
  step: StepId;
  modelCode: string | null;
  colourCode: string | null;
  intent: 'buy' | 'testride' | null;
  dealer: NearbyDealer | null;
  nearby: NearbyDealersResponse | null;
  catalog: ModelAvailability[] | null;
  booking: Booking | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadResume(
  prisma: PrismaClient,
  {
    session,
    journeyRaw,
    prefill,
    now = new Date(),
  }: {
    session: LeadSession | null;
    journeyRaw: string | null | undefined;
    prefill: Prefill;
    now?: Date;
  },
): Promise<Resume | null> {
  if (!session || !isActive(session, now.getTime())) return null;

  const lead = await prisma.lead.findUnique({ where: { id: session.leadId } });
  if (!lead) return null;

  const location = await resolvePincode(prisma, lead.pincode);
  const prefillIntent =
    prefill.intent === 'buy' || prefill.intent === 'testride' ? prefill.intent : null;

  const base = {
    lead: toLeadResponse(lead.id, lead.phoneLast4, lead.pincode, location),
    name: lead.name,
  };

  // Both halves: this browser proved the number, and the lead still carries
  // the number it proved.
  if (!(session.verified && lead.phoneVerified)) {
    return {
      ...base,
      verified: false,
      step: 'details',
      modelCode: prefill.modelCode,
      colourCode: prefill.colourCode,
      intent: prefillIntent,
      dealer: null,
      nearby: null,
      catalog: null,
      booking: null,
    };
  }

  const journey = decodeJourney(journeyRaw);
  // Same link as when the bookmark was written: a refresh. A different one
  // means they came back from another product page, and that product wins.
  const same = journey !== null && journey.from === prefillSignature(prefill);

  const [catalog, nearby] = await Promise.all([
    catalogForPincode(prisma, lead.pincode),
    findNearbyDealers(prisma, lead.pincode),
  ]);

  const dealerCode = same ? journey.dealer : null;
  const dealer =
    dealerCode && dealerCode === lead.dealerCode
      ? (nearby.dealers.find((d) => d.code === dealerCode) ?? null)
      : null;

  const booking =
    same && journey.booking && UUID.test(journey.booking)
      ? await loadBooking(prisma, lead.id, journey.booking, now)
      : null;

  return {
    ...base,
    verified: true,
    step: same ? journey.step : 'scooter',
    modelCode: same ? journey.model : prefill.modelCode,
    colourCode: same ? journey.colour : prefill.colourCode,
    intent: same ? journey.intent : prefillIntent,
    dealer,
    nearby,
    catalog: catalog.models,
    booking,
  };
}

async function loadBooking(
  prisma: PrismaClient,
  leadId: string,
  bookingId: string,
  now: Date,
): Promise<Booking | null> {
  const ride = await prisma.testRide.findFirst({
    where: { id: bookingId, leadId },
    include: { dealer: true },
  });
  if (!ride) return null;

  return {
    bookingId: ride.id,
    mode: ride.mode === 'home' ? 'home' : 'dealer',
    modeChangedReason: null,
    slot: describeSlot(ride.slotDate, ride.slotWindow, now),
    dealer: { name: ride.dealer.name, phone: ride.dealer.phone, address: ride.dealer.address },
    modelName: getModel(ride.modelCode)?.name ?? ride.modelCode,
    // Not stored; the confirmation says so neutrally.
    dealerNotified: null,
  };
}
