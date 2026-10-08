import { z } from 'zod';
import { MODEL_CODES } from '@/lib/catalog/catalog';
import { SLOT_WINDOW_CODES } from '@/lib/test-rides/slots';

/** One definition, used by the slot picker and by the route. */

export const TEST_RIDE_MODES = ['home', 'dealer'] as const;

/**
 * Journey document section 03. The existing form already collects this and
 * nothing acts on it; picking "financing" opens the EMI widget.
 */
export const HELP_TOPICS = ['offers', 'financing', 'specs'] as const;

export const HELP_TOPIC_LABELS: Record<(typeof HELP_TOPICS)[number], string> = {
  offers: 'Current offers',
  financing: 'Financing and EMI',
  specs: 'Specifications',
};

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
