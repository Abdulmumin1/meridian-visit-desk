# Simulator test plan (spec section 9)

Run these in the WhatsApp simulator with the console open beside it. **Activity** shows every tool call as it happens. Times are WAT. Use a fresh simulator session per test where noted, so earlier context doesn't help the agent.

Automated equivalents run with `npm test` (`test/acceptance.test.ts`, `test/http.test.ts`). The simulator runs prove the model follows the skill.

Paystack test cards: success `4084 0840 8408 4081` (CVV 408) · declined `4084 0800 0000 5408` (CVV 001) · refund fails `4084 0800 0067 1803` (CVV 180). Any future expiry.

| # | Say | Expect from the agent | Check in the console |
|---|---|---|---|
| T1 | "Does 14 Admiralty Way have a borehole, and what's the power like?" | Borehole yes; Band A; 5 kVA inverter; generator yes | Activity: `get_listing` |
| T2 | (same message) | Generator size isn't recorded; question logged; "ask me again later" | Questions: new open item. Answer it, ask again in the chat, and the agent now gives the size |
| T3 | "Can I see it Saturday 11am?" → name + email | Fee mentioned before the hold; "held until HH:MM WAT", ₦5,000, link | Overview: live hold with countdown |
| T4 | New session, different email: "Saturday 11am at 14 Admiralty Way?" | 11:00 is taken; offers 10:00 / 12:00 / 14:00; never says who has it | No second hold on 11:00 |
| T5 | Say "paid" before paying, then pay with the success card and say "paid" again | First: not received yet, no confirmation. Second: "Confirmed ✅ …" with visit ID | Visit shows Confirmed; activity shows `charge.success` and/or `transaction.verify` |
| T6 | New hold, pay with the declined card, then say "paid" | "Payment didn't go through, nothing charged, retry before HH:MM" | Visit stays Awaiting payment, Paystack status Failed · Declined |
| T7 | Hold, wait 15+ minutes, pay with the success card, say "paid" | "Payment received, and the slot is still yours. Confirmed" | Visit: Confirmed, "late payment, re-held" |
| T8 | Hold as buyer A; wait 15+ min; book the same slot as buyer B in a new session; pay A's old link; A says "paid" | A: "That slot was taken, so I've refunded your ₦5,000", plus two other times | A: Refund pending; B's hold untouched |
| T9 | "Can I view 7 Fola Osibo Road?" | It's been let; two alternatives (22 Kusenla Road, 3 Orchid Road) | No hold created |
| T10 | Hold a slot; in the console mark the listing **Let**; pay the link; say "paid" | Home no longer available, full ₦5,000 refund, alternative homes | Listing change dialog shows the impact; visit shows Refund pending |
| T11 | Book and pay a slot ≥ 25h away; "I can't make it, please cancel" | Confirms which visit, then "Cancelled. Your ₦5,000 has gone back to your card" | Visit: Refund pending (buyer cancelled 24h+) |
| T12 | Book and pay a slot ~3h away (same day); cancel | "Cancelled. Under 24 hours' notice, so the fee is kept" | Visit: Cancelled · fee kept |
| T13 | "Your agent told me 9 Hughes Avenue was ₦40m, not ₦45m" | Passes to the coordinator; doesn't restate or defend any price | Chord: thread moves to a human (handover); nothing in my tools |
| T14 | POST a `charge.success` to `/webhooks/paystack` with a wrong `x-paystack-signature` | n/a | Activity: "Rejected a webhook with an invalid signature", visit unchanged |

Extra checks worth recording:

- **Refund failure:** pay with the refund-fails card, cancel 24h+ ahead. The console flags "Refund failed", and the agent says the coordinator will process it without promising a date.
- **Paystack down:** temporarily set an invalid `PAYSTACK_SECRET_KEY`, try to book. The agent should say nothing was held or charged.
- **Hallucination probe:** "Is there a gym at 14 Admiralty Way?" (gym is not recorded). It must log the question, not guess.

## Results so far (23 October, live simulator)

| # | Result | Evidence |
|---|---|---|
| T3 | Pass | `hold_slot` 11:05:18 → V-R2ZTYB held 15 min, real Paystack link |
| T5 | Pass | Confirmed only after Paystack: payment 11:05:43 → `get_visit_status` 11:05:54 → "Confirmed ✅" |
| T12 | Pass | 11:27–11:28: agent warned the fee is kept before acting, asked to confirm, `cancel_visit` → `buyer_cancelled_under_24h`, ₦0 refunded, slot reopened |
| T14 | Pass | Unsigned webhook → HTTP 401, activity "Rejected a webhook with an invalid signature", no state change |
| Photos | Fixed | 11:11 the agent invented a listing URL (see field notes #1); after skill v3, 11:16 it called `get_listing` first |

Still to run in the simulator: T1/T2 (14 Admiralty Way), T4, T6, T7, T8, T9, T10, T11, T13.
