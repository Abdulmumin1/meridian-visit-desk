const TZ = "Africa/Lagos"; // WAT, UTC+1

const nf = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 });
export const naira = (n: number) => `₦${nf.format(n)}`;
export const kobo = (k: number | null | undefined) => naira(Math.round((k ?? 0) / 100));

/** ₦18m, ₦450k, ₦1.25m */
export function compactNaira(n: number) {
  if (n >= 1_000_000) return `₦${+(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2)}m`;
  if (n >= 1_000) return `₦${Math.round(n / 1_000)}k`;
  return naira(n);
}

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
const longDayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const dateKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export const watTime = (ms: number) => timeFmt.format(ms);
const weekdayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" });
/** "Today" or "Sat", for compact date blocks. */
export const dayChip = (ms: number, now: number) => (dateKeyFmt.format(ms) === dateKeyFmt.format(now) ? "Today" : weekdayFmt.format(ms));
export const watDay = (ms: number) => dayFmt.format(ms);
export const watLongDay = (ms: number) => longDayFmt.format(ms);
export const watDateKey = (ms: number) => dateKeyFmt.format(ms);
export const watWhen = (ms: number) => `${watDay(ms)} · ${watTime(ms)}`;

/** "Today", "Tomorrow", or "Sat 24 Oct". */
export function relativeDay(ms: number, now: number) {
  const a = watDateKey(ms);
  if (a === watDateKey(now)) return "Today";
  if (a === watDateKey(now + 86_400_000)) return "Tomorrow";
  if (a === watDateKey(now - 86_400_000)) return "Yesterday";
  return watDay(ms);
}

export function ago(ms: number, now: number) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return watDay(ms);
}

export function until(ms: number, now: number) {
  const s = Math.round((ms - now) / 1000);
  if (s <= 0) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h}h ${m % 60}m`;
  return `in ${Math.round(h / 24)} days`;
}

/** mm:ss countdown. */
export function countdown(ms: number, now: number) {
  const s = Math.max(0, Math.round((ms - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const greeting = (now: number) => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hour12: false }).format(now));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export const humanise = (s: string | null | undefined) =>
  (s ?? "").replace(/_/g, " ").replace(/\b24h plus\b/, "24h+").replace(/^\w/, (c) => c.toUpperCase());
