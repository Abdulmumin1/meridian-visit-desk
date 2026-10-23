/**
 * West Africa Time helpers. WAT is a fixed UTC+1 with no daylight saving,
 * so a constant offset is correct and avoids Intl/timezone-data differences.
 */
export const WAT_OFFSET_MS = 60 * 60 * 1000;
export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");

function shifted(ms: number) {
  return new Date(ms + WAT_OFFSET_MS);
}

/** YYYY-MM-DD in WAT. */
export function watDate(ms: number): string {
  const d = shifted(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** HH:MM (24h) in WAT. */
export function watTime(ms: number): string {
  const d = shifted(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Day of week in WAT, 0 = Sunday. */
export function watWeekday(ms: number): number {
  return shifted(ms).getUTCDay();
}

/** "Saturday 24 October" */
export function watDayLabel(ms: number): string {
  const d = shifted(ms);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Saturday 24 October, 11:00 WAT" */
export function watLabel(ms: number): string {
  return `${watDayLabel(ms)}, ${watTime(ms)} WAT`;
}

/** "Friday 23 October 2026, 09:58 WAT" */
export function watNowLabel(ms: number): string {
  return `${watDayLabel(ms)} ${shifted(ms).getUTCFullYear()}, ${watTime(ms)} WAT`;
}

/** Epoch ms for a WAT wall-clock date and time. */
export function watToMs(date: string, time = "00:00"): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - WAT_OFFSET_MS;
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = watToMs(s);
  return Number.isFinite(ms) && watDate(ms) === s;
}

export function addDays(date: string, n: number): string {
  return watDate(watToMs(date, "12:00") + n * DAY);
}

/** Viewing schedule in WAT. Sunday has no viewings. */
export const VIEWING_TIMES: Record<number, string[]> = {
  0: [],
  1: ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00"],
  2: ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00"],
  3: ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00"],
  4: ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00"],
  5: ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00"],
  6: ["10:00", "11:00", "12:00", "14:00"],
};

/** A slot must start at least this far in the future to be bookable. */
export const MIN_LEAD_MS = 60 * MINUTE;
/** How far ahead buyers can book. */
export const BOOKING_HORIZON_DAYS = 30;
