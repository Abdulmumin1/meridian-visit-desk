import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityFeed } from "../components/ActivityFeed";
import { Empty, PageTitle, Skeleton, Tabs } from "../components/ui";
import { VisitSheet } from "../components/VisitSheet";
import { api, type Activity } from "../lib/api";
import { useNow } from "../lib/router";

type Source = "all" | "agent" | "paystack" | "errors";

export function ActivityPage() {
  const now = useNow(5000);
  const [source, setSource] = useState<Source>("all");
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["activity", "all"], queryFn: () => api<{ activity: Activity[] }>("/activity?limit=300"), refetchInterval: 3000 });
  const items = useMemo(
    () => (q.data?.activity ?? []).filter((a) => source === "all" || (source === "errors" ? a.ok === 0 : a.source === source)),
    [q.data, source],
  );

  return (
    <>
      <PageTitle title="Activity">Every tool call and payment event. Click a row for the raw request.</PageTitle>
      <Tabs
        value={source}
        onChange={setSource}
        options={[
          { value: "all", label: "All" },
          { value: "agent", label: "Agent" },
          { value: "paystack", label: "Paystack" },
          { value: "errors", label: "Errors", count: (q.data?.activity ?? []).filter((a) => a.ok === 0).length },
        ]}
      />
      {!q.data ? <Skeleton className="mt-6 h-60" /> : items.length === 0 ? <Empty>Nothing logged.</Empty> : <ActivityFeed items={items} now={now} expandable onVisit={setOpen} />}
      <VisitSheet visitId={open} onClose={() => setOpen(null)} />
    </>
  );
}
