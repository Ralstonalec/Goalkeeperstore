/*
  A3GK kit builder.
  Vanilla JS, no dependencies. Reads its config from the section's JSON,
  renders an SVG front/back preview, prices from real Shopify variants and
  adds the design to the cart as line item properties.
*/
(() => {
  if (customElements.get('a3-builder')) return;

  const STORAGE_DESIGNS = 'a3gk:designs';
  const STORAGE_DRAFT = 'a3gk:builder:draft';
  const MAX_SAVED = 20;

  const BASES = [
    { id: 'jersey', label: 'Jersey', parts: ['jersey'] },
    { id: 'shorts', label: 'Shorts', parts: ['shorts'] },
    { id: 'pants', label: 'Pants', parts: ['pants'] },
    { id: 'kit-shorts', label: 'Kit: jersey + shorts', parts: ['jersey', 'shorts'] },
    { id: 'kit-pants', label: 'Kit: jersey + pants', parts: ['jersey', 'pants'] },
  ];

  const PATTERNS = [
    { id: 'none', label: 'Plain' },
    { id: 'stripes', label: 'Stripes' },
    { id: 'hoops', label: 'Hoops' },
    { id: 'fade', label: 'Fade' },
    { id: 'shards', label: 'Shards' },
  ];

  const FONTS = {
    block: { label: 'Block', family: "'A3GK Display', 'Arial Narrow', sans-serif", weight: 800 },
    classic: { label: 'Classic', family: "Georgia, 'Times New Roman', serif", weight: 700 },
    round: { label: 'Rounded', family: "'Arial Rounded MT Bold', 'Trebuchet MS', Verdana, sans-serif", weight: 700 },
  };

  // Which zones each garment physically supports.
  const GARMENT_ZONES = {
    jersey: ['elbows'],
    shorts: ['hip', 'tailbone', 'thigh'],
    pants: ['hip', 'tailbone', 'thigh', 'knee'],
  };

  const ZONE_LABELS = {
    elbows: 'Elbows',
    hip: 'Hips',
    tailbone: 'Tailbone',
    thigh: 'Thighs',
    knee: 'Knees',
  };

  /* ---------------- Helpers ---------------- */

  const esc = (str) =>
    String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function parsePalette(text) {
    const out = [];
    String(text || '')
      .split(/\n/)
      .forEach((line) => {
        const m = line.match(/^\s*(.+?)\s*:\s*(#[0-9a-f]{3,8})\s*$/i);
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

  function luminance(hex) {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
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

  /* ---------------- Product / variant logic ---------------- */

  function optionIndex(product, re) {
    if (!product || !product.options) return -1;
    return product.options.findIndex((o) => re.test(typeof o === 'string' ? o : o.name));
  }

  function optionValues(product, re) {
    const idx = optionIndex(product, re);
    if (idx < 0) return [];
    const vals = [];
    product.variants.forEach((v) => {
      const val = v.options[idx];
      if (!vals.includes(val)) vals.push(val);
    });
    return vals;
  }

  /* ---------------- SVG garment drawing ---------------- */

  const JERSEY_H = 480;

  function jerseyPaths(view, sleeve, collar) {
    const back = view === 'back';
    let neck;
    if (back) neck = 'M150,62 L165,58 Q200,72 235,58 L250,62';
    else if (collar === 'v') neck = 'M150,62 L165,58 L200,104 L235,58 L250,62';
    else neck = 'M150,62 L165,58 Q200,92 235,58 L250,62';

    const torso = `${neck} L292,80 L300,170 L304,440 Q200,452 96,440 L100,170 L108,80 Z`;

    const longR = 'M292,80 Q322,92 338,140 L376,318 L340,332 L306,200 L300,170 Z';
    const shortR = 'M292,80 Q322,92 336,130 L352,196 L312,210 L300,170 Z';
    const sleeveR = sleeve === 'short' ? shortR : longR;
    const sleeveL = mirror(sleeveR);

    const cuffR =
      sleeve === 'short'
        ? 'M348.7,182.4 L352,196 L312,210 L308.7,196.4 Z'
        : 'M371.4,296.5 L376,318 L340,332 L335.4,310.5 Z';
    const cuffL = mirror(cuffR);

    let collarPath;
    if (back) collarPath = 'M165,58 Q200,72 235,58 L229,55 Q200,64 171,55 Z';
    else if (collar === 'v') collarPath = 'M165,58 L200,104 L235,58 L226,56 L200,90 L174,56 Z';
    else collarPath = 'M165,58 Q200,92 235,58 L228,55 Q200,80 172,55 Z';

    const hem = 'M96,440 Q200,452 304,440 L303.6,428 Q200,440 96.4,428 Z';
    const panelR = 'M300,170 L304,440 L280,443 L276,176 Z';
    const panelL = mirror(panelR);

    return { torso, sleeveR, sleeveL, cuffR, cuffL, collar: collarPath, hem, panelR, panelL };
  }

  function mirror(path) {
    return path.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${+(400 - parseFloat(x)).toFixed(1)},${y}`);
  }

  function shortsPaths() {
    return {
      body: 'M88,50 L312,50 L336,250 L214,262 L200,120 L186,262 L64,250 Z',
      waist: 'M90,30 L310,30 L312,52 L88,52 Z',
      stripeR: 'M312,50 L336,250 L322,252 L299,52 Z',
      stripeL: mirror('M312,50 L336,250 L322,252 L299,52 Z'),
      hemR: 'M214,262 L336,250 L334.6,238 L213,249 Z',
      hemL: mirror('M214,262 L336,250 L334.6,238 L213,249 Z'),
    };
  }

  function pantsPaths() {
    return {
      body: 'M108,50 L292,50 L300,530 L214,536 L200,140 L186,536 L100,530 Z',
      waist: 'M110,30 L290,30 L292,52 L108,52 Z',
      stripeR: 'M292,50 L300,530 L286,531 L279,52 Z',
      stripeL: mirror('M292,50 L300,530 L286,531 L279,52 Z'),
      hemR: 'M214,536 L300,530 L299.4,516 L213.6,522 Z',
      hemL: mirror('M214,536 L300,530 L299.4,516 L213.6,522 Z'),
    };
  }

  function patternDefs(id, pattern, color) {
    switch (pattern) {
      case 'stripes':
        return `<pattern id="${id}" width="44" height="10" patternUnits="userSpaceOnUse"><rect x="0" y="0" width="16" height="10" fill="${color}"/></pattern>`;
      case 'hoops':
        return `<pattern id="${id}" width="10" height="56" patternUnits="userSpaceOnUse"><rect x="0" y="0" width="10" height="22" fill="${color}"/></pattern>`;
      case 'fade':
        return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0.35" stop-color="${color}" stop-opacity="0"/><stop offset="1" stop-color="${color}" stop-opacity="1"/></linearGradient>`;
      case 'shards':
        return `<pattern id="${id}" width="90" height="90" patternUnits="userSpaceOnUse" patternTransform="rotate(18)"><path d="M0,0 L45,0 L0,60 Z M90,30 L90,90 L50,90 Z" fill="${color}"/></pattern>`;
      default:
        return '';
    }
  }

  function crestSvg(crest, x, y, size) {
    if (!crest || crest.type === 'none') return '';
    const c = crest.color;
    const s = size;
    const text = esc((crest.text || '').slice(0, 3).toUpperCase());
    const label = text
      ? `<text x="${x}" y="${y + s * 0.12}" text-anchor="middle" font-family="'A3GK Display', sans-serif" font-weight="800" font-size="${s * 0.36}" fill="${crest.textColor}">${text}</text>`
      : '';
    if (crest.type === 'circle') {
      return `<g class="a3b-crest"><circle cx="${x}" cy="${y}" r="${s / 2}" fill="${c}" stroke="rgba(0,0,0,.25)" stroke-width="1"/>${label}</g>`;
    }
    if (crest.type === 'upload') {
      return `<g class="a3b-crest"><rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" rx="4" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="4 3"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="${c}">LOGO</text></g>`;
    }
    // shield
    const w = s * 0.86;
    const h = s;
    const p = `M${x - w / 2},${y - h / 2} L${x + w / 2},${y - h / 2} L${x + w / 2},${y} Q${x + w / 2},${y + h * 0.35} ${x},${y + h / 2} Q${x - w / 2},${y + h * 0.35} ${x - w / 2},${y} Z`;
    return `<g class="a3b-crest"><path d="${p}" fill="${c}" stroke="rgba(0,0,0,.25)" stroke-width="1"/>${label}</g>`;
  }

  function printText(txt, x, y, size, opts) {
    if (!txt) return '';
    const font = FONTS[opts.style] || FONTS.block;
    const outline =
      opts.outline && opts.outline !== 'none'
        ? `stroke="${opts.outline}" stroke-width="${Math.max(1.5, size * 0.035)}" paint-order="stroke" stroke-linejoin="round"`
        : '';
    const spacing = opts.spacing ? `letter-spacing="${opts.spacing}"` : '';
    const fit = opts.maxWidth ? `textLength="${opts.maxWidth}" lengthAdjust="spacingAndGlyphs"` : '';
    return `<text x="${x}" y="${y}" text-anchor="middle" font-family="${font.family}" font-weight="${font.weight}" font-size="${size}" fill="${opts.color}" ${outline} ${spacing} ${fit}>${esc(txt)}</text>`;
  }

  function zoneShape(zone, garment, view, showLabels) {
    // Returns SVG for a padding zone on the given garment/view.
    const hatch = 'url(#a3b-hatch)';
    const shapes = [];
    const label = (x, y, t) =>
      showLabels
        ? `<text x="${x}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="700" fill="#06140B" stroke="#3BE37F" stroke-width="3" paint-order="stroke">${t}</text>`
        : '';
    const ell = (cx, cy, rx, ry) =>
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${hatch}" stroke="#3BE37F" stroke-width="2" stroke-dasharray="5 3"/>`;

    if (garment === 'jersey' && zone === 'elbows') {
      shapes.push(ell(356, 228, 16, 26), ell(44, 228, 16, 26), label(200, 240, 'ELBOWS'));
    }
    if (garment === 'shorts') {
      if (zone === 'hip') shapes.push(ell(84, 110, 18, 34), ell(316, 110, 18, 34), label(200, 104, view === 'back' ? '' : 'HIPS'));
      if (zone === 'thigh') shapes.push(ell(96, 200, 22, 34), ell(304, 200, 22, 34), label(200, 214, view === 'back' ? '' : 'THIGHS'));
      if (zone === 'tailbone' && view === 'back') shapes.push(ell(200, 88, 30, 26), label(200, 130, 'TAILBONE'));
    }
    if (garment === 'pants') {
      if (zone === 'hip') shapes.push(ell(112, 110, 16, 34), ell(288, 110, 16, 34), label(200, 104, view === 'back' ? '' : 'HIPS'));
      if (zone === 'thigh') shapes.push(ell(122, 230, 20, 40), ell(278, 230, 20, 40), label(200, 238, view === 'back' ? '' : 'THIGHS'));
      if (zone === 'knee' && view === 'front') shapes.push(ell(150, 370, 26, 30), ell(250, 370, 26, 30), label(200, 420, 'KNEES'));
      if (zone === 'tailbone' && view === 'back') shapes.push(ell(200, 88, 30, 26), label(200, 130, 'TAILBONE'));
    }
    return shapes.join('');
  }

  /* ---------------- Custom element ---------------- */

  class A3Builder extends HTMLElement {
    connectedCallback() {
      const cfgEl = this.querySelector('[data-a3b-config]');
      try {
        this.cfg = JSON.parse(cfgEl.textContent);
      } catch (e) {
        console.error('A3GK builder: bad config', e);
        return;
      }
      this.palette = parsePalette(this.cfg.palette);
      this.paddingMap = parsePaddingMap(this.cfg.paddingMap);
      this.view = 'front';
      this.showPadding = false;
      this.activeTab = 'base';

      this.root = this.querySelector('[data-a3b-root]');
      this.figures = this.querySelector('[data-a3b-figures]');
      this.tabs = this.querySelector('[data-a3b-tabs]');
      this.panes = this.querySelector('[data-a3b-panes]');
      this.summary = this.querySelector('[data-a3b-summary]');

      this.state = this.initialState();
      this.root.hidden = false;
      this.bindStage();
      this.renderAll();
    }

    /* ----- State ----- */

    defaultState() {
      const hex = (name, fallback) => (this.palette.find((c) => c.name.toLowerCase() === name) || {}).hex || fallback;
      const p0 = this.palette[0].hex;
      const p1 = (this.palette[2] || this.palette[1] || this.palette[0]).hex;
      const p2 = (this.palette[1] || this.palette[0]).hex;
      return {
        v: 1,
        id: uid(),
        title: 'My kit',
        base: 'kit-shorts',
        colors: { primary: hex('black', p0), secondary: hex('pitch green', p1), trim: hex('white', p2) },
        pattern: 'none',
        collar: 'crew',
        sleeve: 'long',
        number: { value: '1', color: hex('white', p2), outline: 'none', style: 'block', front: 'chest', shorts: true },
        name: { value: '' },
        crest: { type: 'shield', text: '', color: hex('pitch green', p1), textColor: hex('black', p0), placement: 'left' },
        padding: { jersey: this.firstPadding('jersey'), bottoms: this.firstPadding('shorts') },
        sizes: { jersey: '', bottoms: '' },
      };
    }

    initialState() {
      const def = this.defaultState();
      let loaded = null;
      const m = window.location.hash.match(/[#&]d=([^&]+)/);
      if (m) {
        try {
          loaded = b64decode(m[1]);
        } catch (e) {
          this.flash('That design link looks broken — starting fresh.');
        }
      }
      if (!loaded) loaded = readStore(STORAGE_DRAFT, null);
      if (!loaded || loaded.v !== 1) return def;
      return this.sanitize({ ...def, ...loaded, colors: { ...def.colors, ...loaded.colors }, number: { ...def.number, ...loaded.number }, name: { ...def.name, ...loaded.name }, crest: { ...def.crest, ...loaded.crest }, padding: { ...def.padding, ...loaded.padding }, sizes: { ...def.sizes, ...loaded.sizes } });
    }

    sanitize(s) {
      if (!BASES.some((b) => b.id === s.base)) s.base = 'kit-shorts';
      if (!PATTERNS.some((p) => p.id === s.pattern)) s.pattern = 'none';
      s.number.value = String(s.number.value || '').replace(/\D/g, '').slice(0, 2);
      s.name.value = this.cleanName(s.name.value);
      s.crest.text = String(s.crest.text || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
      s.title = String(s.title || 'My kit').slice(0, 40);
      return s;
    }

    cleanName(v) {
      return String(v || '')
        .toUpperCase()
        .replace(/[^A-Z .'\-]/g, '')
        .slice(0, this.cfg.nameMax || 12);
    }

    parts() {
      return (BASES.find((b) => b.id === this.state.base) || BASES[3]).parts;
    }

    bottomPart() {
      return this.parts().find((p) => p !== 'jersey') || null;
    }

    paddingOptions(garment) {
      const product = this.cfg.products[garment];
      const fromProduct = optionValues(product, /padding/i);
      const supported = GARMENT_ZONES[garment];
      const keys = fromProduct.length ? fromProduct : Object.keys(this.paddingMap);
      // Keep options whose zones all exist on this garment (or "none").
      return keys.filter((k) => {
        const zones = this.paddingMap[k];
        if (!zones) return fromProduct.length > 0; // product value without a mapping: still offer it
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

    set(path, value) {
      const keys = path.split('.');
      let obj = this.state;
      keys.slice(0, -1).forEach((k) => (obj = obj[k]));
      obj[keys[keys.length - 1]] = value;
      if (path === 'base') {
        const bottom = this.bottomPart();
        if (bottom && !this.paddingOptions(bottom).includes(this.state.padding.bottoms)) {
          this.state.padding.bottoms = this.firstPadding(bottom);
        }
        this.state.sizes.bottoms = '';
      }
      writeStore(STORAGE_DRAFT, this.state);
      this.renderPreview();
      this.renderSummary();
    }

    /* ----- Rendering ----- */

    renderAll() {
      this.renderTabs();
      this.renderPanes();
      this.renderPreview();
      this.renderSummary();
    }

    tabList() {
      const t = [
        { id: 'base', label: 'Base' },
        { id: 'colours', label: 'Colours' },
        { id: 'print', label: 'Name & number' },
        { id: 'crest', label: 'Crest' },
        { id: 'padding', label: 'Padding' },
        { id: 'order', label: 'Size & order' },
      ];
      return t;
    }

    renderTabs() {
      this.tabs.innerHTML = this.tabList()
        .map(
          (t, i) =>
            `<button type="button" role="tab" id="a3b-tab-${t.id}" aria-controls="a3b-pane-${t.id}" aria-selected="${t.id === this.activeTab}" tabindex="${t.id === this.activeTab ? 0 : -1}" data-tab="${t.id}"><span>${i + 1}</span>${t.label}</button>`
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
        if (on) b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      });
      this.panes.querySelectorAll('[role="tabpanel"]').forEach((p) => (p.hidden = p.dataset.pane !== id));
      if (id === 'padding' && !this.showPadding) this.togglePadding(true);
      if (id === 'print' && this.view !== 'back') this.setView('back');
      if ((id === 'crest' || id === 'colours') && this.view !== 'front') this.setView('front');
    }

    swatches(path, current, name) {
      return `<div class="a3b-swatches" role="radiogroup" aria-label="${esc(name)}">${this.palette
        .map(
          (c) =>
            `<label class="a3b-swatch" title="${esc(c.name)}"><input type="radio" name="${esc(path)}" value="${c.hex}" data-bind="${esc(path)}" ${c.hex === current ? 'checked' : ''}><span style="--c:${c.hex}"></span><span class="visually-hidden">${esc(c.name)}</span></label>`
        )
        .join('')}</div>`;
    }

    choice(path, options, current, name) {
      return `<div class="a3b-choices" role="radiogroup" aria-label="${esc(name)}">${options
        .map(
          (o) =>
            `<label class="a3b-choice"><input type="radio" name="${esc(path)}" value="${esc(o.id)}" data-bind="${esc(path)}" ${o.id === current ? 'checked' : ''}><span>${esc(o.label)}</span></label>`
        )
        .join('')}</div>`;
    }

    renderPanes() {
      const s = this.state;
      const nameMax = this.cfg.nameMax || 12;
      const colourOpts = [{ id: 'none', label: 'None' }].concat(this.palette.map((c) => ({ id: c.hex, label: c.name })));

      const panes = {
        base: `
          <h2 class="a3b-h">What are you building?</h2>
          ${this.choice('base', BASES, s.base, 'Base garment')}
          <div class="a3b-row">
            <div><h3 class="a3b-sub">Sleeves</h3>${this.choice('sleeve', [{ id: 'long', label: 'Long' }, { id: 'short', label: 'Short' }], s.sleeve, 'Sleeve length')}</div>
            <div><h3 class="a3b-sub">Collar</h3>${this.choice('collar', [{ id: 'crew', label: 'Crew' }, { id: 'v', label: 'V-neck' }], s.collar, 'Collar')}</div>
          </div>
          <p class="a3-small">Sleeves and collar apply to jerseys. Ordering for a squad? ${this.cfg.teamUrl ? `<a href="${esc(this.cfg.teamUrl)}">Team orders</a> get volume pricing.` : 'Contact us about team pricing.'}</p>`,
        colours: `
          <h2 class="a3b-h">Colours</h2>
          <h3 class="a3b-sub">Main</h3>${this.swatches('colors.primary', s.colors.primary, 'Main colour')}
          <h3 class="a3b-sub">Sleeves &amp; side panels</h3>${this.swatches('colors.secondary', s.colors.secondary, 'Secondary colour')}
          <h3 class="a3b-sub">Trim (collar, cuffs, hems)</h3>${this.swatches('colors.trim', s.colors.trim, 'Trim colour')}
          <h3 class="a3b-sub">Pattern</h3>${this.choice('pattern', PATTERNS, s.pattern, 'Pattern')}
          <p class="a3-small">Patterns use your sleeve colour. Colours shown are the ones our manufacturer can actually print.</p>`,
        print: `
          <h2 class="a3b-h">Name &amp; number</h2>
          <div class="a3b-row">
            <div class="a3-field"><label for="a3b-num">Number (0–99)</label><input id="a3b-num" class="a3-input" inputmode="numeric" maxlength="2" pattern="[0-9]*" value="${esc(s.number.value)}" data-bind="number.value" data-kind="number" autocomplete="off"></div>
            <div class="a3-field"><label for="a3b-name">Name on back (max ${nameMax})</label><input id="a3b-name" class="a3-input" maxlength="${nameMax}" value="${esc(s.name.value)}" data-bind="name.value" data-kind="name" autocomplete="off" placeholder="Optional"></div>
          </div>
          <h3 class="a3b-sub">Print style</h3>${this.choice('number.style', Object.entries(FONTS).map(([id, f]) => ({ id, label: f.label })), s.number.style, 'Print style')}
          <h3 class="a3b-sub">Number &amp; name colour</h3>${this.swatches('number.color', s.number.color, 'Print colour')}
          <h3 class="a3b-sub">Outline</h3>
          <div class="a3-field"><label for="a3b-outline" class="visually-hidden">Outline colour</label><select id="a3b-outline" class="a3-select" data-bind="number.outline">${colourOpts
            .map((o) => `<option value="${o.id}" ${o.id === s.number.outline ? 'selected' : ''}>${esc(o.label)}</option>`)
            .join('')}</select></div>
          <div class="a3b-row">
            <div><h3 class="a3b-sub">Front number</h3>${this.choice('number.front', [{ id: 'chest', label: 'Chest' }, { id: 'none', label: 'None' }], s.number.front, 'Front number')}</div>
            <div><h3 class="a3b-sub">Number on shorts/pants</h3>${this.choice('number.shorts', [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], s.number.shorts ? 'yes' : 'no', 'Number on bottoms')}</div>
          </div>
          <p class="a3-small" data-a3b-contrast></p>`,
        crest: `
          <h2 class="a3b-h">Crest</h2>
          ${this.choice(
            'crest.type',
            [
              { id: 'shield', label: 'Shield' },
              { id: 'circle', label: 'Circle' },
              { id: 'upload', label: 'Our club crest' },
              { id: 'none', label: 'None' },
            ],
            s.crest.type,
            'Crest type'
          )}
          <div class="a3b-crest-opts" ${s.crest.type === 'upload' ? 'hidden' : ''}>
            <div class="a3-field"><label for="a3b-initials">Initials on crest (up to 3)</label><input id="a3b-initials" class="a3-input" maxlength="3" value="${esc(s.crest.text)}" data-bind="crest.text" data-kind="initials" autocomplete="off"></div>
            <h3 class="a3b-sub">Crest colour</h3>${this.swatches('crest.color', s.crest.color, 'Crest colour')}
            <h3 class="a3b-sub">Initials colour</h3>${this.swatches('crest.textColor', s.crest.textColor, 'Initials colour')}
          </div>
          <p class="a3-notice a3b-upload-note" ${s.crest.type === 'upload' ? '' : 'hidden'}>After you order, we'll email you to collect your crest (vector or high-res PNG) and send a proof. Nothing is printed until you approve it.</p>
          <h3 class="a3b-sub">Placement</h3>${this.choice('crest.placement', [{ id: 'left', label: 'Left chest' }, { id: 'center', label: 'Centre chest' }], s.crest.placement, 'Crest placement')}`,
        padding: this.paddingPaneHtml(),
        order: `<h2 class="a3b-h">Size &amp; order</h2><div data-a3b-sizes></div>
          <div class="a3-field"><label for="a3b-title">Design name</label><input id="a3b-title" class="a3-input" maxlength="40" value="${esc(s.title)}" data-bind="title" autocomplete="off"></div>
          <div class="a3b-save">
            <button type="button" class="a3-btn a3-btn--ghost" data-action="save">Save design</button>
            <button type="button" class="a3-btn a3-btn--ghost" data-action="share">Copy link</button>
            <button type="button" class="a3-btn a3-btn--ghost" data-action="new">Start over</button>
          </div>
          <p class="a3-small">Designs save to this device. Copy the link to keep it anywhere or send it to your coach.</p>
          <div data-a3b-saved></div>`,
      };

      this.panes.innerHTML = this.tabList()
        .map(
          (t) =>
            `<div role="tabpanel" id="a3b-pane-${t.id}" aria-labelledby="a3b-tab-${t.id}" data-pane="${t.id}" ${t.id === this.activeTab ? '' : 'hidden'}>${panes[t.id]}</div>`
        )
        .join('');

      this.panes.oninput = (e) => this.onInput(e);
      this.panes.onchange = (e) => this.onInput(e);
      this.panes.onclick = (e) => this.onAction(e);
      this.renderSizes();
      this.renderSaved();
      this.updateContrast();
    }

    paddingPaneHtml() {
      const s = this.state;
      const parts = this.parts();
      let html = `<h2 class="a3b-h">Padding</h2><p class="a3-muted">Pick where you land. Zones are shown on the preview.</p>`;
      if (parts.includes('jersey')) {
        const opts = this.paddingOptions('jersey');
        if (opts.length) {
          html += `<h3 class="a3b-sub">Jersey</h3>${this.choice('padding.jersey', opts.map((o) => ({ id: o, label: o })), s.padding.jersey, 'Jersey padding')}`;
          if (s.sleeve === 'short' && (this.paddingMap[s.padding.jersey] || []).includes('elbows')) {
            html += `<p class="a3-notice a3-notice--warn">Elbow padding needs long sleeves.</p>`;
          }
        }
      }
      const bottom = this.bottomPart();
      if (bottom) {
        const opts = this.paddingOptions(bottom);
        html += `<h3 class="a3b-sub">${bottom === 'pants' ? 'Pants' : 'Shorts'}</h3>${this.choice('padding.bottoms', opts.map((o) => ({ id: o, label: o })), s.padding.bottoms, 'Bottoms padding')}`;
        if (bottom === 'shorts') html += `<p class="a3-small">Knee padding is only available on pants.</p>`;
      }
      html += `<details class="a3b-explain"><summary>What each zone is for</summary>
        <ul class="a3-list a3-list--dash">
          <li><strong>Hips</strong> — takes the hit when you land on your side after a dive. The one most keepers want.</li>
          <li><strong>Tailbone</strong> — for falling backwards and sitting down hard on hard or frozen ground.</li>
          <li><strong>Thighs</strong> — side of the upper leg; useful on turf and hard pitches.</li>
          <li><strong>Knees</strong> — pants only; for turf burns and hard indoor floors.</li>
          <li><strong>Elbows</strong> — long-sleeve jerseys; for turf and low diving saves.</li>
        </ul>
        <p class="a3-small">More padding means more protection but a bit more bulk and heat. On soft grass, hips alone is usually enough.</p>
      </details>`;
      return html;
    }

    onInput(e) {
      const el = e.target;
      const path = el.dataset.bind;
      if (!path) return;
      let value = el.value;
      if (el.dataset.kind === 'number') {
        value = value.replace(/\D/g, '').slice(0, 2);
        if (el.value !== value) el.value = value;
      } else if (el.dataset.kind === 'name') {
        value = this.cleanName(value);
        if (el.value !== value) el.value = value;
      } else if (el.dataset.kind === 'initials') {
        value = value.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
        if (el.value !== value) el.value = value;
      }
      if (path === 'number.shorts') value = value === 'yes';
      if (el.type === 'radio' && !el.checked) return;
      this.set(path, value);

      if (path === 'crest.type') {
        this.panes.querySelector('.a3b-crest-opts').hidden = value === 'upload';
        this.panes.querySelector('.a3b-upload-note').hidden = value !== 'upload';
      }
      if (path === 'base' || path === 'sleeve') {
        const pane = this.panes.querySelector('[data-pane="padding"]');
        pane.innerHTML = this.paddingPaneHtml();
        this.renderSizes();
      }
      if (path.startsWith('padding')) {
        this.panes.querySelector('[data-pane="padding"]').innerHTML = this.paddingPaneHtml();
      }
      if (path.startsWith('number') || path.startsWith('colors')) this.updateContrast();
      if (path.startsWith('sizes')) this.renderSummary();
    }

    updateContrast() {
      const el = this.panes.querySelector('[data-a3b-contrast]');
      if (!el) return;
      const s = this.state;
      const bg = s.pattern === 'stripes' || s.pattern === 'hoops' ? [s.colors.primary, s.colors.secondary] : [s.colors.primary];
      const worst = Math.min(...bg.map((c) => contrast(c, s.number.color)));
      if (worst < 2.2 && (!s.number.outline || s.number.outline === 'none')) {
        el.textContent = 'Heads up: that number colour will be hard to read from distance on this shirt. Try a contrasting colour or add an outline.';
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
        if (!product) {
          return `<p class="a3-notice a3-notice--warn">${label}: sizes and pricing aren't live yet. You can still design and save.</p>`;
        }
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

    /* ----- Preview ----- */

    bindStage() {
      this.querySelector('.a3b__viewbar').addEventListener('click', (e) => {
        const v = e.target.closest('[data-view]');
        if (v) this.setView(v.dataset.view);
        if (e.target.closest('[data-toggle-padding]')) this.togglePadding();
      });
    }

    setView(view) {
      this.view = view;
      this.querySelectorAll('[data-view]').forEach((b) => {
        const on = b.dataset.view === view;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on);
      });
      this.figures.dataset.view = view;
    }

    togglePadding(force) {
      this.showPadding = typeof force === 'boolean' ? force : !this.showPadding;
      const btn = this.querySelector('[data-toggle-padding]');
      btn.setAttribute('aria-pressed', this.showPadding);
      btn.classList.toggle('is-active', this.showPadding);
      this.renderPreview();
    }

    renderPreview() {
      this.figures.dataset.view = this.view;
      this.figures.innerHTML = ['front', 'back']
        .map((view) => `<figure class="a3b__figure" data-fig="${view}"><figcaption>${view === 'front' ? 'Front' : 'Back'}</figcaption>${this.figureSvg(view)}</figure>`)
        .join('');
    }

    figureSvg(view) {
      const s = this.state;
      const parts = this.parts();
      const hasJersey = parts.includes('jersey');
      const bottom = this.bottomPart();
      const bottomH = bottom === 'pants' ? 560 : bottom === 'shorts' ? 290 : 0;
      const overlap = hasJersey && bottom ? 70 : 0;
      const height = (hasJersey ? JERSEY_H : 0) + bottomH - overlap + 10;
      const pid = `a3b-${this.cfg.sectionId}-${view}`;

      const defs = `
        <defs>
          <linearGradient id="${pid}-shade" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stop-color="#000" stop-opacity=".32"/>
            <stop offset=".22" stop-color="#000" stop-opacity="0"/>
            <stop offset=".5" stop-color="#fff" stop-opacity=".06"/>
            <stop offset=".78" stop-color="#000" stop-opacity="0"/>
            <stop offset="1" stop-color="#000" stop-opacity=".32"/>
          </linearGradient>
          <pattern id="a3b-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="#3BE37F" fill-opacity=".18"/>
            <rect width="3" height="8" fill="#3BE37F" fill-opacity=".55"/>
          </pattern>
          ${patternDefs(`${pid}-pat`, s.pattern, s.colors.secondary)}
        </defs>`;

      let body = '';
      if (bottom) {
        const y = hasJersey ? JERSEY_H - overlap : 0;
        body += `<g transform="translate(0 ${y})">${bottom === 'pants' ? this.pantsSvg(view, pid) : this.shortsSvg(view, pid)}</g>`;
      }
      if (hasJersey) body += this.jerseySvg(view, pid);

      const summary = this.describe(view);
      return `<svg viewBox="0 0 400 ${height}" role="img" aria-label="${esc(summary)}" xmlns="http://www.w3.org/2000/svg">${defs}${body}</svg>`;
    }

    describe(view) {
      const s = this.state;
      const c = (hex) => (this.palette.find((p) => p.hex === hex) || { name: hex }).name;
      const base = (BASES.find((b) => b.id === s.base) || {}).label;
      let d = `${view === 'front' ? 'Front' : 'Back'} view: ${base}, ${c(s.colors.primary)} with ${c(s.colors.secondary)} sleeves and ${c(s.colors.trim)} trim`;
      if (s.pattern !== 'none') d += `, ${s.pattern} pattern`;
      if (view === 'back' && s.name.value) d += `, name ${s.name.value}`;
      if (s.number.value) d += `, number ${s.number.value}`;
      return d + '.';
    }

    jerseySvg(view, pid) {
      const s = this.state;
      const p = jerseyPaths(view, s.sleeve, s.collar);
      const patFill = s.pattern === 'none' ? '' : `<path d="${p.torso}" fill="url(#${pid}-pat)"/>`;
      let out = `<g class="a3b-jersey">
        <path d="${p.sleeveL}" fill="${s.colors.secondary}"/>
        <path d="${p.sleeveR}" fill="${s.colors.secondary}"/>
        <path d="${p.cuffL}" fill="${s.colors.trim}"/>
        <path d="${p.cuffR}" fill="${s.colors.trim}"/>
        <path d="${p.torso}" fill="${s.colors.primary}"/>
        ${patFill}
        <path d="${p.panelL}" fill="${s.colors.secondary}"/>
        <path d="${p.panelR}" fill="${s.colors.secondary}"/>
        <path d="${p.hem}" fill="${s.colors.trim}"/>
        <path d="${p.collar}" fill="${s.colors.trim}"/>
        <path d="${p.torso}" fill="url(#${pid}-shade)"/>
        <path d="${p.sleeveL}" fill="url(#${pid}-shade)" opacity=".6"/>
        <path d="${p.sleeveR}" fill="url(#${pid}-shade)" opacity=".6"/>
        <path d="M150,62 L108,80 M250,62 L292,80" stroke="rgba(0,0,0,.25)" stroke-width="1.5" fill="none"/>
        <path d="M100,170 L108,80 M300,170 L292,80" stroke="rgba(0,0,0,.2)" stroke-width="1" fill="none"/>`;

      const printOpts = { color: s.number.color, outline: s.number.outline, style: s.number.style };
      if (view === 'front') {
        if (s.crest.type !== 'none') {
          const cx = s.crest.placement === 'center' ? 200 : 248;
          const cy = s.crest.placement === 'center' ? 150 : 138;
          out += crestSvg(s.crest, cx, cy, s.crest.placement === 'center' ? 50 : 38);
        }
        if (s.number.front === 'chest' && s.number.value) {
          const nx = s.crest.placement === 'center' && s.crest.type !== 'none' ? 200 : 152;
          const ny = s.crest.placement === 'center' && s.crest.type !== 'none' ? 230 : 158;
          out += printText(s.number.value, nx, ny, 48, printOpts);
        }
      } else {
        if (s.name.value) {
          const len = s.name.value.length;
          const size = len > 10 ? 26 : 30;
          const maxW = Math.min(170, len * size * 0.62);
          out += printText(s.name.value, 200, 140, size, { ...printOpts, spacing: 2, maxWidth: len > 8 ? maxW : null });
        }
        if (s.number.value) out += printText(s.number.value, 200, s.name.value ? 305 : 290, 150, printOpts);
      }
      if (this.showPadding) this.zonesFor('jersey').forEach((z) => (out += zoneShape(z, 'jersey', view, true)));
      return out + '</g>';
    }

    shortsSvg(view, pid) {
      const s = this.state;
      const p = shortsPaths();
      let out = `<g class="a3b-shorts">
        <path d="${p.body}" fill="${s.colors.primary}"/>
        <path d="${p.stripeL}" fill="${s.colors.secondary}"/>
        <path d="${p.stripeR}" fill="${s.colors.secondary}"/>
        <path d="${p.hemL}" fill="${s.colors.trim}"/>
        <path d="${p.hemR}" fill="${s.colors.trim}"/>
        <path d="${p.waist}" fill="${s.colors.trim}"/>
        <path d="${p.body}" fill="url(#${pid}-shade)"/>
        <path d="M200,52 L200,120" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/>`;
      if (view === 'front' && s.number.shorts && s.number.value) {
        out += printText(s.number.value, 272, 225, 34, { color: s.number.color, outline: s.number.outline, style: s.number.style });
      }
      if (this.showPadding) this.zonesFor('shorts').forEach((z) => (out += zoneShape(z, 'shorts', view, true)));
      return out + '</g>';
    }

    pantsSvg(view, pid) {
      const s = this.state;
      const p = pantsPaths();
      let out = `<g class="a3b-pants">
        <path d="${p.body}" fill="${s.colors.primary}"/>
        <path d="${p.stripeL}" fill="${s.colors.secondary}"/>
        <path d="${p.stripeR}" fill="${s.colors.secondary}"/>
        <path d="${p.hemL}" fill="${s.colors.trim}"/>
        <path d="${p.hemR}" fill="${s.colors.trim}"/>
        <path d="${p.waist}" fill="${s.colors.trim}"/>
        <path d="${p.body}" fill="url(#${pid}-shade)"/>
        <path d="M200,52 L200,140" stroke="rgba(0,0,0,.25)" stroke-width="1.5"/>`;
      if (view === 'front' && s.number.shorts && s.number.value) {
        out += printText(s.number.value, 256, 200, 32, { color: s.number.color, outline: s.number.outline, style: s.number.style });
      }
      if (this.showPadding) this.zonesFor('pants').forEach((z) => (out += zoneShape(z, 'pants', view, true)));
      return out + '</g>';
    }

    /* ----- Pricing & order ----- */

    lines() {
      // Returns { lines: [{label, price, variant, part}], missing: [reasons] }
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
        // Price is known even before size is picked (sizes normally share a price).
        const variant = matches.find((v) => want[sizeIdx] && v.options[sizeIdx] === want[sizeIdx]) || null;
        const priceFrom = matches.length ? Math.min(...matches.map((v) => v.price)) : null;
        if (!matches.length) missing.push(`That ${part} combination isn't made — try another padding or sleeve option`);
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
      if (s.sleeve === 'short' && this.parts().includes('jersey') && (this.paddingMap[s.padding.jersey] || []).includes('elbows')) {
        missing.push('Elbow padding needs long sleeves');
      }
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
          <table class="a3-table">
            <tbody>${lines
              .map((l) => `<tr><th scope="row">${esc(l.label)}</th><td>${l.price == null ? '—' : fmt(l.price)}</td></tr>`)
              .join('')}</tbody>
            <tfoot><tr><th scope="row">Total</th><td class="${known ? '' : 'is-unknown'}">${known ? fmt(total) : 'Not available yet'}</td></tr></tfoot>
          </table>
          <p class="a3b-lead"><strong>Lead time:</strong> ${esc(this.cfg.leadTime || 'Not confirmed yet. Ordering opens once it is.')}</p>
          ${this.cfg.customNote ? `<p class="a3-small">${esc(this.cfg.customNote)} ${this.cfg.returnsUrl ? `<a href="${esc(this.cfg.returnsUrl)}">Returns policy</a>.` : ''}</p>` : ''}
          ${missing.length ? `<ul class="a3-list a3-list--dash a3b-missing">${missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
          <label class="a3b-ack"><input type="checkbox" data-ack ${canOrder ? '' : 'disabled'}> I've checked my design, sizes and the lead time above.</label>
          <button type="button" class="a3-btn a3b-add" data-action="add" disabled>${known ? `Add to cart — ${fmt(total)}` : 'Add to cart'}</button>
          <p class="a3-small">Shipping is calculated at checkout — no other fees.</p>
        </div>`;

      const ack = this.summary.querySelector('[data-ack]');
      const add = this.summary.querySelector('[data-action="add"]');
      ack.addEventListener('change', () => (add.disabled = !(ack.checked && canOrder)));
      add.addEventListener('click', () => this.addToCart());
    }

    specText() {
      const s = this.state;
      const c = (hex) => `${(this.palette.find((p) => p.hex === hex) || { name: '' }).name} ${hex}`.trim();
      return {
        Design: s.title,
        'Design ID': s.id,
        Base: (BASES.find((b) => b.id === s.base) || {}).label,
        Colours: `Main ${c(s.colors.primary)} / Sleeves ${c(s.colors.secondary)} / Trim ${c(s.colors.trim)}`,
        Pattern: (PATTERNS.find((p) => p.id === s.pattern) || {}).label,
        Jersey: this.parts().includes('jersey') ? `${s.sleeve} sleeve, ${s.collar === 'v' ? 'V-neck' : 'crew'} collar` : undefined,
        Number: s.number.value ? `${s.number.value} (${FONTS[s.number.style].label}, ${c(s.number.color)}${s.number.outline !== 'none' ? `, outline ${c(s.number.outline)}` : ''}; front: ${s.number.front}; on bottoms: ${s.number.shorts ? 'yes' : 'no'})` : 'None',
        Name: s.name.value || 'None',
        Crest:
          s.crest.type === 'none'
            ? 'None'
            : s.crest.type === 'upload'
              ? `Club crest — artwork to be collected by email (${s.crest.placement} chest)`
              : `${s.crest.type}${s.crest.text ? ' "' + s.crest.text + '"' : ''}, ${c(s.crest.color)} (${s.crest.placement} chest)`,
        Padding: this.parts()
          .map((p) => `${p}: ${this.zonesFor(p).map((z) => ZONE_LABELS[z]).join(', ') || 'none'}`)
          .join('; '),
      };
    }

    shareUrl() {
      return `${window.location.origin}${window.location.pathname}#d=${b64encode(this.state)}`;
    }

    async addToCart() {
      const { lines, missing } = this.lines();
      if (missing.length) return;
      const btn = this.summary.querySelector('[data-action="add"]');
      btn.disabled = true;
      btn.textContent = 'Adding…';

      const spec = this.specText();
      const props = {};
      Object.entries(spec).forEach(([k, v]) => {
        if (v !== undefined) props[k] = String(v);
      });
      // Private (underscore) properties stay out of checkout; the cart shows it as a short link.
      props['_edit_link'] = this.shareUrl();
      props['_spec'] = JSON.stringify(this.state);

      const items = lines.map((l) => {
        if (l.addonId) return { id: l.addonId, quantity: 1, properties: { 'For design': this.state.id } };
        return { id: l.variant.id, quantity: 1, properties: props };
      });

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

    /* ----- Save / load ----- */

    saveDesign(quiet) {
      const list = readStore(STORAGE_DESIGNS, []).filter((d) => d.id !== this.state.id);
      list.unshift({ id: this.state.id, title: this.state.title, updated: Date.now(), state: this.state });
      const ok = writeStore(STORAGE_DESIGNS, list.slice(0, MAX_SAVED));
      if (!quiet) this.flash(ok ? 'Saved on this device.' : "Couldn't save — your browser is blocking storage. Use Copy link instead.");
      this.renderSaved();
    }

    onAction(e) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
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
          this.state = this.sanitize({ ...this.defaultState(), ...item.state });
          writeStore(STORAGE_DRAFT, this.state);
          this.activeTab = 'base';
          this.renderAll();
          this.flash(`Editing "${item.title}".`);
        } else {
          writeStore(
            STORAGE_DESIGNS,
            list.filter((d) => d.id !== item.id)
          );
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
