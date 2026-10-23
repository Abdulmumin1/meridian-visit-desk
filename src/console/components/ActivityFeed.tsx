import { useState } from "react";
import type { Activity } from "../lib/api";
import { ago, watWhen } from "../lib/format";
import { cn } from "./ui";

const SOURCE: Record<Activity["source"], string> = {
  agent: "Agent",
  paystack: "Paystack",
  console: "Console",
  system: "System",
};

export function ActivityFeed({ items, now, expandable = false, onVisit }: { items: Activity[]; now: number; expandable?: boolean; onVisit?: (id: string) => void }) {
  return (
    <ul>
      {items.map((a) => (
        <Item key={a.id} a={a} now={now} expandable={expandable} onVisit={onVisit} />
      ))}
    </ul>
  );
}

function Item({ a, now, expandable, onVisit }: { a: Activity; now: number; expandable: boolean; onVisit?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const canExpand = expandable && Boolean(a.detail);
  return (
    <li className="border-t border-line first:border-t-0">
      <div
        className={cn("grid grid-cols-[72px_1fr_auto] items-baseline gap-4 py-2.5", canExpand && "cursor-pointer")}
        onClick={() => canExpand && setOpen((o) => !o)}
      >
        <span className={cn("text-[12.5px]", a.ok ? "text-faint" : "text-bad")}>{SOURCE[a.source]}</span>
        <span className={cn("min-w-0 text-[13.5px]", a.ok ? "text-ink-2" : "text-bad")}>
          {a.summary}
          {a.duration_ms != null && <span className="tnum ml-2 text-[12px] text-faint">{a.duration_ms} ms</span>}
          {a.visit_id && onVisit && !a.summary.includes(a.visit_id) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onVisit(a.visit_id!);
              }}
              className="ml-2 font-mono text-[12px] text-faint hover:text-ink"
            >
              {a.visit_id}
            </button>
          )}
        </span>
        <span className="text-[12.5px] whitespace-nowrap text-faint" title={watWhen(a.at)}>
          {ago(a.at, now)}
        </span>
      </div>
      {open && a.detail && (
        <pre className="mb-3 ml-[88px] max-h-80 overflow-auto rounded-md bg-subtle p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">
          {pretty(a.detail)}
        </pre>
      )}
    </li>
  );
}

function pretty(s: string) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
