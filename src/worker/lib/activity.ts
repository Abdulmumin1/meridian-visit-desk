export type ActivitySource = "agent" | "paystack" | "console" | "system";

export interface ActivityInput {
  source: ActivitySource;
  action: string;
  summary: string;
  ok?: boolean;
  visitId?: string | null;
  listingId?: string | null;
  durationMs?: number;
  detail?: unknown;
}

const MAX_DETAIL = 6000;

/** Append-only audit trail. Never throws: logging must not break a booking. */
export async function logActivity(db: D1Database, now: number, a: ActivityInput): Promise<void> {
  try {
    let detail: string | null = null;
    if (a.detail !== undefined) {
      detail = JSON.stringify(a.detail);
      if (detail.length > MAX_DETAIL) detail = detail.slice(0, MAX_DETAIL) + "…[truncated]";
    }
    await db
      .prepare(
        `INSERT INTO activity (at, source, action, ok, visit_id, listing_id, duration_ms, summary, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(now, a.source, a.action, a.ok === false ? 0 : 1, a.visitId ?? null, a.listingId ?? null, a.durationMs ?? null, a.summary, detail)
      .run();
  } catch (err) {
    console.error("activity log failed", err);
  }
}
