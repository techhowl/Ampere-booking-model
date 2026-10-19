import type { PrismaClient } from '@prisma/client';
import { getModel } from '@/lib/catalog/catalog';
import { dealerForLead, resolvePincode } from '@/lib/dealers/resolve';
import type { DealerNotifier } from '@/lib/notifications/dealer';
import { describeSlot, validateSlot, type SlotRejection } from './slots';

/**
 * Booking a test ride.
 *
 * Spec 7. Three rules shape this:
 *
 *   - Inventory is NOT touched. Test rides use demo stock, which is a different
 *     thing from sale stock.
 *   - Home mode requires a dealer who offers it. Where none does, we fall back
 *     to the dealership with an explanation rather than a dead end.
 *   - A pincode with no active dealer falls back to another in the region,
 *     rather than dead-ending the customer.
 */

export type TestRideMode = 'home' | 'dealer';

export type BookingFailure =
  | { reason: 'lead_not_found' }
  | { reason: 'not_verified' }
  | { reason: 'no_dealer' }
  | { reason: 'unknown_model' }
  | { reason: 'bad_slot'; detail: SlotRejection };

export interface BookingSuccess {
  bookingId: string;
  /** What was actually booked, which may not be what was asked for. */
  mode: TestRideMode;
  /**
   * Set when we could not honour the requested mode. Shown to the customer —
   * silently changing where their test ride happens would be worse than saying
   * so.
   */
  modeChangedReason: string | null;
  slot: string;
  slotDate: string;
  slotWindow: string;
  dealer: {
    code: string;
    name: string;
    phone: string | null;
    address: string | null;
  };
  modelCode: string;
  modelName: string;
  colourCode: string | null;
  helpTopic: string | null;
  /** False when the dealer could not be reached; the booking still stands. */
  dealerNotified: boolean;
}

export type BookingOutcome = { ok: true; booking: BookingSuccess } | ({ ok: false } & BookingFailure);

export interface BookTestRideInput {
  leadId: string;
  modelCode: string;
  colourCode?: string | null;
  mode: TestRideMode;
  slotDate: string;
  slotWindow: string;
  /** "offers" | "financing" | "specs". Drives the post-booking follow-up. */
  helpTopic?: string | null;
}

export async function bookTestRide(
  prisma: PrismaClient,
  notifier: DealerNotifier,
  input: BookTestRideInput,
  now: Date = new Date(),
): Promise<BookingOutcome> {
  const lead = await prisma.lead.findUnique({ where: { id: input.leadId } });
  if (!lead) return { ok: false, reason: 'lead_not_found' };

  // Spec 4: OTP gates progress. Capture already happened; this is the gate.
  if (!lead.phoneVerified) return { ok: false, reason: 'not_verified' };

  const model = getModel(input.modelCode);
  if (!model) return { ok: false, reason: 'unknown_model' };

  const slot = validateSlot(input.slotDate, input.slotWindow, now);
  if (!slot.ok) return { ok: false, reason: 'bad_slot', detail: slot.reason };

  // The dealer they picked at the dealer step, or the pincode's own.
  const location = await resolvePincode(prisma, lead.pincode);
  const dealer = await dealerForLead(prisma, lead, location.dealer);
  if (!dealer) return { ok: false, reason: 'no_dealer' };

  // Never a dead end: an unserviced home request becomes a dealership visit
  // with the reason stated, rather than a refusal.
  let mode: TestRideMode = input.mode;
  let modeChangedReason: string | null = null;
  if (mode === 'home' && !dealer.homeServiceable) {
    mode = 'dealer';
    modeChangedReason =
      `${dealer.name} doesn't bring scooters to your area yet, ` +
      'so we’ve booked your ride at the showroom instead.';
  }

  const colourCode =
    input.colourCode && model.colours.some((c) => c.code === input.colourCode)
      ? input.colourCode
      : null;

  // A double-tap that slipped past the idempotency key would otherwise put two
  // identical rides on one dealer's sheet.
  const existing = await prisma.testRide.findFirst({
    where: {
      leadId: lead.id,
      slotDate: slot.date,
      slotWindow: slot.window.code,
      status: 'booked',
    },
  });

  const booking =
    existing ??
    (await prisma.testRide.create({
      data: {
        leadId: lead.id,
        dealerCode: dealer.code,
        modelCode: model.code,
        colourCode,
        mode,
        slotDate: slot.date,
        slotWindow: slot.window.code,
        helpTopic: input.helpTopic ?? null,
        status: 'booked',
      },
    }));

  // The customer has chosen their branch; the lead should say so.
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      intent: 'testride',
      modelCode: model.code,
      colourCode,
      dealerCode: dealer.code,
      status: 'test_ride_booked',
    },
  });

  const described = describeSlot(slot.date, slot.window.code, now);

  let dealerNotified = true;
  try {
    await notifier.testRideBooked({
      dealerCode: dealer.code,
      dealerName: dealer.name,
      dealerPhone: dealer.phone,
      customerName: lead.name,
      customerPhoneLast4: lead.phoneLast4,
      customerPincode: lead.pincode,
      modelName: model.name,
      colourName: model.colours.find((c) => c.code === colourCode)?.name ?? null,
      mode,
      slot: described,
      bookingId: booking.id,
    });
  } catch (error) {
    // The booking is real whether or not the message went out. Failing the
    // whole request here would lose a confirmed ride over a flaky webhook.
    dealerNotified = false;
    console.error('[test-rides] dealer notification failed', {
      dealerCode: dealer.code,
      bookingId: booking.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    ok: true,
    booking: {
      bookingId: booking.id,
      mode,
      modeChangedReason,
      slot: described,
      slotDate: input.slotDate,
      slotWindow: slot.window.code,
      dealer: {
        code: dealer.code,
        name: dealer.name,
        phone: dealer.phone,
        address: dealer.address,
      },
      modelCode: model.code,
      modelName: model.name,
      colourCode,
      helpTopic: input.helpTopic ?? null,
      dealerNotified,
    },
  };
}
