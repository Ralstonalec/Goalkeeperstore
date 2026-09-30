# A3GK launch runbook

Everything that happens **in Shopify admin** to turn this theme into a live store.
The theme can't install apps, create products or set shipping rates. Those steps are listed here in order.

Anything marked **[TBC]** needs a real answer from you before launch. Grep the repo for `TBC` to find them all.

---

## 0. Open decisions (answer these first)

| # | Decision | Why it matters | Default if you don't decide |
|---|----------|----------------|-----------------------------|
| 1 | **Gloves.** Your brief says no own-brand gloves until a manufacturer passes pro-level testing. You've also said everything will come from Alibaba suppliers and be own-brand where possible. | The site currently says "Our own gloves? Not yet." That is only true if we stick to guardrail #1. | Keep gloves off the store. Glove *guidance* (sizing, care, choosing) stays live. |
| 2 | **Partner brands.** None at launch? | The homepage "honest picks" and the gloves collection handle both cases. | None. The "not yet" state shows. |
| 3 | **Currency and markets.** Where do you ship from and to? | Price display, duties, and the size charts (cm vs inches). | [TBC] |
| 4 | **Grip socks.** Are they own-brand from day one? | Launch range. | Own-brand if supplier MOQ works; otherwise leave the category as "Coming soon". |
| 5 | **Crest uploads in the builder.** Collect by email after the order (built), or add an upload app (e.g. Uploadery)? | Customer convenience versus one more app. | Collect by email. It is already built and needs no app. |
| 6 | **Saving designs to the customer account.** Designs currently save to the browser plus a shareable link. | True account saving needs an app or backend (see §8). | Browser + link for the MVP. |
| 7 | **Custom kit lead time and made-to-order terms.** | The builder won't let anyone order until the lead time is set. That lock is deliberate. | Ordering stays off. |

---

## 1. Create the store and connect this theme

1. Create the Shopify store and choose a plan.
2. **Online Store → Themes → Add theme → Connect from GitHub.** Pick this repo and the `main` branch.
   - Shopify syncs both ways. Edits made in the theme editor are committed back to the branch.
   - Files outside Shopify's theme folders (`docs/`, `content/`, `tools/`) are ignored by the sync.
3. Leave the theme unpublished and use **Preview** until launch.
4. Before every push, run `python3 tools/validate_templates.py`. Shopify rejects a theme with a template setting that doesn't exist in the section schema, and this script catches those first.

## 1b. Create the pages, collections, blog and menus (one command)

**Every page works as soon as the theme is live, with no setup.** Shopify only serves `/pages/builder` once a page with that handle exists in admin. Until then, the theme serves built-in copies of each page, collection and guide from the homepage, at addresses like `/?view=builder`. All links, the header menu and the footer point there automatically. The built-in copies are marked `noindex` so search engines skip them.

Creating the real pages gives you proper URLs (`/pages/builder`) and search-engine visibility, and links switch over automatically. This script creates everything the theme links to:
- 9 pages, each with its template
- 6 collections, published to the Online Store
- the Guides blog, with the 5 guides from `content/guides/`
- the `a3gk.*` product fields from §3
- the main menu and the three footer menus from §6

It never touches products, prices or policies, and it's safe to re-run: anything that already exists is skipped.

1. **Get an Admin API token.** In Shopify admin, go to **Settings → Apps and sales channels → Develop apps → Create an app**.
   - Under Admin API scopes, tick `write_content`, `write_products`, `write_online_store_navigation` and `write_publications`.
   - Click **Install**, then reveal and copy the token (it starts `shpat_`).
2. **Run the script** on your computer, from a copy of this repo, with Node 18 or later:
   ```sh
   npm install
   npm run setup:store -- --dry-run          # shows what it will create, changes nothing
   SHOPIFY_STORE=your-store.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_xxx npm run setup:store
   ```
3. Treat the token like a password and don't commit it. When setup is done, you can uninstall the app.

If you'd rather click through it yourself, §3, §5 and §6 below list the same items so you can create them by hand.

After editing a page template or a guide, run `npm run gen:fallbacks` so the built-in copies stay in sync.

## 2. Settings

- **Settings → General:** store name `A3GK`, sender email, and your business address (required for policies).
- **Settings → Markets:** primary market and currency **[TBC]**.
- **Settings → Payments:** turn on Shopify Payments, then Shop Pay, Apple Pay and Google Pay.
- **Settings → Checkout:** customer accounts should be **new customer accounts** (Dawn 16 is built for them). Turn on marketing opt-in at checkout.
- **Settings → Shipping:** real rates only. Put any free-shipping threshold in the announcement bar *only once it's set*. Set up a separate shipping profile for made-to-order custom kit (see §6).
- **Settings → Policies:** paste the drafts from `content/policies/` and fill every [TBC].

## 3. Metafield definitions

**Settings → Custom data → Products → Add definition.** Namespace and key must match exactly, because the theme reads these:

