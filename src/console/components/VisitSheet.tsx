import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api, type Activity, type Visit } from "../lib/api";
import { countdown, humanise, kobo, watTime, watWhen } from "../lib/format";
import { useNow } from "../lib/router";
import { ActivityFeed } from "./ActivityFeed";
import { Button, Confirm, Row, Section, Sheet, Skeleton, VisitStatus } from "./ui";

export function VisitSheet({ visitId, onClose }: { visitId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const now = useNow(1000);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const q = useQuery({
    queryKey: ["visit", visitId],
    queryFn: () => api<{ now: number; visit: Visit; activity: Activity[] }>(`/visits/${visitId}`),
    enabled: Boolean(visitId),
    refetchInterval: 3000,
  });
  const v = q.data?.visit;
  const done = () => qc.invalidateQueries();

  const refresh = useMutation({
    mutationFn: () => api<{ visit: Visit; paystack_check: string }>(`/visits/${visitId}/refresh`, { method: "POST" }),
    onSuccess: (r) => {
      toast(r.paystack_check === "unavailable" ? "Paystack didn't respond" : `Paystack: ${r.visit.payment_status ?? "not paid"}`);
      done();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: () => api<{ visit: Visit }>(`/visits/${visitId}/cancel`, { method: "POST", json: { reason: "Cancelled by coordinator" } }),
    onSuccess: (r) => {
      setConfirmCancel(false);
      toast(r.visit.refund_kobo ? `Cancelled, ${kobo(r.visit.refund_kobo)} refunded` : "Cancelled");
      done();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const retry = useMutation({
    mutationFn: () => api<{ visit: Visit }>(`/visits/${visitId}/retry-refund`, { method: "POST" }),
    onSuccess: (r) => {
      toast(r.visit.refund_status === "failed" ? "Paystack refused the refund again" : "Refund accepted");
      done();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const holding = v && (v.effective_status === "awaiting_payment" || v.effective_status === "held");
  const cancellable = v && ["awaiting_payment", "held", "confirmed"].includes(v.effective_status) && v.starts_at > now;

  return (
    <Sheet
      open={Boolean(visitId)}
      onOpenChange={(o) => !o && onClose()}
      title={v?.listing_title ?? "Visit"}
      subtitle={v ? `${watWhen(v.starts_at)} WAT` : undefined}
      footer={
        v && (
          <>
            {v.refund_status === "failed" && (
              <Button variant="primary" loading={retry.isPending} onClick={() => retry.mutate()}>
                Retry refund
              </Button>
            )}
            {!v.paid_at && v.paystack_reference && (
              <Button loading={refresh.isPending} onClick={() => refresh.mutate()}>
                Check Paystack
              </Button>
            )}
            {cancellable && (
              <Button variant="danger" onClick={() => setConfirmCancel(true)}>
                Cancel visit
              </Button>
            )}
          </>
        )
      }
    >
      {!v ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <VisitStatus visit={v} />
            {holding && v.hold_expires_at && <span className="tnum font-mono text-[13px] text-warn">{countdown(v.hold_expires_at, now)}</span>}
          </div>

          {v.refund_status === "failed" && (
            <p className="text-[13.5px] text-bad">
              {kobo(v.refund_kobo)} refund owed. {v.refund_error}
            </p>
          )}

          <dl>
            <Row label="Buyer">{v.buyer_name}</Row>
            <Row label="Email">{v.buyer_email}</Row>
            <Row label="Visit ID" mono>{v.id}</Row>
            {holding && v.hold_expires_at && <Row label="Hold until">{watTime(v.hold_expires_at)} WAT</Row>}
            <Row label="Paid">{v.amount_paid_kobo ? `${kobo(v.amount_paid_kobo)}${v.late_payment ? " (late, re-held)" : ""}` : v.payment_note ? `No · ${v.payment_note}` : null}</Row>
            {v.refund_kobo != null && <Row label="Refund">{v.refund_kobo > 0 ? `${kobo(v.refund_kobo)} · ${humanise(v.refund_reason)}` : "Fee kept"}</Row>}
            <Row label="Reference" mono>{v.paystack_reference}</Row>
          </dl>

          {q.data && q.data.activity.length > 0 && (
            <Section title="History">
              <ActivityFeed items={[...q.data.activity].reverse()} now={now} expandable />
            </Section>
          )}
        </div>
      )}

      <Confirm
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this visit?"
        confirmLabel={v?.effective_status === "confirmed" ? `Cancel and refund ${kobo(v?.fee_kobo)}` : "Cancel hold"}
        danger
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      >
        {v?.effective_status === "confirmed" ? "Agency cancellations are always refunded in full. Let the buyer know in Chord." : "The slot reopens. Nothing was charged."}
      </Confirm>
    </Sheet>
  );
}
