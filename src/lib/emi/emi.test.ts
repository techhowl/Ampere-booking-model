import { describe, expect, it } from 'vitest';
import {
  INDICATIVE_ANNUAL_RATE,
  TENURES_MONTHS,
  calculateEmi,
  lowestInstalment,
} from './emi';

describe('calculateEmi', () => {
  it('computes a standard amortising instalment', () => {
    // ₹1,00,000 over 12 months at 13.5% — verified against the closed form.
    const quote = calculateEmi({
      onRoadPrice: 120000,
      downPayment: 20000,
      tenureMonths: 12,
      annualRatePercent: 13.5,
    });

    expect(quote.principal).toBe(100000);
    expect(quote.monthlyInstalment).toBe(8955);
    expect(quote.totalPayable).toBe(8955 * 12);
  });

  it('reports the total payable, which is the figure that makes it honest', () => {
    const quote = calculateEmi({
      onRoadPrice: 120000,
      downPayment: 20000,
      tenureMonths: 24,
      annualRatePercent: 14.5,
    });

    expect(quote.totalPayable).toBe(quote.monthlyInstalment * 24);
    expect(quote.totalInterest).toBe(quote.totalPayable - quote.principal);
    expect(quote.totalInterest).toBeGreaterThan(0);
  });

  it('charges more interest over a longer tenure', () => {
    const short = calculateEmi({ onRoadPrice: 120000, downPayment: 20000, tenureMonths: 12 });
    const long = calculateEmi({ onRoadPrice: 120000, downPayment: 20000, tenureMonths: 36 });

    // The monthly figure falls and the total rises. Showing only the first
    // half of that is the thing build spec 10 objects to.
    expect(long.monthlyInstalment).toBeLessThan(short.monthlyInstalment);
    expect(long.totalInterest).toBeGreaterThan(short.totalInterest);
  });

  it('handles a zero rate without dividing by zero', () => {
    const quote = calculateEmi({
      onRoadPrice: 120000,
      downPayment: 0,
      tenureMonths: 12,
      annualRatePercent: 0,
    });

    expect(quote.monthlyInstalment).toBe(10000);
    expect(quote.totalInterest).toBe(0);
  });

  it('returns nothing to finance when the down payment covers the price', () => {
    const quote = calculateEmi({ onRoadPrice: 120000, downPayment: 120000, tenureMonths: 12 });

    expect(quote.principal).toBe(0);
    expect(quote.monthlyInstalment).toBe(0);
    expect(quote.totalPayable).toBe(0);
  });

  it('clamps a down payment larger than the price', () => {
    const quote = calculateEmi({ onRoadPrice: 120000, downPayment: 999999, tenureMonths: 12 });
    expect(quote.downPayment).toBe(120000);
    expect(quote.principal).toBe(0);
  });

  it('clamps a negative down payment to zero', () => {
    const quote = calculateEmi({ onRoadPrice: 120000, downPayment: -5000, tenureMonths: 12 });
    expect(quote.downPayment).toBe(0);
    expect(quote.principal).toBe(120000);
  });

  it('falls back to the configured rate for the tenure', () => {
    for (const tenure of TENURES_MONTHS) {
      const quote = calculateEmi({ onRoadPrice: 120000, downPayment: 20000, tenureMonths: tenure });
      expect(quote.annualRatePercent, `tenure ${tenure}`).toBe(INDICATIVE_ANNUAL_RATE[tenure]);
    }
  });
});

describe('lowestInstalment', () => {
  it('is the longest tenure, which is also the most expensive overall', () => {
    const lowest = lowestInstalment(120000, 20000);

    expect(lowest.tenureMonths).toBe(36);

    // The "EMI from" figure every site leads with is the one that costs most.
    const shortest = calculateEmi({ onRoadPrice: 120000, downPayment: 20000, tenureMonths: 12 });
    expect(lowest.totalInterest).toBeGreaterThan(shortest.totalInterest);
  });
});
