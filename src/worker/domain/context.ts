import type { Paystack } from "../lib/paystack";

export interface Ctx {
  db: D1Database;
  paystack: Paystack;
  now: () => number;
  feeKobo: number;
  holdMinutes: number;
  /** Public origin of this Worker, used for the Paystack callback URL. */
  origin: string;
}

/**
 * A business-rule error the agent should see and act on (for example SLOT_HELD
 * with alternatives). Returned to the model as a tool result with isError: true.
 */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number = 400,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ToolError";
  }

  toJSON() {
    return { error: { code: this.code, status: this.httpStatus, message: this.message, ...this.extra } };
  }
}

export type ListingStatus = "available" | "under_offer" | "let" | "sold";
export type VisitStatus = "held" | "awaiting_payment" | "confirmed" | "expired" | "cancelled" | "refunded";

export interface ListingRow {
  id: string;
  title: string;
  neighbourhood: string;
  area: "Lekki" | "Yaba";
  property_type: string;
  listing_type: "rent" | "sale";
  price_ngn: number;
  bedrooms: number;
  bathrooms: number;
  status: ListingStatus;
  amenities: string;
  description: string;
  updated_at: number;
}

export interface SlotRow {
  id: string;
  listing_id: string;
  starts_at: number;
  status: "open" | "held" | "booked";
  hold_expires_at: number | null;
  visit_id: string | null;
  updated_at: number;
}

export interface VisitRow {
  id: string;
  listing_id: string;
  slot_id: string;
  starts_at: number;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string | null;
  status: VisitStatus;
  paystack_reference: string | null;
  payment_url: string | null;
  payment_status: string | null;
  payment_note: string | null;
  fee_kobo: number;
  amount_paid_kobo: number | null;
  hold_expires_at: number | null;
  created_at: number;
  paid_at: number | null;
  confirmed_at: number | null;
  late_payment: number;
  cancelled_at: number | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  refund_kobo: number | null;
  refund_reason: string | null;
  refund_status: string | null;
  refund_error: string | null;
  updated_at: number;
}

export interface QuestionRow {
  id: string;
  listing_id: string;
  question: string;
  asked_at: number;
  status: "open" | "answered";
  answer: string | null;
  answered_at: number | null;
}
