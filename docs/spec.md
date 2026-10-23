# Visit Booking Agent: Spec

**Client:** Meridian Homes (test agency, Lekki and Yaba, 40 listings)
**Channel:** WhatsApp, via Chord simulator
**Data:** test data and Paystack test mode only
**Timezone:** WAT (UTC+1). Show all times to buyers in WAT.

---

## 1. Problem

Buyers and renters message the agency on WhatsApp about specific listings. They ask the same questions in many chats: amenities, power, price, availability, visiting times. Agents answer late and sometimes contradict each other. Visits get booked on houses already let. No-shows waste agent time, and the agency gets nothing for a visit that didn't happen.

**Goal:** a buyer can ask about a listing, pick a visit time, pay a small visit fee, and get confirmed, all in one WhatsApp chat, without a human in the loop for routine steps.

**Why it matters to the agency:** fewer wasted visits, fewer double-bookings, and a visit fee that covers agent time.

## 2. Scope

**In scope**
- Answer listing questions from the agency's listing data only.
- Log amenity questions the data doesn't cover.
- Hold a visit slot for 15 minutes.
- Collect a ₦5,000 visit fee through a Paystack test-mode payment link.
- Confirm a visit only after payment is verified.
- Handle cancellations and refunds under the rules in section 5.
- Hand off complaints, price negotiation and legal questions to a human.

**Out of scope**
- Rent, deposits, or any payment other than the visit fee.
- Price negotiation or promises of discounts.
- Tenant or buyer screening.
- Sharing agent personal numbers.
- Live Paystack keys or real customer data.

## 3. Users

| User | Who | What they need |
|---|---|---|
| Buyer or renter | Person messaging on WhatsApp | Fast, accurate listing facts; a visit they can trust |
| Visit coordinator | Agency staff member | Visits they can trust; a queue of unanswered questions and handoffs |
| Agency owner | Buyer of the product | Fewer wasted visits; a clear go-live note |

## 4. Data model

**listings**: `id`, `title`, `area`, `price_ngn`, `bedrooms`, `status` (`available` | `under_offer` | `let` | `sold`), `amenities` (JSON), `updated_at`

**slots**: `id`, `listing_id`, `starts_at` (WAT), `status` (`open` | `held` | `booked`), `hold_expires_at`, `visit_id`

**visits**: `id`, `listing_id`, `slot_id`, `buyer_name`, `buyer_email`, `buyer_phone`, `status` (`held` | `awaiting_payment` | `confirmed` | `expired` | `cancelled` | `refunded`), `paystack_reference`, `fee_kobo`, `created_at`, `paid_at`

**unanswered_questions**: `id`, `listing_id`, `question`, `asked_at`, `status` (`open` | `answered`), `answer`

Expired holds are treated as open at read time (`hold_expires_at < now`). No background job is needed.

## 5. Business rules

| # | Rule |
|---|---|
| R1 | Listing facts come only from tools. The agent never guesses an amenity. If the data doesn't cover it, call `log_unanswered` and say the agency will confirm. |
| R2 | A hold lasts 15 minutes from `hold_slot`. It is the payment window. |
| R3 | Listing status is re-read at `hold_slot` and again before the payment link is created. If the listing is `let`, `sold` or `under_offer`, refuse and offer up to two alternatives: same area first, then price within ±15% and bedrooms within ±1. |
| R4 | The visit fee is ₦5,000 (500,000 kobo), charged once per visit via Paystack. |
| R5 | A visit is confirmed only when Paystack confirms payment, by webhook or by verify call. The buyer saying "I paid" is never enough. |
| R6 | Refunds: buyer no-show keeps the fee. Agency cancels, or the listing becomes `let` before the visit, gives a full refund. Buyer cancels 24+ hours before: full refund. Buyer cancels under 24 hours: fee kept. |
| R7 | Payment after the hold has lapsed: if the slot is still open, re-hold it and confirm. If it's taken, refund automatically and offer alternatives. |
| R8 | Hand off to a human for complaints, price disputes, legal questions and anything involving someone's safety. Say what happens next. Don't promise a timeline the agency hasn't set. |

## 6. User journeys

### J1: Listing question with an amenity gap

- **Buyer:** "Does 14 Admiralty Way have a borehole, and what's the power like?"
- **Agent:** calls `get_listing`. Borehole: yes. Power: inverter listed, generator size not recorded.
- **Agent:** "It has a borehole and an inverter. The generator size isn't recorded yet, so I've logged your question for the agency. Ask me again later and I'll have the answer if they've added it."
- **System:** `log_unanswered` writes an open row for the coordinator.

