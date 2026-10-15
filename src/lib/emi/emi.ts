/**
 * EMI calculation.
 *
 * NOT WIRED INTO THE UI, DELIBERATELY. Nothing in the buy journey calls this.
 *
 * The decision (2026-10-15): we do not quote instalments. The customer picks
 * "Pay by EMI", we redirect, and Juspay's page shows the real lenders,
 * tenures and rates. Everything below computed off INDICATIVE_ANNUAL_RATE,
 * which is a placeholder nobody at Ampere, TVS Credit or Juspay supplied — so
 * every figure it produced was invented, and a monthly number that disagrees
 * with the payment page costs more trust than showing none.
 *
 * Kept rather than deleted for two reasons: if Finance ever supplies a real
 * rate card this is the calculator, already tested; and EMI_VS_LOAN_NOTE
 * below records a distinction that still matters wherever both products are
 * named.
 *
 * Journey document section 02: this exists to set expectation, not to approve
 * credit. It never applies for anything and never promises a rate. Every
 * display carries "indicative, subject to lender approval".
 *
 * Build spec 10 draws a distinction that must survive into the UI: the ~6.99%
 * financing advertised on product pages is a VEHICLE LOAN arranged at the
 * dealership. What Juspay surfaces at checkout is CHECKOUT EMI on a card, at
 * materially higher rates. They are different products. Labelling them the same
 * is how a customer ends up feeling misled.
 *
 * Rates come from the table below until Juspay's EMI Plans API is wired in.
 * The interface does not change when that happens — only where the numbers
 * come from.
 */

export const TENURES_MONTHS = [12, 18, 24, 36] as const;
export type Tenure = (typeof TENURES_MONTHS)[number];

/**
 * PLACEHOLDER. Annual interest rate per tenure, as a percentage.
 * Open item: Finance owes us the real interim table.
 */
export const INDICATIVE_ANNUAL_RATE: Record<Tenure, number> = {
  12: 13.5,
  18: 14.0,
  24: 14.5,
  36: 15.5,
};

/** The least a customer may put down, as a fraction of the on-road price. */
export const MIN_DOWN_PAYMENT_RATIO = 0.1;

export interface EmiQuote {
  principal: number;
  downPayment: number;
  tenureMonths: Tenure;
  annualRatePercent: number;
  /** Rounded to whole rupees. */
  monthlyInstalment: number;
  /** What the instalments add up to. */
  totalPayable: number;
  /** Total payable minus principal. */
  totalInterest: number;
}

/**
 * Standard amortising EMI.
 *
 *   EMI = P x r x (1+r)^n / ((1+r)^n - 1)
 *
 * where r is the MONTHLY rate. A zero rate degenerates, so it is handled
 * separately rather than dividing by zero.
 */
export function calculateEmi(params: {
  onRoadPrice: number;
  downPayment: number;
  tenureMonths: Tenure;
  annualRatePercent?: number;
}): EmiQuote {
  const { onRoadPrice, tenureMonths } = params;
  const annualRatePercent =
    params.annualRatePercent ?? INDICATIVE_ANNUAL_RATE[tenureMonths];

  const downPayment = Math.min(Math.max(0, params.downPayment), onRoadPrice);
  const principal = onRoadPrice - downPayment;

  if (principal <= 0) {
    return {
      principal: 0,
      downPayment,
      tenureMonths,
      annualRatePercent,
      monthlyInstalment: 0,
      totalPayable: 0,
      totalInterest: 0,
    };
  }

  const monthlyRate = annualRatePercent / 100 / 12;

  const monthlyInstalment =
    monthlyRate === 0
      ? principal / tenureMonths
      : (principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) /
        (Math.pow(1 + monthlyRate, tenureMonths) - 1);

  const rounded = Math.round(monthlyInstalment);
  const totalPayable = rounded * tenureMonths;

  return {
    principal,
    downPayment,
    tenureMonths,
    annualRatePercent,
    monthlyInstalment: rounded,
    // The figure most sites hide, and the one that makes an EMI decision
    // honest. Build spec 10 is explicit that it must be shown.
    totalPayable,
    totalInterest: totalPayable - principal,
  };
}

/** The lowest instalment across tenures — the "EMI from" figure. */
export function lowestInstalment(onRoadPrice: number, downPayment: number): EmiQuote {
  let best: EmiQuote | null = null;
  for (const tenure of TENURES_MONTHS) {
    const quote = calculateEmi({ onRoadPrice, downPayment, tenureMonths: tenure });
    if (!best || quote.monthlyInstalment < best.monthlyInstalment) best = quote;
  }
  // TENURES_MONTHS is non-empty, so this is always set.
  return best as EmiQuote;
}

export const EMI_DISCLAIMER =
  'Indicative only, subject to lender approval. Final rates and eligibility are decided at checkout.';

/**
 * Build spec 10. Shown wherever both products could be confused.
 */
export const EMI_VS_LOAN_NOTE =
  'This is checkout EMI on your card or a pay-later provider. The vehicle loan advertised on our product pages is a separate product arranged at the dealership, usually at a lower rate.';
