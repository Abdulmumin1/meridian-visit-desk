import { env } from "cloudflare:test";
import type { Ctx } from "../src/worker/domain/context";
import { slotId } from "../src/worker/domain/slots";
import { PaystackError, type Paystack, type PaystackTxn } from "../src/worker/lib/paystack";
import { addDays, DAY, HOUR, MINUTE, watDate, watToMs, watWeekday } from "../src/worker/lib/time";

export { DAY, HOUR, MINUTE };

/** In-memory Paystack: tests decide what each reference's checkout outcome is. */
export function fakePaystack() {
  const txns = new Map<string, PaystackTxn>();
  const refunds: Array<{ reference: string; amountKobo: number }> = [];
  const state = { down: false, refundsDown: false };
  const client: Paystack = {
    async initialize(i) {
      if (state.down) throw new PaystackError("unavailable", "Paystack timed out");
      txns.set(i.reference, { status: "abandoned", reference: i.reference, amount: i.amountKobo, currency: "NGN" });
      return { authorizationUrl: `https://checkout.paystack.com/${i.reference}`, reference: i.reference };
    },
    async verify(reference) {
      if (state.down) throw new PaystackError("unavailable", "Paystack timed out");
      const t = txns.get(reference);
      if (!t) throw new PaystackError("rejected", "Transaction reference not found", 400);
      return t;
    },
    async refund({ reference, amountKobo }) {
      if (state.refundsDown) throw new PaystackError("unavailable", "Paystack refund API down");
      refunds.push({ reference, amountKobo });
      return { status: "pending" };
    },
  };
  return {
    client,
    txns,
    refunds,
    state,
    pay(reference: string, paidAt: number, amount = 500_000) {
      txns.set(reference, { status: "success", reference, amount, currency: "NGN", paid_at: new Date(paidAt).toISOString(), gateway_response: "Successful" });
    },
    decline(reference: string) {
      txns.set(reference, { status: "failed", reference, amount: 500_000, currency: "NGN", gateway_response: "Declined" });
    },
  };
}

/**
 * A scenario anchored to the real clock so HTTP-path tests (which use Date.now())
 * stay valid whenever the suite runs: the viewing is on a Monday at least 3 days out.
 */
export function scenario() {
  let date = watDate(Date.now() + 3 * DAY);
  while (watWeekday(watToMs(date, "12:00")) !== 1) date = addDays(date, 1);
  const clock = { t: watToMs(date, "11:00") - 48 * HOUR };
  const paystack = fakePaystack();
  const ctx: Ctx = {
    db: env.DB,
    paystack: paystack.client,
    now: () => clock.t,
    feeKobo: 500_000,
    holdMinutes: 15,
    origin: "https://visits.test",
  };
  return {
    ctx,
    clock,
    paystack,
    date,
    /** MH-001 = 14 Admiralty Way (available). */
    slot: (time: string, listing = "MH-001") => slotId(listing, date, time),
    advance: (ms: number) => {
      clock.t += ms;
    },
  };
}

export const buyerA = { buyer_name: "Ada Okafor", buyer_email: "ada@example.com" };
export const buyerB = { buyer_name: "Bayo Adewale", buyer_email: "bayo@example.com" };
