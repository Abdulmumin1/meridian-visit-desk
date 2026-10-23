/**
 * Spec section 9 acceptance tests (T1-T14), run against the real domain code and a
 * real local D1, with Paystack faked so every payment outcome is deterministic.
 * T13 (price complaint -> human handover) is agent behaviour and is tested in the simulator.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ToolError } from "../src/worker/domain/context";
import { answerQuestion, logUnanswered } from "../src/worker/domain/questions";
import {
  cancelVisitByAgency, cancelVisitByBuyer, getVisit, getVisitStatus, holdSlot, setListingStatus, settlePayment,
} from "../src/worker/domain/visits";
import { TOOLS } from "../src/worker/mcp/tools";
import { buyerA, buyerB, HOUR, MINUTE, scenario } from "./helpers";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

async function expectToolError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe(code);
    return err as ToolError;
  }
  throw new Error(`expected ToolError ${code}`);
}

async function slotRow(id: string) {
  return env.DB.prepare("SELECT * FROM slots WHERE id = ?").bind(id).first<{ status: string; visit_id: string | null }>();
}

describe("listing questions (R1)", () => {
  it("T1: answers an amenity that is in the data, from the data", async () => {
    const s = scenario();
    const res = (await tool("get_listing").run(s.ctx, { listing_id: "14 Admiralty Way" })) as any;
    expect(res.listing_id).toBe("MH-001");
    expect(res.amenities["Borehole"]).toBe("Yes");
    expect(res.amenities["Inverter"]).toBe("5 kVA");
    expect(res.amenities["Generator"]).toBe("Yes");
    expect(res.not_recorded).toContain("Generator size (kVA)");
  });

  it("T2: logs a missing amenity once, and the answer flows back to the agent", async () => {
    const s = scenario();
    const first = await logUnanswered(s.ctx, { listing_id: "MH-001", question: "What size is the generator?" });
    expect(first.status).toBe("logged");
    const again = await logUnanswered(s.ctx, { listing_id: "MH-001", question: "what size is the generator" });
    expect(again.status).toBe("already_logged");

    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM unanswered_questions WHERE status = 'open'").first<{ n: number }>();
    expect(open?.n).toBe(1);

    let detail = (await tool("get_listing").run(s.ctx, { listing_id: "MH-001" })) as any;
    expect(detail.open_questions).toEqual(["What size is the generator?"]);

    await answerQuestion(s.ctx, first.question_id, "27 kVA Mikano, serviced quarterly.");
    detail = (await tool("get_listing").run(s.ctx, { listing_id: "MH-001" })) as any;
    expect(detail.answered_by_agency).toEqual([{ question: "What size is the generator?", answer: "27 kVA Mikano, serviced quarterly." }]);
    expect(detail.open_questions).toEqual([]);
  });

  it("resolves ambiguous addresses by asking, never guessing", async () => {
    const s = scenario();
    await expectToolError(tool("get_listing").run(s.ctx, { listing_id: "Road" }), "AMBIGUOUS_LISTING");
    await expectToolError(tool("get_listing").run(s.ctx, { listing_id: "99 Nowhere Close" }), "NOT_FOUND");
  });
});

describe("holds and payment (R2, R4, R5)", () => {
  it("T3: holds an open slot for 15 minutes and returns a payment link", async () => {
    const s = scenario();
    const hold = await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA });
    expect(hold.status).toBe("awaiting_payment");
    expect(hold.minutes_left).toBe(15);
    expect(hold.fee).toBe("₦5,000");
    expect(hold.payment_url).toMatch(/^https:\/\/checkout\.paystack\.com\//);
    const slot = await slotRow(s.slot("11:00"));
    expect(slot).toMatchObject({ status: "held", visit_id: hold.visit_id });
  });

  it("T4: a second buyer cannot take a held slot and gets alternatives", async () => {
    const s = scenario();
    await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA });

    const day = (await tool("check_slots").run(s.ctx, { listing_id: "MH-001", date: s.date })) as any;
    expect(day.slots.find((x: any) => x.slot_id === s.slot("11:00")).available).toBe(false);

    const err = await expectToolError(holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerB }), "SLOT_HELD");
    expect(err.httpStatus).toBe(409);
    const alts = err.extra.alternatives as Array<{ slot_id: string }>;
    expect(alts.length).toBeGreaterThan(0);
    expect(alts.map((a) => a.slot_id)).not.toContain(s.slot("11:00"));
  });

  it("T5: confirms only after Paystack confirms, never on the buyer's word", async () => {
    const s = scenario();
    const hold = await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA });

    // Buyer says "paid" but Paystack has no successful charge.
    let status = (await getVisitStatus(s.ctx, { visit_id: hold.visit_id })) as any;
    expect(status.outcome).toBe("AWAITING_PAYMENT");
    expect(status.status).toBe("awaiting_payment");

    s.advance(3 * MINUTE);
    s.paystack.pay((await getVisit(env.DB, hold.visit_id))!.paystack_reference!, s.clock.t);
    status = (await getVisitStatus(s.ctx, { visit_id: hold.visit_id })) as any;
    expect(status.outcome).toBe("CONFIRMED");
    expect((await slotRow(s.slot("11:00")))?.status).toBe("booked");
  });

  it("T6: a declined card does not confirm, and the buyer is told it failed", async () => {
    const s = scenario();
    const hold = await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA });
    s.paystack.decline((await getVisit(env.DB, hold.visit_id))!.paystack_reference!);
    const status = (await getVisitStatus(s.ctx, { visit_id: hold.visit_id })) as any;
    expect(status.outcome).toBe("PAYMENT_FAILED");
    expect(status.status).toBe("awaiting_payment");
    expect(status.summary_for_buyer).toContain("Declined");
    expect((await slotRow(s.slot("11:00")))?.status).toBe("held");
  });

  it("Paystack down at hold time: nothing is held, error is retryable", async () => {
    const s = scenario();
    s.paystack.state.down = true;
    const err = await expectToolError(holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA }), "PAYSTACK_UNAVAILABLE");
    expect(err.httpStatus).toBe(502);
    expect(await slotRow(s.slot("11:00"))).toMatchObject({ status: "open", visit_id: null });
  });

  it("retrying hold_slot for the same buyer returns the same hold", async () => {
    const s = scenario();
    const a = await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA });
    const b = await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA });
    expect(b.visit_id).toBe(a.visit_id);
    expect(b.reused_existing_hold).toBe(true);
  });

  it("refunds an amount that does not match the fee", async () => {
    const s = scenario();
    const hold = await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA });
    const ref = (await getVisit(env.DB, hold.visit_id))!.paystack_reference!;
    s.paystack.pay(ref, s.clock.t, 100_000);
    const status = (await getVisitStatus(s.ctx, { visit_id: hold.visit_id })) as any;
    expect(status.outcome).toBe("REFUNDED_AMOUNT_MISMATCH");
    expect(s.paystack.refunds).toEqual([{ reference: ref, amountKobo: 100_000 }]);
  });
});

describe("late payments (R7)", () => {
  it("T7: pays after the hold lapses, slot still open: re-held and confirmed", async () => {
    const s = scenario();
    const hold = await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA });
    s.advance(20 * MINUTE);
    let status = (await getVisitStatus(s.ctx, { visit_id: hold.visit_id })) as any;
    expect(status.outcome).toBe("HOLD_EXPIRED");

    s.paystack.pay((await getVisit(env.DB, hold.visit_id))!.paystack_reference!, s.clock.t);
    status = (await getVisitStatus(s.ctx, { visit_id: hold.visit_id })) as any;
    expect(status.outcome).toBe("CONFIRMED_LATE_PAYMENT");
    expect(await slotRow(s.slot("11:00"))).toMatchObject({ status: "booked", visit_id: hold.visit_id });
  });

  it("T8: pays after the hold lapses, slot taken: refunded with alternatives", async () => {
    const s = scenario();
    const a = await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA });
    s.advance(20 * MINUTE);
    const b = await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerB });

    const refA = (await getVisit(env.DB, a.visit_id))!.paystack_reference!;
    s.paystack.pay(refA, s.clock.t);
    const status = (await getVisitStatus(s.ctx, { visit_id: a.visit_id })) as any;
    expect(status.outcome).toBe("REFUNDED_SLOT_TAKEN");
    expect(status.alternatives.slots.length).toBe(2);
    expect(s.paystack.refunds).toEqual([{ reference: refA, amountKobo: 500_000 }]);
    // Buyer B's hold is untouched and no slot is confirmed twice.
    expect(await slotRow(s.slot("11:00"))).toMatchObject({ status: "held", visit_id: b.visit_id });
  });

  it("a duplicate settlement (webhook + verify) confirms once and never double-refunds", async () => {
    const s = scenario();
    const hold = await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA });
    const ref = (await getVisit(env.DB, hold.visit_id))!.paystack_reference!;
    s.paystack.pay(ref, s.clock.t);
    const txn = s.paystack.txns.get(ref)!;
    const [x, y] = await Promise.all([settlePayment(s.ctx, hold.visit_id, txn, "webhook"), settlePayment(s.ctx, hold.visit_id, txn, "verify")]);
    // Exactly one path does the work; the other sees the payment already recorded.
    expect([x?.status, y?.status]).toContain("confirmed");
    expect(x?.paid_at).toBeTruthy();
    expect(y?.paid_at).toBeTruthy();
    expect((await getVisit(env.DB, hold.visit_id))?.status).toBe("confirmed");
    const confirmations = await env.DB.prepare("SELECT COUNT(*) AS n FROM activity WHERE action = 'visit.confirmed'").first<{ n: number }>();
    expect(confirmations?.n).toBe(1);
    expect(s.paystack.refunds).toEqual([]);
  });
});

describe("listing availability (R3, J5)", () => {
  it("T9: a let listing is refused with two alternatives (same area first)", async () => {
    const s = scenario();
    const res = (await tool("get_listing").run(s.ctx, { listing_id: "7 Fola Osibo Road" })) as any;
    expect(res.status).toBe("let");
    expect(res.bookable).toBe(false);
    expect(res.alternatives).toHaveLength(2);
    for (const alt of res.alternatives) {
      expect(alt.area).toBe("Lekki");
      expect(alt.bedrooms).toBeGreaterThanOrEqual(2);
      expect(alt.bedrooms).toBeLessThanOrEqual(4);
    }
    await expectToolError(tool("check_slots").run(s.ctx, { listing_id: "MH-002" }), "LISTING_UNAVAILABLE");
    const err = await expectToolError(holdSlot(s.ctx, { listing_id: "MH-002", slot_id: s.slot("11:00", "MH-002"), ...buyerA }), "LISTING_UNAVAILABLE");
    expect((err.extra.alternatives as unknown[]).length).toBe(2);
  });

  it("T10: listing let during the hold, buyer then pays: hold cancelled, full refund", async () => {
    const s = scenario();
    const hold = await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA });
    await setListingStatus(s.ctx, "MH-001", "let");
    expect((await getVisit(env.DB, hold.visit_id))?.status).toBe("cancelled");

    const ref = (await getVisit(env.DB, hold.visit_id))!.paystack_reference!;
    s.paystack.pay(ref, s.clock.t);
    const status = (await getVisitStatus(s.ctx, { visit_id: hold.visit_id })) as any;
    expect(status.outcome).toBe("REFUNDED_LISTING_UNAVAILABLE");
    expect(status.alternatives.listings.length).toBeGreaterThan(0);
    expect(s.paystack.refunds).toEqual([{ reference: ref, amountKobo: 500_000 }]);
  });

  it("T10b: listing let after the visit is confirmed: full refund (R6)", async () => {
    const s = scenario();
    const hold = await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA });
    s.paystack.pay((await getVisit(env.DB, hold.visit_id))!.paystack_reference!, s.clock.t);
    await getVisitStatus(s.ctx, { visit_id: hold.visit_id });
    const res = await setListingStatus(s.ctx, "MH-001", "let");
    expect(res.affected).toEqual([{ visit_id: hold.visit_id, result: "refunded (refund pending)" }]);
  });
});

describe("cancellation (R6, J6)", () => {
  async function confirmedVisit(s: ReturnType<typeof scenario>) {
    const hold = await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA });
    s.paystack.pay((await getVisit(env.DB, hold.visit_id))!.paystack_reference!, s.clock.t);
    expect(((await getVisitStatus(s.ctx, { visit_id: hold.visit_id })) as any).outcome).toBe("CONFIRMED");
    return hold.visit_id;
  }

  it("T11: cancelling 25 hours before gives a full refund", async () => {
    const s = scenario(); // clock starts 48h before the 11:00 viewing
    const id = await confirmedVisit(s);
    s.advance(23 * HOUR); // now 25h before
    const res = (await cancelVisitByBuyer(s.ctx, id)) as any;
    expect(res.outcome).toBe("CANCELLED_REFUNDED");
    expect(res.refund.amount).toBe("₦5,000");
    expect(s.paystack.refunds).toHaveLength(1);
    expect((await slotRow(s.slot("11:00")))?.status).toBe("open");
  });

  it("T12: cancelling 3 hours before keeps the fee", async () => {
    const s = scenario();
    const id = await confirmedVisit(s);
    s.advance(45 * HOUR); // now 3h before
    const res = (await cancelVisitByBuyer(s.ctx, id)) as any;
    expect(res.outcome).toBe("CANCELLED_FEE_KEPT");
    expect(s.paystack.refunds).toHaveLength(0);
  });

  it("exactly 24 hours before still refunds (24+ rule)", async () => {
    const s = scenario();
    const id = await confirmedVisit(s);
    s.advance(24 * HOUR);
    expect(((await cancelVisitByBuyer(s.ctx, id)) as any).outcome).toBe("CANCELLED_REFUNDED");
  });

  it("cancelling twice returns ALREADY_CANCELLED", async () => {
    const s = scenario();
    const id = await confirmedVisit(s);
    await cancelVisitByBuyer(s.ctx, id);
    await expectToolError(cancelVisitByBuyer(s.ctx, id), "ALREADY_CANCELLED");
  });

  it("cancelling an unpaid hold releases it and refunds a later payment", async () => {
    const s = scenario();
    const hold = await holdSlot(s.ctx, { listing_id: "MH-001", slot_id: s.slot("11:00"), ...buyerA });
    const res = (await cancelVisitByBuyer(s.ctx, hold.visit_id)) as any;
    expect(res.outcome).toBe("CANCELLED_NO_PAYMENT");
    expect((await slotRow(s.slot("11:00")))?.status).toBe("open");
    const ref = (await getVisit(env.DB, hold.visit_id))!.paystack_reference!;
    s.paystack.pay(ref, s.clock.t);
    expect(((await getVisitStatus(s.ctx, { visit_id: hold.visit_id })) as any).outcome).toBe("REFUNDED");
  });

  it("agency cancellation always refunds in full, even under 24 hours", async () => {
    const s = scenario();
    const id = await confirmedVisit(s);
    s.advance(45 * HOUR);
    const v = await cancelVisitByAgency(s.ctx, id, "Landlord unavailable");
    expect(v.status).toBe("refunded");
    expect(v.refund_reason).toBe("agency_cancelled");
  });

  it("a failed refund is surfaced, not hidden, and can be retried", async () => {
    const s = scenario();
    const id = await confirmedVisit(s);
    s.paystack.state.refundsDown = true;
    const res = (await cancelVisitByBuyer(s.ctx, id)) as any;
    expect(res.outcome).toBe("REFUND_NEEDS_ATTENTION");
    const { retryRefund } = await import("../src/worker/domain/visits");
    s.paystack.state.refundsDown = false;
    const v = await retryRefund(s.ctx, id);
    expect(v.status).toBe("refunded");
    expect(s.paystack.refunds).toHaveLength(1);
  });
});
