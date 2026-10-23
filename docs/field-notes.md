# Deployment field notes

Built and deployed on 23 October 2026. Times are WAT. Request IDs are from a local log of every Chord API call I made. Tool-call evidence is from the Worker's activity log and `wrangler tail`.

---

## 1. The agent invented a link

**What happened.** Mid-conversation, a buyer typed "can i see images". The agent replied:

> Sorry, I can only send text here, but the listing page has photos:
> https://meridian-visit-desk.vercel.app/listing/MH-005

All three parts were made up: the domain (mine is on `workers.dev`), the path (`/listing/`), and the listing (MH-005 is a different house; the buyer's visit was MH-038).

**How I found the cause.**
- The Worker logs every tool call. There were none in that turn (the last was `get_visit_status` at 11:05:54).
- `wrangler tail` showed Chord's usual start-of-turn `POST /mcp` at 11:11:37 and nothing after it, so the model answered without tools.
- The timing explained why. Skill v2, which says "share the `listing_page` link", was published at 11:09:34. The `listing_page` field shipped at 11:09:59. But the conversation's only `get_listing` result was from 11:04, before the field existed. Told to share a link it didn't have, the model wrote a plausible one.

**Fix.** Skill v3 adds two rules: "never type or guess a URL; only send links copied character for character from a tool result", and "if you don't have `listing_page`, call `get_listing` first". The same prompt now fetches the real link.

**What I'd change in Chord.** The same failure on a `payment_url` would send a buyer to a fake payment page.
- Add an optional reply guard that flags or blocks any URL that didn't appear in a tool result or the skill.
- Show a "no tools called" marker in the conversation view, so builders can spot answers made without tools.

## 2. Skill ZIP upload broke the skill's own file references

**What happened.**
- I zipped the skill folder (`meridian-visit-desk/SKILL.md`, `meridian-visit-desk/references/…`) and uploaded it in **Create a teammate**.
- Review showed "Instructions: meridian-visit-desk/SKILL.md" and published without complaint.
- `SKILL.md` tells the model to read `references/agency.md`. The stored path was `meridian-visit-desk/references/agency.md`.
- Chord's own docs say "the path in the instructions must match the uploaded file", so the references could not resolve. Nothing warned me.

**How I found the cause.** `GET /v1/teammates/{id}/skills` returned `entrypoint: "meridian-visit-desk/SKILL.md"` and every file under that prefix.

**Fix.**
- Republished through the Skills API (`PUT …/draft` with `entrypoint: "SKILL.md"` and root-relative paths, then `POST …/publish`). It worked first time.
- Skill updates now ship from the repo through the same API calls (v2 and v3 went out this way).

**What I'd change in Chord.**
- Strip a single top-level folder on upload, as most ZIP-based uploaders do.
- At review, check every path the instructions mention against the package and warn on misses.

## 3. Couldn't find the workspace ID, and real IDs don't look like the docs

**What happened.**
- Every MCP-server endpoint is `/v1/workspaces/{workspace_id}/…`, but I couldn't find the workspace ID anywhere in the app. My first thought was that it might be my email.
- The docs' examples (`ws-a1b2c3d4`, `tm-a1b2c3d4`) suggested IDs I never saw. The real ones are `ws-3389fd22-bed3-484b-945a-c1d4bb186a3c` and a bare UUID teammate ID (`cc7d3039-…`).

**How I found the cause.** I opened browser DevTools and found it in the app's own request: `/api/proxy/v1/workspaces/ws-3389fd22-…/channel-bindings`. The teammate ID was in the page URL. Once I had a working key, `GET /v1/teammates/{id}` also returns `workspace_id`.

**Fix.** My setup script reads the workspace ID from the teammate, so I don't need to find it again.

**What I'd change in Chord.**
- Show workspace and teammate IDs, with copy buttons, in Settings and next to the API-key screen.
- Use real ID formats in the docs.
- Add `GET /v1/me` that returns the caller's workspaces and the key's permissions.

The last point would also have saved me 10 minutes: my first 403s (`Missing required permission: teammate:read`, request `ad2f7eb8-…`) turned out to be an unsaved `.env` file on my side. With no way to ask "what can this key do?", a wrong key and an under-scoped key look identical.

## 4. Autonomy: chosen at creation, no visible effect, and can't be changed by API

**What happened.**
- The **Review your teammate** screen asks for an autonomy level: *Suggest, I approve* / *Work with me* / *Act independently*. I picked **Work with me**. The screen doesn't say what each level means for a customer-facing agent.
- The teammate saved as `autonomy: "collaborative"`, with all six `capabilities` flags `false` (`execute_routine`, `own_end_to_end` and the rest) and `autonomous_ack: false`.
- In the simulator it still called every tool it needed without asking anyone: `hold_slot` (a real Paystack transaction), and `cancel_visit` at 11:28, which applied the refund policy (fee kept, under 24 hours) after the buyer said "yes". No approval step appeared anywhere, in the chat or in the Chord app. I couldn't observe any effect from the setting.
- The setting can't be changed after creation through the API (below).

**How I found the cause.**
- `GET /v1/teammates/{id}` showed the values above. The OpenAPI only describes the levels as "'assisted' (suggest only), 'collaborative' (execute routine tasks), 'autonomous' (end-to-end ownership)", with nothing on which tool calls count as "routine".
- `UpdateTeammateRequest` has no `autonomy` field. `PUT {"autonomy":"autonomous"}` returns **400 "Malformed or unrecognized request body"** (request `98b2c3c0-b7b5-41de-aaa8-05f18dbda822`), which doesn't say which field was wrong.

**Fix.** None needed for this build: the tools enforce the risky rules (refund amounts, confirmation only on Paystack's word), and tool calls run in customer chats. I left it on *Work with me*.

**What I'd change in Chord.**
- Say at creation what each level does on a customer channel. Does *Suggest* hold tool calls for approval? Do the capability flags gate anything?
- Allow changing autonomy after creation, in the app and in `PUT /v1/teammates/{id}`.
- Make the 400 name the unrecognised field.

---

## Smaller things

| What I hit | What I did | Suggestion for Chord |
|---|---|---|
| **No buyer identity reaches MCP tools.** `tools/call` carries no `_meta` and no sender/thread headers (only `user-agent: Java-http-client/23.0.2` plus Cloudflare headers). Yet the *model* knows the buyer: in a fresh session it opened with "Hello Yaqeen", my simulator display name. The spec's open question #2 is answered: the model gets identity, tools don't. | The agent asks for name and email; visits are looked up by email; `buyer_phone` is optional. | Opt-in `_meta` with sender ID, channel and thread ID, so tools can tie a payment to a WhatsApp number without asking for it. |
| **Replies are text only.** No attachment or media field in any chat or thread schema; the partner chat API is "synchronous text only". | Public listing pages with Open Graph tags; the agent shares the link. WhatsApp's preview bot (`WhatsApp/2.23.20.0`) fetched it within a minute. | Let a tool return an image the channel can send. |
| **The teammate gets every workspace connector by default** (`enabled_tool_types: [], unscoped: true`). The schema names native `bookings` and `paystack` connectors with `booking.*` webhooks, but `/docs/bookings` returns 404. | Scoped connectors to none (`PUT /tools {enabled_tool_types: [], unscoped: false}`) so only my 7 MCP tools are offered. Built custom because native bookings are undocumented. | Document the native connectors, or hide them from the schema until they are. Default new teammates to scoped. |
| **Defaults that widen access:** an empty `mcp_server_ids` means all servers; an empty `enabled_tools` means all tools. | Registered the server disabled, set `set_mcp_server_ids` first, then enabled it with an explicit 7-tool allowlist. Registration, discovery (7 tools, 911 ms) and health (`ok`, 21 ms) all worked first time. | Make empty mean empty, with an explicit `"*"` for all. |
| **No way to message the buyer first.** Partner chat is send-and-reply only; scheduled `WHATSAPP` tasks don't define `conversation_id`. | The buyer replies "paid"; `get_visit_status` reads what the webhook already recorded, or verifies with Paystack directly. | A documented "post to this conversation" call for tools and webhooks, e.g. payment confirmations. |

**Not Chord, for completeness:**
- **Paystack webhooks:** none arrived for the first two checkout payments, even though the bookings confirmed. Both were confirmed by my verify fallback (the return page and `get_visit_status` ask Paystack directly), so no buyer saw a wrong state. A probe charge sent through Paystack's Charge API later delivered `charge.success` to the Worker (`Paystack/2.0` → 200). Most likely the dashboard setting was saved after those payments.
- **Paystack checkout testing:** the checkout sits behind Cloudflare Turnstile, so test payments can't be automated headlessly. All payment testing was manual.
- **Test runner install:** `@cloudflare/vitest-pool-workers` is deprecated in favour of `@cloudflare/vitest-plugin`, and npm 10 crashed on its peer range (`Cannot read properties of null (reading 'edgesOut')`). `.npmrc` sets `legacy-peer-deps`.
