/*
  A3GK AI kit + crest designer — Vercel serverless function (POST /api/design).

  The kit designer on the Shopify store calls this with a short "vibe" and the
  manufacturer's real colour list. Claude answers with structured JSON that the
  designer applies directly: colours are limited to that palette, and patterns,
  fonts and collars to what the designer can actually render.

  Environment (Vercel → Project → Settings → Environment Variables):
    ANTHROPIC_API_KEY   required. Without it the endpoint returns 503.
    ALLOWED_ORIGINS     comma-separated origins allowed to call this, e.g.
                        https://a3gk.com,https://a3gk.myshopify.com
                        Same-origin calls (the Vercel preview) are always allowed.
    A3GK_AI_DAILY_LIMIT optional per-visitor daily cap (default 30).
*/
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';
const PATTERNS = ['none', 'stripes', 'pinstripes', 'hoops', 'split', 'sash', 'chevron', 'fade', 'sweep', 'shards', 'halftone', 'camo', 'topo', 'lightning', 'waves', 'grid', 'facets', 'speed', 'contour', 'pixel', 'gradstripes', 'brushed'];
const FONTS = ['block', 'wide', 'classic', 'slab', 'rounded', 'stencil'];
const COLLARS = ['crew', 'v', 'polo', 'wrap'];
const FINISHES = ['matte', 'sheen', 'mesh'];
const DEFAULT_PALETTE = [
  ['Black', '#111111'], ['White', '#F4F4F2'], ['Pitch green', '#3BE37F'], ['Volt', '#D7FF3A'],
  ['Orange', '#FF6A13'], ['Red', '#D7263D'], ['Royal', '#2F55D4'], ['Navy', '#14213D'],
].map(([name, hex]) => ({ name, hex }));

/* ---------------- request guards ---------------- */

const hits = new Map(); // best-effort, per warm instance
function rateLimited(ip) {
  const limit = Number(process.env.A3GK_AI_DAILY_LIMIT || 30);
  const day = new Date().toISOString().slice(0, 10);
  const key = `${day}:${ip}`;
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  if (hits.size > 5000) for (const k of hits.keys()) if (!k.startsWith(day)) hits.delete(k);
  return n > limit;
}

function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const list = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  try {
    if (new URL(origin).host === host) return origin;
  } catch {
    return false;
  }
  return list.includes(origin) ? origin : false;
}

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, max);

function readPalette(input) {
  if (!Array.isArray(input)) return DEFAULT_PALETTE;
  const out = [];
  for (const c of input.slice(0, 40)) {
    const hex = String(c?.hex || '').toUpperCase();
    if (/^#[0-9A-F]{6}$/.test(hex) && !out.some((o) => o.hex === hex)) out.push({ name: clean(c.name, 30) || hex, hex });
  }
  return out.length >= 2 ? out : DEFAULT_PALETTE;
}

/* ---------------- schemas ---------------- */

function kitSchema(hexes) {
  const colour = { type: 'string', enum: hexes };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['designs'],
    properties: {
      designs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'why', 'colors', 'pattern', 'patternScale', 'patternStrength', 'sleeves', 'collar', 'finish', 'cuffs', 'hemTrim', 'sidePanels', 'font', 'archedName', 'crest'],
          properties: {
            name: { type: 'string', description: 'Two or three word name for this kit' },
            why: { type: 'string', description: 'One short sentence on how it matches the vibe' },
            colors: {
              type: 'object',
              additionalProperties: false,
              required: ['primary', 'secondary', 'trim', 'pattern', 'number', 'outline', 'socks', 'sockTop', 'bottoms'],
              properties: {
                primary: colour,
                secondary: colour,
                trim: colour,
                pattern: colour,
                number: colour,
                outline: { type: 'string', enum: ['none', ...hexes] },
                socks: colour,
                sockTop: colour,
                bottoms: { type: 'string', enum: ['match', 'secondary', ...hexes] },
              },
            },
            pattern: { type: 'string', enum: PATTERNS },
            patternScale: { type: 'string', enum: ['s', 'm', 'l'] },
            patternStrength: { type: 'string', enum: ['tonal', 'medium', 'bold'] },
            sleeves: { type: 'string', enum: ['solid', 'pattern', 'match'] },
            collar: { type: 'string', enum: COLLARS },
            finish: { type: 'string', enum: FINISHES },
            cuffs: { type: 'boolean' },
            hemTrim: { type: 'boolean' },
            sidePanels: { type: 'boolean' },
            font: { type: 'string', enum: FONTS },
            archedName: { type: 'boolean' },
            crest: {
              type: 'object',
              additionalProperties: false,
              required: ['color', 'textColor'],
              properties: { color: colour, textColor: colour },
            },
          },
        },
      },
    },
  };
}

const CREST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['crests'],
  properties: {
    crests: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'svg'],
        properties: {
          name: { type: 'string', description: 'Short name for the crest' },
          svg: { type: 'string', description: 'Complete standalone SVG markup, viewBox="0 0 200 200"' },
        },
      },
    },
  },
};

/* ---------------- prompts ---------------- */

const paletteText = (palette) => palette.map((c) => `${c.name} ${c.hex}`).join(', ');

