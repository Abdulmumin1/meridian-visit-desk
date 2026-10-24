import { normaliseListingId } from "../lib/ids";
import { naira } from "../lib/money";
import { ToolError, type ListingRow, type QuestionRow } from "./context";

type AmenityValue = string | number | boolean | null;

/** Human labels, in the order the agent should read them. Unknown keys fall back to a prettified key. */
const LABELS: Record<string, string> = {
  borehole: "Borehole",
  water_treatment: "Water treatment",
  power_supply: "Grid power band",
  prepaid_meter: "Prepaid meter",
  inverter: "Inverter",
  solar: "Solar",
  generator: "Generator",
  generator_kva: "Generator size (kVA)",
  gated_estate: "Gated estate",
  security_guards: "Security guards",
  cctv: "CCTV",
  parking_spaces: "Parking spaces",
  boys_quarters: "Boys' quarters (BQ)",
  fitted_kitchen: "Fitted kitchen",
  air_conditioning: "Air conditioning",
  furnished: "Furnishing",
  ensuite_bedrooms: "Ensuite bedrooms",
  swimming_pool: "Swimming pool",
  gym: "Gym",
  internet: "Internet",
  service_charge_ngn: "Service charge",
  pets_allowed: "Pets allowed",
  year_built: "Year built",
  title_document: "Title document",
};

const label = (k: string) => LABELS[k] ?? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function formatValue(key: string, v: Exclude<AmenityValue, null>): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (key === "service_charge_ngn" && typeof v === "number") return `${naira(v)} per year`;
  return String(v);
}

/**
 * Split amenities into recorded facts and gaps. A null value means the agency has
 * not recorded it. A generator size is only meaningful when there is a generator.
 */
export function presentAmenities(raw: string) {
  const a = JSON.parse(raw) as Record<string, AmenityValue>;
  const recorded: Record<string, string> = {};
  const notRecorded: string[] = [];
  const keys = [...Object.keys(LABELS).filter((k) => k in a), ...Object.keys(a).filter((k) => !(k in LABELS))];
  for (const k of keys) {
    if (k === "generator_kva" && a.generator !== true) continue;
    const v = a[k];
    if (v === null || v === undefined) notRecorded.push(label(k));
    else recorded[label(k)] = formatValue(k, v);
  }
  return { recorded, notRecorded };
}

export function priceLabel(l: Pick<ListingRow, "listing_type" | "price_ngn">) {
  return l.listing_type === "rent" ? `${naira(l.price_ngn)} per year (rent)` : `${naira(l.price_ngn)} (sale)`;
}

export function listingSummary(l: ListingRow) {
  return {
    listing_id: l.id,
    title: l.title,
    neighbourhood: l.neighbourhood,
    area: l.area,
    property: `${l.bedrooms}-bed ${l.property_type.toLowerCase()}`,
    listing_type: l.listing_type,
    price: priceLabel(l),
    bedrooms: l.bedrooms,
    bathrooms: l.bathrooms,
  };
}

export async function getListingRow(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM listings WHERE id = ?").bind(id).first<ListingRow>();
}

/**
 * Resolve what the buyer or agent typed (an ID like "MH-001" or an address like
 * "14 Admiralty Way") to exactly one listing. Ambiguity is an error with candidates,
 * never a guess.
 */
export async function resolveListing(db: D1Database, ref: string): Promise<ListingRow> {
  const input = (ref ?? "").trim();
  if (!input) throw new ToolError("INVALID_INPUT", "listing_id is required");

  const id = normaliseListingId(input);
  if (id) {
    const row = await getListingRow(db, id);
    if (row) return row;
  }

  const needle = input.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const exact = await db
    .prepare("SELECT * FROM listings WHERE lower(title) = ?")
    .bind(needle)
    .all<ListingRow>();
  if (exact.results.length === 1) return exact.results[0];

  const like = await db
    .prepare("SELECT * FROM listings WHERE lower(title) LIKE ? OR lower(title || ' ' || neighbourhood) LIKE ? LIMIT 6")
    .bind(`%${needle}%`, `%${needle}%`)
    .all<ListingRow>();
  if (like.results.length === 1) return like.results[0];
  if (like.results.length > 1) {
    throw new ToolError("AMBIGUOUS_LISTING", `More than one listing matches "${input}". Ask the buyer which one.`, 400, {
      candidates: like.results.map(listingSummary),
    });
  }
  throw new ToolError("NOT_FOUND", `No Meridian Homes listing matches "${input}". Use search_listings to find it.`, 404);
}

/**
 * R3 alternatives: available listings of the same type (rent vs sale) with price
 * within ±15% and bedrooms within ±1, same area first, then closest price.
 */
