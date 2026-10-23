import { useQuery } from "@tanstack/react-query";
import { Check, Clock3, LoaderCircle, RotateCcw, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn, Logo } from "../components/ui";
import { api, ApiError, type PublicPayment } from "../lib/api";
import { countdown, kobo, watDay, watTime } from "../lib/format";
import { useNow } from "../lib/router";

type View = {
  tone: "ok" | "warn" | "bad" | "info" | "muted";
  icon: typeof Check;
  title: string;
  body: ReactNode;
  cta?: { label: string; href: string };
  summary: boolean;
  next: string;
};

const FINAL = new Set(["confirmed", "refunded", "cancelled", "expired"]);

export function PayReturn() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get("reference") ?? params.get("trxref") ?? "";
  const now = useNow(1000);
  const [started] = useState(() => Date.now());

  const q = useQuery({
    queryKey: ["public-payment", reference],
    queryFn: () => api<PublicPayment>(`/public/payment?reference=${encodeURIComponent(reference)}`),
    enabled: Boolean(reference),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d || FINAL.has(d.state) || d.payment_status === "failed") return false;
      return Date.now() - started < 60_000 ? 2500 : false;
    },
  });

  const d = q.data;
  const notFound = !reference || (q.error instanceof ApiError && q.error.status === 404);
  const view = notFound ? missing() : d ? describe(d, now) : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-[400px] flex-col px-6 pt-14 pb-10">
      <div className="flex items-center gap-2">
        <Logo />
        <span className="text-[14px] font-semibold tracking-[-0.01em]">Meridian Homes</span>
      </div>

      {!view ? (
        <div className="mt-16 flex items-center gap-3 text-[14px] text-muted">
          <LoaderCircle className="size-4 animate-spin" /> Checking with Paystack…
        </div>
      ) : (
        <div className="mt-16 animate-fade">
          <view.icon
            className={cn(
              "size-7",
              view.tone === "ok" && "text-ok",
              view.tone === "warn" && "text-warn",
              view.tone === "bad" && "text-bad",
              view.tone === "info" && "text-info",
              view.tone === "muted" && "text-muted",
              view.icon === LoaderCircle && "animate-spin",
            )}
            strokeWidth={2}
          />
          <h1 className="mt-5 text-[24px] leading-tight font-semibold tracking-[-0.02em]">{view.title}</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{view.body}</p>

          {view.cta && (
            <a href={view.cta.href} className="mt-6 flex h-11 items-center justify-center rounded-md bg-ink text-[14.5px] font-medium text-white hover:bg-ink-2">
              {view.cta.label}
            </a>
          )}

          {d && view.summary && (
            <dl className="mt-10 border-t border-line text-[14px]">
              {d.listing && <Line label="Property" value={d.listing.title} />}
              <Line label="Viewing" value={`${watDay(d.starts_at)}, ${watTime(d.starts_at)} WAT`} />
              <Line label="Visit ID" value={<span className="font-mono text-[13px]">{d.visit_id}</span>} />
              <Line label="Fee" value={kobo(d.fee_kobo)} />
            </dl>
          )}

          <p className="mt-10 text-[14px] leading-relaxed text-muted">{view.next}</p>
        </div>
      )}

      <p className="mt-auto pt-16 text-[12px] text-faint">Paystack test mode. No real money moves.</p>
    </div>
  );
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-6 border-b border-line py-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

const BACK_CONFIRMED = "Go back to your WhatsApp chat. If the assistant hasn't confirmed yet, reply “paid”.";
const BACK_HELP = "Questions? Reply in your WhatsApp chat with Meridian Homes.";
const BACK_ALTERNATIVES = "Reply in your WhatsApp chat and the assistant will offer other times or homes.";

function describe(d: PublicPayment, now: number): View {
  const name = d.first_name ? `, ${d.first_name}` : "";
  const fee = kobo(d.fee_kobo);
  if (d.state === "confirmed") {
    return {
      tone: "ok",
      icon: Check,
      title: `You're booked${name}`,
      body: d.late_payment ? "Your payment came in after the hold, but the slot was still free, so it's yours. Bring a valid ID." : "Your viewing is confirmed. Bring a valid ID.",
      summary: true,
      next: BACK_CONFIRMED,
    };
  }
  if (d.payment_status === "success" && (d.state === "awaiting_payment" || d.state === "held" || d.state === "expired")) {
    return { tone: "info", icon: LoaderCircle, title: "Payment received", body: "Finishing your booking. This page updates by itself.", summary: true, next: BACK_CONFIRMED };
  }
  if (d.state === "awaiting_payment" || d.state === "held") {
    const left = d.hold_expires_at ? countdown(d.hold_expires_at, now) : "";
    if (d.payment_status === "failed") {
      return {
        tone: "bad",
        icon: X,
        title: "Payment didn't go through",
        body: `${d.gateway_response ? `${d.gateway_response}. ` : ""}Nothing was charged. Your slot is held for ${left} more.`,
        cta: d.payment_url ? { label: "Try another card", href: d.payment_url } : undefined,
        summary: true,
        next: BACK_HELP,
      };
    }
    return {
      tone: "warn",
      icon: Clock3,
      title: "Not paid yet",
      body: `Your slot is held until ${d.hold_expires_at ? watTime(d.hold_expires_at) : ""} WAT (${left} left).`,
      cta: d.payment_url ? { label: `Pay ${fee}`, href: d.payment_url } : undefined,
      summary: true,
      next: BACK_HELP,
    };
  }
  if (d.state === "expired") {
    return { tone: "muted", icon: Clock3, title: "Your hold has lapsed", body: "The 15 minutes ran out and nothing was charged.", summary: true, next: BACK_ALTERNATIVES };
  }
  if (d.state === "refunded" || (d.state === "cancelled" && d.refund_status)) {
    const why =
      d.refund_reason === "slot_taken"
        ? "Your payment arrived after the hold lapsed and the slot had been taken."
        : d.refund_reason === "listing_unavailable"
          ? "This home is no longer available."
          : d.refund_reason === "amount_mismatch"
            ? "The amount didn't match the visit fee."
            : "This visit was cancelled.";
    return { tone: "info", icon: RotateCcw, title: `${fee} refunded`, body: `${why} The full fee is going back to your card.`, summary: true, next: BACK_ALTERNATIVES };
  }
  return { tone: "muted", icon: X, title: "Visit cancelled", body: "Nothing more to pay.", summary: true, next: BACK_ALTERNATIVES };
}

function missing(): View {
  return {
    tone: "muted",
    icon: X,
    title: "Payment not found",
    body: "Open the link from your WhatsApp chat again, or ask the assistant for a new one.",
    summary: false,
    next: BACK_HELP,
  };
}
