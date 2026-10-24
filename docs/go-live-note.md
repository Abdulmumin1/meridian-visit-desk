# Go-live note for Meridian Homes

## 1. Setting it up in Chord

The booking tools are already built, hosted and running. You don't deploy anything or touch any code. Everything below happens in your Chord dashboard.

1. **Create the teammate.** Teammates → Create a teammate → upload the skill folder (`skill/meridian-visit-desk`). Review it, publish it, and turn on "Activate after setup".
2. **Connect the tools.** In the teammate's settings, open Tools → Add tool and add the booking tools as a remote (MCP) server. You'll be given a server address and an access token separately; paste them in. Allow only the seven tools: `search_listings`, `get_listing`, `check_slots`, `hold_slot`, `get_visit_status`, `cancel_visit`, `log_unanswered`. Switch it on for this teammate only.
3. **Switch off other tools.** Make sure no other tools or connectors are enabled for this teammate.
4. **Set the handover alert.** Add the email address that should be told when the assistant hands a chat to a person.
5. **Connect your WhatsApp number** (Channels → Add channel). Until a real number is connected, it only works in the simulator.
6. **Try it** with the test conversations before telling any buyer.

## 2. What it does, and what must be true first

**What it does.** On WhatsApp, the assistant answers questions about your listings using only the details you've recorded. If something isn't recorded, it says so and adds the question to your queue. It books viewings: it holds a slot for 15 minutes, sends a ₦5,000 Paystack link, and confirms only once Paystack confirms the money. It cancels and refunds by your policy: full refund 24+ hours ahead, fee kept under 24 hours or on a no-show, always a full refund if you cancel or the home is let. Complaints, price disputes, legal and safety matters go straight to a person in Chord.

**What it doesn't do.** It doesn't negotiate prices, collect rent or deposits, screen tenants or give legal advice. It doesn't message buyers first: a buyer who pays has to reply "paid", or come back later, to hear they're confirmed.

**Your team's daily jobs:**
- Answer the questions in the visit desk's **Questions** page. The assistant uses your answer from the next message.
- Mark a home **Let** or **Sold** the moment it goes. The assistant stops offering it, and anyone booked is refunded automatically.
- Check the visit desk for refunds Paystack refused. Those buyers were told a person would sort it out.
- Reply to handed-over chats in Chord.

**Before real buyers use it:**
1. **Paystack live keys** on a verified business account. The person hosting the tools swaps the test key for yours and registers the live webhook; someone on your side can see the Paystack dashboard.
2. **Your real listings**, with accurate status. The assistant is only as right as this data, and stale "available" homes are the main way it will mislead people.
3. **Confirm the rules:** the ₦5,000 fee, the 15-minute window, the 24-hour cutoff, how alternatives are chosen, and a refund timeframe you're happy for it to quote (it currently promises none).
4. **Test handovers on a real phone.** The simulator doesn't show buyers your staff's replies after a handover. Check that they arrive on WhatsApp.
5. **Named people:** who reads handovers and when, who answers questions daily, and who is alerted when a refund fails or the tools go down. Today nobody is paged; the visit desk shows it, but someone has to look.
6. **Failure drills:** if Paystack is down, the assistant says nothing was held or charged. If the tools are down, the assistant can't book at all. Decide who tells buyers and how.
7. **Data protection:** buyer names, emails and chats go to Chord, the tools' host and Paystack, some outside Nigeria. Check your NDPA 2023 obligations and add a privacy notice to the first message.
8. **Visit desk sign-in.** In this test build, anyone with the visit desk link can open it, because the data is made up. Switch on sign-in (or put it behind your staff logins) before it shows real buyer details or can issue refunds.
