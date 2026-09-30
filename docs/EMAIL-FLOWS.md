# Email flows

Build these in Klaviyo or Gro. The copy is ready to paste. Keep the voice: short, direct, from a person. One ask per email.

Merge tags are written as `{{ first_name }}`, `{{ product }}` and so on. Use your email tool's own syntax.

---

## 1. Welcome (on newsletter signup)

**Trigger:** subscribed to list · **Timing:** immediately

> **Subject:** You're in. Here's what A3GK is.
>
> Hi {{ first_name | default: "keeper" }},
>
> A3GK is a goalkeeper-only store. We sell a short list of things — glove care, tape, socks and custom padded kit — and only if we'd use them ourselves.
>
> Three things you'll never get from us: fake "was" prices, made-up lead times, or product copy that pretends everything is perfect for everyone.
>
> Start here: **[How to make your gloves last longer →]** (glove care guide)
>
> — A3GK
>
> *P.S. Reply to this email any time. A real person reads it.*

No discount code. The positioning is fair prices every day, not codes.

---

## 2. Post-purchase check-in (the feedback system)

**Trigger:** order fulfilled + delivered (use the delivery event if your tool has one, otherwise fulfilled + 5 days).
Send **one** version depending on what was in the order. Questions are specific and answer in one tap (link to a short form, or ask them to reply with 1/2/3).

### Glove care
> **Subject:** Quick one about your {{ product }}
>
> It should have arrived by now. Two quick questions:
> 1. Did your gloves grip better after using it? **Yes / A bit / No**
> 2. Anything you'd change? (smell, bottle, how long it lasts) — just hit reply.
>
> We read every answer. If enough keepers say the same thing, we change it and put it on our [You told us](/pages/you-told-us) page.

### Protection / padded kit / socks
> **Subject:** Did it fit?
>
> 1. Did the size fit as expected? **Too small / Right / Too big**
> 2. Did the padding sit where you needed it when you dived? **Yes / Not quite**
> 3. Anything else? Hit reply.

### Custom builder order
> **Subject:** How was designing your kit?
>
> 1. Was the builder easy to use? **Yes / Mostly / No**
> 2. Did the finished kit match your proof? **Yes / No**
> 3. What almost stopped you ordering? Hit reply.

### Tape
> **Subject:** How's the tape holding up?
>
> 1. Does it stay put through a full session? **Yes / Mostly / No**
> 2. Anything you'd change? Hit reply.

---

## 3. Review request

**Trigger:** 14 days after delivery. Use Judge.me's review request, with custom questions switched on:
- Where do you play? (Grass / Artificial / Indoor / Mixed)
- Position level? (Youth / Amateur / Semi-pro / Pro)
- Fit: (Runs small / True / Runs large). Protection and socks only.
- How long have you used it?

> **Subject:** Would you tell other keepers what you think?
>
> Honest reviews help keepers buy the right thing. Good or bad, we publish all verified reviews.

---

## 4. Refill reminder

**Trigger:** Placed order containing a care product or tape · **Timing:** the product's `a3gk.refill_days` minus 7 days.
Only switch this on **after** you've measured how long a unit lasts. A reminder that arrives too early is spam.

> **Subject:** Running low on {{ product }}?
>
> Going by when you ordered, you're probably close to the end of your {{ product }}.
>
> **[Reorder in one click →]** (same size, same address)
>
> Not running low? Ignore this — we won't nag. Or change how often we remind you: **[settings]**

---

## 5. Abandoned cart / checkout

**Timing:** 4 hours, then 24 hours. Two emails maximum. **No discount code.**

> **Subject:** Still thinking about it?
>
> Your cart's saved: {{ cart_items }}
>
> If something's stopping you — sizing, shipping, lead time — reply and ask. A keeper will answer.
>
> **[Back to your cart →]**

For carts with a custom builder item, add:
> Your design is saved — the **Reopen design in builder** link in your cart takes you straight back to it.

---

## 6. Custom order: proof and production (manual/transactional)

1. **Order confirmation** (Shopify notification, add a line):
   > Custom kit is made to order. Lead time: {{ lead_time }}. We'll email a proof within [TBC] working days — nothing is made until you approve it.
2. **Proof email** (sent by you, manually, from a template):
   > Here's your proof. Please check every name, number, colour and size. Reply **APPROVED** or tell us what to change.
3. **In production:** on approval, with the realistic ship date.
4. **Shipped:** the standard Shopify shipping notification.

If your crest was set to "Our club crest", the proof email asks for the artwork first.

---

## 7. Returns (capture the reason, always)

In the returns flow (Shopify's self-serve returns, or the accounts app), make the **reason required** and use specific options:
- Too small / Too big
- Padding in the wrong place
- Didn't perform as described (please tell us how)
- Arrived damaged or faulty
- Changed my mind

Every return reason goes into a monthly review → supplier feedback → "You told us" entry when something changes.