| Name | Namespace.key | Type | Used for |
|------|---------------|------|----------|
| Tagline | `a3gk.tagline` | Single line text | One-liner under the title |
| Why we made this | `a3gk.why_we_made` | Multi-line text | "Why we made this / why we stock this" |
| Good for | `a3gk.good_for` | List of single line text | Honest fit (surface, position, keeper type) |
| Not ideal for | `a3gk.not_ideal_for` | List of single line text | Honest limitations |
| Specs | `a3gk.specs` | List of single line text | One spec per entry, as `Label: Value` (e.g. `Volume: 120ml`) |
| How to use | `a3gk.how_to_use` | Multi-line text | Instructions |
| How often | `a3gk.how_often` | Single line text | e.g. "Before every match and training session" |
| Lead time | `a3gk.lead_time` | Single line text | Overrides the default shipping line |
| Benchmark product | `a3gk.benchmark_name` | Single line text | e.g. "GloveGlu Grip Spray" |
| Benchmark price | `a3gk.benchmark_price` | Decimal | Their **full retail** price, in store currency |
| Benchmark checked | `a3gk.benchmark_checked` | Single line text | e.g. "Oct 2026". Re-check quarterly. |
| Bundle items | `a3gk.bundle_items` | List of product references | Bundle products only; drives the savings maths |
| Refill days | `a3gk.refill_days` | Integer | Typical days a unit lasts, for refill reminders (§7) |

Comparison rules. The theme enforces these:
- A price comparison only renders when **both** a benchmark name and a benchmark price exist.
- Always compare to their full retail price, never their sale price. Record the date you checked.
- Compare like for like, and note any difference in volume in the tagline or specs.

## 4. Products and collections

1. Fill `docs/PRODUCTS.md` for each product first. It is the spec sheet.
2. Create each product. Pick the template under **Theme template**:
   - Glove care → `care`
   - Protection, padded apparel, socks → `apparel`
   - Tape, bags and anything else → default
   - Bundles → `bundle`
   - Builder base garments (Jersey/Shorts/Pants) → `builder-base`. This page just sends people to the builder.
3. Status stays **Draft** until the product is physically in stock and photographed.
4. Collections: `glove-care`, `tape-socks`, `protection`, `gloves` (use the `gloves` collection template), `bags`, `bundles`. Use automated collections by product type.
5. Install **Shopify Search & Discovery** (free) for filters by surface and position if you add those as metafields later.

### Bundles

- Install **Shopify Bundles** (free, made by Shopify) so bundle inventory draws from the component products.
- Set the bundle's `a3gk.bundle_items` metafield to the same products. The bundle template works out "separately vs bundle" from live prices.
- The `/pages/bundles` page uses one bundle section per bundle. In the theme editor, pick the bundle product and add item blocks.
- If a bundle has no saving, the site says so. Don't fake one.

### Builder base products

Create three products: **Custom Padded Jersey**, **Custom Padded Shorts**, **Custom Padded Pants**. Give each the `builder-base` template.

The builder reads these option names:
- `Size` (e.g. S, M, L, XL, plus youth sizes)
- `Padding`. Values must match the "Padding options → zones" setting on the builder section:
  - Jersey: `None`, `Elbows`
  - Shorts: `None`, `Hip + tailbone`, `Hip, tailbone + thigh`
  - Pants: the shorts values, plus `Full`
- `Sleeve` (jersey only): `Short`, `Long`

Each variant's price is what the customer pays, so set it from the manufacturer's real cost plus your margin.

Keep these products out of every collection. Also set the `seo.hidden` metafield (namespace `seo`, key `hidden`, integer `1`) so search engines and the sitemap skip them. If someone lands on one anyway, the `builder-base` template sends them to the builder.

If the manufacturer charges extra for name, number or crest print, create add-on products for them and pick them in the builder section settings. If printing is included, leave those settings blank.

## 5. Pages

**Online Store → Pages → Add page.** Choose the matching template. Page body text can stay empty, because the sections carry the content.

| Page title | Handle | Template |
|-----------|--------|----------|
| Kit designer | `builder` | `page.builder` |
| Bundles | `bundles` | `page.bundles` |
| Size guide | `size-guide` | `page.size-guide` |
| Team & club orders | `team-orders` | `page.team-orders` |
| Feedback | `feedback` | `page.feedback` |
| You told us | `you-told-us` | `page.you-told-us` |
| About | `about` | `page.about` |
| Our mission | `mission` | `page.mission` |
| Contact | `contact` | `page.contact` |
| FAQ | `faq` | `page.faq` |

Blog: create a blog with handle `guides` and publish the articles in `content/guides/`.

Then open the theme editor on the **Kit builder** page and set:
- the three base products
- **Lead time**: until this is filled in, the builder is preview-only
- the made-to-order terms
- the manufacturer's real colour palette
- **AI endpoint URL** (optional, see §5b)

## 5b. AI kit and crest design (optional)

The kit designer can design kits from a described "vibe" and draw original crests. This runs as a small function on your Vercel project (`api/design.js`) and uses Claude through your own Anthropic API key. The key never reaches the browser or the theme.