function kitPrompt(prompt, palette) {
  return `You are the kit designer for A3GK, a goalkeeper-only brand. A keeper has described the vibe they want for a custom padded goalkeeper kit. Design three distinct kits that read clearly from the other end of a pitch.

The keeper's vibe, in their words:
<vibe>${prompt}</vibe>

Constraints:
- Only use these printable colours (hex values must match exactly): ${paletteText(palette)}.
- Keep enough contrast between the number colour and the main body colour for the number to be readable at distance.
- The three designs should differ from each other: vary pattern, colour balance and typeface rather than returning near-copies.
- Patterns: none, stripes, pinstripes, hoops, split (two-tone halves), sash, chevron, fade (gradient), sweep, shards, halftone, camo, topo (contour rings), lightning, waves, grid, facets (low-poly), speed (fine diagonal speed lines), contour (flowing fine lines), pixel (pixel fade), gradstripes (stripes fading up), brushed (dry-brush strokes).
- patternStrength: tonal (subtle, like most pro keeper kits; usually a darker or lighter shade of the main colour), medium, or bold. Prefer tonal or medium unless the vibe is loud or retro.
- "bottoms" is the shorts/pants colour: "match" (same as body), "secondary", or a hex.
- Fonts: block, wide, classic, slab, rounded, stencil.
- Names and "why" lines are for the keeper: plain, confident, no hype words, no emoji.
- If the vibe names a real club, national team or brand, take inspiration from the mood only; do not recreate that team's kit.

Return exactly three designs.`;
}

function crestPrompt(prompt, initials, palette) {
  return `You design original crests for goalkeepers at A3GK. Create three distinct crest options as standalone SVG from this description:
<description>${prompt}</description>
${initials ? `The keeper's initials, if you want to use them: ${initials}\n` : ''}
Rules for the SVG:
- Root element <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">.
- Use only flat fills from these printable colours: ${paletteText(palette)}. Two or three colours per crest.
- Only these elements: g, path, circle, ellipse, rect, polygon, polyline, line, text, tspan, defs, linearGradient, radialGradient, stop, clipPath. No scripts, event attributes, images, external links, <use>, <style> blocks or fonts other than font-family="sans-serif".
- Bold, simple shapes that stay legible when embroidered or printed at 6 cm. Keep each SVG under 6,000 characters.
- Every design must be original. Never reproduce or closely imitate an existing club, national team, league or brand logo, even if the description asks for one; design something new that captures the mood instead.

Return exactly three crests.`;
}

/* ---------------- SVG check (the browser sanitises again) ---------------- */

function safeSvg(svg) {
  const s = String(svg || '').trim();
  if (s.length > 12000 || !/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) return null;
  if (/<\s*(script|foreignObject|iframe|image|use|style|a)\b/i.test(s)) return null;
  if (/\son[a-z]+\s*=|javascript:|data:|https?:\/\/(?!www\.w3\.org\/)/i.test(s)) return null;
  return s;
}

/* ---------------- handler ---------------- */

let client;

export default async function handler(req, res) {
  const origin = allowedOrigin(req);
  if (origin === false) return res.status(403).json({ error: 'This site is not allowed to use the designer.' });
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AI design is not switched on yet.' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: "You've hit today's AI design limit. Keep tweaking by hand, or try again tomorrow." });

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body || {};
  const mode = body.mode === 'crest' ? 'crest' : 'kit';
  const prompt = clean(body.prompt, mode === 'crest' ? 300 : 400);
  if (prompt.length < 3) return res.status(400).json({ error: 'Describe what you want in a few words.' });
  const palette = readPalette(body.palette);
  const hexes = palette.map((c) => c.hex);

  client ||= new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: mode === 'crest' ? 16000 : 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: mode === 'crest' ? 'medium' : 'low',
        format: { type: 'json_schema', schema: mode === 'crest' ? CREST_SCHEMA : kitSchema(hexes) },
      },
      messages: [
        {
          role: 'user',
          content: mode === 'crest' ? crestPrompt(prompt, clean(body.initials, 3).toUpperCase(), palette) : kitPrompt(prompt, palette),
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: "We can't design that one. Try describing a different vibe." });
    }
    if (response.stop_reason === 'max_tokens') {
      return res.status(502).json({ error: 'That took too long to design. Try a shorter description.' });
    }
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const data = safeJson(text);
    if (!data) return res.status(502).json({ error: 'The designer got confused. Try again.' });

    if (mode === 'crest') {
      const crests = (data.crests || [])
        .map((c) => ({ name: clean(c.name, 40), svg: safeSvg(c.svg) }))
        .filter((c) => c.svg)
        .slice(0, 3);
      if (!crests.length) return res.status(502).json({ error: 'No usable crests came back. Try a simpler description.' });
      return res.status(200).json({ crests });
    }

    const designs = (data.designs || []).slice(0, 3).map((d) => ({ ...d, name: clean(d.name, 40), why: clean(d.why, 160) }));
    return res.status(200).json({ designs });
  } catch (err) {
    const status = err?.status;
    console.error('A3GK design error', status, err?.message);
    if (status === 429 || status === 529) return res.status(503).json({ error: 'The designer is busy. Try again in a minute.' });
    return res.status(502).json({ error: 'Something went wrong designing that. Try again.' });
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
