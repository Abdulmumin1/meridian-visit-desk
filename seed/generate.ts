/**
 * Generates seed/seed.sql: 40 made-up Meridian Homes listings across Lekki and Yaba.
 *
 * Amenity convention (the agent relies on this, see the skill file):
 *   true / false / number / string  -> recorded fact
 *   null                           -> NOT recorded; the agent must call log_unanswered
 *
 * Deterministic (seeded PRNG) so every environment gets the same data.
 * Slots are not seeded: the Worker materialises them from the viewing schedule on read.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

type Area = "Lekki" | "Yaba";
type ListingType = "rent" | "sale";
type Status = "available" | "under_offer" | "let" | "sold";
type Amenities = Record<string, string | number | boolean | null>;

interface Listing {
  id: string;
  title: string;
  neighbourhood: string;
  area: Area;
  property_type: string;
  listing_type: ListingType;
  price_ngn: number;
  bedrooms: number;
  bathrooms: number;
  status: Status;
  amenities: Amenities;
  description: string;
}

// Mulberry32: tiny deterministic PRNG.
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(20261023);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;
const between = (lo: number, hi: number, step: number) =>
  Math.round((lo + rand() * (hi - lo)) / step) * step;

function baseAmenities(area: Area, bedrooms: number, type: ListingType): Amenities {
  const premium = area === "Lekki";
  const hasGen = chance(premium ? 0.75 : 0.45);
  const hasInverter = chance(premium ? 0.7 : 0.4);
  return {
    borehole: chance(0.9),
    water_treatment: chance(0.25) ? null : chance(premium ? 0.6 : 0.3),
    power_supply: pick(
      premium
        ? ["Band A (20+ hours/day)", "Band A (20+ hours/day)", "Band B (16+ hours/day)", null]
        : ["Band B (16+ hours/day)", "Band C (12+ hours/day)", "Band A (20+ hours/day)", null],
    ),
    prepaid_meter: chance(0.85),
    inverter: hasInverter ? pick(["3.5 kVA", "5 kVA", "7.5 kVA"]) : false,
    solar: chance(0.2) ? null : chance(0.25),
    generator: hasGen,
    generator_kva: hasGen ? (chance(0.35) ? null : pick([10, 15, 20, 27, 40])) : null,
    gated_estate: chance(premium ? 0.8 : 0.35),
    security_guards: chance(0.15) ? null : chance(premium ? 0.9 : 0.5),
    cctv: chance(0.35) ? null : chance(premium ? 0.6 : 0.2),
    parking_spaces: chance(0.1) ? null : Math.max(1, Math.min(4, bedrooms - (premium ? 0 : 1))),
    boys_quarters: bedrooms >= 4 ? chance(0.8) : chance(0.1),
    fitted_kitchen: chance(premium ? 0.9 : 0.6),
    air_conditioning: pick(premium ? ["All rooms", "All rooms", "Living room and master bedroom", null] : ["None installed", "Living room only", null]),
    furnished: pick(["Unfurnished", "Unfurnished", "Semi-furnished", premium ? "Fully furnished" : "Unfurnished"]),
    ensuite_bedrooms: chance(premium ? 0.8 : 0.3) ? bedrooms : Math.max(0, bedrooms - 1),
    swimming_pool: premium ? (chance(0.3) ? null : chance(0.3)) : false,
    gym: premium ? (chance(0.4) ? null : chance(0.25)) : false,
    internet: pick(["Fibre-ready", "Fibre-ready", null, "No fibre in the street"]),
    service_charge_ngn: type === "rent" ? (chance(0.2) ? null : between(premium ? 600_000 : 150_000, premium ? 2_500_000 : 500_000, 50_000)) : null,
    pets_allowed: chance(0.5) ? null : chance(0.4),
    year_built: chance(0.3) ? null : between(2008, 2024, 1),
    ...(type === "sale" ? { title_document: pick(["C of O", "Governor's Consent", "Registered Deed of Assignment", null]) } : {}),
  };
}

const LEKKI_STREETS: Array<[string, string]> = [
  ["Admiralty Road", "Lekki Phase 1"],
  ["Fola Osibo Road", "Lekki Phase 1"],
  ["Bisola Durosinmi-Etti Drive", "Lekki Phase 1"],
  ["Durosimi Etti Street", "Lekki Phase 1"],
  ["Kusenla Road", "Ikate"],
  ["Elegushi Road", "Ikate"],
  ["Chevron Drive", "Chevron"],
  ["Orchid Road", "Chevron"],
  ["Osapa London Road", "Osapa London"],
  ["Agungi-Ajiran Road", "Agungi"],
  ["Ologolo Road", "Ologolo"],
  ["Freedom Way", "Lekki Phase 1"],
];
const YABA_STREETS: Array<[string, string]> = [
  ["Herbert Macaulay Way", "Alagomeji"],
  ["Commercial Avenue", "Sabo"],
  ["Hughes Avenue", "Alagomeji"],
  ["Montgomery Road", "Yaba"],
  ["Akoka Road", "Akoka"],
  ["Iwaya Road", "Iwaya"],
  ["Onike Street", "Onike"],
  ["Jibowu Street", "Jibowu"],
  ["Tejuosho Street", "Yaba"],
  ["Adekunle Street", "Adekunle"],
];

const TYPES: Record<Area, Array<{ beds: number; type: string; rent: [number, number]; sale: [number, number] }>> = {
  Lekki: [
    { beds: 1, type: "Mini flat", rent: [3_500_000, 5_000_000], sale: [55_000_000, 75_000_000] },
    { beds: 2, type: "Flat", rent: [7_000_000, 11_000_000], sale: [85_000_000, 120_000_000] },
    { beds: 3, type: "Flat", rent: [10_000_000, 15_000_000], sale: [120_000_000, 175_000_000] },
    { beds: 4, type: "Terrace duplex", rent: [15_000_000, 22_000_000], sale: [180_000_000, 260_000_000] },
    { beds: 5, type: "Detached duplex", rent: [25_000_000, 35_000_000], sale: [350_000_000, 550_000_000] },
  ],
  Yaba: [
    { beds: 1, type: "Mini flat", rent: [1_800_000, 2_800_000], sale: [28_000_000, 38_000_000] },
    { beds: 2, type: "Flat", rent: [3_500_000, 5_000_000], sale: [42_000_000, 65_000_000] },
    { beds: 3, type: "Flat", rent: [5_000_000, 7_500_000], sale: [65_000_000, 95_000_000] },
  ],
};

function describe(l: Omit<Listing, "description">): string {
  const verb = l.listing_type === "rent" ? "to let" : "for sale";
  const a = l.amenities;
  const bits = [
    a.gated_estate ? "in a gated estate" : null,
    a.boys_quarters ? "with a BQ" : null,
    a.fitted_kitchen ? "fitted kitchen" : null,
    a.borehole ? "borehole water" : null,
  ].filter(Boolean);
  return `${l.bedrooms}-bedroom ${l.property_type.toLowerCase()} ${verb} in ${l.neighbourhood}${bits.length ? ", " + bits.join(", ") : ""}.`;
}

const listings: Listing[] = [];
let n = 0;
const nextId = () => `MH-${String(++n).padStart(3, "0")}`;
const add = (l: Omit<Listing, "id" | "description">) => {
  const withId = { ...l, id: nextId() };
  listings.push({ ...withId, description: describe(withId) });
};

// ---- Hand-placed listings that the user journeys and acceptance tests rely on ----

// J1 / T1 / T2: borehole yes, inverter recorded, generator present but size NOT recorded.
add({
  title: "14 Admiralty Way",
  neighbourhood: "Lekki Phase 1",
  area: "Lekki",
  property_type: "Terrace duplex",
  listing_type: "rent",
  price_ngn: 18_000_000,
  bedrooms: 4,
  bathrooms: 5,
  status: "available",
  amenities: {
    borehole: true,
    water_treatment: true,
    power_supply: "Band A (20+ hours/day)",
    prepaid_meter: true,
    inverter: "5 kVA",
    solar: false,
    generator: true,
    generator_kva: null,
    gated_estate: true,
    security_guards: true,
    cctv: true,
    parking_spaces: 3,
    boys_quarters: true,
    fitted_kitchen: true,
    air_conditioning: "All rooms",
    furnished: "Unfurnished",
    ensuite_bedrooms: 4,
    swimming_pool: false,
    gym: null,
    internet: "Fibre-ready",
    service_charge_ngn: 1_500_000,
    pets_allowed: null,
    year_built: 2019,
  },
});

// J5 / T9: let listing. R3 alternatives must exist: Lekki rentals, 2-4 beds, ₦10.2m-₦13.8m.
add({
  title: "7 Fola Osibo Road",
  neighbourhood: "Lekki Phase 1",
  area: "Lekki",
  property_type: "Flat",
  listing_type: "rent",
  price_ngn: 12_000_000,
  bedrooms: 3,
  bathrooms: 4,
  status: "let",
  amenities: { ...baseAmenities("Lekki", 3, "rent"), borehole: true, generator: true, generator_kva: 20 },
});
add({
  title: "22 Kusenla Road",
  neighbourhood: "Ikate",
  area: "Lekki",
  property_type: "Flat",
  listing_type: "rent",
  price_ngn: 11_500_000,
  bedrooms: 3,
  bathrooms: 4,
  status: "available",
  amenities: baseAmenities("Lekki", 3, "rent"),
});
add({
  title: "3 Orchid Road",
  neighbourhood: "Chevron",
  area: "Lekki",
  property_type: "Flat",
  listing_type: "rent",
  price_ngn: 12_500_000,
  bedrooms: 3,
  bathrooms: 3,
  status: "available",
  amenities: baseAmenities("Lekki", 3, "rent"),
});

// J7 / T13: the "₦40m, not ₦45m" price complaint. A Yaba flat for sale at ₦45m.
add({
  title: "9 Hughes Avenue",
  neighbourhood: "Alagomeji",
  area: "Yaba",
  property_type: "Flat",
  listing_type: "sale",
  price_ngn: 45_000_000,
  bedrooms: 2,
  bathrooms: 2,
  status: "available",
  amenities: { ...baseAmenities("Yaba", 2, "sale"), title_document: "Governor's Consent" },
});

// A Yaba let listing with Yaba alternatives (2-3 beds, ₦3.57m-₦4.83m).
add({
  title: "31 Onike Street",
  neighbourhood: "Onike",
  area: "Yaba",
  property_type: "Flat",
  listing_type: "rent",
  price_ngn: 4_200_000,
  bedrooms: 2,
  bathrooms: 2,
  status: "let",
  amenities: baseAmenities("Yaba", 2, "rent"),
});
add({
  title: "5 Akoka Road",
  neighbourhood: "Akoka",
  area: "Yaba",
  property_type: "Flat",
  listing_type: "rent",
  price_ngn: 4_000_000,
  bedrooms: 2,
  bathrooms: 2,
  status: "available",
  amenities: baseAmenities("Yaba", 2, "rent"),
});
add({
  title: "18 Jibowu Street",
  neighbourhood: "Jibowu",
  area: "Yaba",
  property_type: "Flat",
  listing_type: "rent",
  price_ngn: 4_500_000,
  bedrooms: 2,
  bathrooms: 2,
  status: "available",
  amenities: baseAmenities("Yaba", 2, "rent"),
});

// ---- Generated remainder: 22 Lekki total, 18 Yaba total ----
const used = new Set(listings.map((l) => l.title));
function generate(area: Area, count: number) {
  const streets = area === "Lekki" ? LEKKI_STREETS : YABA_STREETS;
  for (let i = 0; i < count; i++) {
    const t = pick(TYPES[area]);
    const listing_type: ListingType = chance(area === "Lekki" ? 0.65 : 0.75) ? "rent" : "sale";
    const [lo, hi] = listing_type === "rent" ? t.rent : t.sale;
    const price = between(lo, hi, listing_type === "rent" ? 250_000 : 5_000_000);
    let title = "";
    let neighbourhood = "";
    do {
      const [street, hood] = pick(streets);
      title = `${between(1, 48, 1)} ${street}`;
      neighbourhood = hood;
    } while (used.has(title));
    used.add(title);
    const r = rand();
    const status: Status =
      r < 0.8 ? "available" : r < 0.88 ? "under_offer" : listing_type === "rent" ? "let" : "sold";
    add({
      title,
      neighbourhood,
      area,
      property_type: t.type,
      listing_type,
      price_ngn: price,
      bedrooms: t.beds,
      bathrooms: Math.max(1, t.beds + (chance(0.5) ? 1 : 0)),
      status,
      amenities: baseAmenities(area, t.beds, listing_type),
    });
  }
}
generate("Lekki", 22 - listings.filter((l) => l.area === "Lekki").length);
generate("Yaba", 18 - listings.filter((l) => l.area === "Yaba").length);

if (listings.length !== 40) throw new Error(`expected 40 listings, got ${listings.length}`);

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const now = Date.now();
const rows = listings.map(
  (l) =>
    `(${q(l.id)}, ${q(l.title)}, ${q(l.neighbourhood)}, ${q(l.area)}, ${q(l.property_type)}, ${q(l.listing_type)}, ${l.price_ngn}, ${l.bedrooms}, ${l.bathrooms}, ${q(l.status)}, ${q(JSON.stringify(l.amenities))}, ${q(l.description)}, ${now})`,
);

const sql = `-- Generated by seed/generate.ts. Made-up data only.
DELETE FROM activity;
DELETE FROM payment_events;
DELETE FROM unanswered_questions;
DELETE FROM visits;
DELETE FROM slots;
DELETE FROM listings;
INSERT INTO listings (id, title, neighbourhood, area, property_type, listing_type, price_ngn, bedrooms, bathrooms, status, amenities, description, updated_at) VALUES
${rows.join(",\n")};
`;

const out = join(dirname(fileURLToPath(import.meta.url)), "seed.sql");
writeFileSync(out, sql);
const summary = listings.reduce<Record<string, number>>((acc, l) => {
  const k = `${l.area}/${l.status}`;
  acc[k] = (acc[k] ?? 0) + 1;
  return acc;
}, {});
console.log(`Wrote ${listings.length} listings to ${out}`, summary);
