/*
  Static design preview of the A3GK theme, for Vercel (or any static host).

  The real store runs on Shopify — Liquid, cart, checkout and accounts only
  work there. This renders the A3GK sections from the same template JSON with
  liquidjs and Shopify filter stubs, so the design, copy, builder and guides
  can be shared as a normal website. No products, cart or checkout.

  Usage: npm run build:preview   → writes ./dist
*/
import { Liquid } from 'liquidjs';
import { marked } from 'marked';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'dist');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'assets'))) {
  if (f.startsWith('a3gk')) fs.copyFileSync(path.join(ROOT, 'assets', f), path.join(OUT, 'assets', f));
}

/* ---------------- Liquid engine with Shopify stubs ---------------- */

const engine = new Liquid({ root: [path.join(ROOT, 'snippets')], extname: '.liquid', jsTruthy: false });
let styles = [];

function blockTag(name, render) {
  engine.registerTag(name, {
    parse(token, remain) {
      this.tpls = [];
      const stream = engine.parser
        .parseStream(remain)
        .on(`tag:end${name}`, function () {
          this.stop();
        })
        .on('template', (tpl) => this.tpls.push(tpl))
        .on('end', () => {
          throw new Error(`tag ${name} not closed`);
        });
      stream.start();
    },
    *render(ctx) {
      const inner = yield this.liquid.renderer.renderTemplates(this.tpls, ctx);
      return render(inner);
    },
  });
}

blockTag('schema', () => '');
blockTag('stylesheet', (css) => {
  styles.push(css);
  return '';
});
blockTag(
  'form',
  (inner) =>
    `<form class="a3-card a3-form__card a3-bundle__form" onsubmit="event.preventDefault();alert('This is a design preview — forms and checkout work on the live Shopify store.');">${inner}</form>`
);

engine.registerFilter('money', (c) => '$' + (Number(c || 0) / 100).toFixed(2));
engine.registerFilter('asset_url', (v) => `/assets/${v}`);
engine.registerFilter('stylesheet_tag', (v) => `<link rel="stylesheet" href="${v}">`);
engine.registerFilter('image_url', (v) => v);
engine.registerFilter('image_tag', (v) => `<img src="${v}" alt="">`);
engine.registerFilter('video_tag', () => '');
engine.registerFilter('json', (v) => JSON.stringify(v ?? null));
engine.registerFilter('handleize', (v) =>
  String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
);
engine.registerFilter('default_errors', (v) => String(v));
engine.registerFilter('t', (v) => v);

/* ---------------- Helpers ---------------- */

const mapUrl = (u) =>
  typeof u === 'string'
    ? u.replace(/^shopify:\/\/(pages|collections|blogs|products)\//, '/$1/').replace(/^shopify:\/\/policies\//, '/policies/')
    : u;

const mapAll = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, mapUrl(v)]));

function schemaOf(type) {
  const src = fs.readFileSync(path.join(ROOT, 'sections', `${type}.liquid`), 'utf8');
  const m = src.match(/{%-?\s*schema\s*-?%}([\s\S]*?){%-?\s*endschema/);
  return m ? JSON.parse(m[1]) : { settings: [] };
}

function withDefaults(defs, values) {
  const out = {};
  for (const d of defs || []) if (d.id) out[d.id] = d.default !== undefined ? d.default : d.type === 'checkbox' ? false : '';
  return mapAll({ ...out, ...(values || {}) });
}

function readGuides() {
  const dir = path.join(ROOT, 'content', 'guides');
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
      const meta = {};
      if (fm) fm[1].split('\n').forEach((l) => {
        const i = l.indexOf(':');
        if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim();
      });
      return { ...meta, body: marked.parse(fm ? raw.slice(fm[0].length) : raw) };
    });
}
const guides = readGuides();

