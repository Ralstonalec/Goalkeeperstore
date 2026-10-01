/*
  A3GK kit designer (v2).
  - One design state drives both the 3D model (a3gk-kit-3d.js + three.js) and
    the flat front/back view (fallback when WebGL isn't available).
  - Textures are painted by a3gk-kit-paint.js.
  - Prices come from real Shopify variants; the design is added to the cart
    as line item properties. Designs save locally and to a share link.
  - Optional AI (vibe → kit designs, description → crest) through the
    endpoint configured on the section (see api/design.js).
*/
(() => {
  if (customElements.get('a3-builder')) return;

  const STORAGE_DESIGNS = 'a3gk:designs';
  const STORAGE_DRAFT = 'a3gk:builder:draft2';
  const MAX_SAVED = 20;

  const BASES = [
    { id: 'kit-shorts', label: 'Jersey + shorts', note: 'The full match-day set.', parts: ['jersey', 'shorts'] },
    { id: 'kit-pants', label: 'Jersey + pants', note: 'For hard pitches and cold nights.', parts: ['jersey', 'pants'] },
    { id: 'jersey', label: 'Jersey', note: 'Padded top on its own.', parts: ['jersey'] },
    { id: 'shorts', label: 'Shorts', note: 'Padded shorts only.', parts: ['shorts'] },
    { id: 'pants', label: 'Pants', note: 'Padded pants only.', parts: ['pants'] },
  ];

  const COLLARS = [
    { id: 'crew', label: 'Crew' },
    { id: 'v', label: 'V-neck' },
    { id: 'polo', label: 'Polo' },
    { id: 'wrap', label: 'Wrap' },
  ];

  const FINISHES = [
    { id: 'matte', label: 'Matte knit' },
    { id: 'sheen', label: 'Satin sheen' },
    { id: 'mesh', label: 'Airflow mesh' },
  ];

  const CRESTS = [
    { id: 'shield', label: 'Shield' },
    { id: 'circle', label: 'Roundel' },
    { id: 'diamond', label: 'Diamond' },
    { id: 'hex', label: 'Hex' },
    { id: 'star', label: 'Star' },
    { id: 'upload', label: 'Our club crest' },
    { id: 'none', label: 'None' },
  ];

  const GARMENT_ZONES = {
    jersey: ['elbows'],
    shorts: ['hip', 'tailbone', 'thigh'],
    pants: ['hip', 'tailbone', 'thigh', 'knee'],
  };
  const ZONE_LABELS = { elbows: 'Elbows', hip: 'Hips', tailbone: 'Tailbone', thigh: 'Thighs', knee: 'Knees' };

  const VIBE_IDEAS = [
    'Neon Tokyo at night',
    'Stealth, all black, one flash of colour',
    'Old-school 90s keeper, loud and proud',
    'Molten lava',
    'Deep ocean, calm under pressure',
    'Classy: navy and gold',
  ];

  // Starting points, Spized-style: each is a full look the keeper can then
  // change. Colours are palette names, resolved against the store's palette.
  const PRESETS = [
    { id: 'night-shift', name: 'Night Shift', c: ['navy', 'black', 'volt', 'volt', 'volt', 'navy', 'volt', 'secondary'], pattern: 'lightning', scale: 'm', sleeves: 'solid', collar: 'v', finish: 'sheen', font: 'stencil' },
    { id: 'pitch-black', name: 'Pitch Black', c: ['black', 'pitch green', 'white', 'pitch green', 'white', 'black', 'pitch green', 'match'], pattern: 'shards', scale: 'm', sleeves: 'solid', collar: 'crew', finish: 'matte', font: 'block' },
    { id: 'ember', name: 'Ember', c: ['orange', 'black', 'black', 'red', 'black', 'black', 'orange', 'secondary'], pattern: 'fade', scale: 'l', sleeves: 'pattern', collar: 'crew', finish: 'sheen', font: 'wide' },
    { id: 'ice', name: 'Ice', c: ['white', 'sky', 'navy', 'sky', 'navy', 'white', 'sky', 'secondary'], pattern: 'topo', scale: 's', sleeves: 'match', collar: 'polo', finish: 'mesh', font: 'classic' },
    { id: 'royal-line', name: 'Royal Line', c: ['royal', 'navy', 'white', 'white', 'white', 'royal', 'white', 'secondary'], pattern: 'pinstripes', scale: 'm', sleeves: 'solid', collar: 'wrap', finish: 'matte', font: 'classic' },
    { id: 'hooped', name: 'Hooped', c: ['red', 'black', 'white', 'black', 'white', 'black', 'red', 'secondary'], pattern: 'hoops', scale: 'l', sleeves: 'match', collar: 'crew', finish: 'matte', font: 'slab' },
    { id: 'urban-camo', name: 'Urban Camo', c: ['charcoal', 'black', 'volt', 'grey', 'volt', 'black', 'volt', 'secondary'], pattern: 'camo', scale: 'm', sleeves: 'pattern', collar: 'crew', finish: 'matte', font: 'stencil' },
    { id: 'sunburst', name: 'Sunburst', c: ['yellow', 'black', 'black', 'orange', 'black', 'black', 'yellow', 'secondary'], pattern: 'halftone', scale: 'l', sleeves: 'solid', collar: 'v', finish: 'sheen', font: 'rounded' },
    { id: 'deep-water', name: 'Deep Water', c: ['teal', 'navy', 'white', 'sky', 'white', 'navy', 'teal', 'secondary'], pattern: 'waves', scale: 'm', sleeves: 'pattern', collar: 'crew', finish: 'sheen', font: 'wide' },
    { id: 'retro-90', name: '90s Keeper', c: ['purple', 'pink', 'volt', 'pink', 'white', 'purple', 'pink', 'secondary'], pattern: 'chevron', scale: 'l', sleeves: 'pattern', collar: 'polo', finish: 'matte', font: 'slab' },
    { id: 'gold-standard', name: 'Gold Standard', c: ['black', 'black', 'gold', 'gold', 'gold', 'black', 'gold', 'match'], pattern: 'sash', scale: 'm', sleeves: 'solid', collar: 'v', finish: 'sheen', font: 'classic' },
    { id: 'grid-lock', name: 'Grid Lock', c: ['grey', 'charcoal', 'volt', 'volt', 'black', 'charcoal', 'volt', 'secondary'], pattern: 'grid', scale: 's', sleeves: 'solid', collar: 'wrap', finish: 'mesh', font: 'block' },
  ];

  /* ---------------- helpers ---------------- */

  const P = () => window.A3GKPaint;

  const esc = (str) =>
    String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function parsePalette(text) {
    const out = [];
    String(text || '')
      .split(/\n/)
      .forEach((line) => {
        const m = line.match(/^\s*(.+?)\s*:\s*(#[0-9a-f]{6})\s*$/i);
        if (m) out.push({ name: m[1], hex: m[2].toUpperCase() });
      });
    return out.length ? out : [{ name: 'Black', hex: '#111111' }, { name: 'White', hex: '#F4F4F2' }];
  }

  function parsePaddingMap(text) {
    const map = {};
    String(text || '')
      .split(/\n/)
      .forEach((line) => {
        const idx = line.indexOf(':');
        if (idx < 1) return;
        const key = line.slice(0, idx).trim();
        const zones = line
          .slice(idx + 1)
          .split(',')
          .map((z) => z.trim().toLowerCase())
          .filter((z) => ZONE_LABELS[z]);
        if (key) map[key] = zones;
      });
    return map;
  }

  function formatMoney(cents, format) {
    const fmt = format || '${{amount}}';
    const value = (cents || 0) / 100;
    const withDelims = (n, dp, thousands, decimal) => {
      const [i, d] = n.toFixed(dp).split('.');
      return i.replace(/\B(?=(\d{3})+(?!\d))/g, thousands) + (d ? decimal + d : '');
    };
    return fmt.replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => {
      switch (key) {
        case 'amount_no_decimals':
          return withDelims(value, 0, ',', '.');
        case 'amount_with_comma_separator':
          return withDelims(value, 2, '.', ',');
        case 'amount_no_decimals_with_comma_separator':
          return withDelims(value, 0, '.', ',');
        case 'amount_with_apostrophe_separator':
          return withDelims(value, 2, "'", '.');
        default:
          return withDelims(value, 2, ',', '.');
      }
    });
  }

  function hexRgb(hex) {
    const h = hex.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }

  function luminance(hex) {
    const lin = hexRgb(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  const b64encode = (obj) =>
    btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64decode = (str) => {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(s + '==='.slice((s.length + 3) % 4)))));
  };
  const uid = () => 'D' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

  function readStore(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v ?? fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function optionIndex(product, re) {
    if (!product || !product.options) return -1;
    return product.options.findIndex((o) => re.test(typeof o === 'string' ? o : o.name));
  }
  function optionValues(product, re) {
    const idx = optionIndex(product, re);
    if (idx < 0) return [];
    const vals = [];
    product.variants.forEach((v) => {
      if (!vals.includes(v.options[idx])) vals.push(v.options[idx]);
    });
    return vals;
  }

  /* ---------------- SVG sanitiser (AI crests, share links) ---------------- */

  const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line', 'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'title']);
  const SVG_ATTRS = new Set([
    'viewbox', 'xmlns', 'width', 'height', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'points',
    'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'opacity', 'transform', 'id', 'offset', 'stop-color', 'stop-opacity', 'gradientunits',
    'gradienttransform', 'clip-path', 'clip-rule', 'font-family', 'font-size', 'font-weight', 'text-anchor',
    'letter-spacing', 'dominant-baseline', 'preserveaspectratio',
  ]);

  function sanitizeSvg(input) {
    if (typeof input !== 'string' || input.length > 40000) return null;
    let doc;
    try {
      doc = new DOMParser().parseFromString(input, 'image/svg+xml');
    } catch (e) {
      return null;
    }
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
    const walk = (el) => {
      [...el.children].forEach((child) => {
        if (!SVG_TAGS.has(child.nodeName.toLowerCase())) {
          child.remove();
          return;
        }
        walk(child);
      });
      [...el.attributes].forEach((a) => {
        const n = a.name.toLowerCase();
        const v = a.value;
        const urlRef = /url\(/i.test(v);
        if (!SVG_ATTRS.has(n) || /javascript:|data:|http/i.test(v) || (urlRef && !/^url\(#[\w-]+\)$/.test(v.trim()))) {
          el.removeAttribute(a.name);
        }
      });
    };
    walk(root);
    root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', '0 0 200 240');
    return new XMLSerializer().serializeToString(root);
  }

  const scriptLoads = {};
  function loadScript(src) {
    if (!src) return Promise.reject(new Error('missing script URL'));
    if (!scriptLoads[src])
      scriptLoads[src] = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.async = false; // keep order
        el.onload = resolve;
        el.onerror = () => reject(new Error(`could not load ${src.split('/').pop().split('?')[0]}`));
        document.head.appendChild(el);
      });
    return scriptLoads[src];
  }

  /* ---------------- custom element ---------------- */

  class A3Builder extends HTMLElement {
    connectedCallback() {
      try {
        this.cfg = JSON.parse(this.querySelector('[data-a3b-config]').textContent);
      } catch (e) {
        console.error('A3GK builder: bad config', e);
        return;
      }
      this.palette = parsePalette(this.cfg.palette);
      this.paddingMap = parsePaddingMap(this.cfg.paddingMap);
      this.activeTab = 'designs';
      this.showPadding = false;
      this.mode = '3d';
      this.view = 'front';

      this.root = this.querySelector('[data-a3b-root]');
      this.stage3d = this.querySelector('[data-a3b-3d]');
      this.flatWrap = this.querySelector('[data-a3b-flat]');
      this.tabs = this.querySelector('[data-a3b-tabs]');
      this.panes = this.querySelector('[data-a3b-panes]');
      this.summary = this.querySelector('[data-a3b-summary]');

      this.tex = {};
      ['torso', 'sleeveL', 'sleeveR', 'hip', 'legL', 'legR', 'sock'].forEach((k) => (this.tex[k] = document.createElement('canvas')));
      this.state = this.initialState();
      this.root.hidden = false;

      // On desktop, size the stage so the whole designer fits the first screen.
      const fit = () => {
        if (window.innerWidth < 990) return this.root.style.removeProperty('--a3b-stage-h');
        const top = this.root.getBoundingClientRect().top + window.scrollY;
        const h = Math.max(560, window.innerHeight - Math.max(0, top - window.scrollY));
        this.root.style.setProperty('--a3b-stage-h', `${Math.min(h, window.innerHeight)}px`);
      };
      fit();
      window.addEventListener('resize', fit);

      this.whenPainterReady(() => {
        this.bindStage();
        this.renderAll();
        this.init3d();
      });
    }

    whenPainterReady(fn) {
      if (P()) return fn();
      const t = setInterval(() => {
        if (P()) {
          clearInterval(t);
          fn();
        }
      }, 30);
    }

    /* ----- palette helpers ----- */

    hex(name, fallbackIndex) {
      const f = this.palette.find((c) => c.name.toLowerCase() === name);
      return (f || this.palette[fallbackIndex] || this.palette[0]).hex;
    }

    nearest(hex) {
      if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return this.palette[0].hex;
      const found = this.palette.find((c) => c.hex === hex.toUpperCase());
      if (found) return found.hex;
      const [r, g, b] = hexRgb(hex);
      let best = this.palette[0];
      let bestD = Infinity;
      this.palette.forEach((c) => {
        const [r2, g2, b2] = hexRgb(c.hex);
        const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      });
      return best.hex;
    }

    colourName(hex) {
      return (this.palette.find((c) => c.hex === hex) || { name: hex }).name;
    }

    /* ----- state ----- */

    defaultState() {
      const black = this.hex('black', 0);
      const green = this.hex('pitch green', 2);
      const white = this.hex('white', 1);
      return {
        v: 2,
        id: uid(),
        title: 'My kit',
        base: 'kit-shorts',
        colors: {
          primary: black,
          secondary: green,
          trim: white,
          pattern: green,
          number: white,
          outline: 'none',
          bottoms: 'match',
          socks: black,
          sockTop: green,
        },
        pattern: { type: 'shards', scale: 'm', sleeves: 'solid' },
        collar: 'crew',
        sleeve: 'long',
        cuffs: true,
        hemTrim: true,
        sidePanels: true,
        finish: 'matte',
        socks: true,
        number: { value: '1', font: 'block', size: 'm', front: 'chest', sleeve: false, shorts: true },
        name: { value: '', arch: false },
        motto: '',
        crest: { type: 'shield', text: '', color: green, textColor: black, placement: 'left', size: 'm', svg: '' },
        padding: { jersey: this.firstPadding('jersey'), bottoms: this.firstPadding('shorts') },
        sizes: { jersey: '', bottoms: '' },
      };
    }

    migrate(old) {
      // v1 share links / drafts → v2.
      if (!old || typeof old !== 'object') return null;
      if (old.v === 2) return old;
      if (old.v !== 1) return null;
      return {
        base: old.base,
        title: old.title,
        colors: { ...old.colors, pattern: old.colors && old.colors.secondary, number: old.number && old.number.color, outline: (old.number && old.number.outline) || 'none' },
        pattern: { type: old.pattern || 'none', scale: 'm', sleeves: 'solid' },
        collar: old.collar,
        sleeve: old.sleeve,
        number: { value: old.number && old.number.value, font: 'block', size: 'm', front: old.number && old.number.front === 'none' ? 'none' : 'chest', shorts: old.number && old.number.shorts },
        name: { value: old.name && old.name.value, arch: false },
        crest: old.crest,
        padding: old.padding,
        sizes: old.sizes,
      };
    }

    initialState() {
      const def = this.defaultState();
      let loaded = null;
      const m = window.location.hash.match(/[#&]d=([^&]+)/);
      if (m) {
        try {
          loaded = this.migrate(b64decode(m[1]));
        } catch (e) {
          this.flash('That design link looks broken, so this is a fresh design.');
        }
      }
      if (!loaded) loaded = this.migrate(readStore(STORAGE_DRAFT, null));
      return this.sanitize(this.merge(def, loaded || {}));
    }

    merge(def, over) {
      const out = { ...def, ...over };
      ['colors', 'pattern', 'number', 'name', 'crest', 'padding', 'sizes'].forEach((k) => {
        out[k] = { ...def[k], ...(over[k] || {}) };
      });
      return out;
    }

    sanitize(s) {
      if (!BASES.some((b) => b.id === s.base)) s.base = 'kit-shorts';
      if (!P().PATTERNS.some((p) => p.id === s.pattern.type)) s.pattern.type = 'none';
      if (!['s', 'm', 'l'].includes(s.pattern.scale)) s.pattern.scale = 'm';
      if (!['match', 'solid', 'pattern'].includes(s.pattern.sleeves)) s.pattern.sleeves = 'solid';
      if (!COLLARS.some((c) => c.id === s.collar)) s.collar = 'crew';
      if (!FINISHES.some((f) => f.id === s.finish)) s.finish = 'matte';
      if (!['long', 'short'].includes(s.sleeve)) s.sleeve = 'long';
      if (!P().FONTS[s.number.font]) s.number.font = 'block';
      if (!['chest', 'center', 'none'].includes(s.number.front)) s.number.front = 'chest';
      s.number.value = String(s.number.value || '').replace(/\D/g, '').slice(0, 2);
      s.name.value = this.cleanName(s.name.value);
      s.motto = String(s.motto || '').replace(/[^A-Za-z0-9 .'!&-]/g, '').slice(0, 24);
      s.title = String(s.title || 'My kit').slice(0, 40);
      const cols = s.colors;
      ['primary', 'secondary', 'trim', 'pattern', 'number', 'socks', 'sockTop'].forEach((k) => (cols[k] = this.nearest(cols[k])));
      cols.outline = cols.outline === 'none' ? 'none' : this.nearest(cols.outline);
      if (!['match', 'secondary'].includes(cols.bottoms)) cols.bottoms = this.nearest(cols.bottoms);
      const cr = s.crest;
      if (!CRESTS.some((c) => c.id === cr.type) && cr.type !== 'ai') cr.type = 'shield';
      cr.text = String(cr.text || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
      cr.color = this.nearest(cr.color);
      cr.textColor = this.nearest(cr.textColor);
      if (!['left', 'center', 'right'].includes(cr.placement)) cr.placement = 'left';
      if (!['s', 'm', 'l'].includes(cr.size)) cr.size = 'm';
      cr.svg = cr.type === 'ai' ? sanitizeSvg(cr.svg) || '' : '';
      if (cr.type === 'ai' && !cr.svg) cr.type = 'shield';
      return s;
    }

    cleanName(v) {
      return String(v || '').toUpperCase().replace(/[^A-Z .'\-]/g, '').slice(0, this.cfg.nameMax || 12);
    }

    parts() {
      return (BASES.find((b) => b.id === this.state.base) || BASES[0]).parts;
    }
    bottomPart() {
      return this.parts().find((p) => p !== 'jersey') || null;
    }

    paddingOptions(garment) {
      const fromProduct = optionValues(this.cfg.products[garment], /padding/i);
      const supported = GARMENT_ZONES[garment];
      const keys = fromProduct.length ? fromProduct : Object.keys(this.paddingMap);
      return keys.filter((k) => {
        const zones = this.paddingMap[k];
        if (!zones) return fromProduct.length > 0;
        return zones.every((z) => supported.includes(z));
      });
    }
    firstPadding(garment) {
      return this.paddingOptions(garment)[0] || '';
    }
    zonesFor(garment) {
      const key = garment === 'jersey' ? this.state.padding.jersey : this.state.padding.bottoms;
      return (this.paddingMap[key] || []).filter((z) => GARMENT_ZONES[garment].includes(z));
    }

    set(path, value, opts = {}) {
      const keys = path.split('.');
      let obj = this.state;
      keys.slice(0, -1).forEach((k) => (obj = obj[k]));
      obj[keys[keys.length - 1]] = value;
      if (path === 'base') {
        const bottom = this.bottomPart();
        if (bottom && !this.paddingOptions(bottom).includes(this.state.padding.bottoms)) this.state.padding.bottoms = this.firstPadding(bottom);
        this.state.sizes.bottoms = '';
      }
      writeStore(STORAGE_DRAFT, this.state);
      this.schedulePaint();
      this.renderSummary();
      if (opts.rerenderPanes) this.renderPanes();
    }

    applyPatch(patch) {
      this.state = this.sanitize(this.merge(this.state, patch));
      writeStore(STORAGE_DRAFT, this.state);
      this.renderPanes();
      this.renderSummary();
      this.schedulePaint();
    }

    /* ----- painting ----- */

    schedulePaint() {
      if (this._paintQueued) return;
      this._paintQueued = true;
      requestAnimationFrame(() => {
        this._paintQueued = false;
        this.paint();
      });
    }

    paint() {
      const s = this.state;
      const paint = P();
      const onAsync = () => this.schedulePaint();
      const bottom = this.bottomPart();
      const padOpts = (garment) => ({ padding: this.showPadding, zones: garment ? this.zonesFor(garment) : [] });

      const hud = this.querySelector('[data-a3b-hudtitle]');
      if (hud) hud.textContent = s.title || 'My kit';
      paint.paintTorso(this.tex.torso, s, { onAsync });
      paint.paintSleeve(this.tex.sleeveL, s, 'l', padOpts('jersey'));
      paint.paintSleeve(this.tex.sleeveR, s, 'r', padOpts('jersey'));
      paint.paintHip(this.tex.hip, s, padOpts(bottom));
      paint.paintLeg(this.tex.legL, s, 'l', bottom, padOpts(bottom));
      paint.paintLeg(this.tex.legR, s, 'r', bottom, padOpts(bottom));
      paint.paintSock(this.tex.sock, s);

      if (this.kit3d && this.mode === '3d') {
        const finishChanged = this._finish !== s.finish;
        this._finish = s.finish;
        if (finishChanged || !this._knit) this._knit = paint.knitCanvas(s.finish);
        this.kit3d.update({
          parts: this.parts(),
          sleeve: s.sleeve,
          collar: s.collar,
          finish: s.finish,
          socks: false, // A3GK sells grip socks separately; not part of custom kit
          trim: s.colors.trim,
          textures: this.textures3d(),
          knit: this._knit,
          finishChanged,
        });
      } else {
        this.paintFlat();
      }
      this.updateContrast();
    }

    textures3d() {
      // CanvasTexture objects are created once and flagged for update each paint.
      if (!this._t3) {
        const THREE = this.THREE;
        this._t3 = {};
        Object.entries(this.tex).forEach(([k, c]) => {
          const t = new THREE.CanvasTexture(c);
          t.colorSpace = THREE.SRGBColorSpace;
          this._t3[k] = t;
        });
      }
      Object.values(this._t3).forEach((t) => (t.needsUpdate = true));
      return this._t3;
    }

    paintFlat() {
      const figs = this.flatWrap.querySelectorAll('canvas[data-view]');
      figs.forEach((c) => P().paintFlat(c, this.state, c.dataset.view, this.tex, this.parts()));
    }

    async init3d() {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl');
      if (!gl || !this.cfg.threeUrl || !this.cfg.kit3dUrl || !this.cfg.garmentUrl) {
        this.root.dataset.no3d = gl ? 'config' : 'webgl';
        const why = this.querySelector('[data-a3b-no3d-why]');
        if (why) why.textContent = gl ? '(missing 3D files)' : '(WebGL is turned off or unsupported)';
        this.setMode('flat', true);
        return;
      }
      try {
        // Plain <script> tags, not import(): classic scripts load from any CDN
        // without CORS, which module imports need.
        // Baked draped garments are optional: without them the viewer builds garments itself.
        const meshes = this.cfg.meshesUrl ? loadScript(this.cfg.meshesUrl).catch(() => null) : null;
        await Promise.all([this.cfg.threeUrl, this.cfg.garmentUrl, this.cfg.kit3dUrl].map(loadScript).concat(meshes || []));
        const THREE = window.THREE;
        const mod = window.A3GKKit3D;
        const garment = window.A3GKGarment;
        if (!THREE || !mod || !garment) throw new Error('3D scripts did not initialise');
        this.THREE = THREE;
        this.kit3d = mod.createKitScene(THREE, this.stage3d, { garment, garmentUrl: this.cfg.garmentUrl });
        // Let the "building" label paint before the garment mesh is generated.
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
        this.setMode('3d', true);
        this.root.dataset.building = '1';
        await this.kit3d.ready;
        delete this.root.dataset.building;
        this.stage3d.classList.add('is-ready');
      } catch (e) {
        console.warn('A3GK: 3D unavailable, using flat view', e);
        this.root.dataset.no3d = 'load';
        const why = this.querySelector('[data-a3b-no3d-why]');
        if (why) why.textContent = `(${(e && e.message) || e})`;
        this.setMode('flat', true);
      }
    }

    setMode(mode, silent) {
      if (mode === '3d' && !this.kit3d) mode = 'flat';
      this.mode = mode;
      this.root.dataset.mode = mode;
      this.querySelectorAll('[data-mode-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modeBtn === mode)));
      this.querySelector('[data-mode-toggle]').hidden = !this.kit3d;
      this.paint();
      if (!silent) this.flash(mode === '3d' ? '3D view. Drag to turn the kit.' : 'Flat view: front and back.');
    }

    /* ----- stage controls ----- */

    bindStage() {
      this.querySelector('[data-a3b-stagebar]').addEventListener('click', (e) => {
        const v = e.target.closest('[data-view]');
        if (v) {
          this.view = v.dataset.view;
          this.querySelectorAll('[data-a3b-stagebar] [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b === v)));
          if (this.kit3d && this.mode === '3d') this.kit3d.setView(this.view);
          this.flatWrap.dataset.view = this.view === 'back' ? 'back' : 'front';
        }
        const m = e.target.closest('[data-mode-btn]');
        if (m) this.setMode(m.dataset.modeBtn);
        if (e.target.closest('[data-toggle-padding]')) {
          this.showPadding = !this.showPadding;
          e.target.closest('[data-toggle-padding]').setAttribute('aria-pressed', String(this.showPadding));
          this.paint();
        }
      });
    }

    /* ----- UI ----- */

    renderAll() {
      this.renderTabs();
      this.renderPanes();
      this.renderSummary();
      this.paint();
    }

    tabList() {
      const tabs = [{ id: 'designs', label: 'Designs' }];
      if (this.cfg.aiEndpoint) tabs.push({ id: 'vibe', label: 'AI design ✦' });
      return tabs.concat([
        { id: 'base', label: 'Base' },
        { id: 'colours', label: 'Colours' },
        { id: 'pattern', label: 'Pattern' },
        { id: 'details', label: 'Details' },
        { id: 'print', label: 'Number & name' },
        { id: 'crest', label: 'Crest' },
        { id: 'padding', label: 'Padding' },
        { id: 'order', label: 'Size & order' },
      ]);
    }

    renderTabs() {
      this.tabs.innerHTML = this.tabList()
        .map(
          (t, i) =>
            `<button type="button" role="tab" id="a3b-tab-${t.id}" aria-controls="a3b-pane-${t.id}" aria-selected="${t.id === this.activeTab}" tabindex="${t.id === this.activeTab ? 0 : -1}" data-tab="${t.id}"><span>${String(i + 1).padStart(2, '0')}</span>${t.label}</button>`
        )
        .join('');
      this.tabs.onclick = (e) => {
        const btn = e.target.closest('[data-tab]');
        if (btn) this.openTab(btn.dataset.tab);
      };
      this.tabs.onkeydown = (e) => {
        if (!['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
        const ids = this.tabList().map((t) => t.id);
        let i = ids.indexOf(this.activeTab) + (e.key === 'ArrowRight' ? 1 : -1);
        i = (i + ids.length) % ids.length;
        this.openTab(ids[i], true);
      };
    }

    openTab(id, focus) {
      this.activeTab = id;
      this.tabs.querySelectorAll('[data-tab]').forEach((b) => {
        const on = b.dataset.tab === id;
        b.setAttribute('aria-selected', on);
        b.tabIndex = on ? 0 : -1;
        if (on && focus) b.focus();
      });
      this.panes.querySelectorAll('[role="tabpanel"]').forEach((p) => (p.hidden = p.dataset.pane !== id));
      this.renderStepNav();
      // Bring the new step's top into view under the sticky tabs.
      const stuck = this.tabs.getBoundingClientRect().bottom;
      const top = this.panes.getBoundingClientRect().top;
      if (top < stuck) window.scrollBy({ top: top - stuck, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      if (id === 'padding' && !this.showPadding) this.querySelector('[data-toggle-padding]').click();
      const want = id === 'print' ? 'back' : id === 'crest' || id === 'colours' ? 'front' : null;
      if (want && this.view !== want) this.querySelector(`[data-a3b-stagebar] [data-view="${want}"]`).click();
    }

    swatches(path, current, label, extra = []) {
      const opts = extra.concat(this.palette.map((c) => ({ value: c.hex, name: c.name, hex: c.hex })));
      return `<div class="a3b-swatches" role="radiogroup" aria-label="${esc(label)}">${opts
        .map(
          (c) =>
            `<label class="a3b-swatch${c.special ? ' a3b-swatch--special' : ''}" title="${esc(c.name)}"><input type="radio" name="${esc(path)}" value="${esc(c.value)}" data-bind="${esc(path)}" ${c.value === current ? 'checked' : ''}><span style="--c:${c.hex || 'transparent'}">${c.special ? esc(c.short || '') : ''}</span><span class="visually-hidden">${esc(c.name)}</span></label>`
        )
        .join('')}</div>`;
    }

    choice(path, options, current, label, cls = '') {
      return `<div class="a3b-choices ${cls}" role="radiogroup" aria-label="${esc(label)}">${options
        .map(
          (o) =>
            `<label class="a3b-choice"><input type="radio" name="${esc(path)}" value="${esc(o.id)}" data-bind="${esc(path)}" ${String(o.id) === String(current) ? 'checked' : ''}><span>${o.html || esc(o.label)}</span></label>`
        )
        .join('')}</div>`;
    }

    toggle(path, on, label) {
      return `<label class="a3b-toggle"><input type="checkbox" data-bind="${esc(path)}" data-kind="bool" ${on ? 'checked' : ''}><span class="a3b-toggle__ui" aria-hidden="true"></span><span>${esc(label)}</span></label>`;
    }

    group(title, body, note = '') {
      return `<section class="a3b-group"><h3 class="a3b-sub">${esc(title)}</h3>${body}${note ? `<p class="a3-small">${note}</p>` : ''}</section>`;
    }

    renderPanes() {
      const s = this.state;
      const paint = P();
      const nameMax = this.cfg.nameMax || 12;
      const panes = {};

      if (this.cfg.aiEndpoint) {
        panes.vibe = `
          <div class="a3b-ai">
            <h2 class="a3b-h">Describe your vibe</h2>
            <p class="a3-muted">Tell us how you want to look and feel in goal. We'll design three kits from the colours our manufacturer can print. Tweak anything after.</p>
            <div class="a3-field"><label for="a3b-vibe">Your vibe</label>
              <textarea id="a3b-vibe" class="a3-textarea a3b-ai__input" maxlength="400" placeholder="e.g. Calm but menacing. Midnight colours, a flash of volt, nothing too busy." data-ai-input="kit"></textarea></div>
            <div class="a3b-ideas">${VIBE_IDEAS.map((v) => `<button type="button" class="a3b-idea" data-idea="${esc(v)}">${esc(v)}</button>`).join('')}</div>
            <button type="button" class="a3-btn a3b-ai__go" data-action="ai-kit">Design my kit</button>
            <div class="a3b-ai__out" data-ai-out="kit" aria-live="polite"></div>
            <p class="a3-small">AI suggestions are a starting point. You'll see and approve a proof before anything is made.</p>
          </div>`;
      }

      panes.designs = `
        <h2 class="a3b-h">Start from a design</h2>
        <p class="a3-muted">Pick a look, then make it yours: every colour, pattern, number and crest can be changed in the next steps.</p>
        <div class="a3b-presets">${PRESETS.map(
          (d) =>
            `<button type="button" class="a3b-preset" data-action="preset" data-id="${d.id}" aria-label="Start from ${esc(d.name)}"><span class="a3b-preset__img"><img alt="" data-preset-img="${d.id}" width="200" height="${this.parts().length > 1 ? 400 : 240}"></span><span class="a3b-preset__name">${esc(d.name)}</span></button>`
        ).join('')}</div>`;

      panes.base = `
        <h2 class="a3b-h">What are you building?</h2>
        ${this.choice('base', BASES.map((b) => ({ id: b.id, html: `<strong>${esc(b.label)}</strong><span class="a3-small">${esc(b.note)}</span>` })), s.base, 'Base garment', 'a3b-choices--cards')}
        <p class="a3-small">Ordering for a squad? ${this.cfg.teamUrl ? `<a href="${esc(this.cfg.teamUrl)}">Team orders</a> get volume pricing.` : 'Contact us about team pricing.'}</p>`;

      const bottomsExtra = [
        { value: 'match', name: 'Match jersey', hex: s.colors.primary, special: true, short: '=' },
        { value: 'secondary', name: 'Sleeve colour', hex: s.colors.secondary, special: true, short: '2' },
      ];
      panes.colours = `
        <h2 class="a3b-h">Colours</h2>
        ${this.group('Main body', this.swatches('colors.primary', s.colors.primary, 'Main colour'))}
        ${this.group('Sleeves & side panels', this.swatches('colors.secondary', s.colors.secondary, 'Secondary colour'))}
        ${this.group('Pattern', this.swatches('colors.pattern', s.colors.pattern, 'Pattern colour'))}
        ${this.group('Trim (collar, cuffs, hems)', this.swatches('colors.trim', s.colors.trim, 'Trim colour'))}
        ${this.group('Shorts / pants', this.swatches('colors.bottoms', s.colors.bottoms, 'Bottoms colour', bottomsExtra))}
        <p class="a3-small">These are the colours our manufacturer can actually print.</p>`;

      panes.pattern = `
        <h2 class="a3b-h">Pattern</h2>
        <div class="a3b-tiles" role="radiogroup" aria-label="Pattern">${paint.PATTERNS.map(
          (p) =>
            `<label class="a3b-tile"><input type="radio" name="pattern.type" value="${p.id}" data-bind="pattern.type" ${p.id === s.pattern.type ? 'checked' : ''}><canvas data-thumb="${p.id}" width="144" height="144" aria-hidden="true"></canvas><span>${esc(p.label)}</span></label>`
        ).join('')}</div>
        ${this.group('Scale', this.choice('pattern.scale', [{ id: 's', label: 'Fine' }, { id: 'm', label: 'Medium' }, { id: 'l', label: 'Bold' }], s.pattern.scale, 'Pattern scale'))}
        ${this.group('Sleeves', this.choice('pattern.sleeves', [{ id: 'solid', label: 'Solid sleeve colour' }, { id: 'pattern', label: 'Pattern on sleeves' }, { id: 'match', label: 'Match the body' }], s.pattern.sleeves, 'Sleeve treatment'))}`;

      panes.details = `
        <h2 class="a3b-h">Details</h2>
        ${this.group('Sleeves', this.choice('sleeve', [{ id: 'long', label: 'Long' }, { id: 'short', label: 'Short' }], s.sleeve, 'Sleeve length'))}
        ${this.group('Collar', this.choice('collar', COLLARS, s.collar, 'Collar'))}
        ${this.group('Fabric finish', this.choice('finish', FINISHES, s.finish, 'Finish'), 'Preview of the look. Your proof confirms the exact fabric.')}
        ${this.group('Trims', `<div class="a3b-toggles">${this.toggle('cuffs', s.cuffs, 'Contrast cuffs')}${this.toggle('hemTrim', s.hemTrim, 'Contrast hem')}${this.toggle('sidePanels', s.sidePanels, 'Side panels')}</div>`)}`;

      const fontTiles = Object.entries(paint.FONTS).map(([id, f]) => ({ id, label: f.label, html: `<canvas data-font="${id}" width="120" height="72" aria-hidden="true"></canvas>${esc(f.label)}` }));
      const outlineExtra = [{ value: 'none', name: 'No outline', hex: 'transparent', special: true, short: '∅' }];
      panes.print = `
        <h2 class="a3b-h">Number &amp; name</h2>
        <div class="a3b-row">
          <div class="a3-field"><label for="a3b-num">Number (0–99)</label><input id="a3b-num" class="a3-input" inputmode="numeric" maxlength="2" value="${esc(s.number.value)}" data-bind="number.value" data-kind="number" autocomplete="off"></div>
          <div class="a3-field"><label for="a3b-name">Name on back (max ${nameMax})</label><input id="a3b-name" class="a3-input" maxlength="${nameMax}" value="${esc(s.name.value)}" data-bind="name.value" data-kind="name" autocomplete="off" placeholder="Optional"></div>
        </div>
        ${this.group('Typeface', this.choice('number.font', fontTiles, s.number.font, 'Typeface', 'a3b-choices--fonts'))}
        ${this.group('Print colour', this.swatches('colors.number', s.colors.number, 'Print colour'))}
        ${this.group('Outline', this.swatches('colors.outline', s.colors.outline, 'Outline colour', outlineExtra))}
        ${this.group('Number size', this.choice('number.size', [{ id: 's', label: 'Small' }, { id: 'm', label: 'Regular' }, { id: 'l', label: 'Large' }], s.number.size, 'Number size'))}
        ${this.group('Front number', this.choice('number.front', [{ id: 'chest', label: 'Chest' }, { id: 'center', label: 'Centre' }, { id: 'none', label: 'None' }], s.number.front, 'Front number'))}
        ${this.group('More placements', `<div class="a3b-toggles">${this.toggle('number.sleeve', s.number.sleeve, 'Numbers on sleeves')}${this.toggle('number.shorts', s.number.shorts, 'Number on shorts / pants')}${this.toggle('name.arch', s.name.arch, 'Arched name')}</div>`)}
        <div class="a3-field"><label for="a3b-motto">Back-neck motto (optional, 24 max)</label><input id="a3b-motto" class="a3-input" maxlength="24" value="${esc(s.motto)}" data-bind="motto" data-kind="motto" autocomplete="off" placeholder="e.g. NOTHING GETS PAST"></div>
        <p class="a3-small" data-a3b-contrast></p>`;

      const crestTiles = CRESTS.concat(s.crest.type === 'ai' ? [{ id: 'ai', label: 'AI crest' }] : []);
      panes.crest = `
        <h2 class="a3b-h">Crest</h2>
        ${this.choice('crest.type', crestTiles, s.crest.type, 'Crest type')}
        <div class="a3b-crest-opts" ${['upload', 'ai', 'none'].includes(s.crest.type) ? 'hidden' : ''}>
          <div class="a3-field"><label for="a3b-initials">Initials (up to 3)</label><input id="a3b-initials" class="a3-input" maxlength="3" value="${esc(s.crest.text)}" data-bind="crest.text" data-kind="initials" autocomplete="off"></div>
          ${this.group('Crest colour', this.swatches('crest.color', s.crest.color, 'Crest colour'))}
          ${this.group('Initials colour', this.swatches('crest.textColor', s.crest.textColor, 'Initials colour'))}
        </div>
        <p class="a3-notice a3b-upload-note" ${s.crest.type === 'upload' ? '' : 'hidden'}>After you order, we'll email you for your crest (vector or high-res PNG) and send a proof. Nothing is printed until you approve it.</p>
        ${this.group('Placement', this.choice('crest.placement', [{ id: 'left', label: 'Left chest' }, { id: 'center', label: 'Centre' }, { id: 'right', label: 'Right chest' }], s.crest.placement, 'Crest placement'))}
        ${this.group('Size', this.choice('crest.size', [{ id: 's', label: 'Small' }, { id: 'm', label: 'Regular' }, { id: 'l', label: 'Large' }], s.crest.size, 'Crest size'))}
        ${
          this.cfg.aiEndpoint
            ? `<div class="a3b-ai a3b-ai--crest">
            <h3 class="a3b-h a3b-h--sm">Design a crest with AI ✦</h3>
            <div class="a3-field"><label for="a3b-crest-prompt">Describe your crest</label>
              <textarea id="a3b-crest-prompt" class="a3-textarea a3b-ai__input" maxlength="300" placeholder="e.g. A wolf's head inside a shield, sharp lines, two colours" data-ai-input="crest"></textarea></div>
            <button type="button" class="a3-btn a3b-ai__go" data-action="ai-crest">Design crests</button>
            <div class="a3b-ai__out" data-ai-out="crest" aria-live="polite"></div>
            <p class="a3-small">Original designs only: we won't recreate another club's or brand's logo. You approve a proof before printing.</p>
          </div>`
            : ''
        }`;

      panes.padding = this.paddingPaneHtml();

      panes.order = `<h2 class="a3b-h">Size &amp; order</h2><div data-a3b-sizes></div>
        <div class="a3-field"><label for="a3b-title">Design name</label><input id="a3b-title" class="a3-input" maxlength="40" value="${esc(s.title)}" data-bind="title" autocomplete="off"></div>
        <div class="a3b-save">
          <button type="button" class="a3-btn a3-btn--ghost" data-action="save">Save design</button>
          <button type="button" class="a3-btn a3-btn--ghost" data-action="share">Copy link</button>
          <button type="button" class="a3-btn a3-btn--ghost" data-action="new">Start over</button>
        </div>
        <p class="a3-small">Designs save to this device. Copy the link to keep it anywhere or send it to your coach.</p>
        <div data-a3b-saved></div>`;

      this.panes.innerHTML = this.tabList()
        .map((t) => `<div role="tabpanel" id="a3b-pane-${t.id}" aria-labelledby="a3b-tab-${t.id}" data-pane="${t.id}" ${t.id === this.activeTab ? '' : 'hidden'}>${panes[t.id]}</div>`)
        .join('');

      this.panes.oninput = (e) => this.onInput(e);
      this.panes.onchange = (e) => this.onInput(e);
      this.panes.onclick = (e) => this.onAction(e);
      this.renderSizes();
      this.renderSaved();
      this.drawThumbs();
      this.drawPresetThumbs();
      this.restoreAi();
      this.renderStepNav();
      this.updateContrast();
    }

    renderStepNav() {
      const nav = this.querySelector('[data-a3b-stepnav]');
      if (!nav) return;
      const list = this.tabList();
      const i = list.findIndex((t) => t.id === this.activeTab);
      const prev = list[i - 1];
      const next = list[i + 1];
      nav.innerHTML = `
        <button type="button" class="a3b-stepnav__btn" data-step="${prev ? prev.id : ''}" ${prev ? '' : 'disabled'}>← ${prev ? esc(prev.label) : 'Back'}</button>
        <span class="a3b-stepnav__count">Step ${i + 1} of ${list.length}</span>
        ${next ? `<button type="button" class="a3-btn a3b-stepnav__next" data-step="${next.id}">Next: ${esc(next.label)} →</button>` : `<button type="button" class="a3-btn a3b-stepnav__next" data-step="summary">Review &amp; order ↓</button>`}`;
      nav.onclick = (e) => {
        const b = e.target.closest('[data-step]');
        if (!b || !b.dataset.step) return;
        if (b.dataset.step === 'summary') {
          this.summary.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        this.openTab(b.dataset.step, true);
      };
    }

    presetDesign(d) {
      const [primary, secondary, trim, pattern, number, socks, sockTop, bottoms] = d.c;
      const hx = (n, i) => this.hex(n, i);
      return {
        colors: {
          primary: hx(primary, 0),
          secondary: hx(secondary, 0),
          trim: hx(trim, 1),
          pattern: hx(pattern, 2),
          number: hx(number, 1),
          outline: 'none',
          socks: hx(socks, 0),
          sockTop: hx(sockTop, 2),
          bottoms: bottoms === 'match' || bottoms === 'secondary' ? bottoms : hx(bottoms, 0),
        },
        pattern: d.pattern,
        patternScale: d.scale,
        sleeves: d.sleeves,
        collar: d.collar,
        finish: d.finish,
        font: d.font,
        cuffs: true,
        hemTrim: true,
        sidePanels: d.pattern !== 'hoops',
        crest: { color: hx(trim, 1), textColor: hx(primary, 0) },
      };
    }

    // Preset thumbnails are painted once per base garment and cached, a few
    // per frame so the page stays responsive.
    drawPresetThumbs() {
      const imgs = [...this.panes.querySelectorAll('img[data-preset-img]')];
      if (!imgs.length) return;
      const key = this.parts().join(',');
      this._presetThumbs = this._presetThumbs || {};
      const cache = (this._presetThumbs[key] = this._presetThumbs[key] || {});
      const todo = [];
      imgs.forEach((img) => {
        const id = img.dataset.presetImg;
        if (cache[id]) img.src = cache[id];
        else todo.push(img);
      });
      const step = () => {
        const img = todo.shift();
        if (!img) return;
        const id = img.dataset.presetImg;
        if (!cache[id]) {
          const d = PRESETS.find((x) => x.id === id);
          cache[id] = this.flatPreview(this.sanitize(this.merge(this.state, this.kitPatch(this.presetDesign(d)))), 200);
        }
        if (img.isConnected) img.src = cache[id];
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    flatPreview(state, width) {
      const tex = {};
      ['torso', 'sleeveL', 'sleeveR', 'hip', 'legL', 'legR', 'sock'].forEach((k) => (tex[k] = document.createElement('canvas')));
      const paint = P();
      paint.paintTorso(tex.torso, state, {});
      paint.paintSleeve(tex.sleeveL, state, 'l');
      paint.paintSleeve(tex.sleeveR, state, 'r');
      paint.paintHip(tex.hip, state);
      paint.paintLeg(tex.legL, state, 'l', this.bottomPart());
      paint.paintLeg(tex.legR, state, 'r', this.bottomPart());
      const c = document.createElement('canvas');
      paint.paintFlat(c, state, 'front', tex, this.parts());
      const out = document.createElement('canvas');
      out.width = width * 2;
      out.height = Math.round((c.height / c.width) * width * 2);
      out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    }

    restoreAi() {
      // Panes re-render on every applied change; keep AI prompts and results.
      ['kit', 'crest'].forEach((k) => {
        const input = this.panes.querySelector(`[data-ai-input="${k}"]`);
        if (input && this._aiPrompt && this._aiPrompt[k]) input.value = this._aiPrompt[k];
      });
      const kitOut = this.panes.querySelector('[data-ai-out="kit"]');
      if (kitOut && this._aiKits && this._aiKits.length) this.renderAiKits(kitOut);
      const crestOut = this.panes.querySelector('[data-ai-out="crest"]');
      if (crestOut && this._aiCrests && this._aiCrests.length) this.renderAiCrests(crestOut);
    }

    drawThumbs() {
      const paint = P();
      this.panes.querySelectorAll('canvas[data-thumb]').forEach((c) => {
        const src = paint.patternThumb(c.dataset.thumb, this.state.colors);
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(src, 0, 0, c.width, c.height);
      });
      this.panes.querySelectorAll('canvas[data-font]').forEach((c) => {
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
        paint.drawText(ctx, '17', c.width / 2, c.height / 2 + 2, 58, { font: c.dataset.font, color: '#eeebe3', bridge: '#171916' });
      });
    }

    paddingPaneHtml() {
      const s = this.state;
      const parts = this.parts();
      let html = `<h2 class="a3b-h">Padding</h2><p class="a3-muted">Pick where you land. Zones light up on the kit.</p>`;
      if (parts.includes('jersey')) {
        const opts = this.paddingOptions('jersey');
        if (opts.length) {
          html += this.group('Jersey', this.choice('padding.jersey', opts.map((o) => ({ id: o, label: o })), s.padding.jersey, 'Jersey padding'));
          if (s.sleeve === 'short' && (this.paddingMap[s.padding.jersey] || []).includes('elbows')) html += `<p class="a3-notice a3-notice--warn">Elbow padding needs long sleeves.</p>`;
        }
      }
      const bottom = this.bottomPart();
      if (bottom) {
        const opts = this.paddingOptions(bottom);
        html += this.group(bottom === 'pants' ? 'Pants' : 'Shorts', this.choice('padding.bottoms', opts.map((o) => ({ id: o, label: o })), s.padding.bottoms, 'Bottoms padding'));
        if (bottom === 'shorts') html += `<p class="a3-small">Knee padding is only available on pants.</p>`;
      }
      html += `<details class="a3b-explain"><summary>What each zone is for</summary>
        <ul class="a3-list a3-list--dash">
          <li><strong>Hips</strong>: takes the hit when you land on your side after a dive. The one most keepers want.</li>
          <li><strong>Tailbone</strong>: for falling backwards on hard or frozen ground.</li>
          <li><strong>Thighs</strong>: side of the upper leg; useful on turf and hard pitches.</li>
          <li><strong>Knees</strong>: pants only; for turf burns and indoor floors.</li>
          <li><strong>Elbows</strong>: long-sleeve jerseys; for turf and low saves.</li>
        </ul>
        <p class="a3-small">More padding means more protection but a bit more bulk and heat. On soft grass, hips alone is usually enough.</p>
      </details>`;
      return html;
    }

    onInput(e) {
      const el = e.target;
      const path = el.dataset.bind;
      if (!path) return;
      if (el.type === 'radio' && !el.checked) return;
      let value = el.value;
      switch (el.dataset.kind) {
        case 'number':
          value = value.replace(/\D/g, '').slice(0, 2);
          if (el.value !== value) el.value = value;
          break;
        case 'name':
          value = this.cleanName(value);
          if (el.value !== value) el.value = value;
          break;
        case 'initials':
          value = value.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
          if (el.value !== value) el.value = value;
          break;
        case 'motto':
          value = value.replace(/[^A-Za-z0-9 .'!&-]/g, '').slice(0, 24);
          if (el.value !== value) el.value = value;
          break;
        case 'bool':
          value = el.checked;
          break;
        default:
          break;
      }
      if (e.type === 'input' && el.type === 'radio') return; // handled on change
      const structural = ['base', 'sleeve', 'crest.type'].includes(path) || path.startsWith('padding');
      this.set(path, value, { rerenderPanes: false });
      if (path === 'crest.type') {
        this.panes.querySelector('.a3b-crest-opts').hidden = ['upload', 'ai', 'none'].includes(value);
        this.panes.querySelector('.a3b-upload-note').hidden = value !== 'upload';
      }
      if (structural) {
        const pad = this.panes.querySelector('[data-pane="padding"]');
        if (pad) pad.innerHTML = this.paddingPaneHtml();
        this.renderSizes();
      }
      if (path.startsWith('colors')) this.drawThumbs();
    }

    updateContrast() {
      const el = this.panes && this.panes.querySelector('[data-a3b-contrast]');
      if (!el) return;
      const s = this.state;
      const bgs = [s.colors.primary];
      if (['stripes', 'hoops', 'split', 'shards', 'camo'].includes(s.pattern.type)) bgs.push(s.colors.pattern);
      const worst = Math.min(...bgs.map((c) => contrast(c, s.colors.number)));
      if (worst < 2.2 && s.colors.outline === 'none') {
        el.textContent = 'Heads up: that number colour will be hard to read from a distance on this shirt. Try a contrasting colour or add an outline.';
        el.classList.add('a3b-warn');
      } else {
        el.textContent = '';
        el.classList.remove('a3b-warn');
      }
    }

    renderSizes() {
      const box = this.panes.querySelector('[data-a3b-sizes]');
      if (!box) return;
      const rows = this.parts().map((part) => {
        const key = part === 'jersey' ? 'jersey' : 'bottoms';
        const product = this.cfg.products[part];
        const sizes = optionValues(product, /size/i);
        const label = part.charAt(0).toUpperCase() + part.slice(1);
        if (!product) return `<p class="a3-notice a3-notice--warn">${label}: sizes and pricing aren't live yet. You can still design and save.</p>`;
        if (!sizes.length) return '';
        return `<div class="a3-field"><label for="a3b-size-${part}">${label} size</label><select id="a3b-size-${part}" class="a3-select" data-bind="sizes.${key}"><option value="">Choose size</option>${sizes
          .map((v) => `<option value="${esc(v)}" ${this.state.sizes[key] === v ? 'selected' : ''}>${esc(v)}</option>`)
          .join('')}</select></div>`;
      });
      box.innerHTML = rows.join('') + `<p class="a3-small">Not sure? <a href="${esc(this.cfg.sizeGuideUrl || '/pages/size-guide#apparel')}">Apparel size guide</a>.</p>`;
    }

    renderSaved() {
      const box = this.panes.querySelector('[data-a3b-saved]');
      if (!box) return;
      const saved = readStore(STORAGE_DESIGNS, []);
      if (!saved.length) {
        box.innerHTML = '';
        return;
      }
      box.innerHTML = `<h3 class="a3b-sub">Saved designs</h3><ul class="a3b-saved">${saved
        .map(
          (d) =>
            `<li><span><strong>${esc(d.title)}</strong><br><span class="a3-small">${new Date(d.updated).toLocaleDateString()}</span></span><span><button type="button" class="a3b-mini" data-action="load" data-id="${esc(d.id)}">Edit</button><button type="button" class="a3b-mini" data-action="delete" data-id="${esc(d.id)}" aria-label="Delete ${esc(d.title)}">Delete</button></span></li>`
        )
        .join('')}</ul>`;
    }

    /* ----- AI ----- */

    async callAi(body) {
      let res;
      try {
        res = await fetch(this.cfg.aiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e) {
        throw new Error("Couldn't reach the designer. Check your connection and try again.");
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The designer is busy. Try again in a moment.');
      return data;
    }

    async aiKit(btn) {
      const input = this.panes.querySelector('[data-ai-input="kit"]');
      const out = this.panes.querySelector('[data-ai-out="kit"]');
      const prompt = input.value.trim();
      this._aiPrompt = { ...(this._aiPrompt || {}), kit: prompt };
      if (prompt.length < 3) {
        input.focus();
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Designing…';
      out.innerHTML = '<div class="a3b-ai__loading"><span></span><span></span><span></span></div>';
      try {
        const data = await this.callAi({
          mode: 'kit',
          prompt,
          palette: this.palette,
          patterns: P().PATTERNS.map((p) => p.id),
          fonts: Object.keys(P().FONTS),
        });
        this._aiKits = (data.designs || []).slice(0, 3);
        if (!this._aiKits.length) throw new Error('No designs came back. Try describing it differently.');
        this.renderAiKits(out);
      } catch (e) {
        out.innerHTML = `<p class="a3-notice a3-notice--warn">${esc(e.message)}</p>`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Design my kit';
      }
    }

    renderAiKits(out) {
      out.innerHTML = `<div class="a3b-ai__cards">${this._aiKits
        .map(
          (d, i) =>
            `<article class="a3b-ai__card"><canvas data-ai-preview="${i}" aria-hidden="true"></canvas><h4>${esc(d.name)}</h4><p class="a3-small">${esc(d.why)}</p><button type="button" class="a3-btn a3-btn--ghost" data-action="ai-apply" data-i="${i}">Use this</button></article>`
        )
        .join('')}</div>`;
      this._aiKits.forEach((d, i) => {
        const preview = this.sanitize(this.merge(this.state, this.kitPatch(d)));
        const c = out.querySelector(`[data-ai-preview="${i}"]`);
        const tex = {};
        ['torso', 'sleeveL', 'sleeveR', 'hip', 'legL', 'legR', 'sock'].forEach((k) => (tex[k] = document.createElement('canvas')));
        const paint = P();
        paint.paintTorso(tex.torso, preview, {});
        paint.paintSleeve(tex.sleeveL, preview, 'l');
        paint.paintSleeve(tex.sleeveR, preview, 'r');
        paint.paintHip(tex.hip, preview);
        paint.paintLeg(tex.legL, preview, 'l', this.bottomPart());
        paint.paintLeg(tex.legR, preview, 'r', this.bottomPart());
        paint.paintFlat(c, preview, 'front', tex, this.parts());
      });
    }

    renderAiCrests(out) {
      out.innerHTML = `<div class="a3b-ai__cards a3b-ai__cards--crest">${this._aiCrests
        .map(
          (c, i) =>
            `<article class="a3b-ai__card"><img alt="${esc(c.name)}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(c.svg)}"><h4>${esc(c.name)}</h4><button type="button" class="a3-btn a3-btn--ghost" data-action="ai-crest-use" data-i="${i}">Use this crest</button></article>`
        )
        .join('')}</div>`;
    }

    kitPatch(d) {
      const c = d.colors || {};
      return {
        colors: {
          primary: c.primary,
          secondary: c.secondary,
          trim: c.trim,
          pattern: c.pattern,
          number: c.number,
          outline: c.outline || 'none',
          socks: c.socks || c.primary,
          sockTop: c.sockTop || c.secondary,
          bottoms: c.bottoms || 'match',
        },
        pattern: { type: d.pattern, scale: d.patternScale, sleeves: d.sleeves },
        collar: d.collar,
        finish: d.finish,
        cuffs: d.cuffs !== false,
        hemTrim: d.hemTrim !== false,
        sidePanels: d.sidePanels !== false,
        number: { ...this.state.number, font: d.font },
        name: { ...this.state.name, arch: !!d.archedName },
        crest: { ...this.state.crest, color: (d.crest && d.crest.color) || this.state.crest.color, textColor: (d.crest && d.crest.textColor) || this.state.crest.textColor },
      };
    }

    async aiCrest(btn) {
      const input = this.panes.querySelector('[data-ai-input="crest"]');
      const out = this.panes.querySelector('[data-ai-out="crest"]');
      const prompt = input.value.trim();
      this._aiPrompt = { ...(this._aiPrompt || {}), crest: prompt };
      if (prompt.length < 3) {
        input.focus();
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Designing…';
      out.innerHTML = '<div class="a3b-ai__loading"><span></span><span></span><span></span></div>';
      try {
        const data = await this.callAi({ mode: 'crest', prompt, initials: this.state.crest.text, palette: this.palette });
        this._aiCrests = (data.crests || []).map((c) => ({ name: c.name, svg: sanitizeSvg(c.svg) })).filter((c) => c.svg);
        if (!this._aiCrests.length) throw new Error('No usable crests came back. Try a simpler description.');
        this.renderAiCrests(out);
      } catch (e) {
        out.innerHTML = `<p class="a3-notice a3-notice--warn">${esc(e.message)}</p>`;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Design crests';
      }
    }

    /* ----- pricing & order ----- */

    lines() {
      const s = this.state;
      const lines = [];
      const missing = [];
      this.parts().forEach((part) => {
        const product = this.cfg.products[part];
        const label = part.charAt(0).toUpperCase() + part.slice(1);
        if (!product) {
          missing.push(`${label} isn't available to order yet`);
          lines.push({ label, price: null, part });
          return;
        }
        const key = part === 'jersey' ? 'jersey' : 'bottoms';
        const want = [];
        const sizeIdx = optionIndex(product, /size/i);
        const padIdx = optionIndex(product, /padding/i);
        const sleeveIdx = optionIndex(product, /sleeve/i);
        if (sizeIdx >= 0) {
          if (!s.sizes[key]) missing.push(`Choose a ${part} size`);
          want[sizeIdx] = s.sizes[key];
        }
        if (padIdx >= 0) want[padIdx] = part === 'jersey' ? s.padding.jersey : s.padding.bottoms;
        if (sleeveIdx >= 0) want[sleeveIdx] = s.sleeve === 'short' ? /short/i : /long/i;
        const matches = product.variants.filter((v) =>
          want.every((w, i) => w === undefined || w === '' || (w instanceof RegExp ? w.test(v.options[i]) : v.options[i] === w))
        );
        const variant = matches.find((v) => want[sizeIdx] && v.options[sizeIdx] === want[sizeIdx]) || null;
        const priceFrom = matches.length ? Math.min(...matches.map((v) => v.price)) : null;
        if (!matches.length) missing.push(`That ${part} combination isn't made; try another padding or sleeve option`);
        else if (variant && !variant.available) missing.push(`${label} in ${want[sizeIdx]} is sold out`);
        lines.push({ label: product.title, price: variant ? variant.price : priceFrom, variant: sizeIdx >= 0 ? variant : matches[0], part });
      });
      const addon = (key, cond, label) => {
        const a = this.cfg.addons[key];
        if (!a || !cond) return;
        if (!a.available) missing.push(`${label} is unavailable right now`);
        lines.push({ label: a.title || label, price: a.price, addonId: a.id, part: 'addon' });
      };
      addon('name', !!s.name.value && this.parts().includes('jersey'), 'Name print');
      addon('number', !!s.number.value, 'Number print');
      addon('crest', s.crest.type !== 'none', 'Crest');
      if (!this.cfg.leadTime) missing.push('Ordering opens once our production lead time is confirmed');
      if (s.sleeve === 'short' && this.parts().includes('jersey') && (this.paddingMap[s.padding.jersey] || []).includes('elbows')) missing.push('Elbow padding needs long sleeves');
      return { lines, missing };
    }

    renderSummary() {
      const { lines, missing } = this.lines();
      const known = lines.every((l) => l.price !== null && l.price !== undefined);
      const total = lines.reduce((sum, l) => sum + (l.price || 0), 0);
      const fmt = (c) => formatMoney(c, this.cfg.moneyFormat);
      const canOrder = !missing.length && known && !this.cfg.designMode;
      this.summary.innerHTML = `
        <div class="a3b-sum">
          <table class="a3-table"><tbody>${lines.map((l) => `<tr><th scope="row">${esc(l.label)}</th><td>${l.price == null ? '–' : fmt(l.price)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><th scope="row">Total</th><td class="${known ? '' : 'is-unknown'}">${known ? fmt(total) : 'Not available yet'}</td></tr></tfoot></table>
          <p class="a3b-lead"><strong>Lead time:</strong> ${esc(this.cfg.leadTime || 'Not confirmed yet. Ordering opens once it is.')}</p>
          ${this.cfg.customNote ? `<p class="a3-small">${esc(this.cfg.customNote)} ${this.cfg.returnsUrl ? `<a href="${esc(this.cfg.returnsUrl)}">Returns policy</a>.` : ''}</p>` : ''}
          ${missing.length ? `<ul class="a3-list a3-list--dash a3b-missing">${missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
          <label class="a3b-ack"><input type="checkbox" data-ack ${canOrder ? '' : 'disabled'}> I've checked my design, sizes and the lead time above.</label>
          <button type="button" class="a3-btn a3b-add" data-action="add" disabled>${known ? `Add to cart · ${fmt(total)}` : 'Add to cart'}</button>
          <p class="a3-small">Shipping is calculated at checkout. No other fees.</p>
        </div>`;
      const ack = this.summary.querySelector('[data-ack]');
      const add = this.summary.querySelector('[data-action="add"]');
      ack.addEventListener('change', () => (add.disabled = !(ack.checked && canOrder)));
      add.addEventListener('click', () => this.addToCart());
    }

    specText() {
      const s = this.state;
      const c = (hex) => (hex === 'none' ? 'none' : `${this.colourName(hex)} ${hex}`);
      const pat = P().PATTERNS.find((p) => p.id === s.pattern.type) || {};
      const bottoms = s.colors.bottoms === 'match' ? 'match jersey' : s.colors.bottoms === 'secondary' ? 'sleeve colour' : c(s.colors.bottoms);
      return {
        Design: s.title,
        'Design ID': s.id,
        Base: (BASES.find((b) => b.id === s.base) || {}).label,
        Colours: `Main ${c(s.colors.primary)} / Sleeves ${c(s.colors.secondary)} / Pattern ${c(s.colors.pattern)} / Trim ${c(s.colors.trim)} / Bottoms ${bottoms}`,
        Pattern: `${pat.label || 'Plain'} (${{ s: 'fine', m: 'medium', l: 'bold' }[s.pattern.scale]}), sleeves: ${s.pattern.sleeves}`,
        Jersey: this.parts().includes('jersey') ? `${s.sleeve} sleeve, ${s.collar} collar, ${s.finish}; cuffs ${s.cuffs ? 'on' : 'off'}, hem ${s.hemTrim ? 'on' : 'off'}, side panels ${s.sidePanels ? 'on' : 'off'}` : undefined,
        Number: s.number.value
          ? `${s.number.value} (${P().FONTS[s.number.font].label}, ${c(s.colors.number)}, outline ${c(s.colors.outline)}, size ${s.number.size}; front ${s.number.front}; sleeves ${s.number.sleeve ? 'yes' : 'no'}; bottoms ${s.number.shorts ? 'yes' : 'no'})`
          : 'None',
        Name: s.name.value ? `${s.name.value}${s.name.arch ? ' (arched)' : ''}` : 'None',
        Motto: s.motto || undefined,
        Crest:
          s.crest.type === 'none'
            ? 'None'
            : s.crest.type === 'upload'
              ? `Club crest, artwork to be collected by email (${s.crest.placement}, ${s.crest.size})`
              : s.crest.type === 'ai'
                ? `AI-designed crest (${s.crest.placement}, ${s.crest.size}); SVG in _spec`
                : `${s.crest.type}${s.crest.text ? ' "' + s.crest.text + '"' : ''}, ${c(s.crest.color)} (${s.crest.placement}, ${s.crest.size})`,
        Padding: this.parts()
          .map((p) => `${p}: ${this.zonesFor(p).map((z) => ZONE_LABELS[z]).join(', ') || 'none'}`)
          .join('; '),
      };
    }

    shareUrl() {
      return `${window.location.origin}${window.location.pathname}${window.location.search}#d=${b64encode(this.state)}`;
    }

    async addToCart() {
      const { lines, missing } = this.lines();
      if (missing.length) return;
      const btn = this.summary.querySelector('[data-action="add"]');
      btn.disabled = true;
      btn.textContent = 'Adding…';
      const props = {};
      Object.entries(this.specText()).forEach(([k, v]) => {
        if (v !== undefined) props[k] = String(v);
      });
      props._edit_link = this.shareUrl();
      props._spec = JSON.stringify(this.state);
      const items = lines.map((l) =>
        l.addonId ? { id: l.addonId, quantity: 1, properties: { 'For design': this.state.id } } : { id: l.variant.id, quantity: 1, properties: props }
      );
      this.saveDesign(true);
      try {
        const res = await fetch(this.cfg.cartAddUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ items }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.description || 'Could not add to cart');
        }
        window.location.href = this.cfg.cartUrl;
      } catch (e) {
        btn.disabled = false;
        btn.textContent = 'Try again';
        this.flash(e.message);
      }
    }

    saveDesign(quiet) {
      const list = readStore(STORAGE_DESIGNS, []).filter((d) => d.id !== this.state.id);
      list.unshift({ id: this.state.id, title: this.state.title, updated: Date.now(), state: this.state });
      const ok = writeStore(STORAGE_DESIGNS, list.slice(0, MAX_SAVED));
      if (!quiet) this.flash(ok ? 'Saved on this device.' : "Couldn't save: your browser is blocking storage. Use Copy link instead.");
      this.renderSaved();
    }

    onAction(e) {
      const idea = e.target.closest('[data-idea]');
      if (idea) {
        const input = this.panes.querySelector('[data-ai-input="kit"]');
        input.value = idea.dataset.idea;
        input.focus();
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'ai-kit') this.aiKit(btn);
      if (action === 'preset') {
        const d = PRESETS.find((x) => x.id === btn.dataset.id);
        if (d) {
          this.applyPatch(this.kitPatch(this.presetDesign(d)));
          this.flash(`${d.name} applied. Change anything in the next steps.`);
        }
      }
      if (action === 'ai-crest') this.aiCrest(btn);
      if (action === 'ai-apply') {
        const d = this._aiKits && this._aiKits[+btn.dataset.i];
        if (d) {
          this.applyPatch({ ...this.kitPatch(d), title: String(d.name || this.state.title).slice(0, 40) });
          this.flash(`Applied "${d.name}". Fine-tune anything in the other tabs.`);
        }
      }
      if (action === 'ai-crest-use') {
        const c = this._aiCrests && this._aiCrests[+btn.dataset.i];
        if (c) {
          this.applyPatch({ crest: { ...this.state.crest, type: 'ai', svg: c.svg } });
          this.openTab('crest');
          this.flash(`Crest "${c.name}" added.`);
        }
      }
      if (action === 'save') this.saveDesign();
      if (action === 'share') {
        const url = this.shareUrl();
        const done = () => this.flash('Link copied. Anyone with it can open this design.');
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy this link:', url));
        else window.prompt('Copy this link:', url);
      }
      if (action === 'new') {
        if (!window.confirm('Start a new design? Unsaved changes will be lost.')) return;
        this.state = this.defaultState();
        writeStore(STORAGE_DRAFT, this.state);
        history.replaceState(null, '', window.location.pathname + window.location.search);
        this.renderAll();
      }
      if (action === 'load' || action === 'delete') {
        const list = readStore(STORAGE_DESIGNS, []);
        const item = list.find((d) => d.id === btn.dataset.id);
        if (!item) return;
        if (action === 'load') {
          this.state = this.sanitize(this.merge(this.defaultState(), this.migrate(item.state) || {}));
          writeStore(STORAGE_DRAFT, this.state);
          this.activeTab = 'base';
          this.renderAll();
          this.flash(`Editing "${item.title}".`);
        } else {
          writeStore(STORAGE_DESIGNS, list.filter((d) => d.id !== item.id));
          this.renderSaved();
        }
      }
    }

    flash(msg) {
      let el = this.querySelector('.a3b-toast');
      if (!el) {
        el = document.createElement('div');
        el.className = 'a3b-toast';
        el.setAttribute('role', 'status');
        this.appendChild(el);
      }
      el.textContent = msg;
      el.classList.add('is-on');
      clearTimeout(this._t);
      this._t = setTimeout(() => el.classList.remove('is-on'), 3200);
    }
  }

  customElements.define('a3-builder', A3Builder);
})();
