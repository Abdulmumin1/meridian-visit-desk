# Go-live note for Meridian Homes

**What it does.** On WhatsApp, the assistant answers questions about your listings using only the details you've recorded. If something isn't recorded, it says so and adds the question to your queue. It books viewings: it holds a slot for 15 minutes, sends a ₦5,000 Paystack link, and confirms only once Paystack confirms the money. It cancels and refunds by your policy: full refund 24+ hours ahead, fee kept under 24 hours or on a no-show, always a full refund if you cancel or the home is let. Complaints, price disputes, legal and safety matters go straight to a person in Chord.

**What it doesn't do.** It doesn't negotiate prices, collect rent or deposits, screen tenants or give legal advice. It doesn't message buyers first: a buyer who pays has to reply "paid", or come back later, to hear they're confirmed.

**Your team's daily jobs (in the visit desk console):**
- Answer the questions in **Questions**. The assistant uses your answer from the next message.
- Mark a home **Let** or **Sold** the moment it goes. The assistant stops offering it, and anyone booked is refunded automatically.
- Check **Needs attention** for refunds Paystack refused. Those buyers were told a person would sort it out.
- Reply to handed-over chats in Chord.

**What must be true before real buyers use it:**
1. **Paystack live keys** on a verified business account, kept as a Worker secret. The live webhook URL is registered, and someone can see the Paystack dashboard.
2. **A real WhatsApp number** connected in Chord (Meta Business verification). Until then it only runs in the simulator, which doesn't show buyers your staff's replies after a handover. Test that those replies reach a real phone.
3. **Your real listings**, with accurate status. The assistant is only as right as this data, and stale "available" homes are the main way it will mislead people.
4. **Confirm the rules:** the ₦5,000 fee, the 15-minute window, the 24-hour cutoff, how alternatives are chosen, and a refund timeframe you're happy for it to quote (it currently promises none).
5. **Named people:** who reads handovers and when, who answers questions daily, and who is alerted when a refund fails or the tools go down. Today nobody is paged; the console shows it, but someone has to look.
6. **Failure drills:** if Paystack is down, the assistant says nothing was held or charged. If the tools are down, the assistant can't book at all. Decide who tells buyers and how.
7. **Data protection:** buyer names, emails and chats go to Chord, Cloudflare and Paystack, some outside Nigeria. Check your NDPA 2023 obligations and add a privacy notice to the first message.
8. **Console sign-in.** The visit desk console is open to anyone with the link in this test build, because the data is made up. Switch `CONSOLE_OPEN` off so it asks for a token (or put it behind your staff logins) before it shows real buyer details or can issue refunds.
