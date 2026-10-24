# Submission

**Role:** Forward-deployed Engineering

**Problem.** Lagos estate agencies like Meridian Homes (a test agency: 40 rentals and sales in Lekki and Yaba) get most enquiries on WhatsApp, where agents answer the same listing questions late and inconsistently, book viewings on homes that are already let, and lose hours to no-shows. This Chord agent answers only from the agency's listing data (logging gaps instead of guessing), holds a viewing slot for 15 minutes, collects a ₦5,000 Paystack visit fee, and confirms only once Paystack does, applying the refund policy automatically for late payments, cancellations and homes that get let. It's worth paying for because each avoided no-show or double-booking saves an agent a wasted trip across Lagos traffic, and the fee pays for the visits that do happen. I deliberately left out rent and deposit collection, price negotiation, tenant screening, and proactive WhatsApp notifications.

## What to look at

1. **The agent:** *Meridian Homes* teammate on my Chord account, in the WhatsApp simulator. Try "i need a house with good electricity and security in lekki", pick one of the homes it suggests, then ask to see it at 11am on a weekday.
2. **Code:** this repo. Start with the [README](../README.md). The visit desk console is open at https://meridian-visit-desk.avdorr12345.workers.dev (no sign-in; all data is made up).
3. **Recording:** https://cap.so/s/ndk4w65q97qne6w
4. **[Deployment field notes](field-notes.md)**
5. **[Go-live note](go-live-note.md)**

## Where Chord does the work, and where the tools do

- **Chord:** the conversation, the agency's voice and rules (skill file), deciding which tool to call, and human handover (`handover_to_human` puts the thread in front of a person in Chord).
- **My MCP tools (Cloudflare Worker):** the things a model must not be trusted with: slot locking, payment state, the refund policy and listing facts. The model can't confirm a visit or invent an amenity because the tools only expose what is true.
