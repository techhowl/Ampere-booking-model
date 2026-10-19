import { z } from 'zod';
import type { NearbyBasis, NearbyDealer } from '@/lib/dealers/nearby';

/** One definition, used by the dealer step and by POST /api/leads/dealer. */

export const chooseDealerSchema = z.object({
  dealerCode: z.string().trim().min(1, 'Please choose a dealer').max(64),
});

export type ChooseDealerInput = z.infer<typeof chooseDealerSchema>;

/** What GET /api/dealers/nearby returns. */
export interface NearbyDealersResponse {
  pincode: string;
  radiusKm: number;
  basis: NearbyBasis;
  dealers: NearbyDealer[];
}

export type { NearbyBasis, NearbyDealer };
