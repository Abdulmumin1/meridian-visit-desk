import { logActivity } from "../lib/activity";
import { verifyPaystackSignature, type PaystackTxn } from "../lib/paystack";
import type { Ctx } from "../domain/context";
import { getVisit, getVisitByReference, settlePayment } from "../domain/visits";

interface PaystackEvent {
  event: string;
  data?: Record<string, unknown> & {
    id?: number | string;
    reference?: string;
    transaction_reference?: string;
    status?: string;
    gateway_response?: string;
    metadata?: { visit_id?: string } | string | null;
  };
}

/**
 * POST /webhooks/paystack
 * 1. Verify x-paystack-signature (HMAC-SHA512 of the raw body). Mismatch = 401, no state change (T14).
 * 2. Dedupe on event + reference so Paystack retries never double-process.
 * 3. Acknowledge with 200 straight away and process in waitUntil.
 * A lost or failed webhook self-heals: get_visit_status verifies with Paystack directly.
 */
export async function handlePaystackWebhook(ctx: Ctx, req: Request, secretKey: string, waitUntil: (p: Promise<unknown>) => void) {
  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature");
  if (!(await verifyPaystackSignature(raw, signature, secretKey))) {
    await logActivity(ctx.db, ctx.now(), {
      source: "paystack",
      action: "webhook.rejected",
      ok: false,
      summary: "Rejected a webhook with an invalid signature (no state changed)",
      detail: { signature_present: Boolean(signature), body_bytes: raw.length },
    });
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let evt: PaystackEvent;
  try {
    evt = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const data = evt.data ?? {};
  const reference = data.reference ?? data.transaction_reference ?? null;
  const key = `${evt.event}:${evt.event.startsWith("refund.") ? (data.id ?? reference) : (reference ?? data.id)}`;

  const inserted = await ctx.db
    .prepare("INSERT OR IGNORE INTO payment_events (id, event, reference, received_at, payload) VALUES (?, ?, ?, ?, ?)")
    .bind(key, evt.event, reference, ctx.now(), raw.slice(0, 20000))
    .run();
  if (inserted.meta.changes === 0) return Response.json({ status: "duplicate" });

  waitUntil(
    processEvent(ctx, evt, reference)
      .then((outcome) => ctx.db.prepare("UPDATE payment_events SET outcome = ? WHERE id = ?").bind(outcome, key).run())
      .catch(async (err) => {
        console.error("paystack webhook processing failed", err);
        await ctx.db.prepare("UPDATE payment_events SET outcome = ? WHERE id = ?").bind(`error: ${String(err)}`, key).run();
        await logActivity(ctx.db, ctx.now(), {
          source: "paystack",
          action: evt.event,
          ok: false,
          summary: `Webhook processing failed for ${reference}; will reconcile on the next status check`,
          detail: { error: String(err) },
        });
      }),
  );
  return Response.json({ status: "accepted" });
}

async function findVisit(ctx: Ctx, reference: string | null, data: PaystackEvent["data"]) {
  if (reference) {
    const v = await getVisitByReference(ctx.db, reference);
    if (v) return v;
  }
  let meta = data?.metadata;
  if (typeof meta === "string") {
    try {
      meta = JSON.parse(meta);
    } catch {
      meta = null;
    }
  }
  const visitId = (meta as { visit_id?: string } | null)?.visit_id;
  return visitId ? getVisit(ctx.db, visitId) : null;
}

async function processEvent(ctx: Ctx, evt: PaystackEvent, reference: string | null): Promise<string> {
  const data = evt.data ?? {};
  switch (evt.event) {
    case "charge.success": {
      const visit = await findVisit(ctx, reference, data);
      if (!visit) {
        await logActivity(ctx.db, ctx.now(), { source: "paystack", action: "charge.success", ok: false, summary: `Payment for unknown reference ${reference}` });
        return "unknown_reference";
      }
      const settled = await settlePayment(ctx, visit.id, data as unknown as PaystackTxn, "webhook");
      return settled?.status ?? "missing";
    }
    case "charge.failed": {
      const visit = await findVisit(ctx, reference, data);
      if (!visit) return "unknown_reference";
      await ctx.db
        .prepare("UPDATE visits SET payment_status = 'failed', payment_note = ?, updated_at = ? WHERE id = ? AND paid_at IS NULL")
        .bind(data.gateway_response ?? "Declined", ctx.now(), visit.id)
        .run();
      await logActivity(ctx.db, ctx.now(), { source: "paystack", action: "charge.failed", ok: false, summary: `Payment failed for ${visit.id}: ${data.gateway_response ?? "declined"}`, visitId: visit.id, listingId: visit.listing_id });
      return "payment_failed";
    }
    case "refund.pending":
    case "refund.processing":
    case "refund.processed":
    case "refund.failed":
    case "refund.needs-attention": {
      const visit = await findVisit(ctx, reference, data);
      if (!visit) return "unknown_reference";
      // "needs-attention" means Paystack could not complete it without a human: treat as failed.
      const failed = evt.event === "refund.failed" || evt.event === "refund.needs-attention";
      const status = failed ? "failed" : evt.event === "refund.processed" ? "processed" : "pending";
      const stmt = failed
        ? ctx.db
            .prepare("UPDATE visits SET status = 'cancelled', refund_status = 'failed', refund_error = ?, updated_at = ? WHERE id = ?")
            .bind(`Paystack reported ${evt.event}`, ctx.now(), visit.id)
        : ctx.db
            .prepare("UPDATE visits SET refund_status = ?, updated_at = ? WHERE id = ? AND refund_status != 'processed'")
            .bind(status, ctx.now(), visit.id);
      await stmt.run();
      await logActivity(ctx.db, ctx.now(), {
        source: "paystack",
        action: evt.event,
        ok: !failed,
        summary: failed ? `Refund FAILED for ${visit.id}: needs the coordinator` : `Refund ${status} for ${visit.id}`,
        visitId: visit.id,
        listingId: visit.listing_id,
      });
      return `refund_${status}`;
    }
    default:
      await logActivity(ctx.db, ctx.now(), { source: "paystack", action: evt.event, summary: `Ignored Paystack event ${evt.event}` });
      return "ignored";
  }
}
