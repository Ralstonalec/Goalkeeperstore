/*
  Creates everything the A3GK theme links to, in your Shopify store:
  pages (with the right template), collections, the Guides blog with its
  articles, navigation menus, and the product metafield definitions.

  The theme alone can't do this — pages, collections, blogs and menus are
  store data, not theme files. Safe to re-run: existing items (matched by
  handle) are updated or left alone, never duplicated.

  It does NOT touch products, prices, policies, or anything published at
  checkout. Policies stay drafts in content/policies/ until you fill the [TBC]s.

  Usage:
    SHOPIFY_STORE=your-store.myshopify.com \
    SHOPIFY_ADMIN_TOKEN=shpat_xxx \
    npm run setup:store            # add -- --dry-run to preview without changes

  Token: Shopify admin → Settings → Apps and sales channels → Develop apps →
  Create an app → Admin API scopes: write_content, write_products,
  write_online_store_navigation, write_publications → Install → reveal token.
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_VERSION = '2025-07';
const DRY = process.argv.includes('--dry-run');
const STORE = (process.env.SHOPIFY_STORE || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || '';
const ENDPOINT = process.env.SHOPIFY_GRAPHQL_URL || `https://${STORE}/admin/api/${API_VERSION}/graphql.json`;

if (!DRY && (!STORE || !TOKEN)) {
  console.error('Set SHOPIFY_STORE (your-store.myshopify.com) and SHOPIFY_ADMIN_TOKEN, or pass --dry-run.');
  process.exit(1);
}

/* ---------------- What to create ---------------- */

const PAGES = [
  { handle: 'builder', title: 'Kit builder', template: 'builder' },
  { handle: 'bundles', title: 'Bundles', template: 'bundles' },
  { handle: 'size-guide', title: 'Size guide', template: 'size-guide' },
  { handle: 'team-orders', title: 'Team & club orders', template: 'team-orders' },
  { handle: 'feedback', title: 'Feedback', template: 'feedback' },
  { handle: 'you-told-us', title: 'You told us', template: 'you-told-us' },
  { handle: 'about', title: 'About', template: 'about' },
  { handle: 'contact', title: 'Contact', template: 'contact' },
  { handle: 'faq', title: 'FAQ', template: 'faq' },
];

// Automated collections: a product joins by its Product type.
const COLLECTIONS = [
  { handle: 'glove-care', title: 'Glove care', type: 'Glove care', description: 'Our own glove wash, grip spray and deodorizer.' },
  { handle: 'tape-socks', title: 'Tape & socks', type: 'Tape & socks', description: 'Finger tape and grip socks.' },
  { handle: 'protection', title: 'Protection', type: 'Protection', description: 'Padded shorts and pants.' },
  { handle: 'bundles', title: 'Bundles', type: 'Bundle', description: 'Products that go together, priced together.' },
  { handle: 'bags', title: 'Bags', type: 'Bag', description: '' },
  { handle: 'gloves', title: 'Gloves', type: 'Gloves', template: 'gloves', description: '' },
];

const BLOG = { handle: 'guides', title: 'Guides' };

const METAFIELDS = [
  ['Tagline', 'tagline', 'single_line_text_field'],
  ['Why we made this', 'why_we_made', 'multi_line_text_field'],
  ['Good for', 'good_for', 'list.single_line_text_field'],
  ['Not ideal for', 'not_ideal_for', 'list.single_line_text_field'],
  ['Specs', 'specs', 'list.single_line_text_field'],
  ['How to use', 'how_to_use', 'multi_line_text_field'],
  ['How often', 'how_often', 'single_line_text_field'],
  ['Lead time', 'lead_time', 'single_line_text_field'],
  ['Benchmark product', 'benchmark_name', 'single_line_text_field'],
  ['Benchmark price', 'benchmark_price', 'number_decimal'],
  ['Benchmark checked', 'benchmark_checked', 'single_line_text_field'],
  ['Bundle items', 'bundle_items', 'list.product_reference'],
  ['Refill days', 'refill_days', 'number_integer'],
];

// Menus reference items by kind + handle; IDs are resolved at run time.
const MENUS = [
  {
    handle: 'main-menu',
    title: 'Main menu',
    items: [
      ['Glove care', 'collection', 'glove-care'],
      ['Kit builder', 'page', 'builder'],
      ['Tape & socks', 'collection', 'tape-socks'],
      ['Protection', 'collection', 'protection'],
      ['Bundles', 'page', 'bundles'],
      ['Guides', 'blog', 'guides'],
      ['Team orders', 'page', 'team-orders'],
    ],
  },
  {
    handle: 'footer-shop',
    title: 'Shop',
    items: [
      ['Glove care', 'collection', 'glove-care'],
      ['Tape & socks', 'collection', 'tape-socks'],
      ['Protection', 'collection', 'protection'],
      ['Bundles', 'page', 'bundles'],
      ['Kit builder', 'page', 'builder'],
      ['Gloves', 'collection', 'gloves'],
    ],
  },
  {
    handle: 'footer-help',
    title: 'Help',
    items: [
      ['Size guide', 'page', 'size-guide'],
      ['Shipping', 'url', '/policies/shipping-policy'],
      ['Returns', 'url', '/policies/refund-policy'],
      ['FAQ', 'page', 'faq'],
      ['Contact', 'page', 'contact'],
      ['Team orders', 'page', 'team-orders'],
    ],
  },
  {
    handle: 'footer-learn',
    title: 'Learn',
    items: [
      ['About', 'page', 'about'],
      ['Guides', 'blog', 'guides'],
      ['You told us', 'page', 'you-told-us'],
      ['Feedback', 'page', 'feedback'],
    ],
  },
];