**Done when:** the answer matches the listing data exactly, and the gap appears in the coordinator's queue.

### J2: Visit request, hold, pay, confirm (happy path)

1. **Buyer:** "Can I see it Saturday 11am?"
2. **Agent:** calls `check_slots`. 11:00 is open. Agent asks for name and email, since Paystack needs an email for the payment link.
3. **Buyer:** gives name and email.
4. **Agent:** calls `hold_slot`. Re-reads status (R3). Creates the visit as `awaiting_payment`, sets `hold_expires_at` to now + 15 min, creates the Paystack transaction.
5. **Agent:** "Held for you until 10:52 WAT. The visit fee is ₦5,000. Pay here: [link]. The slot is held until then."
6. **Buyer:** pays on the Paystack checkout page.
7. **Paystack:** sends `charge.success` to the Worker webhook. The Worker verifies the signature, checks the amount, sets the visit to `confirmed`, and sets the slot to `booked`.
8. **Buyer:** "Paid."
9. **Agent:** calls `get_visit_status`. Status is `confirmed`. Agent: "Confirmed: Saturday 11:00 WAT at 14 Admiralty Way. Bring a valid ID. Reply CANCEL any time to change it."

**Done when:** the visit is confirmed only after the Paystack event, and the buyer sees confirmation once it's recorded.

### J3: Competing buyer

1. **Buyer B:** "Saturday 11am?" while Buyer A holds it.
2. **Agent:** `check_slots` shows 11:00 as `held`. Agent offers 14:00 WAT.
3. **Buyer B** takes 14:00 and follows J2.

**Done when:** Buyer B never sees 11:00 as available, and gets a clear alternative.

### J4: Payment after the hold lapses

1. Buyer A doesn't pay within 15 minutes. The slot returns to open (R2).
2. **Case 4a:** Buyer B has not taken it. Buyer A pays late. Worker verifies payment, re-holds the slot, confirms the visit. Agent: "Payment received, and the slot is still yours. Confirmed."
3. **Case 4b:** Buyer B has taken it. Worker issues a Paystack refund. Agent: "That slot has been taken, so I've refunded your ₦5,000. Here are two other times."

**Done when:** no buyer pays for a visit they can't attend, and no slot is confirmed twice.

### J5: Let listing

- **Buyer:** asks about a house that is now `let`.
- **Agent:** "That one has been let. Here are two similar homes that are available." Lists up to two alternatives (R3).
- **If it becomes `let` during a hold:** the hold is cancelled. If the buyer has paid, the Worker refunds in full and the agent says so.

**Done when:** the buyer never gets a visit booking on a let property.

### J6: Cancellation

- **Buyer:** "I can't make Saturday."
- **Agent:** calls `get_visit_status`, then `cancel_visit`. Applies R6 based on how far away the visit is in WAT.
- **Agent:** states the outcome: "Cancelled. Your ₦5,000 will be refunded within [timeframe to confirm]." or "Cancelled. Under 24 hours' notice means the fee is kept, per our policy."

**Done when:** the refund decision matches R6 for every case, and the buyer knows the outcome before the chat ends.

### J7: Complaint or price dispute

- **Buyer:** "Your agent told me the price was ₦40m, not ₦45m."
- **Agent:** does not comment on price. Logs a handoff, then says: "I'm passing this to our coordinator, who will contact you in this chat. I can't change or confirm prices myself."

**Done when:** no price is confirmed or changed by the agent, and the handoff is logged.

## 7. Paystack (test mode)

**Setup**
- Use the test secret key only, stored as a Worker secret. Never put it in the skill file or the code repo.
- The visit fee is 500,000 kobo (₦5,000).
- Each visit gets a unique reference. Pass `visit_id`, `slot_id` and `listing_id` in `metadata`.

**Calls**

| Action | Paystack endpoint | When |
|---|---|---|
| Create payment | `POST /transaction/initialize` | In `hold_slot`, after the listing check |
| Verify payment | `GET /transaction/verify/{reference}` | In `get_visit_status` if the webhook hasn't arrived, and in J4 |
| Refund | `POST /refund` | Under R6 and R7 |

**Webhook:** `POST /webhooks/paystack` on the Worker.
- Check the `x-paystack-signature` header against an HMAC-SHA512 of the raw body, using the test secret key. Reject mismatches.
- Respond 200 quickly. Process idempotently, keyed on the event or reference, so retries don't double-confirm.
- Check that the amount paid equals `fee_kobo`. Reject and refund if not.

