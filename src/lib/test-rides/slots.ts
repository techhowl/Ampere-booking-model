/**
 * Test ride slots: a rolling seven-day window and the four time windows the
 * current form already uses.
 *
 * Everything here is computed in **IST**, deliberately and explicitly. The
 * droplet runs UTC, so at 20:00 UTC it is already tomorrow in India — a naive
 * `new Date()` would offer a customer in Chennai a slot that has passed, or
 * hide tomorrow entirely. India has no daylight saving, so a fixed offset is
 * both correct and simpler than timezone tables.
 */

const IST_OFFSET_MINUTES = 330; // UTC+05:30
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** How many days the customer may choose from, today included. */
export const WINDOW_DAYS = 7;

/**
 * A dealer needs some notice. A slot starting in ten minutes is a booking
 * nobody can honour, and the customer finds out by turning up to a closed
 * showroom.
 */
export const MINIMUM_NOTICE_MINUTES = 60;

export interface SlotWindow {
  code: string;
  label: string;
  /** Minutes past IST midnight. */
  startMinutes: number;
  endMinutes: number;
}

/** The four existing windows, unchanged from the form this replaces. */
export const SLOT_WINDOWS: readonly SlotWindow[] = [
  { code: 'w1', label: '10:00 – 12:00', startMinutes: 10 * 60, endMinutes: 12 * 60 },
  { code: 'w2', label: '13:00 – 15:00', startMinutes: 13 * 60, endMinutes: 15 * 60 },
  { code: 'w3', label: '15:00 – 17:00', startMinutes: 15 * 60, endMinutes: 17 * 60 },
  { code: 'w4', label: '17:00 – 20:00', startMinutes: 17 * 60, endMinutes: 20 * 60 },
] as const;

export const SLOT_WINDOW_CODES = SLOT_WINDOWS.map((w) => w.code);

export function getSlotWindow(code: string): SlotWindow | null {
  return SLOT_WINDOWS.find((w) => w.code === code) ?? null;
}

/* ------------------------------------------------------------------ */
/* IST date handling                                                   */
/* ------------------------------------------------------------------ */

interface IstMoment {
  year: number;
  /** 0-indexed, as JavaScript insists. */
  month: number;
  day: number;
  /** Minutes past IST midnight. */
  minutesOfDay: number;
}

function toIst(at: Date): IstMoment {
  const shifted = new Date(at.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/**
 * A calendar date, stored as UTC midnight.
 *
 * `slot_date` is a DATE column with no time and no zone. Pinning it to UTC
 * midnight is what stops a date read back in a different zone sliding a day.
 */
function dateOnly(moment: Pick<IstMoment, 'year' | 'month' | 'day'>): Date {
  return new Date(Date.UTC(moment.year, moment.month, moment.day));
}

/** "2026-10-05" — the wire format for a slot date. */
export function formatSlotDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parses "2026-10-05" back to UTC midnight. Null for anything else. */
export function parseSlotDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Rejects "2026-02-31", which Date would otherwise roll into March.
  return formatSlotDate(parsed) === value ? parsed : null;
}

/** The instant an IST window begins, as a real UTC timestamp. */
function windowStartsAt(date: Date, window: SlotWindow): Date {
  return new Date(
    date.getTime() + (window.startMinutes - IST_OFFSET_MINUTES) * MS_PER_MINUTE,
  );
}

/* ------------------------------------------------------------------ */
/* The offer                                                           */
/* ------------------------------------------------------------------ */

export interface OfferedWindow {
  code: string;
  label: string;
  available: boolean;
}

export interface OfferedDay {
  /** "2026-10-05" */
  date: string;
  /** "Today", "Tomorrow", or "Mon 12 Oct". */
  label: string;
  isToday: boolean;
  windows: OfferedWindow[];
  /** False once every window on this day has passed. */
  hasAvailability: boolean;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function labelFor(date: Date, offset: number): string {
  if (offset === 0) return 'Today';
  if (offset === 1) return 'Tomorrow';
  return `${DAY_NAMES[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`;
}

/**
 * The seven days a customer may pick from, with windows that have already
 * passed marked unavailable rather than hidden — a greyed 10:00 slot reads as
 * "too late today", where a missing one reads as "broken".
 */
export function offeredDays(now: Date = new Date()): OfferedDay[] {
  const today = dateOnly(toIst(now));
  const earliest = now.getTime() + MINIMUM_NOTICE_MINUTES * MS_PER_MINUTE;

  return Array.from({ length: WINDOW_DAYS }, (_, offset) => {
    const date = new Date(today.getTime() + offset * MS_PER_DAY);

    const windows = SLOT_WINDOWS.map((window) => ({
      code: window.code,
      label: window.label,
      available: windowStartsAt(date, window).getTime() >= earliest,
    }));

    return {
      date: formatSlotDate(date),
      label: labelFor(date, offset),
      isToday: offset === 0,
      windows,
      hasAvailability: windows.some((w) => w.available),
    };
  });
}

export type SlotRejection = 'unknown_window' | 'bad_date' | 'out_of_range' | 'too_late';

/**
 * Server-side check that a chosen slot is one we actually offered. The browser
 * sends a date and a window code; neither can be trusted to be one of ours.
 */
export function validateSlot(
  dateValue: string,
  windowCode: string,
  now: Date = new Date(),
): { ok: true; date: Date; window: SlotWindow } | { ok: false; reason: SlotRejection } {
  const window = getSlotWindow(windowCode);
  if (!window) return { ok: false, reason: 'unknown_window' };

  const date = parseSlotDate(dateValue);
  if (!date) return { ok: false, reason: 'bad_date' };

  const today = dateOnly(toIst(now));
  const offset = Math.round((date.getTime() - today.getTime()) / MS_PER_DAY);
  if (offset < 0 || offset >= WINDOW_DAYS) return { ok: false, reason: 'out_of_range' };

  const startsAt = windowStartsAt(date, window);
  if (startsAt.getTime() < now.getTime() + MINIMUM_NOTICE_MINUTES * MS_PER_MINUTE) {
    return { ok: false, reason: 'too_late' };
  }

  return { ok: true, date, window };
}

/** "Today, 13:00 – 15:00" — for the confirmation screen and the dealer's message. */
export function describeSlot(date: Date, windowCode: string, now: Date = new Date()): string {
  const window = getSlotWindow(windowCode);
  const today = dateOnly(toIst(now));
  const offset = Math.round((date.getTime() - today.getTime()) / MS_PER_DAY);
  return `${labelFor(date, offset)}, ${window?.label ?? windowCode}`;
}
