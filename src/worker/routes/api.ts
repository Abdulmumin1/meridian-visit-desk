/**
 * Coordinator console API. Covers only what Chord's own dashboard does not:
 * visits and payments, listing availability, and the unanswered-question queue.
 * Conversations and human handover stay in Chord.
 */
import { Hono } from "hono";
import { timingSafeEqualStr } from "../lib/paystack";
import { DAY, watLabel } from "../lib/time";
import { ToolError, type Ctx, type ListingRow, type ListingStatus, type QuestionRow, type VisitRow } from "../domain/context";
import { getListingRow, presentAmenities } from "../domain/listings";
import { answerQuestion } from "../domain/questions";
import {
  cancelVisitByAgency, effectiveStatus, expireIfLapsed, getVisit, getVisitByReference, retryRefund, setListingStatus, syncPayment,
} from "../domain/visits";

type AppEnv = { Bindings: Env; Variables: { ctx: Ctx } };

export const api = new Hono<AppEnv>();

api.onError((err, c) => {
  if (err instanceof ToolError) return c.json(err.toJSON(), err.httpStatus as 400);
  console.error("api error", err);
  return c.json({ error: { code: "INTERNAL_ERROR", message: "Unexpected error" } }, 500);
});

// --- Public: the Paystack return page polls this. Reveals no buyer details. ---
api.get("/public/payment", async (c) => {
  const ctx = c.get("ctx");
  const reference = c.req.query("reference") ?? c.req.query("trxref") ?? "";
  let v = reference ? await getVisitByReference(ctx.db, reference) : null;
  if (!v) return c.json({ state: "unknown" }, 404);
  ({ visit: v } = await syncPayment(ctx, v, "return_page"));
  v = await expireIfLapsed(ctx, v);
  const l = await getListingRow(ctx.db, v.listing_id);
  const status = effectiveStatus(v, ctx.now());
  return c.json({
    state: status,
    payment_status: v.payment_status,
    gateway_response: v.payment_note,
    late_payment: Boolean(v.late_payment),
    refund_reason: v.refund_reason,
    refund_status: v.refund_status,
    visit_id: v.id,
    first_name: v.buyer_name.split(" ")[0],
    listing: l ? { title: l.title, neighbourhood: l.neighbourhood } : null,
    visit_time: watLabel(v.starts_at),
    starts_at: v.starts_at,
    hold_expires_at: v.hold_expires_at,
    payment_url: status === "awaiting_payment" ? v.payment_url : null,
    fee_kobo: v.fee_kobo,
    now: ctx.now(),
  });
});

// --- Everything below needs the console token. ---
api.use("*", async (c, next) => {
  if (c.req.path.startsWith("/api/public/")) return next();
  const token = c.env.CONSOLE_TOKEN;
  const given = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || !given || !timingSafeEqualStr(given, token)) {
    return c.json({ error: { code: "UNAUTHORIZED", message: "Console token required" } }, 401);
  }
  return next();
});

api.get("/session", (c) => c.json({ ok: true, agency: c.env.AGENCY_NAME }));

interface VisitWithListing extends VisitRow {
  listing_title: string;
  neighbourhood: string;
}

const VISIT_SELECT = `SELECT v.*, l.title AS listing_title, l.neighbourhood AS neighbourhood FROM visits v JOIN listings l ON l.id = v.listing_id`;

function shapeVisit(v: VisitWithListing | VisitRow, now: number) {
  return { ...v, effective_status: effectiveStatus(v, now) };
}