const guideCards = (limit = 99) => `
  <section class="a3-section" style="--a3-pad-top:48px;--a3-pad-bottom:96px">
    <div class="a3-wrap">
      <div class="a3-head"><h2>Guides</h2><p><a class="a3-link" href="/blogs/guides">All guides</a></p></div>
      <div class="a3-grid" style="--a3-min:28rem">
        ${guides
          .slice(0, limit)
          .map(
            (g, i) => `<a class="a3-item" href="/blogs/guides/${g.handle}">
              <h3>${g.title}</h3><p class="a3-muted">${g.seo_description || ''}</p></a>`
          )
          .join('')}
      </div>
    </div>
  </section>`;

async function renderSections(template) {
  let html = '';
  for (const id of template.order) {
    const sec = template.sections[id];
    if (sec.type === 'featured-blog') {
      html += guideCards(sec.settings?.post_limit || 3);
      continue;
    }
    if (!sec.type.startsWith('a3gk-')) continue; // Dawn sections need Shopify data
    const schema = schemaOf(sec.type);
    const src = fs.readFileSync(path.join(ROOT, 'sections', `${sec.type}.liquid`), 'utf8');
    const bdefs = Object.fromEntries((schema.blocks || []).map((b) => [b.type, b]));
    const blocks = (sec.block_order || Object.keys(sec.blocks || {})).map((bid) => {
      const b = sec.blocks[bid];
      return { id: bid, type: b.type, settings: withDefaults(bdefs[b.type]?.settings, b.settings), shopify_attributes: '' };
    });
    const section = { id, settings: withDefaults(schema.settings, sec.settings), blocks };
    html += await engine.parseAndRender(src, {
      section,
      request: { design_mode: false, path: '/' },
      template: { name: 'page' },
      shop: { money_format: '${{amount}}' },
      routes: { cart_url: '/cart', cart_add_url: '/cart/add', account_login_url: '/account/login', root_url: '/' },
      form: {},
    });
  }
  return html;
}

const NAV = [
  ['Glove care', '/collections/glove-care'],
  ['Kit builder', '/pages/builder'],
  ['Bundles', '/pages/bundles'],
  ['Size guide', '/pages/size-guide'],
  ['Guides', '/blogs/guides'],
  ['Team orders', '/pages/team-orders'],
];

function page(title, body, description = '') {
  const css = styles.map((s) => `<style>${s}</style>`).join('');
  styles = [];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} – A3GK</title>