export async function findAlternatives(db: D1Database, l: ListingRow, limit = 2) {
  const rows = await db
    .prepare(
      `SELECT * FROM listings
       WHERE status = 'available' AND id != ? AND listing_type = ?
         AND price_ngn BETWEEN ? AND ?
         AND bedrooms BETWEEN ? AND ?
       ORDER BY (area = ?) DESC, ABS(price_ngn - ?) ASC
       LIMIT ?`,
    )
    .bind(l.id, l.listing_type, Math.floor(l.price_ngn * 0.85), Math.ceil(l.price_ngn * 1.15), l.bedrooms - 1, l.bedrooms + 1, l.area, l.price_ngn, limit)
    .all<ListingRow>();
  return rows.results.map(listingSummary);
}

export function unavailableError(l: ListingRow, alternatives: ReturnType<typeof listingSummary>[]) {
  const word = { let: "has been let", sold: "has been sold", under_offer: "is under offer", available: "is available" }[l.status];
  return new ToolError("LISTING_UNAVAILABLE", `${l.title} ${word}, so it cannot be viewed or booked.`, 409, {
    listing_status: l.status,
    alternatives,
    alternatives_rule: "Same type (rent/sale), price within ±15%, bedrooms within ±1, same area first.",
  });
}

export async function searchListings(
  db: D1Database,
  q: { area?: string; bedrooms?: number; max_price_ngn?: number; listing_type?: string; query?: string },
) {
  const where = ["status = 'available'"];
  const binds: unknown[] = [];
  if (q.area) {
    const area = q.area.trim().toLowerCase();
    if (area.includes("lekki") || area.includes("ikate") || area.includes("chevron") || area.includes("osapa") || area.includes("agungi")) {
      where.push("area = 'Lekki'");
    } else if (area.includes("yaba") || area.includes("akoka") || area.includes("sabo") || area.includes("onike") || area.includes("jibowu")) {
      where.push("area = 'Yaba'");
    } else {
      where.push("(lower(area) = ? OR lower(neighbourhood) LIKE ?)");
      binds.push(area, `%${area}%`);
    }
  }
  if (q.bedrooms) {
    where.push("bedrooms = ?");
    binds.push(q.bedrooms);
  }
  if (q.max_price_ngn) {
    where.push("price_ngn <= ?");
    binds.push(q.max_price_ngn);
  }
  if (q.listing_type === "rent" || q.listing_type === "sale") {
    where.push("listing_type = ?");
    binds.push(q.listing_type);
  }
  if (q.query) {
    where.push("(lower(title) LIKE ? OR lower(neighbourhood) LIKE ? OR lower(property_type) LIKE ?)");
    const like = `%${q.query.trim().toLowerCase()}%`;
    binds.push(like, like, like);
  }
  const sql = `SELECT * FROM listings WHERE ${where.join(" AND ")} ORDER BY price_ngn ASC`;
  const rows = await db.prepare(sql).bind(...binds).all<ListingRow>();
  const results = rows.results;
  return {
    total_matches: results.length,
    listings: results.slice(0, 8).map((l) => {
      const { recorded } = presentAmenities(l.amenities);
      const highlights = ["Grid power band", "Inverter", "Generator", "Gated estate", "Security guards", "CCTV", "Borehole", "Boys' quarters (BQ)", "Furnishing"]
        .filter((k) => recorded[k] && recorded[k] !== "No")
        .map((k) => (recorded[k] === "Yes" ? k : `${k}: ${recorded[k]}`));
      return { ...listingSummary(l), highlights };
    }),
    note: results.length > 8 ? "Showing the 8 cheapest matches. Narrow the search for more." : undefined,
  };
}

export async function listingDetail(db: D1Database, l: ListingRow) {
  const { recorded, notRecorded } = presentAmenities(l.amenities);
  const qs = await db
    .prepare("SELECT * FROM unanswered_questions WHERE listing_id = ? ORDER BY asked_at DESC LIMIT 20")
    .bind(l.id)
    .all<QuestionRow>();
  return {
    ...listingSummary(l),
    status: l.status,
    description: l.description,
    amenities: recorded,
    not_recorded: notRecorded,
    answered_by_agency: qs.results
      .filter((q) => q.status === "answered")
      .map((q) => ({ question: q.question, answer: q.answer })),
    open_questions: qs.results.filter((q) => q.status === "open").map((q) => q.question),
    data_rule:
      "Only state facts in `amenities` or `answered_by_agency`. Anything in `not_recorded`, or not mentioned at all, is unknown: call log_unanswered (unless it is already in `open_questions`) and tell the buyer the agency will confirm.",
  };
}
