import { describe, expect, it } from 'vitest';
import {
  MINIMUM_NOTICE_MINUTES,
  SLOT_WINDOWS,
  WINDOW_DAYS,
  describeSlot,
  formatSlotDate,
  offeredDays,
  parseSlotDate,
  validateSlot,
} from './slots';

/**
 * Every fixed instant below is written in UTC with its IST equivalent noted,
 * because the whole point of this module is that the two differ.
 */

/** 2026-10-05 02:00 UTC = 07:30 IST — early, nothing has started. */
const MORNING = new Date('2026-10-05T02:00:00.000Z');

/** 2026-10-05 20:00 UTC = 2026-10-06 01:30 IST — already tomorrow in India. */
const LATE_UTC_EVENING = new Date('2026-10-05T20:00:00.000Z');

/** 2026-10-05 12:00 UTC = 17:30 IST, during the last window. */
const IST_EVENING = new Date('2026-10-05T12:00:00.000Z');

describe('the rolling window', () => {
  it('offers seven days starting today', () => {
    const days = offeredDays(MORNING);

    expect(days).toHaveLength(WINDOW_DAYS);
    expect(days[0]?.date).toBe('2026-10-05');
    expect(days[0]?.label).toBe('Today');
    expect(days[1]?.label).toBe('Tomorrow');
    expect(days[6]?.date).toBe('2026-10-11');
  });

  it('names later days readably', () => {
    const days = offeredDays(MORNING);
    expect(days[2]?.label).toBe('Wed 7 Oct');
  });

  it('gives every day the four existing windows', () => {
    for (const day of offeredDays(MORNING)) {
      expect(day.windows.map((w) => w.code)).toEqual(['w1', 'w2', 'w3', 'w4']);
    }
    expect(SLOT_WINDOWS.map((w) => w.label)).toEqual([
      '10:00 – 12:00',
      '13:00 – 15:00',
      '15:00 – 17:00',
      '17:00 – 20:00',
    ]);
  });
});

/**
 * The trap this module exists for. The server runs UTC; the customer is in IST.
 */
describe('timezone', () => {
  it('treats late-UTC-evening as the next IST day', () => {
    // 20:00 UTC on the 5th is 01:30 IST on the 6th. Offering the 5th would be
    // offering a day that has already ended for the customer.
    const days = offeredDays(LATE_UTC_EVENING);

    expect(days[0]?.date).toBe('2026-10-06');
    expect(days[0]?.label).toBe('Today');
  });

  it('still has a full day available in that case', () => {
    const days = offeredDays(LATE_UTC_EVENING);
    expect(days[0]?.windows.every((w) => w.available)).toBe(true);
  });
});

describe('windows that have already passed', () => {
  it('are greyed rather than hidden', () => {
    // 17:30 IST: w1, w2 and w3 are gone, w4 started half an hour ago.
    const today = offeredDays(IST_EVENING)[0];

    expect(today?.windows.map((w) => w.available)).toEqual([false, false, false, false]);
    expect(today?.windows).toHaveLength(4);
    expect(today?.hasAvailability).toBe(false);
  });

  it('leaves every window open early in the day', () => {
    // 07:30 IST — nothing has started and the first window is hours away.
    const today = offeredDays(MORNING)[0];
    expect(today?.windows.every((w) => w.available)).toBe(true);
    expect(today?.hasAvailability).toBe(true);
  });

  it('respects the minimum notice', () => {
    // 04:00 UTC is 09:30 IST. The 10:00 window is 30 minutes away — inside the
    // hour's notice, so it closes even though it has not started.
    const halfAnHourBeforeW1 = new Date('2026-10-05T04:00:00.000Z');
    const today = offeredDays(halfAnHourBeforeW1)[0];

    expect(MINIMUM_NOTICE_MINUTES).toBe(60);
    expect(today?.windows[0]?.available).toBe(false);
    expect(today?.windows[1]?.available).toBe(true);
  });

  it('never closes tomorrow, however late today is', () => {
    const days = offeredDays(IST_EVENING);
    expect(days[1]?.windows.every((w) => w.available)).toBe(true);
  });
});

describe('validateSlot', () => {
  it('accepts a slot we offered', () => {
    const result = validateSlot('2026-10-06', 'w2', MORNING);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(formatSlotDate(result.date)).toBe('2026-10-06');
      expect(result.window.code).toBe('w2');
    }
  });

  it('rejects a window code we do not have', () => {
    const result = validateSlot('2026-10-06', 'w9', MORNING);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unknown_window');
  });

  it('rejects a malformed date', () => {
    for (const bad of ['06-10-2026', '2026/10/06', 'tomorrow', '']) {
      const result = validateSlot(bad, 'w2', MORNING);
      expect(result.ok, bad).toBe(false);
      if (!result.ok) expect(result.reason).toBe('bad_date');
    }
  });

  it('rejects a date that does not exist', () => {
    // Date would silently roll this into March.
    const result = validateSlot('2026-02-31', 'w2', MORNING);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_date');
  });

  it('rejects yesterday', () => {
    const result = validateSlot('2026-10-04', 'w2', MORNING);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('out_of_range');
  });

  it('rejects a date beyond the window', () => {
    const result = validateSlot('2026-10-12', 'w2', MORNING);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('out_of_range');
  });

  it('accepts the last day of the window', () => {
    expect(validateSlot('2026-10-11', 'w2', MORNING).ok).toBe(true);
  });

  it('rejects a window that has already started today', () => {
    // The browser could send this by sitting on the page past 13:00.
    const result = validateSlot('2026-10-05', 'w2', IST_EVENING);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too_late');
  });
});

describe('parseSlotDate', () => {
  it('round-trips', () => {
    const date = parseSlotDate('2026-10-05');
    expect(date).not.toBeNull();
    expect(formatSlotDate(date as Date)).toBe('2026-10-05');
  });

  it('pins to UTC midnight so the day cannot slide', () => {
    expect(parseSlotDate('2026-10-05')?.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });
});

describe('describeSlot', () => {
  it('reads the way a confirmation should', () => {
    const date = parseSlotDate('2026-10-06') as Date;
    expect(describeSlot(date, 'w2', MORNING)).toBe('Tomorrow, 13:00 – 15:00');
  });

  it('names a distant day', () => {
    const date = parseSlotDate('2026-10-09') as Date;
    expect(describeSlot(date, 'w4', MORNING)).toBe('Fri 9 Oct, 17:00 – 20:00');
  });
});