api.get("/overview", async (c) => {
  const { db, now: clock } = c.get("ctx");
  const now = clock();
  const [kpi, upcoming, holds, attention, questions, listings] = await Promise.all([
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'confirmed' AND starts_at > ?1 THEN 1 ELSE 0 END) AS confirmed_upcoming,
           SUM(CASE WHEN status = 'confirmed' AND starts_at BETWEEN ?1 AND ?1 + ?2 THEN 1 ELSE 0 END) AS confirmed_next_7d,
           SUM(CASE WHEN status IN ('held','awaiting_payment') AND hold_expires_at > ?1 THEN 1 ELSE 0 END) AS active_holds,
           COALESCE(SUM(amount_paid_kobo), 0) AS collected_kobo,
           COALESCE(SUM(CASE WHEN refund_status IN ('pending','processing','processed','requested') THEN refund_kobo ELSE 0 END), 0) AS refunded_kobo,
           SUM(CASE WHEN refund_status IN ('pending','processing','processed','requested') THEN 1 ELSE 0 END) AS refunds,
           COALESCE(SUM(CASE WHEN refund_status = 'failed' THEN refund_kobo ELSE 0 END), 0) AS owed_kobo,
           SUM(CASE WHEN status = 'expired' OR (status IN ('held','awaiting_payment') AND hold_expires_at < ?1) THEN 1 ELSE 0 END) AS lapsed_holds,
           COUNT(*) AS total
         FROM visits`,
      )
      .bind(now, 7 * DAY)
      .first(),
    db.prepare(`${VISIT_SELECT} WHERE v.status = 'confirmed' AND v.starts_at > ? ORDER BY v.starts_at LIMIT 8`).bind(now).all<VisitWithListing>(),
    db.prepare(`${VISIT_SELECT} WHERE v.status IN ('held','awaiting_payment') AND v.hold_expires_at > ? ORDER BY v.hold_expires_at`).bind(now).all<VisitWithListing>(),
    db.prepare(`${VISIT_SELECT} WHERE v.refund_status = 'failed' ORDER BY v.updated_at DESC`).all<VisitWithListing>(),
    db.prepare("SELECT COUNT(*) AS open FROM unanswered_questions WHERE status = 'open'").first<{ open: number }>(),
    db.prepare("SELECT status, COUNT(*) AS n FROM listings GROUP BY status").all<{ status: string; n: number }>(),
  ]);
  return c.json({
    now,
    kpis: { ...kpi, open_questions: questions?.open ?? 0, refunds_failed: attention.results.length },
    listings_by_status: Object.fromEntries(listings.results.map((r) => [r.status, r.n])),
    upcoming: upcoming.results.map((v) => shapeVisit(v, now)),
    holds: holds.results.map((v) => shapeVisit(v, now)),
    attention: attention.results.map((v) => shapeVisit(v, now)),
  });
});

api.get("/visits", async (c) => {
  const { db, now: clock } = c.get("ctx");
  const now = clock();
  const rows = await db.prepare(`${VISIT_SELECT} ORDER BY v.created_at DESC LIMIT 300`).all<VisitWithListing>();
  return c.json({ now, visits: rows.results.map((v) => shapeVisit(v, now)) });
});

api.get("/visits/:id", async (c) => {
  const { db, now: clock } = c.get("ctx");
  const v = await db.prepare(`${VISIT_SELECT} WHERE v.id = ?`).bind(c.req.param("id")).first<VisitWithListing>();
  if (!v) return c.json({ error: { code: "NOT_FOUND", message: "No such visit" } }, 404);
  const activity = await db.prepare("SELECT * FROM activity WHERE visit_id = ? ORDER BY id ASC").bind(v.id).all();
  return c.json({ now: clock(), visit: shapeVisit(v, clock()), activity: activity.results });
});

api.post("/visits/:id/cancel", async (c) => {
  const body = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }));
  const v = await cancelVisitByAgency(c.get("ctx"), c.req.param("id"), body.reason ?? "");
  return c.json({ visit: shapeVisit(v, c.get("ctx").now()) });
});

api.post("/visits/:id/refresh", async (c) => {
  const ctx = c.get("ctx");
  let v = await getVisit(ctx.db, c.req.param("id"));
  if (!v) return c.json({ error: { code: "NOT_FOUND", message: "No such visit" } }, 404);
  const sync = await syncPayment(ctx, v);
  v = await expireIfLapsed(ctx, sync.visit);
  return c.json({ visit: shapeVisit(v, ctx.now()), paystack_check: sync.check });
});

api.post("/visits/:id/retry-refund", async (c) => {
  const v = await retryRefund(c.get("ctx"), c.req.param("id"));
  return c.json({ visit: shapeVisit(v, c.get("ctx").now()) });
});

api.get("/listings", async (c) => {
  const { db, now: clock } = c.get("ctx");
  const now = clock();
  const rows = await db
    .prepare(
      `SELECT l.*,
         (SELECT COUNT(*) FROM visits v WHERE v.listing_id = l.id AND v.status = 'confirmed' AND v.starts_at > ?1) AS upcoming_visits,
         (SELECT COUNT(*) FROM visits v WHERE v.listing_id = l.id AND v.status IN ('held','awaiting_payment') AND v.hold_expires_at > ?1) AS active_holds,
         (SELECT COUNT(*) FROM unanswered_questions q WHERE q.listing_id = l.id AND q.status = 'open') AS open_questions
       FROM listings l ORDER BY l.id`,
    )
    .bind(now)
    .all<ListingRow & { upcoming_visits: number; active_holds: number; open_questions: number }>();
  return c.json({
    listings: rows.results.map(({ amenities, ...l }) => {
      const { notRecorded } = presentAmenities(amenities);
      return { ...l, gaps: notRecorded.length };
    }),
  });
});

api.get("/listings/:id", async (c) => {
  const ctx = c.get("ctx");
  const now = ctx.now();
  const l = await getListingRow(ctx.db, c.req.param("id"));
  if (!l) return c.json({ error: { code: "NOT_FOUND", message: "No such listing" } }, 404);
  const { recorded, notRecorded } = presentAmenities(l.amenities);
  const [visits, questions] = await Promise.all([
    ctx.db.prepare("SELECT * FROM visits WHERE listing_id = ? ORDER BY starts_at DESC LIMIT 50").bind(l.id).all<VisitRow>(),
    ctx.db.prepare("SELECT * FROM unanswered_questions WHERE listing_id = ? ORDER BY asked_at DESC").bind(l.id).all<QuestionRow>(),
  ]);
  return c.json({
    now,
    listing: { ...l, amenities: undefined, recorded, not_recorded: notRecorded },
    visits: visits.results.map((v) => shapeVisit(v, now)),
    questions: questions.results,
  });
});

/** Preview what taking a listing off the market would do, before confirming. */
api.get("/listings/:id/impact", async (c) => {
  const { db, now } = c.get("ctx");
  const r = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
         SUM(CASE WHEN status IN ('held','awaiting_payment') THEN 1 ELSE 0 END) AS holds
       FROM visits WHERE listing_id = ? AND starts_at > ? AND status IN ('held','awaiting_payment','confirmed')`,
    )
    .bind(c.req.param("id"), now())
    .first<{ confirmed: number | null; holds: number | null }>();
  return c.json({ confirmed: r?.confirmed ?? 0, holds: r?.holds ?? 0 });
});

