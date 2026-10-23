// Unambiguous alphabet: no 0/O, 1/I/L, so buyers can read a visit ID back over chat.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function randomCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export const newVisitId = () => `V-${randomCode(6)}`;
export const newQuestionId = () => `Q-${randomCode(6)}`;
/** Paystack reference: unique per payment attempt, traceable to the visit. */
export const newPaymentReference = (visitId: string) => `MRD-${visitId.slice(2)}-${randomCode(4)}`;

/** Accepts "MH-001", "mh-1", "MH001", "1" and returns the canonical "MH-001". */
export function normaliseListingId(input: string): string | null {
  const m = input.trim().match(/^(?:mh[-\s]?)?0*(\d{1,3})$/i);
  if (!m) return null;
  return `MH-${m[1].padStart(3, "0")}`;
}
