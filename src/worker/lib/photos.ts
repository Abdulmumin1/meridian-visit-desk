/**
 * Illustrative photos (Wikimedia Commons, see public/photos/CREDITS.md).
 * The listings are made up, so each gets a deterministic gallery from a small pool.
 */
const EXTERIORS = ["exterior-1.jpg", "exterior-2.jpg"];
const LIVING = ["living-1.jpg", "living-2.jpg"];

export function photosFor(listingId: string): string[] {
  const n = Number(listingId.replace(/\D/g, "")) || 0;
  return [EXTERIORS[n % 2], LIVING[(n >> 1) % 2], "kitchen-1.jpg", "bedroom-1.jpg"].map((f) => `/photos/${f}`);
}

export const listingPath = (listingId: string) => `/l/${listingId.toLowerCase()}`;