api.post("/listings/:id/status", async (c) => {
  const { status } = await c.req.json<{ status: ListingStatus }>();
  if (!["available", "under_offer", "let", "sold"].includes(status)) {
    return c.json({ error: { code: "INVALID_INPUT", message: "Invalid status" } }, 400);
  }
  return c.json(await setListingStatus(c.get("ctx"), c.req.param("id"), status));
});

api.get("/questions", async (c) => {
  const { db } = c.get("ctx");
  const rows = await db
    .prepare(
      `SELECT q.*, l.title AS listing_title, l.neighbourhood AS neighbourhood FROM unanswered_questions q
       JOIN listings l ON l.id = q.listing_id ORDER BY (q.status = 'open') DESC, q.asked_at DESC LIMIT 300`,
    )
    .all<QuestionRow & { listing_title: string; neighbourhood: string }>();
  return c.json({ questions: rows.results });
});

api.post("/questions/:id/answer", async (c) => {
  const { answer } = await c.req.json<{ answer: string }>();
  return c.json({ question: await answerQuestion(c.get("ctx"), c.req.param("id"), answer) });
});

api.get("/activity", async (c) => {
  const { db } = c.get("ctx");
  const after = Number(c.req.query("after") ?? 0);
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 300);
  const rows = after
    ? await db.prepare("SELECT * FROM activity WHERE id > ? ORDER BY id DESC LIMIT ?").bind(after, limit).all()
    : await db.prepare("SELECT * FROM activity ORDER BY id DESC LIMIT ?").bind(limit).all();
  return c.json({ activity: rows.results });
});
