import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Empty, Mono, PageTitle, Skeleton, Tabs, VisitStatus } from "../components/ui";
import { VisitSheet } from "../components/VisitSheet";
import { api, type Visit } from "../lib/api";
import { countdown, relativeDay, watTime } from "../lib/format";
import { useNow, useSearchParam } from "../lib/router";

type Filter = "all" | "holds" | "confirmed" | "closed";

const MATCH: Record<Filter, (v: Visit) => boolean> = {
  all: () => true,
  holds: (v) => v.effective_status === "awaiting_payment" || v.effective_status === "held",
  confirmed: (v) => v.effective_status === "confirmed",
  closed: (v) => ["refunded", "cancelled", "expired"].includes(v.effective_status),
};

export function VisitsPage() {
  const now = useNow(1000);
  const initial = useSearchParam("filter") as Filter | null;
  const [filter, setFilter] = useState<Filter>(initial && initial in MATCH ? initial : "all");
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["visits"], queryFn: () => api<{ now: number; visits: Visit[] }>("/visits"), refetchInterval: 4000 });
  const visits = q.data?.visits ?? [];
  const rows = useMemo(() => visits.filter(MATCH[filter]), [visits, filter]);
  const count = (f: Filter) => visits.filter(MATCH[f]).length;

  return (
    <>
      <PageTitle title="Visits">Confirmed only once Paystack confirms the fee.</PageTitle>

      <Tabs
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All" },
          { value: "holds", label: "Awaiting payment", count: count("holds") },
          { value: "confirmed", label: "Confirmed", count: count("confirmed") },
          { value: "closed", label: "Cancelled & refunded", count: count("closed") },
        ]}
      />

      {!q.data ? (
        <Skeleton className="mt-6 h-40" />
      ) : rows.length === 0 ? (
        <Empty>Nothing here.</Empty>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="text-[12.5px] text-faint">
              <th className="py-3 font-normal">When</th>
              <th className="py-3 font-normal">Property</th>
              <th className="hidden py-3 font-normal md:table-cell">Buyer</th>
              <th className="py-3 font-normal">Status</th>
              <th className="hidden py-3 text-right font-normal sm:table-cell">ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const holding = v.effective_status === "awaiting_payment" || v.effective_status === "held";
              return (
                <tr key={v.id} onClick={() => setOpen(v.id)} className="cursor-pointer border-t border-line transition-colors hover:bg-subtle">
                  <td className="tnum py-3 pr-4 text-[13.5px] whitespace-nowrap">
                    {relativeDay(v.starts_at, now)} <span className="text-muted">{watTime(v.starts_at)}</span>
                  </td>
                  <td className="max-w-[240px] truncate py-3 pr-4 text-[13.5px]">{v.listing_title}</td>
                  <td className="hidden max-w-[200px] truncate py-3 pr-4 text-[13.5px] text-muted md:table-cell">{v.buyer_name}</td>
                  <td className="py-3 pr-4">
                    <VisitStatus visit={v} />
                    {holding && v.hold_expires_at && <span className="tnum ml-2 font-mono text-[12px] text-warn">{countdown(v.hold_expires_at, now)}</span>}
                  </td>
                  <td className="hidden py-3 text-right sm:table-cell">
                    <Mono className="text-faint">{v.id}</Mono>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <VisitSheet visitId={open} onClose={() => setOpen(null)} />
    </>
  );
}
