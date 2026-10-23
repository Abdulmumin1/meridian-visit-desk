/**
 * Minimal Paystack client (test mode). Every call has a hard timeout so a slow
 * Paystack can never hang an agent turn; Chord's sync turn budget is 60s total.
 */

export type PaystackTxnStatus =
  | "success" | "failed" | "abandoned" | "ongoing" | "pending" | "processing" | "queued" | "reversed";

export interface PaystackTxn {
  status: PaystackTxnStatus | string;
  reference: string;
  amount: number; // kobo
  currency: string;
  paid_at?: string | null;
  gateway_response?: string | null;
  metadata?: unknown;
}

export interface InitializeInput {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}

export interface RefundResult {
  status: string; // pending | processing | processed | failed
  id?: number;
}

export interface Paystack {
  initialize(input: InitializeInput): Promise<{ authorizationUrl: string; reference: string }>;
  verify(reference: string): Promise<PaystackTxn>;
  refund(input: { reference: string; amountKobo: number; note: string }): Promise<RefundResult>;
}

export class PaystackError extends Error {
  constructor(
    /** unavailable = network/timeout/5xx (retryable). rejected = Paystack said no (4xx). */
    readonly kind: "unavailable" | "rejected",
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "PaystackError";
  }
}

const TIMEOUT_MS = 8000;

export function createPaystack(secretKey: string, baseUrl = "https://api.paystack.co"): Paystack {
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    if (!secretKey || !secretKey.startsWith("sk_test_")) {
      // Guardrail: this build is test-mode only. Refuse live keys outright.
      throw new PaystackError("rejected", "PAYSTACK_SECRET_KEY must be a Paystack TEST key (sk_test_...)");
    }
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const msg = err instanceof Error && err.name === "TimeoutError" ? `timed out after ${TIMEOUT_MS}ms` : String(err);
      throw new PaystackError("unavailable", `Paystack ${method} ${path} failed: ${msg}`);
    }
    let json: { status?: boolean; message?: string; data?: T } = {};
    try {
      json = await res.json();
    } catch {
      /* non-JSON body, handled below */
    }
    if (res.status >= 500) {
      throw new PaystackError("unavailable", `Paystack ${res.status}: ${json.message ?? "server error"}`, res.status);
    }
    if (!res.ok || json.status === false || json.data === undefined) {
      throw new PaystackError("rejected", `Paystack ${res.status}: ${json.message ?? "request rejected"}`, res.status);
    }
    return json.data;
  }

  return {
    async initialize(input) {
      const data = await call<{ authorization_url: string; reference: string }>("POST", "/transaction/initialize", {
        email: input.email,
        amount: input.amountKobo,
        currency: "NGN",
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      });
      return { authorizationUrl: data.authorization_url, reference: data.reference };
    },

    async verify(reference) {
      return call<PaystackTxn>("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
    },

    async refund({ reference, amountKobo, note }) {
      const data = await call<{ status?: string; id?: number }>("POST", "/refund", {
        transaction: reference,
        amount: amountKobo,
        merchant_note: note,
        customer_note: "Meridian Homes visit fee refund",
      });
      return { status: data.status ?? "pending", id: data.id };
    },
  };
}

/** Paystack signs webhooks with HMAC-SHA512 of the raw body using the secret key. */
export async function verifyPaystackSignature(rawBody: string, signature: string | null, secretKey: string) {
  if (!signature || !secretKey) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secretKey), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqualStr(expected, signature.trim().toLowerCase());
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}
