import { logActivity, type ActivitySource } from "../lib/activity";
import { newPaymentReference, newVisitId } from "../lib/ids";
import { koboToNaira } from "../lib/money";
import { PaystackError, type PaystackTxn } from "../lib/paystack";
import { HOUR, MINUTE, watLabel, watTime } from "../lib/time";
import { ToolError, type Ctx, type ListingRow, type ListingStatus, type VisitRow } from "./context";
import { findAlternatives, getListingRow, listingSummary, resolveListing, unavailableError } from "./listings";
import { alternativeSlots, ensureSlots, getSlot, isBookableTime, isSlotFree, releaseSlotStmt } from "./slots";

export type RefundReason =
  | "slot_taken"
  | "listing_unavailable"
  | "buyer_cancelled_24h_plus"
  | "agency_cancelled"
  | "amount_mismatch"
  | "cancelled_before_payment"
  | "slot_passed";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const getVisit = (db: D1Database, id: string) =>
  db.prepare("SELECT * FROM visits WHERE id = ?").bind(id).first<VisitRow>();

export const getVisitByReference = (db: D1Database, ref: string) =>
  db.prepare("SELECT * FROM visits WHERE paystack_reference = ?").bind(ref).first<VisitRow>();

export function normaliseVisitId(input: string) {
  const s = input.trim().toUpperCase().replace(/\s+/g, "");
  return s.startsWith("V-") ? s : `V-${s.replace(/^V/, "")}`;
}

/** Holds past their window read as expired even before anything writes that down. */
export function effectiveStatus(v: Pick<VisitRow, "status" | "paid_at" | "hold_expires_at">, now: number): VisitRow["status"] {
  if ((v.status === "held" || v.status === "awaiting_payment") && !v.paid_at && (v.hold_expires_at ?? 0) < now) {
    return "expired";
  }
  return v.status;
}

async function log(ctx: Ctx, source: ActivitySource, action: string, summary: string, v: Partial<VisitRow>, extra: { ok?: boolean; detail?: unknown } = {}) {
  await logActivity(ctx.db, ctx.now(), { source, action, summary, visitId: v.id, listingId: v.listing_id, ...extra });
}

// ---------------------------------------------------------------------------
// hold_slot (J2 steps 4-5, R2, R3, R4)
// ---------------------------------------------------------------------------

export interface HoldInput {
  listing_id: string;
  slot_id: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone?: string | null;
}

