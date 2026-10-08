import { z } from 'zod';
import { MODEL_CODES } from '@/lib/catalog/catalog';

/** One definition, used by the buy branch and by the order route. */

export const PAYMENT_TYPES = ['full', 'partial', 'emi'] as const;

export type PaymentTypeCode = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_TYPE_LABELS: Record<PaymentTypeCode, string> = {
  full: 'Pay in full',
  partial: 'Pay a booking amount',
  emi: 'Pay by EMI',
};

/**
 * Note what is absent: any amount. The client sends selections; every rupee is
 * resolved server-side from price_book. A client-supplied amount is a
 * trivially exploitable vulnerability — spec 12, rule 1.
 */
export const createOrderSchema = z.object({
  modelCode: z.enum(MODEL_CODES as [string, ...string[]]),
  colourCode: z.string().max(64).nullable().optional(),
  paymentType: z.enum(PAYMENT_TYPES),
  /** What the EMI widget displayed, kept for disputes. Never used to charge. */
  emiContext: z
    .object({
      tenureMonths: z.number().int().positive().max(120),
      downPayment: z.number().nonnegative(),
      monthly: z.number().nonnegative(),
    })
    .nullable()
    .optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export interface CreatedOrderResponse {
  orderId: string;
  redirectUrl: string;
  amountTotal: string;
  amountCharged: string;
  paymentType: PaymentTypeCode;
  reservationExpiresAt: string;
}
