-- Meridian Homes visit desk. All timestamps are epoch milliseconds (UTC);
-- they are rendered in WAT (UTC+1) at the edges.

CREATE TABLE listings (
  id            TEXT PRIMARY KEY,               -- e.g. MH-001
  title         TEXT NOT NULL,                  -- street address buyers use, e.g. "14 Admiralty Way"
  neighbourhood TEXT NOT NULL,                  -- e.g. "Lekki Phase 1"
  area          TEXT NOT NULL CHECK (area IN ('Lekki', 'Yaba')),
  property_type TEXT NOT NULL,                  -- e.g. "Terrace duplex"
  listing_type  TEXT NOT NULL CHECK (listing_type IN ('rent', 'sale')),
  price_ngn     INTEGER NOT NULL,               -- annual rent for rent, asking price for sale
  bedrooms      INTEGER NOT NULL,
  bathrooms     INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('available', 'under_offer', 'let', 'sold')),
  amenities     TEXT NOT NULL,                  -- JSON object; null value = not recorded
  description   TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX listings_status_area ON listings (status, area);

-- Slots are materialised on read from the viewing schedule, so they never run out.
CREATE TABLE slots (
  id              TEXT PRIMARY KEY,             -- {listing_id}-{YYYYMMDD}-{HHMM}
  listing_id      TEXT NOT NULL REFERENCES listings (id),
  starts_at       INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('open', 'held', 'booked')),
  hold_expires_at INTEGER,
  visit_id        TEXT,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX slots_listing_start ON slots (listing_id, starts_at);

CREATE TABLE visits (
  id                 TEXT PRIMARY KEY,          -- e.g. V-7K2Q9M
  listing_id         TEXT NOT NULL REFERENCES listings (id),
  slot_id            TEXT NOT NULL REFERENCES slots (id),
  starts_at          INTEGER NOT NULL,          -- copied from the slot for history
  buyer_name         TEXT NOT NULL,
  buyer_email        TEXT NOT NULL,
  buyer_phone        TEXT,
  status             TEXT NOT NULL CHECK (status IN ('held', 'awaiting_payment', 'confirmed', 'expired', 'cancelled', 'refunded')),
  paystack_reference TEXT UNIQUE,
  payment_url        TEXT,
  payment_status     TEXT,                      -- last known Paystack status: success | failed | abandoned | ongoing | pending
  payment_note       TEXT,                      -- Paystack gateway_response, e.g. "Declined"
  fee_kobo           INTEGER NOT NULL,
  amount_paid_kobo   INTEGER,
  hold_expires_at    INTEGER,
  created_at         INTEGER NOT NULL,
  paid_at            INTEGER,
  confirmed_at       INTEGER,
  late_payment       INTEGER NOT NULL DEFAULT 0, -- 1 when paid after the hold lapsed (R7)
  cancelled_at       INTEGER,
  cancelled_by       TEXT,                      -- buyer | agency | system
  cancel_reason      TEXT,
  refund_kobo        INTEGER,
  refund_reason      TEXT,
  refund_status      TEXT,                      -- pending | processing | processed | failed
  refund_error       TEXT,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX visits_email ON visits (buyer_email, created_at);
CREATE INDEX visits_listing ON visits (listing_id, status);
CREATE INDEX visits_status ON visits (status, starts_at);

CREATE TABLE unanswered_questions (
  id          TEXT PRIMARY KEY,
  listing_id  TEXT NOT NULL REFERENCES listings (id),
  question    TEXT NOT NULL,
  asked_at    INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('open', 'answered')),
  answer      TEXT,
  answered_at INTEGER
);
CREATE INDEX questions_status ON unanswered_questions (status, asked_at);
CREATE INDEX questions_listing ON unanswered_questions (listing_id, status);

-- Idempotency ledger for Paystack webhooks (keyed on event + reference).
CREATE TABLE payment_events (
  id           TEXT PRIMARY KEY,
  event        TEXT NOT NULL,
  reference    TEXT,
  received_at  INTEGER NOT NULL,
  outcome      TEXT,
  payload      TEXT NOT NULL
);

-- Everything the system does, for the coordinator console and for debugging.
CREATE TABLE activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  source      TEXT NOT NULL,                    -- agent | paystack | console | system
  action      TEXT NOT NULL,                    -- e.g. hold_slot, charge.success, refund
  ok          INTEGER NOT NULL DEFAULT 1,
  visit_id    TEXT,
  listing_id  TEXT,
  duration_ms INTEGER,
  summary     TEXT NOT NULL,
  detail      TEXT
);
CREATE INDEX activity_at ON activity (at);
CREATE INDEX activity_visit ON activity (visit_id);
