import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Confirm, Empty, LISTING_STATUS, PageTitle, Row, Section, Sheet, Skeleton, Status, Tabs, VisitStatus } from "../components/ui";
import { VisitSheet } from "../components/VisitSheet";
import { api, type Listing, type ListingDetail, type ListingStatus } from "../lib/api";
import { compactNaira, kobo, naira, relativeDay, watTime } from "../lib/format";
import { useNow } from "../lib/router";

type AreaFilter = "all" | "Lekki" | "Yaba";

export function ListingsPage() {
  const [area, setArea] = useState<AreaFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["listings"], queryFn: () => api<{ listings: Listing[] }>("/listings"), refetchInterval: 6000 });
  const rows = useMemo(() => (q.data?.listings ?? []).filter((l) => area === "all" || l.area === area), [q.data, area]);

  return (
    <>
      <PageTitle title="Listings">The agent answers only from this data. Mark a home let and it stops offering it.</PageTitle>

      <Tabs
        value={area}
        onChange={setArea}
        options={[
          { value: "all", label: "All" },
          { value: "Lekki", label: "Lekki" },
          { value: "Yaba", label: "Yaba" },
        ]}
      />

      {!q.data ? (
        <Skeleton className="mt-6 h-60" />
      ) : rows.length === 0 ? (
        <Empty>No listings.</Empty>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="text-[12.5px] text-faint">
              <th className="py-3 font-normal">Address</th>
              <th className="hidden py-3 font-normal md:table-cell">Home</th>
              <th className="py-3 text-right font-normal">Price</th>
              <th className="py-3 pl-8 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} onClick={() => setOpen(l.id)} className="cursor-pointer border-t border-line transition-colors hover:bg-subtle">
                <td className="py-3 pr-4">
                  <div className="text-[13.5px]">{l.title}</div>
                  <div className="text-[12.5px] text-muted">{l.neighbourhood}</div>
                </td>
                <td className="hidden py-3 pr-4 text-[13.5px] text-muted md:table-cell">
                  {l.bedrooms}-bed {l.property_type.toLowerCase()}
                </td>
                <td className="tnum py-3 text-right text-[13.5px] whitespace-nowrap">
                  {compactNaira(l.price_ngn)}
                  <span className="text-muted">{l.listing_type === "rent" ? "/yr" : ""}</span>
                </td>
                <td className="py-3 pl-8" onClick={(e) => e.stopPropagation()}>
                  <StatusMenu listing={l} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ListingSheet id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function StatusMenu({ listing }: { listing: Pick<Listing, "id" | "title" | "status"> }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<ListingStatus | null>(null);
  const impact = useQuery({
    queryKey: ["impact", listing.id, pending],
    queryFn: () => api<{ confirmed: number; holds: number }>(`/listings/${listing.id}/impact`),
    enabled: Boolean(pending && pending !== "available"),
  });
  const change = useMutation({
    mutationFn: (status: ListingStatus) => api<{ affected: unknown[] }>(`/listings/${listing.id}/status`, { method: "POST", json: { status } }),
    onSuccess: (r, status) => {
      setPending(null);
      toast(`${listing.title} is now ${LISTING_STATUS[status].label.toLowerCase()}${r.affected.length ? `. ${r.affected.length} visit(s) cancelled and refunded.` : ""}`);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const pick = (s: ListingStatus) => {
    if (s === listing.status) return;
    if (s === "available") change.mutate(s);
    else setPending(s);
  };
  const conf = impact.data?.confirmed ?? 0;
  const holds = impact.data?.holds ?? 0;
  const label = pending ? LISTING_STATUS[pending].label.toLowerCase() : "";

  return (
    <>
      <Dropdown.Root>
        <Dropdown.Trigger className="group inline-flex items-center gap-1 rounded-md outline-none">
          <Status tone={LISTING_STATUS[listing.status].tone}>{LISTING_STATUS[listing.status].label}</Status>
          <ChevronDown className="size-3.5 text-faint group-hover:text-ink" />
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content align="start" sideOffset={6} className="z-50 min-w-40 rounded-lg border border-line bg-bg p-1 data-[state=open]:animate-fade">
            {(Object.keys(LISTING_STATUS) as ListingStatus[]).map((s) => (
              <Dropdown.Item
                key={s}
                onSelect={() => pick(s)}
                className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-subtle"
              >
                <Status tone={LISTING_STATUS[s].tone}>{LISTING_STATUS[s].label}</Status>
                {s === listing.status && <Check className="size-3.5" />}
              </Dropdown.Item>
            ))}
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>

      <Confirm
        open={Boolean(pending)}
        onOpenChange={(o) => !o && setPending(null)}
        title={`Mark as ${label}?`}
        confirmLabel={`Mark ${label}`}
        danger={conf + holds > 0}
        loading={change.isPending}
        onConfirm={() => pending && change.mutate(pending)}
      >
        {impact.isLoading ? (
          "Checking bookings…"
        ) : conf + holds === 0 ? (
          <>The agent will stop offering {listing.title} and suggest similar homes.</>
        ) : (
          <>
            {conf > 0 && <>{conf} confirmed visit{conf > 1 ? "s" : ""} will be cancelled and refunded ({kobo(conf * 500_000)}). </>}
            {holds > 0 && <>{holds} hold{holds > 1 ? "s" : ""} will be released. </>}
            The agent will suggest similar homes instead.
          </>
        )}
      </Confirm>
    </>
  );
}

function ListingSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const now = useNow(5000);
  const [openVisit, setOpenVisit] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["listing", id], queryFn: () => api<ListingDetail>(`/listings/${id}`), enabled: Boolean(id) });
  const l = q.data?.listing;

  return (
    <>
      <Sheet
        open={Boolean(id)}
        onOpenChange={(o) => !o && onClose()}
        title={l?.title ?? "Listing"}
        subtitle={l ? `${l.neighbourhood} · ${l.bedrooms}-bed ${l.property_type.toLowerCase()} · ${naira(l.price_ngn)}${l.listing_type === "rent" ? " per year" : ""}` : undefined}
      >
        {!q.data || !l ? (
          <Skeleton className="h-60" />
        ) : (
          <div className="space-y-8">
            <StatusMenu listing={l} />

            <Section title="What the agent knows">
              <dl>
                {Object.entries(l.recorded).map(([k, v]) => (
                  <Row key={k} label={k}>
                    <span className={v === "No" ? "text-faint" : undefined}>{v}</span>
                  </Row>
                ))}
              </dl>
              {l.not_recorded.length > 0 && (
                <p className="mt-3 text-[13px] text-muted">
                  Not recorded, so the agent won't guess: <span className="text-ink-2">{l.not_recorded.join(", ")}</span>
                </p>
              )}
            </Section>

            {q.data.questions.length > 0 && (
              <Section title="Buyer questions">
                <ul>
                  {q.data.questions.map((qq) => (
                    <li key={qq.id} className="border-t border-line py-2.5 text-[13.5px] first:border-t-0">
                      {qq.question}
                      <div className="text-[13px] text-muted">{qq.answer ?? "Not answered yet"}</div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {q.data.visits.length > 0 && (
              <Section title="Visits">
                <ul>
                  {q.data.visits.map((v) => (
                    <li key={v.id} className="border-t border-line first:border-t-0">
                      <button onClick={() => setOpenVisit(v.id)} className="flex w-full items-baseline gap-4 py-2.5 text-left">
                        <span className="tnum w-28 text-[13px] text-muted">
                          {relativeDay(v.starts_at, now)} {watTime(v.starts_at)}
                        </span>
                        <span className="flex-1 truncate text-[13.5px]">{v.buyer_name}</span>
                        <VisitStatus visit={v} />
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        )}
      </Sheet>
      <VisitSheet visitId={openVisit} onClose={() => setOpenVisit(null)} />
    </>
  );
}