1. Get an API key at console.anthropic.com (billing is per use; a kit request is a few cents at most).
2. **Vercel → Project → Settings → Environment Variables:**
   - `ANTHROPIC_API_KEY` = your key
   - `ALLOWED_ORIGINS` = your store's addresses, comma-separated, e.g. `https://a3gk.com,https://a3gk.myshopify.com`
   - optional `A3GK_AI_DAILY_LIMIT` = AI requests per visitor per day (default 30)
3. Redeploy. The Vercel design preview turns the AI option on automatically once the key is set.
4. In Shopify, open the theme editor on the Kit designer page and set **AI endpoint URL** to `https://<your-vercel-project>.vercel.app/api/design`.

Leave the URL blank to hide every AI option. What's enforced in code:
- Kits only use colours from the palette you set, and only patterns, fonts and collars the designer can render.
- Crests are checked on the server and again in the browser: flat SVG only, no scripts, links or images.
- The prompt tells the model to make original crests and not recreate club or brand logos. You still approve a proof before anything is printed.

## 6. Navigation

- **main-menu:** Glove care · Kit designer · Tape & socks · Protection · Bundles · Mission · Guides · Team orders
- **footer-shop:** Glove care · Tape & socks · Protection · Bundles · Kit builder · Gloves
- **footer-help:** Size guide · Shipping · Returns · FAQ · Contact · Team orders
- **footer-learn:** About · Guides · You told us · Feedback

## 7. Apps

| Job | App (from your brief) | Setup notes |
|-----|------------------------|-------------|
| Customer portal: order history, reorder, wishlist, returns | Customer Accounts Deluxe (free starter / $19 Pro) | **Check it supports Shopify's new customer accounts before installing.** If it doesn't, use Shopify's built-in order history and a "Buy again" customer account extension. |
| Refill reminders | Replenish (free up to 100 reminders a month) **or** Reorder Reminder Pro | Base timing on each product's `a3gk.refill_days`. Don't guess: time how long a bottle actually lasts in testing. Include one-click reorder. |
| Email/SMS | Klaviyo (free under 250 contacts) **or** Gro | Flows in `docs/EMAIL-FLOWS.md`. |
| Reviews | Judge.me (~$15/mo) | Turn on custom review questions (fit, durability, surface, position). Publish every verified review, including negative ones, because the product page promises it. Add the Judge.me app block to the product details section. |
| Bundles | Shopify Bundles (free) | See §4. |
| Filters | Shopify Search & Discovery (free) | Optional at launch. |

Saved sizes and fit preferences (hand measurement, cut, surfaces, position) are stored in the browser today (the glove sizer saves to `localStorage`). To keep them on the customer record, you need an app that writes customer metafields: Customer Accounts Deluxe Pro or a small custom app. Definitions to use: `a3gk.hand_cm` (decimal), `a3gk.preferred_cut`, `a3gk.surfaces` (list), `a3gk.position`, `a3gk.sizes` (JSON).

## 8. Saved custom designs (what exists vs what's next)

**Built now (no backend):**
- Autosave of the current draft in the browser.
- Named saved designs in the browser (up to 20).
- A shareable "copy link" that encodes the full design.
- Each ordered garment carries the design as line item properties. Customers see a readable summary in cart and checkout, plus a "Reopen design in builder" link in the cart. In the order in admin you also get `_edit_link` (reopens the exact design) and `_spec` (the full design as JSON).

**Next step, if you want designs in the customer account:** a small Shopify app (App Proxy + customer metafield `a3gk.designs` as JSON, or a metaobject per design). Add it once order volume justifies it.

## 9. Analytics and SEO

- **Analytics:** Shopify Analytics is built in. Add Google Analytics 4 via the Google & YouTube channel app, which handles conversion tracking. Add Meta pixel via the Facebook & Instagram app only if you'll run Meta ads.
- **SEO:**
  - Set a title tag and meta description on every product, collection, page and article (use "Search engine listing").
  - Product structured data comes from Dawn. FAQ sections output `FAQPage` schema, and only one per page has it switched on.
  - Keep URLs short: `/products/grip-spray`, not `/products/a3gk-grip-spray-120ml-new`.
- **Queries to target with guides:** "how to clean goalkeeper gloves", "goalkeeper glove size chart", "negative cut vs roll finger", "best goalkeeper gloves for artificial grass", "padded goalkeeper shorts", "goalkeeper glove grip spray".

## 10. Pre-launch checklist

- [ ] Every product: real photos, all metafields, correct template, price checked against spec sheet
- [ ] Every price comparison has a checked date and a full retail price
- [ ] Bundle maths shows a real saving, or honestly says it doesn't
- [ ] Category badges on the homepage match reality ("Available now" only when in stock)
- [ ] Builder: lead time set, palette matches the manufacturer, one test order placed end to end
- [ ] Policies filled in, with no [TBC] left: `grep -rn "TBC" content/`
- [ ] "You told us" shows the honest empty state. No invented examples.
- [ ] Test on a real phone: builder, cart, checkout, account
- [ ] Email flows switched on and tested with a real order
- [ ] Remove the password page
