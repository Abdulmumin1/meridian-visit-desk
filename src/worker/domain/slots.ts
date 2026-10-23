import {
  addDays, BOOKING_HORIZON_DAYS, DAY, isIsoDate, MIN_LEAD_MS, VIEWING_TIMES,
  watDate, watDayLabel, watLabel, watTime, watToMs, watWeekday,
} from "../lib/time";
import { ToolError, type SlotRow } from "./context";

export const slotId = (listingId: string, date: string, time: string) =>
  `${listingId}-${date.replace(/-/g, "")}-${time.replace(":", "")}`;

/** Create the day's slots from the viewing schedule if they don't exist yet. Idempotent. */
export async function ensureSlots(db: D1Database, listingId: string, date: string, now: number) {
  const dow = watWeekday(watToMs(date, "12:00"));
  const times = VIEWING_TIMES[dow] ?? [];
  if (times.length === 0) return;
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO slots (id, listing_id, starts_at, status, updated_at) VALUES (?, ?, ?, 'open', ?)",
  );
  await db.batch(times.map((t) => stmt.bind(slotId(listingId, date, t), listingId, watToMs(date, t), now)));
}

/** Expired holds are open at read time (spec section 4); no background job. */
export function isSlotFree(s: Pick<SlotRow, "status" | "hold_expires_at">, now: number) {
  return s.status === "open" || (s.status === "held" && (s.hold_expires_at ?? 0) < now);
}

export function isBookableTime(startsAt: number, now: number) {
  return startsAt >= now + MIN_LEAD_MS && startsAt <= now + BOOKING_HORIZON_DAYS * DAY;
}

async function daySlots(db: D1Database, listingId: string, date: string, now: number) {
  await ensureSlots(db, listingId, date, now);
  const start = watToMs(date, "00:00");
  const rows = await db
    .prepare("SELECT * FROM slots WHERE listing_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at")
    .bind(listingId, start, start + DAY)
    .all<SlotRow>();
  return rows.results;
}

function viewSlot(s: SlotRow, now: number) {
  return {
    slot_id: s.id,
    time: `${watTime(s.starts_at)} WAT`,
    available: isSlotFree(s, now) && isBookableTime(s.starts_at, now),
  };
}

/** Slots for one WAT date. Buyers only learn available or not; who holds a slot is private. */
export async function slotsForDate(db: D1Database, listingId: string, date: string, now: number) {
  if (!isIsoDate(date)) throw new ToolError("INVALID_INPUT", "date must be YYYY-MM-DD (WAT)");
  const today = watDate(now);
  if (date < today) throw new ToolError("PAST_DATE", `${date} is in the past. Today is ${today} (WAT).`);
  if (date > addDays(today, BOOKING_HORIZON_DAYS)) {
    throw new ToolError("TOO_FAR_AHEAD", `Viewings can be booked up to ${BOOKING_HORIZON_DAYS} days ahead.`);
  }
  const slots = (await daySlots(db, listingId, date, now)).map((s) => viewSlot(s, now));
  return {
    date,
    day: watDayLabel(watToMs(date, "12:00")),
    slots,
    open_count: slots.filter((s) => s.available).length,
    note: slots.length === 0 ? "No viewings on Sundays." : undefined,
  };
}

/** The next few days that still have open slots. */
export async function nextOpenDays(db: D1Database, listingId: string, now: number, days = 3, fromDate?: string) {
  const out: Awaited<ReturnType<typeof slotsForDate>>[] = [];
  let date = fromDate ?? watDate(now);
  for (let i = 0; i < 14 && out.length < days; i++, date = addDays(date, 1)) {
    const day = await slotsForDate(db, listingId, date, now);
    if (day.open_count > 0) out.push({ ...day, slots: day.slots.filter((s) => s.available) });
  }
  return out;
}

/** Up to `limit` open slots for alternatives: same day first, then the following days. */
export async function alternativeSlots(db: D1Database, listingId: string, aroundMs: number, now: number, limit = 3, excludeId?: string) {
  const out: Array<{ slot_id: string; when: string }> = [];
  let date = watDate(Math.max(aroundMs, now));
  for (let i = 0; i < 7 && out.length < limit; i++, date = addDays(date, 1)) {
    for (const s of await daySlots(db, listingId, date, now)) {
      if (s.id !== excludeId && isSlotFree(s, now) && isBookableTime(s.starts_at, now)) {
        out.push({ slot_id: s.id, when: watLabel(s.starts_at) });
        if (out.length >= limit) break;
      }
    }
  }
  return out;
}

export async function getSlot(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM slots WHERE id = ?").bind(id).first<SlotRow>();
}

/** Release a slot only if this visit still owns it. Safe to call repeatedly. */
export function releaseSlotStmt(db: D1Database, slotId: string, visitId: string, now: number) {
  return db
    .prepare("UPDATE slots SET status = 'open', visit_id = NULL, hold_expires_at = NULL, updated_at = ? WHERE id = ? AND visit_id = ?")
    .bind(now, slotId, visitId);
}
