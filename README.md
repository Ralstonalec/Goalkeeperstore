# A3GK: goalkeeper-first Shopify theme

A Shopify Online Store 2.0 theme for **A3GK**, a keeper-only store. It's built on Shopify's **Dawn 16.0.0** and customised heavily: dark cinematic design, honest product pages, bundle maths, a custom padded-kit builder, and a public feedback loop.

Shopify stays in charge of commerce: products, variants, cart, checkout, customer accounts and email. The theme adds the A3GK layer on top.

## What's in here

```
assets/      a3gk.css (design system), a3gk.js (reveals/parallax),
             a3gk-builder.js/.css (kit builder), self-hosted Archivo variable font (OFL)
sections/    a3gk-*.liquid: all custom sections (see below). Everything else is Dawn.
snippets/    a3gk-media (image or honest placeholder), a3gk-value-compare, a3gk-status-badge
templates/   homepage, product (default/care/apparel/bundle/builder-base),
             pages (builder, bundles, size guide, team orders, feedback, about, contact, FAQ),
             gloves collection
config/      A3GK colour schemes and fonts
docs/        SETUP.md (launch runbook — start here), PRODUCTS.md, SOURCING.md,
             EMAIL-FLOWS.md, IMAGERY.md
content/     Ready-to-paste guides (blog) and policy drafts
tools/       validate_templates.py: checks templates against section schemas
```

### Custom sections

| Section | What it does |
|---------|--------------|
| `a3gk-hero` | Full-bleed video or still, with light parallax that respects reduced motion |
| `a3gk-statement` | Big-type statement with optional points and links |
| `a3gk-category-tiles` | Category grid with honest status badges (Available now / Coming soon) |
| `a3gk-care-showcase` | Own-brand care line with a side-by-side price against a named big-brand equivalent |
| `a3gk-honest-picks` | 2–4 products, each with a take plus "good for" and "not ideal for". Empty state: "Our own gloves? Not yet." |
| `a3gk-builder-teaser` | Homepage builder promo |
| `a3gk-builder` | **Custom kit builder**: front/back SVG preview, colours, pattern, collar and sleeves, name and number, crest, padding zones, sizes. Prices come from real variants and the lead time is shown before cart. Save, re-edit and share link. |
| `a3gk-feedback-log` | "Keepers tell us things. We change things." A dated changelog with an honest empty state |
| `a3gk-bundle` | Bundle with automatic "separately vs bundle" maths from live prices |
| `a3gk-product-details` | Honest product-page content from `a3gk.*` metafields: why, fit, specs, how-to, comparison, lead time |
| `a3gk-glove-sizer` | Hand-measurement glove size calculator |
| `a3gk-size-chart` | Editable size charts. Says "not confirmed yet" rather than showing unchecked numbers. |
| `a3gk-steps` | Steps, phases or volume-price tiers (tiers without a price show "Ask us") |
| `a3gk-faq` | Accordion FAQ with `FAQPage` structured data |
| `a3gk-contact-form` | Native Shopify contact form in three modes: contact, feedback, team quote |

## Honesty is enforced in code, not only copy

- Price comparisons only render when a benchmark name **and** price exist, and they carry a "checked" date.
- Bundle savings are calculated from live prices. If there's no saving, the page says so.
- The builder won't let anyone order until a real lead time is set, and it requires the customer to confirm it.
- Empty feedback logs, size charts and price tiers show honest placeholders, never invented examples.
- The gloves section defaults to "Not yet".

## Deploy

1. Shopify admin → Online Store → Themes → **Add theme → Connect from GitHub** → this repo.
2. Create the pages, collections, blog and menus with `npm run setup:store`. It needs an Admin API token; see [docs/SETUP.md](docs/SETUP.md) §1b. Without this step, only the homepage exists.
3. Follow the rest of **[docs/SETUP.md](docs/SETUP.md)**: products, apps, policies.

With the Shopify CLI instead: `shopify theme dev` / `shopify theme push`. The `.shopifyignore` file keeps `docs/`, `content/` and `tools/` out of the upload.

## Design preview on Vercel

Vercel can't run the store: Liquid, cart, checkout and accounts only work on Shopify. This repo *does* include a static **design preview** for Vercel. It shows the homepage, builder, bundles, size guide, team orders, about, FAQ, guides and policy drafts, rendered from the same theme files. Forms and checkout are disabled, and a banner says it's a preview.

- Import the repo in Vercel. `vercel.json` sets everything: install `npm install`, build `npm run build:preview`, output `dist/`.
- Local: `npm install && npm run build:preview`, then serve `dist/`.
- Each push to `main` redeploys the preview. The Shopify theme is unaffected, because `.shopifyignore` keeps these files out of the theme.

## Before pushing changes

```sh
python3 tools/validate_templates.py   # template settings vs section schemas
shopify theme check                   # Shopify's linter (if you have the CLI)
```

## Licences

Dawn is © Shopify, used under its licence (see `LICENSE.md`). Archivo is under the SIL Open Font License 1.1.