/* ---------------- GraphQL ---------------- */

async function gql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 500));
  return json.data;
}

function checkUserErrors(label, errors) {
  const real = (errors || []).filter((e) => e.code !== 'TAKEN');
  if (real.length) throw new Error(`${label}: ${real.map((e) => `${(e.field || []).join('.')} ${e.message}`).join('; ')}`);
}

const log = (verb, what) => console.log(`${DRY ? '[dry-run] ' : ''}${verb.padEnd(9)} ${what}`);

// Match handles client-side rather than trusting search syntax; stores
// this size have far fewer than 250 pages/collections/blogs/articles.
const listCache = {};
async function findOne(connection, handle) {
  if (!listCache[connection]) {
    const data = await gql(`{ ${connection}(first: 250) { nodes { id handle } } }`);
    listCache[connection] = data[connection].nodes;
  }
  return listCache[connection].find((n) => n.handle === handle) || null;
}

/* ---------------- Steps ---------------- */

async function onlineStorePublication() {
  const data = await gql(`{ publications(first: 25) { nodes { id name } } }`);
  return data.publications.nodes.find((p) => /online store/i.test(p.name)) || null;
}

async function ensurePages() {
  const ids = {};
  for (const p of PAGES) {
    if (DRY) { log('page', `/pages/${p.handle} (template page.${p.template})`); continue; }
    const existing = await findOne('pages', p.handle);
    if (existing) {
      const d = await gql(
        `mutation($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id } userErrors { field message code } } }`,
        { id: existing.id, page: { templateSuffix: p.template, isPublished: true } }
      );
      checkUserErrors(`pageUpdate ${p.handle}`, d.pageUpdate.userErrors);
      ids[p.handle] = existing.id;
      log('updated', `/pages/${p.handle}`);
    } else {
      const d = await gql(
        `mutation($page: PageCreateInput!) { pageCreate(page: $page) { page { id } userErrors { field message code } } }`,
        { page: { title: p.title, handle: p.handle, templateSuffix: p.template, body: '', isPublished: true } }
      );
      checkUserErrors(`pageCreate ${p.handle}`, d.pageCreate.userErrors);
      ids[p.handle] = d.pageCreate.page.id;
      log('created', `/pages/${p.handle}`);
    }
  }
  return ids;
}

async function ensureCollections(publication) {
  const ids = {};
  for (const c of COLLECTIONS) {
    if (DRY) { log('coll', `/collections/${c.handle} (product type = "${c.type}")`); continue; }
    let id = (await findOne('collections', c.handle))?.id;
    if (!id) {
      const input = {
        title: c.title,
        handle: c.handle,
        descriptionHtml: c.description ? `<p>${c.description}</p>` : '',
        ruleSet: { appliedDisjunctively: false, rules: [{ column: 'TYPE', relation: 'EQUALS', condition: c.type }] },
      };
      if (c.template) input.templateSuffix = c.template;
      const d = await gql(
        `mutation($input: CollectionInput!) { collectionCreate(input: $input) { collection { id } userErrors { field message } } }`,
        { input }
      );
      checkUserErrors(`collectionCreate ${c.handle}`, d.collectionCreate.userErrors);
      id = d.collectionCreate.collection.id;
      log('created', `/collections/${c.handle}`);
    } else {
      log('exists', `/collections/${c.handle}`);
    }
    if (publication) {
      const d = await gql(
        `mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`,
        { id, input: [{ publicationId: publication.id }] }
      );
      checkUserErrors(`publish ${c.handle}`, d.publishablePublish.userErrors);
    }
    ids[c.handle] = id;
  }
  return ids;
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
      return { ...meta, html: marked.parse(fm ? raw.slice(fm[0].length) : raw) };
    });
}