export async function holdSlot(ctx: Ctx, input: HoldInput) {
  const { db } = ctx;
  const now = ctx.now();
  const name = (input.buyer_name ?? "").trim();
  const email = (input.buyer_email ?? "").trim().toLowerCase();
  if (name.length < 2) throw new ToolError("INVALID_INPUT", "buyer_name is required (the buyer's full name).");
  if (!EMAIL_RE.test(email)) throw new ToolError("INVALID_INPUT", "buyer_email must be a valid email address; Paystack sends the receipt there.");

  // R3, first read: the listing must be available at hold time.
  const listing = await resolveListing(db, input.listing_id);
  if (listing.status !== "available") throw unavailableError(listing, await findAlternatives(db, listing));

  // Slots are materialised lazily; make sure the requested day exists before reading.
  const m = (input.slot_id ?? "").trim().toUpperCase().match(/^(MH-\d{3})-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
  if (!m) throw new ToolError("INVALID_INPUT", "slot_id must come from check_slots, e.g. MH-001-20261024-1100.");
  if (m[1] !== listing.id) throw new ToolError("INVALID_INPUT", `slot ${input.slot_id} does not belong to ${listing.title} (${listing.id}).`);
  await ensureSlots(db, listing.id, `${m[2]}-${m[3]}-${m[4]}`, now);
  const slot = await getSlot(db, input.slot_id.trim().toUpperCase());
  if (!slot) throw new ToolError("NOT_FOUND", "That time is not a viewing slot. Call check_slots for valid times.", 404);
  if (!isBookableTime(slot.starts_at, now)) {
    throw new ToolError("SLOT_UNAVAILABLE", "That slot is too soon or too far ahead to book (minimum 1 hour notice, maximum 30 days).", 409, {
      alternatives: await alternativeSlots(db, listing.id, slot.starts_at, now, 3, slot.id),
    });
  }

  // Idempotent retry: the same buyer already holds this exact slot.
  if (slot.status === "held" && slot.visit_id && !isSlotFree(slot, now)) {
    const existing = await getVisit(db, slot.visit_id);
    if (existing && existing.buyer_email === email && existing.status === "awaiting_payment") {
      return holdResult(existing, listing, now, true);
    }
  }

  const visitId = newVisitId();
  const reference = newPaymentReference(visitId);
  const holdExpiresAt = now + ctx.holdMinutes * MINUTE;

  // Atomic claim: the slot update and the visit insert commit together, and the
  // insert only happens if this visit now owns the slot. D1 serialises writes.
  const [claim] = await db.batch([
    db
      .prepare(
        `UPDATE slots SET status = 'held', visit_id = ?1, hold_expires_at = ?2, updated_at = ?3
         WHERE id = ?4 AND (status = 'open' OR (status = 'held' AND hold_expires_at < ?3))`,
      )
      .bind(visitId, holdExpiresAt, now, slot.id),
    db
      .prepare(
        `INSERT INTO visits (id, listing_id, slot_id, starts_at, buyer_name, buyer_email, buyer_phone, status,
                             paystack_reference, fee_kobo, hold_expires_at, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'held', ?8, ?9, ?10, ?11, ?11
         WHERE EXISTS (SELECT 1 FROM slots WHERE id = ?3 AND visit_id = ?1)`,
      )
      .bind(visitId, listing.id, slot.id, slot.starts_at, name, email, input.buyer_phone?.trim() || null, reference, ctx.feeKobo, holdExpiresAt, now),
  ]);

  if (claim.meta.changes !== 1) {
    // J3: someone else is in their payment window or has booked it.
    throw new ToolError("SLOT_HELD", `${watLabel(slot.starts_at)} is not available any more.`, 409, {
      alternatives: await alternativeSlots(db, listing.id, slot.starts_at, now, 3, slot.id),
    });
  }

  const visit = { id: visitId, listing_id: listing.id };
  const abandon = async (reason: string) => {
    await db.batch([
      releaseSlotStmt(db, slot.id, visitId, now),
      db
        .prepare("UPDATE visits SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'system', cancel_reason = ?, updated_at = ? WHERE id = ?")
        .bind(now, reason, now, visitId),
    ]);
  };

  // R3, second read: just before creating the payment link.
  const fresh = await getListingRow(db, listing.id);
  if (!fresh || fresh.status !== "available") {
    await abandon("listing_unavailable");
    throw unavailableError(fresh ?? listing, await findAlternatives(db, fresh ?? listing));
  }

  let paymentUrl: string;
  const started = Date.now();
  try {
    const init = await ctx.paystack.initialize({
      email,
      amountKobo: ctx.feeKobo,
      reference,
      callbackUrl: `${ctx.origin}/pay/return`,
      metadata: {
        visit_id: visitId,
        slot_id: slot.id,
        listing_id: listing.id,
        cancel_action: `${ctx.origin}/pay/return?reference=${reference}`,
        custom_fields: [
          { display_name: "Property", variable_name: "property", value: listing.title },
          { display_name: "Visit", variable_name: "visit_time", value: watLabel(slot.starts_at) },
          { display_name: "Visit ID", variable_name: "visit_id", value: visitId },
        ],
      },
    });
    paymentUrl = init.authorizationUrl;
  } catch (err) {
    await abandon("paystack_unavailable");
    const msg = err instanceof Error ? err.message : String(err);
    await log(ctx, "paystack", "transaction.initialize", `Payment link failed for ${visitId}; hold released`, visit, { ok: false, detail: { error: msg } });
    throw new ToolError(
      "PAYSTACK_UNAVAILABLE",
      "The payment system did not respond, so nothing was held or charged. Ask the buyer to try again in a few minutes.",
      502,
      { retryable: !(err instanceof PaystackError && err.kind === "rejected") },
    );
  }

  await db
    .prepare("UPDATE visits SET status = 'awaiting_payment', payment_url = ?, updated_at = ? WHERE id = ? AND status = 'held'")
    .bind(paymentUrl, now, visitId)
    .run();

  await log(ctx, "paystack", "transaction.initialize", `Payment link created for ${visitId} (${koboToNaira(ctx.feeKobo)})`, visit, {
    detail: { reference, latency_ms: Date.now() - started },
  });

  // A buyer switching to a different time on the same listing releases their earlier unpaid hold.
  const replaced = await db
    .prepare(
      `SELECT * FROM visits WHERE buyer_email = ? AND listing_id = ? AND id != ?
       AND status IN ('held', 'awaiting_payment') AND paid_at IS NULL`,
    )
    .bind(email, listing.id, visitId)
    .all<VisitRow>();
  for (const old of replaced.results) {
    await db.batch([
      releaseSlotStmt(db, old.slot_id, old.id, now),
      db
        .prepare("UPDATE visits SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'buyer', cancel_reason = 'replaced_by_new_hold', updated_at = ? WHERE id = ? AND paid_at IS NULL")
        .bind(now, now, old.id),
    ]);
    await log(ctx, "system", "hold.replaced", `${old.id} released: buyer chose ${watLabel(slot.starts_at)} instead`, old);
  }

  const created = (await getVisit(db, visitId))!;
  return holdResult(created, listing, now, false);
}

function holdResult(v: VisitRow, l: ListingRow, now: number, reused: boolean) {
  return {
    visit_id: v.id,
    status: v.status,
    listing: listingSummary(l),
    visit_time: watLabel(v.starts_at),
    fee: koboToNaira(v.fee_kobo),
    hold_expires_at: `${watTime(v.hold_expires_at!)} WAT`,
    minutes_left: Math.max(0, Math.ceil((v.hold_expires_at! - now) / MINUTE)),
    payment_url: v.payment_url,
    reused_existing_hold: reused || undefined,
    next_step:
      "Send the payment link and the hold expiry time. The visit is NOT confirmed until get_visit_status reports CONFIRMED; the buyer saying they paid is not enough.",
  };
}

// ---------------------------------------------------------------------------
// Payment settlement (R5, R7, T7, T8, T10): shared by the webhook and verify paths
// ---------------------------------------------------------------------------

export async function settlePayment(ctx: Ctx, visitId: string, txn: PaystackTxn, source: "webhook" | "verify" | "return_page") {
  const { db } = ctx;
  const now = ctx.now();
  let v = await getVisit(db, visitId);
  if (!v) return null;
  if (v.paid_at) return v; // already settled: idempotent

  const paidAt = txn.paid_at ? Date.parse(txn.paid_at) || now : now;
  const lapsed = v.hold_expires_at != null && paidAt > v.hold_expires_at;

  // Record the payment exactly once, whichever path gets here first.
  const claim = await db
    .prepare(
      `UPDATE visits SET paid_at = ?, amount_paid_kobo = ?, payment_status = 'success', payment_note = ?, late_payment = ?, updated_at = ?
       WHERE id = ? AND paid_at IS NULL`,
    )
    .bind(paidAt, txn.amount, txn.gateway_response ?? null, lapsed ? 1 : 0, now, v.id)
    .run();
  if (claim.meta.changes !== 1) return getVisit(db, v.id);
  v = (await getVisit(db, v.id))!;
  await log(ctx, "paystack", source === "webhook" ? "charge.success" : "transaction.verify", `Payment of ${koboToNaira(txn.amount)} received for ${v.id}${lapsed ? " (after hold lapsed)" : ""}`, v, {
    detail: { reference: txn.reference, via: source, paid_at: txn.paid_at },
  });

  // Amount must equal the visit fee (spec section 7).
  if (txn.amount !== v.fee_kobo || (txn.currency ?? "NGN").toUpperCase() !== "NGN") {
    return issueRefund(ctx, v, { amountKobo: txn.amount, reason: "amount_mismatch", cancelledBy: "system", releaseSlot: true });
  }

  // R3/R6/T10: listing became unavailable during the hold (checked first so the buyer hears why).
  const listing = await getListingRow(db, v.listing_id);
  if (!listing || listing.status !== "available" || v.cancel_reason === "listing_unavailable") {
    return issueRefund(ctx, v, { amountKobo: v.fee_kobo, reason: "listing_unavailable", cancelledBy: "system", releaseSlot: true });
  }

  // Cancelled before the money arrived (buyer cancelled, agency cancelled, or a replaced hold).
  if (v.status === "cancelled") {
    return issueRefund(ctx, v, { amountKobo: v.fee_kobo, reason: "cancelled_before_payment", cancelledBy: "system", releaseSlot: true });
  }

  if (v.starts_at <= now) {
    return issueRefund(ctx, v, { amountKobo: v.fee_kobo, reason: "slot_passed", cancelledBy: "system", releaseSlot: true });
  }

  // Book the slot if this visit still owns it, or (R7) if it is free again.
  const [, confirm] = await db.batch([
    db
      .prepare(
        `UPDATE slots SET status = 'booked', visit_id = ?1, hold_expires_at = NULL, updated_at = ?2
         WHERE id = ?3 AND (visit_id = ?1 OR status = 'open' OR (status = 'held' AND hold_expires_at < ?2))`,
      )
      .bind(v.id, now, v.slot_id),
    db
      .prepare(
        `UPDATE visits SET status = 'confirmed', confirmed_at = ?2, hold_expires_at = NULL, updated_at = ?2
         WHERE id = ?1 AND EXISTS (SELECT 1 FROM slots WHERE id = ?3 AND visit_id = ?1 AND status = 'booked')`,
      )
      .bind(v.id, now, v.slot_id),
  ]);

  if (confirm.meta.changes === 1) {
    v = (await getVisit(db, v.id))!;
    await log(ctx, "system", "visit.confirmed", `${v.id} confirmed for ${watLabel(v.starts_at)}${lapsed ? " (slot re-held after late payment)" : ""}`, v);
    return v;
  }

  // R7 / J4b: the slot went to someone else while this payment was late.
  return issueRefund(ctx, v, { amountKobo: v.fee_kobo, reason: "slot_taken", cancelledBy: "system", releaseSlot: false });
}

// ---------------------------------------------------------------------------
// Refunds (R6, R7)
// ---------------------------------------------------------------------------

interface RefundOpts {
  amountKobo: number;
  reason: RefundReason;
  cancelledBy: "buyer" | "agency" | "system";
  releaseSlot: boolean;
}

export async function issueRefund(ctx: Ctx, v: VisitRow, o: RefundOpts) {
  const { db } = ctx;
  const now = ctx.now();
  // One refund per visit. A failed attempt can be retried; anything else is a no-op.
  const claim = await db
    .prepare(
      `UPDATE visits SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, ?1), cancelled_by = COALESCE(cancelled_by, ?2),
         cancel_reason = COALESCE(cancel_reason, ?3), refund_kobo = ?4, refund_reason = ?3, refund_status = 'requested',
         refund_error = NULL, hold_expires_at = NULL, updated_at = ?1
       WHERE id = ?5 AND paid_at IS NOT NULL AND (refund_status IS NULL OR refund_status = 'failed')`,
    )
    .bind(now, o.cancelledBy, o.reason, o.amountKobo, v.id)
    .run();
  if (claim.meta.changes !== 1) return getVisit(db, v.id);
  if (o.releaseSlot) await releaseSlotStmt(db, v.slot_id, v.id, now).run();
  return attemptRefund(ctx, v.id);
}

/** Calls Paystack for a visit whose refund is requested or failed. */
export async function attemptRefund(ctx: Ctx, visitId: string) {
  const { db } = ctx;
  const now = ctx.now();
  const v = (await getVisit(db, visitId))!;
  if (!v.paystack_reference || !v.refund_kobo) return v;
  try {
    const r = await ctx.paystack.refund({ reference: v.paystack_reference, amountKobo: v.refund_kobo, note: `Visit ${v.id}: ${v.refund_reason}` });
    const status = r.status === "processed" ? "processed" : "pending";
    await db
      .prepare("UPDATE visits SET status = 'refunded', refund_status = ?, refund_error = NULL, updated_at = ? WHERE id = ?")
      .bind(status, now, v.id)
      .run();
    await log(ctx, "paystack", "refund", `Refund of ${koboToNaira(v.refund_kobo)} initiated for ${v.id} (${v.refund_reason})`, v, { detail: r });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .prepare("UPDATE visits SET refund_status = 'failed', refund_error = ?, updated_at = ? WHERE id = ?")
      .bind(msg, now, v.id)
      .run();
    await log(ctx, "paystack", "refund", `Refund for ${v.id} FAILED: needs the coordinator`, v, { ok: false, detail: { error: msg } });
  }
  return (await getVisit(db, v.id))!;
}

export async function retryRefund(ctx: Ctx, visitId: string) {
  const v = await getVisit(ctx.db, visitId);
  if (!v) throw new ToolError("NOT_FOUND", "No such visit", 404);
  if (v.refund_status !== "failed") throw new ToolError("NOTHING_TO_RETRY", "This visit has no failed refund.", 409);
  await ctx.db.prepare("UPDATE visits SET refund_status = 'requested', updated_at = ? WHERE id = ? AND refund_status = 'failed'").bind(ctx.now(), v.id).run();
  return attemptRefund(ctx, v.id);
}

// ---------------------------------------------------------------------------
// Payment sync (verify) and lazy expiry
// ---------------------------------------------------------------------------

export type PaymentCheck = "ok" | "unavailable" | "skipped";

/** If we have no record of payment yet, ask Paystack. Covers a late or lost webhook. */
export async function syncPayment(ctx: Ctx, v: VisitRow, source: "verify" | "return_page" = "verify"): Promise<{ visit: VisitRow; check: PaymentCheck }> {
  if (v.paid_at || !v.paystack_reference || !["held", "awaiting_payment", "expired", "cancelled"].includes(v.status)) {
    return { visit: v, check: "skipped" };
  }
  // A cancelled visit that never got a payment link has nothing to verify.
  if (v.status === "cancelled" && !v.payment_url) return { visit: v, check: "skipped" };
  try {
    const txn = await ctx.paystack.verify(v.paystack_reference);
    if (txn.status === "success") {
      return { visit: (await settlePayment(ctx, v.id, txn, source))!, check: "ok" };
    }
    await ctx.db
      .prepare("UPDATE visits SET payment_status = ?, payment_note = ?, updated_at = ? WHERE id = ? AND paid_at IS NULL")
      .bind(txn.status, txn.gateway_response ?? null, ctx.now(), v.id)
      .run();
    return { visit: (await getVisit(ctx.db, v.id))!, check: "ok" };
  } catch (err) {
    await log(ctx, "paystack", "transaction.verify", `Could not verify payment for ${v.id}`, v, { ok: false, detail: { error: String(err) } });
    return { visit: v, check: "unavailable" };
  }
}

export async function expireIfLapsed(ctx: Ctx, v: VisitRow) {
  const now = ctx.now();
  if (effectiveStatus(v, now) !== "expired" || v.status === "expired") return v;
  await ctx.db.batch([
    ctx.db
      .prepare("UPDATE visits SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('held', 'awaiting_payment') AND paid_at IS NULL")
      .bind(now, v.id),
    // Only an un-renewed hold by this visit is released; a newer hold by someone else is untouched.
    ctx.db
      .prepare("UPDATE slots SET status = 'open', visit_id = NULL, hold_expires_at = NULL, updated_at = ? WHERE id = ? AND visit_id = ? AND status = 'held' AND hold_expires_at < ?")
      .bind(now, v.slot_id, v.id, now),
  ]);
  await log(ctx, "system", "hold.expired", `${v.id} hold lapsed without payment`, v);
  return (await getVisit(ctx.db, v.id))!;
}

// ---------------------------------------------------------------------------
// get_visit_status (J2 step 9, T5, T6, T7, T8)
// ---------------------------------------------------------------------------

export async function findVisits(ctx: Ctx, input: { visit_id?: string; buyer_email?: string }) {
  if (input.visit_id?.trim()) {
    const v = await getVisit(ctx.db, normaliseVisitId(input.visit_id));
    if (!v) throw new ToolError("NOT_FOUND", `No visit with ID ${input.visit_id}. Check the ID or look it up by the buyer's email.`, 404);
    return [v];
  }
  const email = input.buyer_email?.trim().toLowerCase();
  if (!email) throw new ToolError("INVALID_INPUT", "Provide visit_id, or buyer_email to look the visit up.");
  const rows = await ctx.db
    .prepare("SELECT * FROM visits WHERE buyer_email = ? ORDER BY created_at DESC LIMIT 10")
    .bind(email)
    .all<VisitRow>();
  if (rows.results.length === 0) throw new ToolError("NOT_FOUND", `No visits found for ${email}.`, 404);
  const now = ctx.now();
  const live = rows.results.filter((v) => ["held", "awaiting_payment", "confirmed"].includes(v.status) && v.starts_at > now);
  return live.length > 0 ? live : [rows.results[0]];
}

export async function getVisitStatus(ctx: Ctx, input: { visit_id?: string; buyer_email?: string }) {
  const visits = await findVisits(ctx, input);
  if (visits.length > 1) {
    const listings = await Promise.all(visits.map((v) => getListingRow(ctx.db, v.listing_id)));
    return {
      multiple_visits: true,
      note: "This buyer has more than one upcoming visit. Ask which one they mean, then call again with its visit_id.",
      visits: visits.map((v, i) => ({ visit_id: v.id, listing: listings[i]?.title, visit_time: watLabel(v.starts_at), status: effectiveStatus(v, ctx.now()) })),
    };
  }
  let { visit, check } = await syncPayment(ctx, visits[0]);
  visit = await expireIfLapsed(ctx, visit);
  return presentVisit(ctx, visit, check);
}

// ---------------------------------------------------------------------------
// cancel_visit (J6, R6, T11, T12) and agency cancellation
// ---------------------------------------------------------------------------

export async function cancelVisitByBuyer(ctx: Ctx, visitIdInput: string, reason?: string) {
  const { db } = ctx;
  const now = ctx.now();
  let v = await getVisit(db, normaliseVisitId(visitIdInput ?? ""));
  if (!v) throw new ToolError("NOT_FOUND", `No visit with ID ${visitIdInput}.`, 404);
  if (v.status === "cancelled" || v.status === "refunded" || v.status === "expired") {
    throw new ToolError("ALREADY_CANCELLED", `Visit ${v.id} is already ${v.status}; there is nothing to cancel.`, 409, { visit: await presentVisit(ctx, v, "skipped") });
  }
  if (v.starts_at <= now) {
    throw new ToolError("VISIT_IN_PAST", `Visit ${v.id} was scheduled for ${watLabel(v.starts_at)} and can no longer be cancelled. A no-show keeps the fee (R6).`, 409);
  }

  // The buyer may have paid seconds ago without a webhook yet. Settle that first.
  ({ visit: v } = await syncPayment(ctx, v));
  v = await expireIfLapsed(ctx, v);
  if (v.status === "refunded" || v.status === "cancelled" || v.status === "expired") {
    return { ...(await presentVisit(ctx, v, "ok")), cancellation: v.status === "expired" ? "The hold had already lapsed without payment; nothing was charged." : undefined };
  }

  const hoursBefore = (v.starts_at - now) / HOUR;
  const policy = {
    hours_before_visit: Math.round(hoursBefore * 10) / 10,
    rule: "R6: buyer cancels 24+ hours before = full refund; under 24 hours = fee kept.",
  };

  if (v.status !== "confirmed") {
    // Unpaid hold: release it. Nothing to refund. A late payment on this link is refunded automatically.
    await db.batch([
      releaseSlotStmt(db, v.slot_id, v.id, now),
      db
        .prepare("UPDATE visits SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'buyer', cancel_reason = ?, hold_expires_at = NULL, updated_at = ? WHERE id = ? AND paid_at IS NULL")
        .bind(now, reason?.slice(0, 200) || "buyer_cancelled_before_payment", now, v.id),
    ]);
    v = (await getVisit(db, v.id))!;
    await log(ctx, "agent", "visit.cancelled", `${v.id} cancelled by buyer before payment`, v);
    return { ...(await presentVisit(ctx, v, "ok")), outcome: "CANCELLED_NO_PAYMENT", refund_amount: koboToNaira(0), policy };
  }

  if (hoursBefore >= 24) {
    v = (await issueRefund(ctx, v, { amountKobo: v.fee_kobo, reason: "buyer_cancelled_24h_plus", cancelledBy: "buyer", releaseSlot: true }))!;
    await log(ctx, "agent", "visit.cancelled", `${v.id} cancelled by buyer ${policy.hours_before_visit}h ahead: full refund`, v);
    return { ...(await presentVisit(ctx, v, "ok")), policy };
  }

  await db.batch([
    releaseSlotStmt(db, v.slot_id, v.id, now),
    db
      .prepare(
        "UPDATE visits SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'buyer', cancel_reason = 'buyer_cancelled_under_24h', refund_kobo = 0, updated_at = ? WHERE id = ? AND status = 'confirmed'",
      )
      .bind(now, now, v.id),
  ]);
  v = (await getVisit(db, v.id))!;
  await log(ctx, "agent", "visit.cancelled", `${v.id} cancelled by buyer ${policy.hours_before_visit}h ahead: fee kept`, v);
  return { ...(await presentVisit(ctx, v, "ok")), policy };
}

/** R6: the agency cancelling always refunds in full. */
export async function cancelVisitByAgency(ctx: Ctx, visitId: string, reason: string) {
  const { db } = ctx;
  const now = ctx.now();
  let v = await getVisit(db, visitId);
  if (!v) throw new ToolError("NOT_FOUND", "No such visit", 404);
  if (["cancelled", "refunded", "expired"].includes(v.status)) throw new ToolError("ALREADY_CANCELLED", `Visit is already ${v.status}.`, 409);
  ({ visit: v } = await syncPayment(ctx, v));
  if (v.status === "confirmed") {
    v = (await issueRefund(ctx, v, { amountKobo: v.fee_kobo, reason: "agency_cancelled", cancelledBy: "agency", releaseSlot: true }))!;
  } else if (v.status === "held" || v.status === "awaiting_payment") {
    await db.batch([
      releaseSlotStmt(db, v.slot_id, v.id, now),
      db
        .prepare("UPDATE visits SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'agency', cancel_reason = ?, hold_expires_at = NULL, updated_at = ? WHERE id = ? AND paid_at IS NULL")
        .bind(now, "agency_cancelled", now, v.id),
    ]);
    v = (await getVisit(db, v.id))!;
  }
  await log(ctx, "console", "visit.cancelled", `${v.id} cancelled by the agency: ${reason || "no reason given"}`, v);
  return v;
}

/**
 * Coordinator changes a listing's status. Taking a listing off the market cancels
 * every future hold and refunds every confirmed visit in full (R6, J5, T10).
 */
export async function setListingStatus(ctx: Ctx, listingId: string, status: ListingStatus) {
  const { db } = ctx;
  const now = ctx.now();
  const listing = await getListingRow(db, listingId);
  if (!listing) throw new ToolError("NOT_FOUND", "No such listing", 404);
  await db.prepare("UPDATE listings SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, listingId).run();
  await logActivity(db, now, { source: "console", action: "listing.status", summary: `${listing.title}: ${listing.status} → ${status}`, listingId });
  if (status === "available") return { listing_id: listingId, status, affected: [] as Array<{ visit_id: string; result: string }> };

  const rows = await db
    .prepare("SELECT * FROM visits WHERE listing_id = ? AND status IN ('held', 'awaiting_payment', 'confirmed') AND starts_at > ?")
    .bind(listingId, now)
    .all<VisitRow>();
  const affected: Array<{ visit_id: string; result: string }> = [];
  for (const row of rows.results) {
    let { visit: v } = await syncPayment(ctx, row); // a just-paid hold is settled (and refunded) here
    if (v.status === "confirmed") {
      v = (await issueRefund(ctx, v, { amountKobo: v.fee_kobo, reason: "listing_unavailable", cancelledBy: "agency", releaseSlot: true }))!;
    } else if (v.status === "held" || v.status === "awaiting_payment" || v.status === "expired") {
      await db.batch([
        releaseSlotStmt(db, v.slot_id, v.id, now),
        db
          .prepare("UPDATE visits SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'system', cancel_reason = 'listing_unavailable', hold_expires_at = NULL, updated_at = ? WHERE id = ? AND paid_at IS NULL")
          .bind(now, now, v.id),
      ]);
      v = (await getVisit(db, v.id))!;
    }
    affected.push({ visit_id: v.id, result: v.refund_status ? `${v.status} (refund ${v.refund_status})` : v.status });
  }
  return { listing_id: listingId, status, affected };
}

// ---------------------------------------------------------------------------
// Presentation for the agent: status, outcome code and a plain-English summary
// ---------------------------------------------------------------------------

const REFUND_TIMING =
  "Paystack has accepted the refund to the original payment method. Do not promise a date; say the agency will confirm if it has not arrived.";

export async function presentVisit(ctx: Ctx, v: VisitRow, check: PaymentCheck) {
  const now = ctx.now();
  const l = await getListingRow(ctx.db, v.listing_id);
  const status = effectiveStatus(v, now);
  const where = l ? `${l.title}, ${l.neighbourhood}` : v.listing_id;
  const when = watLabel(v.starts_at);
  const fee = koboToNaira(v.fee_kobo);
  let outcome: string;
  let summary: string;
  let alternatives: unknown;

  const refund = v.refund_kobo && v.refund_kobo > 0 ? koboToNaira(v.refund_kobo) : null;

  if (status === "confirmed") {
    outcome = v.late_payment ? "CONFIRMED_LATE_PAYMENT" : "CONFIRMED";
    summary = v.late_payment
      ? `Payment arrived after the hold lapsed, but the slot was still free, so it is re-held and confirmed: ${when} at ${where}.`
      : `Confirmed: ${when} at ${where}. Bring a valid ID. Reply CANCEL any time to change it.`;
  } else if ((status === "awaiting_payment" || status === "held" || status === "expired") && v.paid_at) {
    // Paid, and the confirming write is in flight on another request (webhook vs verify race).
    outcome = "PAYMENT_PROCESSING";
    summary = `Payment received. The booking is being finalised; check again in a few seconds before confirming to the buyer.`;
  } else if (status === "awaiting_payment" || status === "held") {
    if (v.payment_status === "failed") {
      outcome = "PAYMENT_FAILED";
      summary = `The last payment attempt failed${v.payment_note ? ` (${v.payment_note})` : ""}. Nothing was charged. The slot is still held until ${watTime(v.hold_expires_at!)} WAT; the buyer can retry on the same link with another card.`;
    } else {
      outcome = check === "unavailable" ? "PAYMENT_CHECK_UNAVAILABLE" : "AWAITING_PAYMENT";
      summary =
        check === "unavailable"
          ? `Paystack could not be reached to check the payment. The visit is not confirmed yet. Ask the buyer to try again in a minute.`
          : `No payment received yet. Held until ${watTime(v.hold_expires_at!)} WAT. The visit is not confirmed until payment is received.`;
    }
  } else if (status === "expired") {
    outcome = "HOLD_EXPIRED";
    summary = `The ${ctx.holdMinutes}-minute hold lapsed without payment, so the slot was released. Nothing was charged. Offer to hold a time again.`;
    alternatives = { slots: await alternativeSlots(ctx.db, v.listing_id, v.starts_at, now, 3) };
  } else if (v.refund_status === "failed") {
    outcome = "REFUND_NEEDS_ATTENTION";
    summary = `A refund of ${refund} is owed, but Paystack did not accept it automatically. The coordinator has been alerted to process it by hand. Do not promise a date.`;
  } else if (status === "refunded") {
    switch (v.refund_reason) {
      case "slot_taken":
        outcome = "REFUNDED_SLOT_TAKEN";
        summary = `Payment arrived after the hold lapsed and the slot had been taken, so the full ${refund} was refunded. Offer the alternative times.`;
        alternatives = { slots: await alternativeSlots(ctx.db, v.listing_id, v.starts_at, now, 2) };
        break;
      case "listing_unavailable":
        outcome = "REFUNDED_LISTING_UNAVAILABLE";
        summary = `${l?.title ?? "The listing"} is no longer available (${l?.status ?? "withdrawn"}), so the visit was cancelled and the full ${refund} refunded. Offer the alternative homes.`;
        alternatives = l ? { listings: await findAlternatives(ctx.db, l) } : undefined;
        break;
      case "buyer_cancelled_24h_plus":
        outcome = "CANCELLED_REFUNDED";
        summary = `Cancelled more than 24 hours ahead, so the full ${refund} is refunded.`;
        break;
      case "agency_cancelled":
        outcome = "REFUNDED_AGENCY_CANCELLED";
        summary = `The agency cancelled this visit, so the full ${refund} is refunded.`;
        break;
      case "amount_mismatch":
        outcome = "REFUNDED_AMOUNT_MISMATCH";
        summary = `The amount paid did not match the ${fee} fee, so it was refunded in full. Offer a fresh payment link.`;
        break;
      default:
        outcome = "REFUNDED";
        summary = `The visit was cancelled before the payment arrived, so the full ${refund} was refunded.`;
    }
    summary += ` ${REFUND_TIMING}`;
  } else {
    // cancelled, no refund
    if (v.cancel_reason === "buyer_cancelled_under_24h") {
      outcome = "CANCELLED_FEE_KEPT";
      summary = `Cancelled with under 24 hours' notice, so the ${fee} fee is kept, per the agency's policy.`;
    } else if (v.cancel_reason === "listing_unavailable") {
      outcome = "CANCELLED_LISTING_UNAVAILABLE";
      summary = `${l?.title ?? "The listing"} is no longer available, so the hold was cancelled. Nothing was charged. Offer the alternative homes.`;
      alternatives = l ? { listings: await findAlternatives(ctx.db, l) } : undefined;
    } else {
      outcome = "CANCELLED";
      summary = `Cancelled. No payment was taken.`;
    }
  }

  return {
    visit_id: v.id,
    status,
    outcome,
    summary_for_buyer: summary,
    listing: l ? { listing_id: l.id, title: l.title, neighbourhood: l.neighbourhood } : { listing_id: v.listing_id },
    visit_time: when,
    buyer_name: v.buyer_name,
    fee,
    payment: {
      paid: Boolean(v.paid_at),
      paid_at: v.paid_at ? watLabel(v.paid_at) : undefined,
      last_status: v.payment_status ?? undefined,
      gateway_response: v.payment_note ?? undefined,
      checked_with_paystack: check === "ok" ? true : check === "unavailable" ? "failed" : undefined,
    },
    hold:
      status === "awaiting_payment" || status === "held"
        ? { expires_at: `${watTime(v.hold_expires_at!)} WAT`, minutes_left: Math.max(0, Math.ceil((v.hold_expires_at! - now) / MINUTE)) }
        : undefined,
    payment_url: status === "awaiting_payment" ? v.payment_url : undefined,
    refund: v.refund_kobo != null ? { amount: koboToNaira(v.refund_kobo), reason: v.refund_reason ?? v.cancel_reason, status: v.refund_status ?? "none" } : undefined,
    alternatives,
  };
}
