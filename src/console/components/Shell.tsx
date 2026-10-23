import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api, auth, type Overview } from "../lib/api";
import { watTime } from "../lib/format";
import { Link, usePath, useNow } from "../lib/router";
import { cn, Logo } from "./ui";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/visits", label: "Visits" },
  { href: "/listings", label: "Listings" },
  { href: "/questions", label: "Questions" },
  { href: "/activity", label: "Activity" },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePath();
  const now = useNow(15_000);
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api<Overview>("/overview"), refetchInterval: 4000 });
  const open = overview.data?.kpis.open_questions ?? 0;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1080px] items-center gap-8 px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[14px] font-semibold tracking-[-0.01em]">Meridian</span>
          </Link>
          <nav className="-mb-px flex h-full gap-6 overflow-x-auto">
            {NAV.map(({ href, label }) => {
              const active = href === "/" ? path === "/" : path.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center border-b text-[13.5px] whitespace-nowrap transition-colors",
                    active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
                  )}
                >
                  {label}
                  {href === "/questions" && open > 0 && <span className="tnum ml-1.5 text-warn">{open}</span>}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-4 text-[12.5px] text-muted">
            <span className="tnum hidden sm:inline">{watTime(now)} WAT</span>
            <button
              onClick={() => {
                auth.clear();
                window.dispatchEvent(new Event("meridian:logout"));
              }}
              className="hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1080px] px-6 py-10">{children}</main>
    </div>
  );
}