async function ensureBlog() {
  if (DRY) {
    log('blog', `/blogs/${BLOG.handle}`);
    for (const g of readGuides()) log('article', `/blogs/${BLOG.handle}/${g.handle}`);
    return null;
  }
  let blogId = (await findOne('blogs', BLOG.handle))?.id;
  if (!blogId) {
    const d = await gql(
      `mutation($blog: BlogCreateInput!) { blogCreate(blog: $blog) { blog { id } userErrors { field message code } } }`,
      { blog: { title: BLOG.title, handle: BLOG.handle } }
    );
    checkUserErrors('blogCreate', d.blogCreate.userErrors);
    blogId = d.blogCreate.blog.id;
    log('created', `/blogs/${BLOG.handle}`);
  } else {
    log('exists', `/blogs/${BLOG.handle}`);
  }

  for (const g of readGuides()) {
    const existing = await findOne('articles', g.handle);
    if (existing) { log('exists', `/blogs/${BLOG.handle}/${g.handle}`); continue; }
    const metafields = [];
    if (g.seo_title) metafields.push({ namespace: 'global', key: 'title_tag', type: 'single_line_text_field', value: g.seo_title });
    if (g.seo_description) metafields.push({ namespace: 'global', key: 'description_tag', type: 'single_line_text_field', value: g.seo_description });
    const d = await gql(
      `mutation($article: ArticleCreateInput!) { articleCreate(article: $article) { article { id } userErrors { field message code } } }`,
      {
        article: {
          blogId,
          title: g.title,
          handle: g.handle,
          body: g.html,
          summary: g.seo_description ? `<p>${g.seo_description}</p>` : undefined,
          isPublished: true,
          author: { name: 'A3GK' },
          metafields,
        },
      }
    );
    checkUserErrors(`articleCreate ${g.handle}`, d.articleCreate.userErrors);
    log('created', `/blogs/${BLOG.handle}/${g.handle}`);
  }
  return blogId;
}

async function ensureMetafields() {
  for (const [name, key, type] of METAFIELDS) {
    if (DRY) { log('field', `product a3gk.${key} (${type})`); continue; }
    const d = await gql(
      `mutation($definition: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $definition) { createdDefinition { id } userErrors { field message code } } }`,
      { definition: { name, namespace: 'a3gk', key, type, ownerType: 'PRODUCT' } }
    );
    checkUserErrors(`metafield a3gk.${key}`, d.metafieldDefinitionCreate.userErrors);
    const taken = (d.metafieldDefinitionCreate.userErrors || []).some((e) => e.code === 'TAKEN');
    log(taken ? 'exists' : 'created', `product a3gk.${key}`);
  }
}

async function ensureMenus(pageIds, collectionIds, blogId) {
  const existing = DRY ? [] : (await gql(`{ menus(first: 50) { nodes { id handle } } }`)).menus.nodes;
  for (const m of MENUS) {
    const items = m.items
      .map(([title, kind, ref]) => {
        if (kind === 'url') return { title, type: 'HTTP', url: ref };
        if (kind === 'page' && pageIds[ref]) return { title, type: 'PAGE', resourceId: pageIds[ref] };
        if (kind === 'collection' && collectionIds[ref]) return { title, type: 'COLLECTION', resourceId: collectionIds[ref] };
        if (kind === 'blog' && blogId) return { title, type: 'BLOG', resourceId: blogId };
        return DRY ? { title, type: kind.toUpperCase() } : null;
      })
      .filter(Boolean);
    if (DRY) { log('menu', `${m.handle}: ${items.map((i) => i.title).join(' · ')}`); continue; }
    const found = existing.find((e) => e.handle === m.handle);
    if (found) {
      const d = await gql(
        `mutation($id: ID!, $title: String!, $handle: String, $items: [MenuItemUpdateInput!]!) { menuUpdate(id: $id, title: $title, handle: $handle, items: $items) { menu { id } userErrors { field message code } } }`,
        { id: found.id, title: m.title, handle: m.handle, items }
      );
      checkUserErrors(`menuUpdate ${m.handle}`, d.menuUpdate.userErrors);
      log('updated', `menu ${m.handle}`);
    } else {
      const d = await gql(
        `mutation($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) { menuCreate(title: $title, handle: $handle, items: $items) { menu { id } userErrors { field message code } } }`,
        { title: m.title, handle: m.handle, items }
      );
      checkUserErrors(`menuCreate ${m.handle}`, d.menuCreate.userErrors);
      log('created', `menu ${m.handle}`);
    }
  }
}

/* ---------------- Run ---------------- */

try {
  console.log(DRY ? 'Dry run — nothing will change.\n' : `Setting up ${STORE}\n`);
  const publication = DRY ? null : await onlineStorePublication();
  if (!DRY && !publication) console.warn('! Online Store publication not found — collections will be created but not published.');
  const pageIds = await ensurePages();
  const collectionIds = await ensureCollections(publication);
  const blogId = await ensureBlog();
  await ensureMetafields();
  await ensureMenus(pageIds, collectionIds, blogId);
  console.log('\nDone. Next: add products (set Product type to match a collection), then fill the builder settings in the theme editor. See docs/SETUP.md.');
} catch (e) {
  console.error(`\nStopped: ${e.message}`);
  console.error('Nothing after this step ran. Fix the issue and re-run — completed steps are skipped.');
  process.exit(1);
}
