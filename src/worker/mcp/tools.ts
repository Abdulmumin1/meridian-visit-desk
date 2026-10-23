import type { Ctx } from "../domain/context";
import { ToolError } from "../domain/context";
import { findAlternatives, listingDetail, resolveListing, searchListings, unavailableError } from "../domain/listings";
import { logUnanswered } from "../domain/questions";
import { nextOpenDays, slotsForDate } from "../domain/slots";
import { cancelVisitByBuyer, getVisitStatus, holdSlot } from "../domain/visits";
import { listingPath, photosFor } from "../lib/photos";

/** Add a shareable page link to every listing summary (Chord can only send text; the link unfurls into photos). */
function linkListings<T extends { listing_id: string }>(ctx: Ctx, items: T[]) {
  return items.map((l) => ({ ...l, listing_page: `${ctx.origin}${listingPath(l.listing_id)}` }));
}

type JsonSchema = Record<string, unknown>;

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: Record<string, boolean>;
  run: (ctx: Ctx, args: Record<string, unknown>) => Promise<unknown>;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? undefined : String(v));
const num = (v: unknown) => {
  if (v == null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[₦,\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

const LISTING_ID = {
  type: "string",
  description: "Listing ID (e.g. MH-001) or the street address the buyer used (e.g. '14 Admiralty Way').",
};

export const TOOLS: ToolDef[] = [
  {
    name: "search_listings",
    title: "Search available listings",
    description:
      "Find AVAILABLE Meridian Homes listings (Lekki and Yaba). Use when the buyer describes what they want rather than naming a property. Returns at most 8, cheapest first. Rent prices are per year.",
    inputSchema: {
      type: "object",
      properties: {
        area: { type: "string", description: "Lekki or Yaba (neighbourhoods like Ikate or Akoka also work)." },
        bedrooms: { type: "integer", minimum: 1, maximum: 6 },
        max_price_ngn: { type: "integer", description: "Maximum price in naira. For rentals this is the annual rent." },
        listing_type: { type: "string", enum: ["rent", "sale"] },
        query: { type: "string", description: "Free text matched against street, neighbourhood and property type." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: async (ctx, a) => {
      const r = await searchListings(ctx.db, {
        area: str(a.area),
        bedrooms: num(a.bedrooms),
        max_price_ngn: num(a.max_price_ngn),
        listing_type: str(a.listing_type),
        query: str(a.query),
      });
      return { ...r, listings: linkListings(ctx, r.listings) };
    },
  },
  {
    name: "get_listing",
    title: "Get listing facts",
    description:
      "The ONLY source of truth for a listing: status, price, recorded amenities, which amenities are NOT recorded, and answers the agency has added. Call it before answering any question about a property. Also returns `listing_page`, a link with photos to share with the buyer. If the listing is let, sold or under offer, it also returns up to two alternatives.",
    inputSchema: {
      type: "object",
      properties: { listing_id: LISTING_ID },
      required: ["listing_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: async (ctx, a) => {
      const l = await resolveListing(ctx.db, str(a.listing_id) ?? "");
      const detail = {
        ...(await listingDetail(ctx.db, l)),
        listing_page: `${ctx.origin}${listingPath(l.id)}`,
        photos: photosFor(l.id).map((p) => `${ctx.origin}${p}`),
      };
      if (l.status !== "available") {
        return { ...detail, bookable: false, alternatives: linkListings(ctx, await findAlternatives(ctx.db, l)) };
      }
      return { ...detail, bookable: true };
    },
  },
  {
    name: "check_slots",
    title: "Check viewing times",
    description:
      "Viewing times for a listing in WAT. Pass `date` (YYYY-MM-DD, WAT) for one day; omit it to get the next 3 days with open times. `available: false` means taken or held by someone else: never offer it. Viewings run Mon-Fri 10:00-16:00 and Sat 10:00-14:00, none on Sunday, at least 1 hour ahead.",
    inputSchema: {
      type: "object",
      properties: {
        listing_id: LISTING_ID,
        date: { type: "string", description: "YYYY-MM-DD in WAT. Work it out from `now` in any previous tool result." },
      },
      required: ["listing_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    run: async (ctx, a) => {
      const l = await resolveListing(ctx.db, str(a.listing_id) ?? "");
      if (l.status !== "available") throw unavailableError(l, await findAlternatives(ctx.db, l));
      const date = str(a.date)?.trim();
      const listing = { listing_id: l.id, title: l.title };
      if (date) {
        const day = await slotsForDate(ctx.db, l.id, date, ctx.now());
        if (day.open_count === 0) {
          return { listing, ...day, next_open_days: await nextOpenDays(ctx.db, l.id, ctx.now(), 2) };
        }
        return { listing, ...day };
      }
      return { listing, days: await nextOpenDays(ctx.db, l.id, ctx.now(), 3) };
    },
  },
  {
    name: "hold_slot",
    title: "Hold a viewing slot and create the payment link",
    description:
      "Holds a viewing slot for 15 minutes and creates a ₦5,000 Paystack payment link. Re-checks that the listing is still available. Needs the buyer's name and email (Paystack requires an email). The visit is NOT confirmed by this call. Errors: SLOT_HELD (offer the returned alternatives), LISTING_UNAVAILABLE (offer the alternative homes), PAYSTACK_UNAVAILABLE (nothing held; ask them to try again shortly).",
    inputSchema: {
      type: "object",
      properties: {
        listing_id: LISTING_ID,
        slot_id: { type: "string", description: "slot_id exactly as returned by check_slots." },
        buyer_name: { type: "string" },
        buyer_email: { type: "string", format: "email" },
        buyer_phone: { type: "string", description: "Optional. The buyer's WhatsApp number if known." },
      },
      required: ["listing_id", "slot_id", "buyer_name", "buyer_email"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: (ctx, a) =>
      holdSlot(ctx, {
        listing_id: str(a.listing_id) ?? "",
        slot_id: str(a.slot_id) ?? "",
        buyer_name: str(a.buyer_name) ?? "",
        buyer_email: str(a.buyer_email) ?? "",
        buyer_phone: str(a.buyer_phone),
      }),
  },
  {
    name: "get_visit_status",
    title: "Get visit and payment status",
    description:
      "Current state of a visit. If payment hasn't been recorded yet it checks with Paystack first, so call it whenever the buyer says they've paid. Only outcome CONFIRMED or CONFIRMED_LATE_PAYMENT means the visit is booked. Look up by visit_id, or by buyer_email if you don't have the ID. Relay `summary_for_buyer` in your own words and offer any `alternatives`.",
    inputSchema: {
      type: "object",
      properties: {
        visit_id: { type: "string", description: "e.g. V-7K2Q9M" },
        buyer_email: { type: "string", description: "Fallback lookup when the visit ID is unknown." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
    run: (ctx, a) => getVisitStatus(ctx, { visit_id: str(a.visit_id), buyer_email: str(a.buyer_email) }),
  },
  {
    name: "cancel_visit",
    title: "Cancel a visit",
    description:
      "Cancels a visit and applies the refund policy automatically: 24+ hours before the visit = full ₦5,000 refund; under 24 hours = fee kept; unpaid hold = released with nothing charged. Confirm with the buyer before calling. Returns the outcome and refund amount to tell the buyer.",
    inputSchema: {
      type: "object",
      properties: {
        visit_id: { type: "string" },
        reason: { type: "string", description: "Optional short reason in the buyer's words." },
      },
      required: ["visit_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    run: (ctx, a) => cancelVisitByBuyer(ctx, str(a.visit_id) ?? "", str(a.reason)),
  },
  {
    name: "log_unanswered",
    title: "Log a question the listing data can't answer",
    description:
      "Records a buyer question that get_listing does not answer (for example a missing generator size) in the agency coordinator's queue. Call it instead of guessing. Do not use it for complaints, price disputes or legal questions: hand those to a human.",
    inputSchema: {
      type: "object",
      properties: {
        listing_id: LISTING_ID,
        question: { type: "string", description: "The specific question, e.g. 'What size is the generator?'" },
      },
      required: ["listing_id", "question"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
    run: (ctx, a) => logUnanswered(ctx, { listing_id: str(a.listing_id) ?? "", question: str(a.question) ?? "" }),
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

export function findTool(name: string) {
  return TOOLS.find((t) => t.name === name);
}

export { ToolError };
