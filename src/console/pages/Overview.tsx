import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityFeed } from "../components/ActivityFeed";
import { Empty, Section, Skeleton } from "../components/ui";
import { VisitSheet } from "../components/VisitSheet";
import { api, type Activity, type Overview, type Visit } from "../lib/api";
import { countdown, greeting, kobo, relativeDay, watTime } from "../lib/format";
import { Link, useNow } from "../lib/router";

export function OverviewPage() {
  const now = useNow(1000);
  const [open, setOpen] = useState<string | null>(null);
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("/overview"), refetchInterval: 3000 });
  const activity = useQuery({ queryKey: ["activity", "recent"], queryFn: () => api<{ activity: Activity[] }>("/activity?limit=8"), refetchInterval: 3000 });
  const d = overview.data;
  const k = d?.kpis;
  const kept = (k?.collected_kobo ?? 0) - (k?.refunded_kobo ?? 0) - (k?.owed_kobo ?? 0);

  return (
    <>
      <h1 className="text-[20px] font-semibold tracking-[-0.015em]">{greeting(now)}</h1>

      <dl className="mt-8 grid grid-cols-3 border-y border-line">
        <Stat label="Upcoming visits" value={k?.confirmed_upcoming ?? 0} loading={!d} />
        <Stat label="Fees kept" value={kobo(kept)} loading={!d} />
        <Stat label="Open questions" value={k?.open_questions ?? 0} loading={!d} href="/questions" />
      </dl>

      {d && d.attention.length > 0 && (
        <button onClick={() => setOpen(d.attention[0].id)} className="mt-6 text-left text-[13.5px] text-bad hover:underline">
          {d.attention.length === 1 ? "1 refund failed at Paystack and needs you" : `${d.attention.length} refunds failed at Paystack and need you`} →
        </button>
      )}

      <div className="mt-12 grid gap-12 lg:grid-cols-2">
        <div className="space-y-12">
          {d && d.holds.length > 0 && (
            <Section title="Waiting for payment">
              <ul>
                {d.holds.map((v) => (
                  <VisitLine key={v.id} v={v} now={now} onOpen={() => setOpen(v.id)} right={<span className="tnum font-mono text-[13px] text-warn">{countdown(v.hold_expires_at!, now)}</span>} />
                ))}
              </ul>
            </Section>
          )}
          <Section title="Upcoming" action={<Link href="/visits" className="text-[13px] text-muted hover:text-ink">All visits</Link>}>
            {!d ? (
              <Skeleton className="h-24" />
            ) : d.upcoming.length === 0 ? (
              <Empty>No confirmed visits yet.</Empty>
            ) : (
              <ul>
                {d.upcoming.map((v) => (
                  <VisitLine key={v.id} v={v} now={now} onOpen={() => setOpen(v.id)} right={<span className="text-[13px] text-muted">{v.buyer_name}</span>} />
                ))}
              </ul>
            )}
          </Section>
        </div>

        <Section title="Recent activity" action={<Link href="/activity" className="text-[13px] text-muted hover:text-ink">View all</Link>}>
          {!activity.data ? (
            <Skeleton className="h-40" />
          ) : activity.data.activity.length === 0 ? (
            <Empty>Nothing yet. Message the agent in the simulator.</Empty>
          ) : (
            <ActivityFeed items={activity.data.activity} now={now} onVisit={setOpen} />
          )}
        </Section>
      </div>

      <VisitSheet visitId={open} onClose={() => setOpen(null)} />
    </>
  );
}

function Stat({ label, value, loading, href }: { label: string; value: React.ReactNode; loading?: boolean; href?: string }) {
  const inner = (
    <>
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="tnum mt-1 text-[24px] font-semibold tracking-[-0.02em]">{loading ? <Skeleton className="mt-1 h-7 w-14" /> : value}</dd>
    </>
  );
  return (
    <div className="border-l border-line px-5 py-5 first:border-l-0 first:pl-0">
      {href ? (
        <Link href={href} className="block transition-opacity hover:opacity-70">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </div>
  );
}

function VisitLine({ v, now, onOpen, right }: { v: Visit; now: number; onOpen: () => void; right: React.ReactNode }) {
  return (
    <li className="border-t border-line first:border-t-0">
      <button onClick={onOpen} className="flex w-full items-baseline gap-4 py-3 text-left">
        <span className="tnum w-28 shrink-0 text-[13px] text-muted">
          {relativeDay(v.starts_at, now)} {watTime(v.starts_at)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13.5px] hover:underline">{v.listing_title}</span>
        {right}
      </button>
    </li>
  );
}
