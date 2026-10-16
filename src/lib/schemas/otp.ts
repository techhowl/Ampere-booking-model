import { z } from 'zod';

/** One definition, used by the verify form and by the route. */

export const otpRequestSchema = z.object({
  /** Cloudflare Turnstile token. Absent until the keys arrive. */
  turnstileToken: z.string().max(4096).nullable().optional(),
});

export const otpVerifySchema = z.object({
  otpRef: z.string().min(1).max(64),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export interface OtpRequestResponse {
  otpRef: string;
  expiresAt: string;
  resendAfterSeconds: number;
  phoneLast4: string;
  /**
   * The live code, shown on screen instead of sent by SMS.
   *
   * Present only on UAT and only when OTP_ECHO_ENABLED is set — see
   * env.otpEchoEnabled. Absent in production, always.
   */
  testCode?: string;
}

export interface OtpVerifyResponse {
  verified: true;
}
