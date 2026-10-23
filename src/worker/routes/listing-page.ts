/**
 * GET /l/:id — a public, server-rendered page per listing. Chord can only send
 * text, so the agent shares this link; WhatsApp unfurls it into a photo card
 * using the Open Graph tags below.
 */
import type { ListingRow } from "../domain/context";
import { presentAmenities, priceLabel } from "../domain/listings";
import { normaliseListingId } from "../lib/ids";
import { photosFor } from "../lib/photos";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STATUS: Record<ListingRow["status"], string> = {
  available: "Available to view",
  under_offer: "Under offer",
  let: "Let",
  sold: "Sold",
};

const HIGHLIGHTS = ["Grid power band", "Inverter", "Generator", "Borehole", "Gated estate", "Parking spaces", "Boys' quarters (BQ)", "Furnishing", "Service charge"];

export async function renderListingPage(db: D1Database, origin: string, rawId: string): Promise<Response> {
  const id = normaliseListingId(rawId);
  const l = id ? await db.prepare("SELECT * FROM listings WHERE id = ?").bind(id).first<ListingRow>() : null;
  if (!l) return new Response("Listing not found", { status: 404, headers: { "content-type": "text/plain" } });

  const photos = photosFor(l.id).map((p) => `${origin}${p}`);
  const { recorded } = presentAmenities(l.amenities);
  const facts = HIGHLIGHTS.filter((k) => recorded[k] && recorded[k] !== "No").map((k) => [k, recorded[k]] as const);
  const title = `${l.title}, ${l.neighbourhood}`;
  const summary = `${l.bedrooms}-bed ${l.property_type.toLowerCase()} · ${priceLabel(l)}`;
  const available = l.status === "available";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Meridian Homes</title>
<meta name="description" content="${esc(summary)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Meridian Homes">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(summary)}${available ? "" : ` · ${STATUS[l.status]}`}">
<meta property="og:image" content="${photos[0]}">
<meta property="og:image:width" content="960">
<meta property="og:url" content="${origin}/l/${l.id.toLowerCase()}">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">
<style>
  *{box-sizing:border-box;margin:0}
  body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;color:#161616;background:#fff;-webkit-font-smoothing:antialiased}
  main{max-width:640px;margin:0 auto;padding:20px 20px 48px}
  .brand{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;margin-bottom:20px}
  .brand i{width:20px;height:20px;border-radius:6px;background:#1d4434;display:inline-block}
  .cover{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:10px;background:#f4f4f2;display:block}
  h1{font-size:24px;letter-spacing:-.02em;line-height:1.2;margin-top:20px}
  .sub{color:#737370;margin-top:4px}
  .price{font-size:18px;font-weight:600;margin-top:14px}
  .status{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:#3a3a38;margin-top:10px}
  .status:before{content:"";width:6px;height:6px;border-radius:50%;background:${available ? "#24804f" : "#a3a3a0"}}
  dl{margin-top:24px;border-top:1px solid #ebebe8}
  dl div{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid #ebebe8;font-size:14px}
  dt{color:#737370} dd{text-align:right}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:24px}
  .grid img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;display:block}
  .cta{margin-top:28px;padding:14px 16px;border-radius:10px;background:#f7f7f5;font-size:14px;color:#3a3a38}
  footer{margin-top:28px;font-size:12px;color:#a3a3a0}
  footer a{color:inherit}
</style>
</head>
<body>
<main>
  <div class="brand"><i></i>Meridian Homes</div>
  <img class="cover" src="${photos[0]}" alt="${esc(l.title)}">
  <h1>${esc(l.title)}</h1>
  <p class="sub">${esc(l.neighbourhood)}, ${esc(l.area)} · ${l.bedrooms} bed · ${l.bathrooms} bath · ${esc(l.property_type)}</p>
  <p class="price">${esc(priceLabel(l))}</p>
  <span class="status">${STATUS[l.status]}</span>
  ${facts.length ? `<dl>${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}
  <div class="grid">${photos.slice(1).map((p) => `<img src="${p}" alt="" loading="lazy">`).join("")}</div>
  <p class="cta">${available ? "To book a viewing, reply in your WhatsApp chat with Meridian Homes." : "This home is no longer available. Ask in your WhatsApp chat for similar homes."}</p>
  <footer>Illustrative photos from Wikimedia Commons (<a href="/photos/CREDITS.md">credits</a>). Test listing, not a real property.</footer>
</main>
</body>
</html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}
