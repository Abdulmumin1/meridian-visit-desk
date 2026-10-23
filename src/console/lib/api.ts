export type VisitStatus = "held" | "awaiting_payment" | "confirmed" | "expired" | "cancelled" | "refunded";
export type ListingStatus = "available" | "under_offer" | "let" | "sold";

export interface Visit {
  id: string;
  listing_id: string;
  slot_id: string;
  starts_at: number;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string | null;
  status: VisitStatus;
  effective_status: VisitStatus;
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
  listing_title?: string;
  neighbourhood?: string;
}

export interface Listing {
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
  description: string;
  updated_at: number;
  upcoming_visits: number;
  active_holds: number;
  open_questions: number;
  gaps: number;
}

export interface ListingDetail {
  now: number;
  listing: Omit<Listing, "upcoming_visits" | "active_holds" | "open_questions" | "gaps"> & {
    recorded: Record<string, string>;
    not_recorded: string[];
  };
  visits: Visit[];
  questions: Question[];
}

export interface Question {
  id: string;
  listing_id: string;
  question: string;
  asked_at: number;
  status: "open" | "answered";
  answer: string | null;
  answered_at: number | null;
  listing_title?: string;
  neighbourhood?: string;
}

export interface Activity {
  id: number;
  at: number;
  source: "agent" | "paystack" | "console" | "system";
  action: string;
  ok: number;
  visit_id: string | null;
  listing_id: string | null;
  duration_ms: number | null;
  summary: string;
  detail: string | null;
}

export interface Overview {
  now: number;
  kpis: {
    confirmed_upcoming: number | null;
    confirmed_next_7d: number | null;
    active_holds: number | null;
    collected_kobo: number;
    refunded_kobo: number;
    owed_kobo: number;
    refunds: number | null;
    lapsed_holds: number | null;
    total: number;
    open_questions: number;
    refunds_failed: number;
  };
  listings_by_status: Partial<Record<ListingStatus, number>>;
  upcoming: Visit[];
  holds: Visit[];
  attention: Visit[];
}

export interface PublicPayment {
  state: VisitStatus | "unknown";
  payment_status: string | null;
  gateway_response: string | null;
  late_payment: boolean;
  refund_reason: string | null;
  refund_status: string | null;
  visit_id: string;
  first_name: string;
  listing: { title: string; neighbourhood: string } | null;
  visit_time: string;
  starts_at: number;
  hold_expires_at: number | null;
  payment_url: string | null;
  fee_kobo: number;
  now: number;
}

const TOKEN_KEY = "meridian.console.token";

export const auth = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = auth.get();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.json !== undefined) headers.set("Content-Type", "application/json");
  const res = await fetch(`/api${path}`, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/public")) {
      auth.clear();
      window.dispatchEvent(new Event("meridian:logout"));
    }
    throw new ApiError(res.status, body.error?.code ?? "ERROR", body.error?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}
