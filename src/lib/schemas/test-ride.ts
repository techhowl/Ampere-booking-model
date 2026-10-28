import { z } from 'zod';
import { MODEL_CODES } from '@/lib/catalog/catalog';
import { SLOT_WINDOW_CODES } from '@/lib/test-rides/slots';

/** One definition, used by the slot picker and by the route. */

export const TEST_RIDE_MODES = ['home', 'dealer'] as const;

/**
 * Journey document section 03. What the customer would like help with on the
 * day; it travels to the dealer with the booking.
 *
 * 'brochure' replaced 'specs' on the page — choosing it also downloads the
 * scooter's brochure. 'financing' and 'specs' stay valid so older bookings
 * still read; which topics the page OFFERS is SHOWN_HELP_TOPICS.
 */
export const HELP_TOPICS = ['offers', 'brochure', 'financing', 'specs'] as const;

export type HelpTopic = (typeof HELP_TOPICS)[number];

export const HELP_TOPIC_LABELS: Record<HelpTopic, string> = {
  offers: 'Current offers',
  brochure: 'Brochure',
  financing: 'Financing and EMI',
  specs: 'Specifications',
};

/** Offered on the page today. Financing returns with EMI. */
export const SHOWN_HELP_TOPICS: readonly HelpTopic[] = ['offers', 'brochure'];

export const testRideSchema = z.object({
  modelCode: z.enum(MODEL_CODES as [string, ...string[]]),
  colourCode: z.string().max(64).nullable().optional(),
  mode: z.enum(TEST_RIDE_MODES),
  /** "2026-10-06". Re-checked server-side against the window we actually offered. */
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  slotWindow: z.enum(SLOT_WINDOW_CODES as [string, ...string[]]),
  helpTopic: z.enum(HELP_TOPICS).nullable().optional(),
});

export type TestRideInput = z.infer<typeof testRideSchema>;