<meta name="description" content="${description.replace(/"/g, '&quot;')}">
<meta name="theme-color" content="#0e0f0d">
<meta name="robots" content="noindex">
<link rel="preload" as="font" type="font/woff2" href="/assets/a3gk-archivo.woff2" crossorigin>
<style>
  *,*::before,*::after{box-sizing:border-box}
  html{font-size:62.5%}
  body{margin:0;background:#0e0f0d;color:#eeebe3;font-family:'A3GK Sans',system-ui,sans-serif;font-size:1.6rem;line-height:1.55;-webkit-font-smoothing:antialiased}
  a{color:inherit}
  img{max-width:100%}
  .visually-hidden{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .pv-bar{background:#eeebe3;color:#121310;text-align:center;font-size:1.3rem;padding:.8rem 1.6rem;font-weight:500}
  .pv-announce{background:#000;text-align:center;font-size:1.3rem;padding:.8rem 1.6rem;color:#97948b}
  .pv-header{position:sticky;top:0;z-index:20;background:rgba(14,15,13,.92);backdrop-filter:blur(10px);border-bottom:1px solid rgba(237,239,236,.12)}
  .pv-header__in{display:flex;align-items:center;justify-content:space-between;gap:2rem;max-width:136rem;margin:0 auto;padding:1.8rem clamp(1.6rem,4vw,5.6rem)}
  .pv-logo{font-weight:800;font-stretch:72%;font-size:3rem;letter-spacing:-.01em;text-decoration:none}
  .pv-nav{display:flex;gap:2.8rem;font-size:1.5rem}
  .pv-nav a{text-decoration:none;opacity:.8}.pv-nav a:hover{opacity:1;text-decoration:underline;text-underline-offset:.35em}
  .pv-menu{display:none}
  .pv-menu summary{list-style:none;cursor:pointer;padding:.6rem 1.2rem;border:1px solid rgba(237,239,236,.24);border-radius:4px;font-size:1.4rem}
  .pv-menu summary::-webkit-details-marker{display:none}
  .pv-menu nav{position:absolute;left:0;right:0;top:100%;background:#131715;display:grid;padding:1.6rem;gap:1.4rem;border-bottom:1px solid rgba(237,239,236,.12)}
  @media (max-width:989px){.pv-nav{display:none}.pv-menu{display:block}}
  .pv-footer{background:#000;padding:7.2rem 0 5.6rem}
  .pv-footer__in{max-width:136rem;margin:0 auto;padding:0 clamp(1.6rem,4vw,5.6rem);display:grid;gap:3.2rem;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))}
  .pv-footer h4{margin:0 0 1.2rem;font-size:1.6rem}
  .pv-footer ul{list-style:none;margin:0;padding:0;display:grid;gap:.8rem;font-size:1.4rem;color:#9aa39d}
  .pv-footer a{text-decoration:none}.pv-footer a:hover{color:#eeebe3}
  .pv-prose{max-width:72rem;margin:0 auto;padding:6.4rem clamp(1.6rem,4vw,5rem) 9.6rem;line-height:1.7}
  .pv-prose h1{font-size:clamp(3.4rem,2.4rem + 2.4vw,5.2rem);margin:0 0 2.4rem}
  .pv-prose h2{font-size:2.8rem;margin:4.8rem 0 1.6rem}
  .pv-prose table{width:100%;border-collapse:collapse;font-size:1.5rem;display:block;overflow-x:auto}
  .pv-prose th,.pv-prose td{text-align:left;padding:1rem;border-bottom:1px solid rgba(237,239,236,.12);vertical-align:top}
  .pv-prose a{color:inherit;text-underline-offset:.3em}
  .pv-prose blockquote{margin:0;padding:.4rem 0 .4rem 2rem;border-left:2px solid #3be37f;color:#c9c6be}
</style>
<link rel="stylesheet" href="/assets/a3gk.css">
${css}
</head>
<body>
<div class="pv-bar">Design preview. The live store, cart and checkout run on Shopify.</div>
<div class="pv-announce">Goalkeepers only. Launching soon.</div>
<header class="pv-header"><div class="pv-header__in">
  <a class="pv-logo" href="/">A3GK</a>
  <nav class="pv-nav" aria-label="Main">${NAV.map(([l, h]) => `<a href="${h}">${l}</a>`).join('')}</nav>
  <details class="pv-menu"><summary>Menu</summary><nav aria-label="Main">${NAV.map(([l, h]) => `<a href="${h}">${l}</a>`).join('')}</nav></details>
</div></header>
<main id="MainContent">${body}</main>
<footer class="pv-footer"><div class="pv-footer__in">
  <div><h4>A3GK</h4><p class="a3-small">Goalkeepers only. If it isn't good enough to recommend, we don't sell it.</p></div>
  <div><h4>Shop</h4><ul><li><a href="/collections/glove-care">Glove care</a></li><li><a href="/collections/tape-socks">Tape &amp; socks</a></li><li><a href="/collections/protection">Protection</a></li><li><a href="/pages/bundles">Bundles</a></li><li><a href="/pages/builder">Kit builder</a></li><li><a href="/collections/gloves">Gloves</a></li></ul></div>
  <div><h4>Help</h4><ul><li><a href="/pages/size-guide">Size guide</a></li><li><a href="/policies/shipping-policy">Shipping</a></li><li><a href="/policies/refund-policy">Returns</a></li><li><a href="/pages/faq">FAQ</a></li><li><a href="/pages/contact">Contact</a></li><li><a href="/pages/team-orders">Team orders</a></li></ul></div>
  <div><h4>Learn</h4><ul><li><a href="/pages/about">About</a></li><li><a href="/blogs/guides">Guides</a></li><li><a href="/pages/you-told-us">You told us</a></li><li><a href="/pages/feedback">Feedback</a></li></ul></div>
</div></footer>
<script src="/assets/a3gk.js" defer></script>
</body>
</html>`;
}

function write(route, html) {
  const dir = path.join(OUT, route);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}

const readTemplate = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', `${name}.json`), 'utf8'));

/* ---------------- Routes ---------------- */

const routes = [
  ['/', 'index', 'Keeper kit, done properly.'],
  ['/pages/builder', 'page.builder', 'Kit builder'],
  ['/pages/bundles', 'page.bundles', 'Bundles'],
  ['/pages/size-guide', 'page.size-guide', 'Size guide'],
  ['/pages/team-orders', 'page.team-orders', 'Team & club orders'],
  ['/pages/feedback', 'page.feedback', 'Feedback'],
  ['/pages/you-told-us', 'page.you-told-us', 'You told us'],
  ['/pages/about', 'page.about', 'About'],
  ['/pages/contact', 'page.contact', 'Contact'],
  ['/pages/faq', 'page.faq', 'FAQ'],
  ['/collections/gloves', 'collection.gloves', 'Gloves'],
];

for (const [route, tpl, title] of routes) {
  write(route, page(title, await renderSections(readTemplate(tpl)), title));
}

// Collections that only exist once products are added in Shopify.
const soon = (heading, text) =>
  `<section class="a3-section" style="--a3-pad-top:120px;--a3-pad-bottom:120px"><div class="a3-wrap a3-wrap--narrow">
    <span class="a3-badge">Coming soon</span>
    <h1 style="font-size:clamp(3.6rem,2.4rem + 3vw,6.4rem);margin:1.6rem 0 2.4rem">${heading}</h1>
    <p class="a3-lede">${text}</p>
    <p><a class="a3-link" href="/pages/builder">Try the kit builder</a></p></div></section>`;
for (const [handle, name] of [
  ['glove-care', 'Glove care'],
  ['tape-socks', 'Tape & socks'],
  ['protection', 'Protection'],
  ['bags', 'Bags'],
  ['bundles', 'Bundles'],
  ['all', 'Shop'],
]) {
  write(`/collections/${handle}`, page(name, soon(name, 'Products go live here once they have passed testing and are in stock.'), name));
}
write('/cart', page('Cart', soon('Cart', 'The cart and checkout run on the live Shopify store. This is a design preview.'), 'Cart'));

// Guides blog
write(
  '/blogs/guides',
  page('Keeper guides', guideCards() , 'Goalkeeper guides: glove care, choosing gloves, padding, sizing.')
);
for (const g of guides) {
  write(`/blogs/guides/${g.handle}`, page(g.title, `<article class="pv-prose"><h1>${g.title}</h1>${g.body}</article>`, g.seo_description || ''));
}

// Policies (drafts)
for (const [handle, file] of [
  ['shipping-policy', 'shipping.md'],
  ['refund-policy', 'returns.md'],
  ['privacy-policy', 'privacy-additions.md'],
]) {
  const md = fs.readFileSync(path.join(ROOT, 'content', 'policies', file), 'utf8');
  write(`/policies/${handle}`, page(handle.replace('-', ' '), `<article class="pv-prose">${marked.parse(md)}</article>`));
}

fs.writeFileSync(
  path.join(OUT, '404.html'),
  page('Not found', soon('Not here', 'That page lives on the live Shopify store, or doesn\'t exist yet.'))
);

console.log(`A3GK preview built → ${path.relative(ROOT, OUT)}/`);
