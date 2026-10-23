# Meridian Homes visit desk

A Chord teammate that books property viewings on WhatsApp for a (made-up) Lagos estate agency.

A buyer asks about a home, picks a time, pays a ₦5,000 visit fee through Paystack, and is confirmed in the same chat. Complaints, price disputes and legal questions go to a person.

**Read next:** [submission](docs/submission.md) · [field notes](docs/field-notes.md) · [go-live note](docs/go-live-note.md) · [spec](docs/spec.md)

## How it works

- **Chord** runs the conversation. The skill in `skill/meridian-visit-desk/` sets the agency's voice and rules, and Chord's built-in handover passes chats to a human.
- **Seven MCP tools** on a Cloudflare Worker do everything else: answer from listing data, hold a slot for 15 minutes, create the Paystack link, confirm on payment, cancel and refund.
- **Paystack (test mode)** confirms payments by webhook. If the webhook is late, the tools ask Paystack directly.
- **A small console** at the Worker URL shows visits, listings and questions the agent couldn't answer.

The model never decides anything involving money or availability. The tools only confirm a visit when Paystack does, and they apply the refund policy themselves.

## Run it locally

```bash
npm install
cp .dev.vars.example .dev.vars    # add a Paystack test secret key
npm run db:migrate:local && npm run db:seed:local
npm run dev
npm test                          # acceptance tests T1–T14, with Paystack faked
```

## Deploy

```bash
npx wrangler d1 create meridian   # put the id in wrangler.jsonc
npm run db:migrate:remote && npm run db:seed:remote
npx wrangler secret put PAYSTACK_SECRET_KEY   # also MCP_BEARER_TOKEN and CONSOLE_TOKEN
npm run deploy
```

Then:
- In Paystack, set the test webhook URL to `https://<worker>/webhooks/paystack`.
- In Chord, upload the skill folder as a teammate and add `https://<worker>/mcp` as an MCP server with the bearer token.

## What's where

```
skill/        the Chord skill (instructions + reference files)
src/worker/   MCP tools, Paystack client and webhook, console API
src/console/  the coordinator console and the payment result page
test/         acceptance tests against a real local D1
docs/         spec, field notes, go-live note, test plan
```

## Testing payments

Paystack test cards (any future expiry date):

| Card number | CVV | Result |
|---|---|---|
| `4084 0840 8408 4081` | `408` | Successful payment |
| `4084 0800 0000 5408` | `001` | Declined |

## How I used AI

I wrote the spec and made the product calls. I built with OpenCode, an AI coding agent. It read Chord's docs to answer the spec's open questions, then wrote the tools, tests, console and a first draft of the skill. I tested everything in the simulator, and the field notes come from my own deployment.
