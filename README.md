# Meridian Homes visit desk

A Chord teammate that books property viewings on WhatsApp for a (made-up) Lagos estate agency.

A buyer asks about a home, picks a time, pays a ₦5,000 visit fee through Paystack, and is confirmed in the same chat. Complaints, price disputes and legal questions go to a person.

**Submission:** [summary](docs/submission.md) · [field notes](docs/field-notes.md) · [go-live note](docs/go-live-note.md) · [original spec](docs/spec.md)

## Try it

1. Open the [WhatsApp simulator](https://chat.tsglabs.dev) and chat with the **Meridian Homes** teammate.
2. Say: *"i need a house with good electricity and security in lekki"*. Pick one of the homes it suggests, then ask to see it on a weekday at 11am.
3. Give a name and email, and you'll get a Paystack payment link. Pay with a test card:

| Card number | Expiry / CVV | Result |
|---|---|---|
| `4084 0840 8408 4081` | any future date / `408` | Payment succeeds |
| `4084 0800 0000 5408` | any future date / `001` | Card declined |

4. Say "paid". The agent confirms only once Paystack has.

The [visit desk](https://meridian-visit-desk.avdorr12345.workers.dev) shows what's happening behind the chat: holds counting down, confirmed visits, refunds, and every tool call. It has no sign-in in this test build, and all data is made up.

## How it works

- **Chord** runs the conversation. The skill in [`skill/`](skill/meridian-visit-desk) sets the agency's voice and rules, and Chord's built-in handover passes chats to a person.
- **Seven tools** do everything else: answer from the listing data, hold a slot for 15 minutes, create the Paystack link, confirm on payment, cancel and refund. They run on a Cloudflare Worker that Chord calls.
- **Paystack (test mode)** confirms payments by webhook. If the webhook is late, the tools ask Paystack directly.

The model never decides anything involving money or availability. The tools only confirm a visit when Paystack does, and they apply the refund policy themselves.

## Where to look

```
skill/        the Chord skill: instructions and reference files
src/worker/   the tools, the Paystack payment and webhook code, the visit desk's API
src/console/  the visit desk and the payment result page
test/         30 acceptance tests covering the spec's T1–T14
docs/         field notes, go-live note, spec, test plan
```

## How I used AI

I wrote the spec and made the product calls. I built with OpenCode, an AI coding agent. It read Chord's docs to answer the spec's open questions, then wrote the tools, tests, console and a first draft of the skill. I tested everything in the simulator, and the field notes come from my own deployment.