**Test cards:** use Paystack's documented test cards for a successful payment and for a decline. Test a decline in the simulator to check the "payment failed" path.

## 8. Tools (MCP server on Cloudflare Worker)

| Tool | Input | Output | Errors |
|---|---|---|---|
| `search_listings` | `area?`, `bedrooms?`, `max_price_ngn?` | Available listings | None |
| `get_listing` | `listing_id` | Full listing, amenities, open questions | `NOT_FOUND` |
| `check_slots` | `listing_id`, `date` | Open slots in WAT (expired holds count as open) | `LISTING_UNAVAILABLE` |
| `hold_slot` | `listing_id`, `slot_id`, `buyer_name`, `buyer_email`, `buyer_phone` | `visit_id`, `hold_expires_at`, `payment_url` | `409 SLOT_HELD`, `409 LISTING_UNAVAILABLE` (with alternatives), `502 PAYSTACK_UNAVAILABLE` |
| `get_visit_status` | `visit_id` | Status. If `awaiting_payment`, verifies with Paystack first. | `NOT_FOUND` |
| `cancel_visit` | `visit_id` | Outcome and refund amount per R6 | `ALREADY_CANCELLED` |
| `log_unanswered` | `listing_id`, `question` | Confirmation | None |

**Open question:** `buyer_phone` must come from the Chord channel's sender ID. Confirm that Chord passes it to MCP tools. If not, the agent has to ask for it.

## 9. Acceptance tests (run in the simulator)

| # | Test | Expected |
|---|---|---|
| T1 | Ask an amenity that's in the data | Correct answer from the listing |
| T2 | Ask an amenity that's missing | Log created; buyer told the agency will confirm |
| T3 | Hold an open slot | 15-minute hold, payment link returned |
| T4 | Second buyer requests the held slot | Conflict; alternative offered |
| T5 | Pay with the success test card, then say "paid" | Confirmed only after webhook or verify |
| T6 | Pay with the decline test card | No confirmation; buyer told payment failed |
| T7 | Pay after the hold lapses, slot still open | Re-held and confirmed |
| T8 | Pay after the hold lapses, slot taken | Refunded; alternatives offered |
| T9 | Ask about a `let` listing | Refused; two alternatives offered |
| T10 | Listing set to `let` during hold, buyer paid | Hold cancelled; full refund |
| T11 | Cancel 25 hours before | Full refund |
| T12 | Cancel 3 hours before | Fee kept |
| T13 | Price complaint | Handoff logged; no price stated |
| T14 | Webhook with a bad signature | Rejected; no state change |

## 10. Chord configuration

- **Skill file:** agency voice, rules R1 to R8, tone for buyers, what the agent must never do.
- **MCP server:** registered with a public HTTPS URL on the Worker and a bearer token. Stays disabled until the tools are tested.
- **`enabled_tools`:** the seven tools in section 8, nothing else.
- **Teammate assignment:** this teammate only. Use `set_mcp_server_ids`. Note that `set_mcp_server_ids: []` doesn't clear the assignment, and removing the last ID widens access to every enabled server.
- **Native bookings:** not used yet. See section 11.

## 11. Open checks and risks

1. **Chord booking docs.** `/docs/booking/`, `/docs/bookings` and `/docs/bookings/` all return 404. The webhook reference does describe booking payloads with `resource_id`, `payment_link_url`, `paystack_transaction_reference` and `amount_paid`, so native bookings may support this flow. Check before build. If native bookings support per-listing slot holds, the Worker can drop `hold_slot`'s slot logic, but R3 and R7 would still need custom code.
2. **Buyer identity.** Confirm whether Chord passes the sender's phone number to MCP tools.
3. **Tool timeouts.** Chord's MCP docs don't state a timeout. `hold_slot` makes a Paystack call, so measure its latency during testing.
4. **Refund timing.** Test-mode refund speed is unverified. R6 promises a timeframe, so confirm it before the buyer sees one.
5. **Assumptions to confirm with the agency:** the ₦5,000 fee, the 15-minute window, the 24-hour cancellation rule, and the R3 alternatives.
6. **Production note (not for the take-home):** Paystack, Cloudflare and Chord all process data outside Nigeria. Before real buyer data goes in, check cross-border transfer obligations under the Nigeria Data Protection Act 2023.
