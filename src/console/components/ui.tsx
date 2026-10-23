import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { LoaderCircle, X } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { ListingStatus, Visit } from "../lib/api";

export const cn = clsx;

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="8" fill="var(--color-brand)" />
      <path d="M9 22V12.5L16 9l7 3.5V22" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M13.5 22v-5h5v5" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
        "disabled:pointer-events-none disabled:opacity-40",
        variant === "primary" && "bg-ink text-white hover:bg-ink-2",
        variant === "secondary" && "border border-line bg-bg text-ink hover:bg-subtle",
        variant === "ghost" && "text-muted hover:bg-subtle hover:text-ink",
        variant === "danger" && "border border-line bg-bg text-bad hover:bg-[#fdf3f2]",
        className,
      )}
      {...rest}
    >
      {loading && <LoaderCircle className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Status: a dot and a word
// ---------------------------------------------------------------------------

type Tone = "ok" | "warn" | "bad" | "info" | "violet" | "muted";
const DOT: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  bad: "bg-bad",
  info: "bg-info",
  violet: "bg-violet",
  muted: "bg-faint",
};

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] whitespace-nowrap text-ink-2">
      <span className={cn("size-1.5 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}

export function visitStatus(v: Pick<Visit, "effective_status" | "refund_status" | "cancel_reason">): { tone: Tone; label: string } {
  if (v.refund_status === "failed") return { tone: "bad", label: "Refund failed" };
  switch (v.effective_status) {
    case "confirmed":
      return { tone: "ok", label: "Confirmed" };
    case "awaiting_payment":
    case "held":
      return { tone: "warn", label: "Awaiting payment" };
    case "expired":
      return { tone: "muted", label: "Hold lapsed" };
    case "refunded":
      return { tone: "info", label: "Refunded" };
    case "cancelled":
      return { tone: "muted", label: v.cancel_reason === "buyer_cancelled_under_24h" ? "Cancelled, fee kept" : "Cancelled" };
  }
}

export function VisitStatus({ visit }: { visit: Pick<Visit, "effective_status" | "refund_status" | "cancel_reason"> }) {
  const s = visitStatus(visit);
  return <Status tone={s.tone}>{s.label}</Status>;
}

export const LISTING_STATUS: Record<ListingStatus, { tone: Tone; label: string }> = {
  available: { tone: "ok", label: "Available" },
  under_offer: { tone: "warn", label: "Under offer" },
  let: { tone: "violet", label: "Let" },
  sold: { tone: "info", label: "Sold" },
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function PageTitle({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[20px] font-semibold tracking-[-0.015em]">{title}</h1>
        {children && <p className="mt-1 text-[13.5px] text-muted">{children}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[13px] font-medium text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="border-t border-line py-6 text-[13.5px] text-faint">{children}</p>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-subtle", className)} />;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12.5px]", className)}>{children}</span>;
}

export function Tabs<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; count?: number }>;
}) {
  return (
    <div className="flex gap-5 border-b border-line">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "-mb-px border-b pb-2.5 text-[13.5px] transition-colors",
            value === o.value ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {o.label}
          {o.count !== undefined && o.count > 0 && <span className="tnum ml-1.5 text-faint">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Row({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-t border-line py-2.5 first:border-t-0">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className={cn("min-w-0 text-right text-[13.5px] break-words", mono && "font-mono text-[12.5px]")}>{children ?? <span className="text-faint">—</span>}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet and confirm
// ---------------------------------------------------------------------------

export function Sheet({ open, onOpenChange, title, subtitle, children, footer }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/10 data-[state=open]:animate-fade" />
        <Dialog.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed inset-y-0 right-0 z-50 flex w-[min(480px,100vw)] flex-col border-l border-line bg-bg outline-none data-[state=open]:animate-slide"
        >
          <div className="flex items-start gap-3 px-6 pt-6 pb-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-[16px] font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
              {subtitle && <Dialog.Description className="mt-0.5 text-[13px] text-muted">{subtitle}</Dialog.Description>}
            </div>
            <Dialog.Close className="-mr-1.5 grid size-7 place-items-center rounded-md text-muted hover:bg-subtle hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-6 pb-6">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-3.5">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Confirm({ open, onOpenChange, title, children, confirmLabel, danger, loading, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/15 data-[state=open]:animate-fade" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-[70] w-[min(400px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-bg p-5 outline-none data-[state=open]:animate-fade">
          <Dialog.Title className="text-[15px] font-semibold">{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="mt-2 text-[13.5px] leading-relaxed text-muted">{children}</div>
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
            <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
