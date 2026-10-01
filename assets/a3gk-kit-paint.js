/*
  A3GK kit painter.
  Paints a kit design onto canvases. The same textures drive the 3D model
  (wrapped around the garment meshes) and the flat front/back view.

  Texture layouts:
  - Torso 2048×1024. The body wraps once around: x=0 left side, x=512 front
    centre, x=1024 right side, x=1536 back centre, x=2048 left side again.
    y=0 is the neckline, y=1024 the hem.
  - Sleeves 1024×512: y=0 shoulder, y=512 cuff. x=256 faces out on the
    right sleeve, x=768 faces out on the left.
  - Hip 1024×256 (waist → crotch), legs 512×512 (top → hem), socks 256×512.

  Exposes window.A3GKPaint.
*/
(() => {
  if (window.A3GKPaint) return;

  const SANS = "'A3GK Sans', 'Helvetica Neue', Arial, sans-serif";

  const FONTS = {
    block: { label: 'Block', css: (px) => `condensed 800 ${px}px ${SANS}` },
    wide: { label: 'Wide', css: (px) => `expanded 800 ${px}px ${SANS}` },
    classic: { label: 'Classic', css: (px) => `700 ${px}px Georgia, 'Times New Roman', serif` },
    slab: { label: 'Slab', css: (px) => `800 ${px}px Rockwell, 'Roboto Slab', 'Courier New', serif` },
    rounded: { label: 'Rounded', css: (px) => `700 ${px}px 'Arial Rounded MT Bold', 'Trebuchet MS', Verdana, sans-serif` },
    stencil: { label: 'Stencil', css: (px) => `condensed 800 ${px}px ${SANS}`, stencil: true },
  };

  const PATTERNS = [
    { id: 'none', label: 'Plain' },
    { id: 'stripes', label: 'Stripes' },
    { id: 'pinstripes', label: 'Pinstripes' },
    { id: 'hoops', label: 'Hoops' },
    { id: 'split', label: 'Half & half' },
    { id: 'sash', label: 'Sash' },
    { id: 'chevron', label: 'Chevron' },
    { id: 'fade', label: 'Fade' },
    { id: 'sweep', label: 'Diagonal sweep' },
    { id: 'shards', label: 'Shards' },
    { id: 'halftone', label: 'Halftone' },
    { id: 'camo', label: 'Camo' },
    { id: 'topo', label: 'Topographic' },
    { id: 'lightning', label: 'Lightning' },
    { id: 'waves', label: 'Waves' },
    { id: 'grid', label: 'Grid' },
    { id: 'facets', label: 'Facets' },
    { id: 'speed', label: 'Speed lines' },
    { id: 'contour', label: 'Contour' },
    { id: 'pixel', label: 'Pixel fade' },
    { id: 'gradstripes', label: 'Gradient stripes' },
    { id: 'brushed', label: 'Brushed' },
  ];

  // How strongly a pattern prints over the base colour. Tonal is how most
  // pro keeper kits are sublimated: the graphic reads up close, not from afar.
  const STRENGTH = { tonal: 0.24, medium: 0.55, bold: 1 };

  const SCALE = { s: 0.6, m: 1, l: 1.6 };

  /* ---------- small utils ---------- */

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) % 100000) / 100000;
    };
  }

  function hexToRgb(hex) {
    let h = String(hex || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
  }

  function rgba(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  /* ---------- patterns ---------- */

  // Paints `type` in `color` over the rect. Deterministic for a given seed.
  // Paint a pattern at a given strength (via an offscreen layer, so patterns
  // that vary their own opacity keep their internal contrast).
  function paintPatternLayer(ctx, x, y, w, h, type, color, scaleKey, seed, strength) {
    const a = STRENGTH[strength] ?? 1;
    if (a >= 1) return paintPattern(ctx, x, y, w, h, type, color, scaleKey, seed);
    const layer = makeCanvas(Math.ceil(w), Math.ceil(h));
    paintPattern(layer.getContext('2d'), 0, 0, w, h, type, color, scaleKey, seed);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.drawImage(layer, x, y);
    ctx.restore();
  }

  function paintPattern(ctx, x, y, w, h, type, color, scaleKey, seed = 7) {
    const k = SCALE[scaleKey] || 1;
    const r = rng(seed);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;

    switch (type) {
      case 'stripes': {
        const band = 64 * k;
        for (let i = x; i < x + w; i += band * 2) ctx.fillRect(i, y, band, h);
        break;
      }
      case 'pinstripes': {
        const gap = 34 * k;
        for (let i = x; i < x + w; i += gap) ctx.fillRect(i, y, Math.max(3, 4 * k), h);
        break;
      }
      case 'hoops': {
        const band = 70 * k;
        for (let j = y + band * 0.5; j < y + h; j += band * 2) ctx.fillRect(x, j, w, band);
        break;
      }
      case 'split': {
        // Handled per region by the torso painter (left/right halves).
        ctx.fillRect(x + w / 2, y, w / 2, h);
        break;
      }
      case 'sash': {
        ctx.beginPath();
        const t = 150 * k;
        ctx.moveTo(x + w * 0.1, y - 10);
        ctx.lineTo(x + w * 0.1 + t, y - 10);
        ctx.lineTo(x + w * 0.9 + t, y + h + 10);
        ctx.lineTo(x + w * 0.9, y + h + 10);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'chevron': {
        const t = 60 * k;
        for (let j = y + h * 0.18; j < y + h; j += t * 3.2) {
          ctx.beginPath();
          ctx.moveTo(x, j);
          ctx.lineTo(x + w / 2, j + w * 0.18);
          ctx.lineTo(x + w, j);
          ctx.lineTo(x + w, j + t);
          ctx.lineTo(x + w / 2, j + w * 0.18 + t);
          ctx.lineTo(x, j + t);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      case 'fade': {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0.25, rgba(color, 0));
        g.addColorStop(1, rgba(color, 1));
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        break;
      }
      case 'sweep': {
        const g = ctx.createLinearGradient(x, y, x + w, y + h);
        g.addColorStop(0, rgba(color, 0.95));
        g.addColorStop(0.45, rgba(color, 0.35));
        g.addColorStop(0.7, rgba(color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        break;
      }
      case 'shards': {
        const n = Math.round(26 / k);
        for (let i = 0; i < n; i++) {
          const cx = x + r() * w;
          const cy = y + r() * h;
          const s = (50 + r() * 110) * k;
          const a = r() * Math.PI;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s);
          ctx.lineTo(cx + Math.cos(a + 2.2) * s * 0.5, cy + Math.sin(a + 2.2) * s * 0.5);
          ctx.lineTo(cx + Math.cos(a + 3.6) * s * 0.8, cy + Math.sin(a + 3.6) * s * 0.8);
          ctx.closePath();
          ctx.globalAlpha = 0.65 + r() * 0.35;
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'halftone': {
        const step = 26 * k;
        for (let j = y; j < y + h + step; j += step) {
          const t = (j - y) / h;
          const rad = step * 0.48 * Math.min(1, t * 1.2);
          for (let i = x + ((j / step) % 2) * (step / 2); i < x + w + step; i += step) {
            if (rad < 0.8) continue;
            ctx.beginPath();
            ctx.arc(i, j, rad, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      }
      case 'camo': {
        const n = Math.round(46 / k);
        for (let i = 0; i < n; i++) {
          const cx = x + r() * w;
          const cy = y + r() * h;
          const s = (40 + r() * 70) * k;
          ctx.beginPath();
          for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 6) {
            const rr = s * (0.6 + r() * 0.6);
            const px = cx + Math.cos(a) * rr * 1.4;
            const py = cy + Math.sin(a) * rr;
            a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.globalAlpha = 0.55 + r() * 0.45;
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'topo': {
        ctx.lineWidth = Math.max(1.5, 2 * k);
        ctx.globalAlpha = 0.9;
        const centres = [0, 1, 2].map(() => [x + r() * w, y + r() * h]);
        for (const [cx, cy] of centres) {
          for (let ring = 1; ring < 14; ring++) {
            ctx.beginPath();
            for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.1) {
              const wob = 1 + 0.18 * Math.sin(a * 3 + ring) + 0.08 * Math.sin(a * 7);
              const rr = ring * 24 * k * wob;
              const px = cx + Math.cos(a) * rr * 1.3;
              const py = cy + Math.sin(a) * rr;
              a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'lightning': {
        ctx.lineWidth = 6 * k;
        ctx.lineJoin = 'miter';
        const bolts = Math.round(6 / k) + 1;
        for (let b = 0; b < bolts; b++) {
          let px = x + ((b + 0.5) / bolts) * w;
          let py = y - 20;
          ctx.beginPath();
          ctx.moveTo(px, py);
          while (py < y + h) {
            px += (r() - 0.5) * 120 * k;
            py += (50 + r() * 60) * k;
            ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        break;
      }
      case 'waves': {
        ctx.lineWidth = 18 * k;
        for (let j = y; j < y + h + 60; j += 70 * k) {
          ctx.beginPath();
          for (let i = x; i <= x + w; i += 12) {
            const py = j + Math.sin((i / (90 * k)) * Math.PI) * 16 * k;
            i === x ? ctx.moveTo(i, py) : ctx.lineTo(i, py);
          }
          ctx.stroke();
        }
        break;
      }
      case 'facets': {
        // Low-poly facets: a jittered grid split into triangles of varying weight.
        const cell = 120 * k;
        const cols = Math.ceil(w / cell) + 2;
        const rows = Math.ceil(h / cell) + 2;
        const pt = [];
        for (let j = 0; j < rows; j++) {
          pt.push([]);
          for (let i = 0; i < cols; i++) pt[j].push([x + (i - 0.5 + (r() - 0.5) * 0.7) * cell, y + (j - 0.5 + (r() - 0.5) * 0.7) * cell]);
        }
        for (let j = 0; j < rows - 1; j++)
          for (let i = 0; i < cols - 1; i++) {
            const a = pt[j][i], b = pt[j][i + 1], c = pt[j + 1][i + 1], d = pt[j + 1][i];
            for (const tri of [[a, b, c], [a, c, d]]) {
              ctx.globalAlpha = Math.pow(r(), 1.6);
              ctx.beginPath();
              ctx.moveTo(tri[0][0], tri[0][1]);
              ctx.lineTo(tri[1][0], tri[1][1]);
              ctx.lineTo(tri[2][0], tri[2][1]);
              ctx.closePath();
              ctx.fill();
            }
          }
        ctx.globalAlpha = 1;
        break;
      }
      case 'speed': {
        // Fine diagonal speed lines, denser toward one side.
        const n = Math.round(160 / k);
        for (let i = 0; i < n; i++) {
          const t = Math.pow(r(), 0.7);
          const px = x + t * w;
          const py = y + r() * h;
          const len = (80 + r() * 260) * k;
          ctx.lineWidth = (1 + r() * 3) * k;
          ctx.globalAlpha = 0.35 + r() * 0.65;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + len * 0.45, py - len);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'contour': {
        // Dense fine contour lines flowing across the garment.
        ctx.lineWidth = Math.max(1.2, 1.6 * k);
        const lines = Math.round(60 / k);
        const ph = r() * 10;
        for (let l = 0; l < lines; l++) {
          const base = y + (l / lines) * (h + 200) - 100;
          ctx.beginPath();
          for (let i = x - 20; i <= x + w + 20; i += 10) {
            const yy = base + Math.sin(i / (180 * k) + ph + l * 0.05) * 40 * k + Math.sin(i / (70 * k) + l * 0.2) * 10 * k;
            i === x - 20 ? ctx.moveTo(i, yy) : ctx.lineTo(i, yy);
          }
          ctx.stroke();
        }
        break;
      }
      case 'pixel': {
        // Pixel blocks dissolving upward from the hem.
        const px = 28 * k;
        for (let j = y; j < y + h; j += px)
          for (let i = x; i < x + w; i += px) {
            const t = (j - y) / h;
            if (r() < Math.pow(t, 1.6)) ctx.fillRect(i + 1, j + 1, px - 2, px - 2);
          }
        break;
      }
      case 'gradstripes': {
        // Vertical stripes that fade out toward the chest.
        const band = 46 * k;
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, rgba(color, 0));
        g.addColorStop(0.35, rgba(color, 0.15));
        g.addColorStop(1, rgba(color, 1));
        ctx.fillStyle = g;
        for (let i = x; i < x + w; i += band * 2) ctx.fillRect(i, y, band, h);
        break;
      }
      case 'brushed': {
        // Soft dry-brush strokes.
        const n = Math.round(40 / k);
        for (let i = 0; i < n; i++) {
          const py = y + r() * h;
          const px = x + r() * w * 0.4 - w * 0.1;
          const len = w * (0.4 + r() * 0.7);
          const th = (14 + r() * 40) * k;
          for (let b = 0; b < 10; b++) {
            ctx.globalAlpha = 0.08 + r() * 0.25;
            ctx.fillRect(px + r() * 30, py + (r() - 0.5) * th, len * (0.6 + r() * 0.4), Math.max(1.5, r() * 5 * k));
          }
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'grid': {
        ctx.lineWidth = Math.max(2, 3 * k);
        const g = 56 * k;
        for (let i = x; i < x + w; i += g) {
          ctx.beginPath();
          ctx.moveTo(i, y);
          ctx.lineTo(i, y + h);
          ctx.stroke();
        }
        for (let j = y; j < y + h; j += g) {
          ctx.beginPath();
          ctx.moveTo(x, j);
          ctx.lineTo(x + w, j);
          ctx.stroke();
        }
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  /* ---------- text & crests ---------- */

  function drawText(ctx, text, x, y, px, opts) {
    if (!text) return;
    const font = FONTS[opts.font] || FONTS.block;
    ctx.save();
    ctx.font = font.css(px);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (opts.maxWidth) {
      const m = ctx.measureText(text).width;
      if (m > opts.maxWidth) {
        const scaled = Math.floor((px * opts.maxWidth) / m);
        ctx.font = font.css(scaled);
      }
    }
    const paint = (tx, ty, t) => {
      if (opts.outline && opts.outline !== 'none') {
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(4, px * 0.09);
        ctx.strokeStyle = opts.outline;
        ctx.strokeText(t, tx, ty);
      }
      ctx.fillStyle = opts.color;
      ctx.fillText(t, tx, ty);
    };

    if (opts.arch && text.length > 1) {
      // Arched name across the shoulders.
      const radius = px * 7;
      const total = ctx.measureText(text).width;
      let angle = -total / radius / 2;
      for (const ch of text) {
        const cw = ctx.measureText(ch).width;
        const a = angle + cw / radius / 2;
        ctx.save();
        ctx.translate(x + Math.sin(a) * radius, y + radius - Math.cos(a) * radius);
        ctx.rotate(a);
        paint(0, 0, ch);
        ctx.restore();
        angle += cw / radius;
      }
    } else {
      paint(x, y, text);
    }

    if (font.stencil) {
      // Stencil bridges: thin horizontal gaps through the glyphs.
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = opts.bridge || '#000';
      const bw = ctx.measureText(text).width;
      ctx.fillRect(x - bw / 2 - 10, y - px * 0.06, bw + 20, px * 0.08);
    }
    ctx.restore();
  }

  const svgCache = new Map();

  // Loads a (sanitised) SVG string into an Image once; calls onload when ready.
  function svgImage(svg, onload) {
    if (!svg) return null;
    let entry = svgCache.get(svg);
    if (!entry) {
      const img = new Image();
      entry = { img, ready: false, waiters: [] };
      img.onload = () => {
        entry.ready = true;
        entry.waiters.splice(0).forEach((fn) => fn());
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      svgCache.set(svg, entry);
    }
    if (!entry.ready && onload) entry.waiters.push(onload);
    return entry.ready ? entry.img : null;
  }

  function crestPath(ctx, type, cx, cy, s) {
    ctx.beginPath();
    switch (type) {
      case 'circle':
        ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
        break;
      case 'diamond':
        ctx.moveTo(cx, cy - s * 0.55);
        ctx.lineTo(cx + s * 0.45, cy);
        ctx.lineTo(cx, cy + s * 0.55);
        ctx.lineTo(cx - s * 0.45, cy);
        break;
      case 'hex':
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + (i * Math.PI) / 3;
          const px = cx + Math.cos(a) * s * 0.5;
          const py = cy + Math.sin(a) * s * 0.5;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        break;
      case 'star':
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i % 2 ? s * 0.24 : s * 0.55;
          const px = cx + Math.cos(a) * rr;
          const py = cy + Math.sin(a) * rr;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        break;
      default: {
        // shield
        const w = s * 0.86;
        const h = s;
        ctx.moveTo(cx - w / 2, cy - h / 2);
        ctx.lineTo(cx + w / 2, cy - h / 2);
        ctx.lineTo(cx + w / 2, cy);
        ctx.quadraticCurveTo(cx + w / 2, cy + h * 0.35, cx, cy + h / 2);
        ctx.quadraticCurveTo(cx - w / 2, cy + h * 0.35, cx - w / 2, cy);
      }
    }
    ctx.closePath();
  }

  function drawCrest(ctx, crest, cx, cy, s, onAsync) {
    if (!crest || crest.type === 'none') return;
    ctx.save();
    if (crest.type === 'ai' && crest.svg) {
      const img = svgImage(crest.svg, onAsync);
      if (img) {
        const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 200 / 240;
        const h = s * 1.1;
        ctx.drawImage(img, cx - (h * ratio) / 2, cy - h / 2, h * ratio, h);
      }
    } else if (crest.type === 'upload') {
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 4;
      ctx.strokeStyle = crest.color;
      ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
      ctx.setLineDash([]);
      ctx.fillStyle = crest.color;
      ctx.font = `700 ${Math.round(s * 0.2)}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CREST', cx, cy);
    } else {
      crestPath(ctx, crest.type, cx, cy, s);
      ctx.fillStyle = crest.color;
      ctx.fill();
      ctx.lineWidth = s * 0.04;
      ctx.strokeStyle = 'rgba(0,0,0,.25)';
      ctx.stroke();
      if (crest.text) {
        drawText(ctx, crest.text.slice(0, 3), cx, cy + s * 0.02, s * 0.34, { font: 'wide', color: crest.textColor });
      }
    }
    ctx.restore();
  }

  /* ---------- padding overlay ---------- */

  function padZone(ctx, x, y, w, h) {
    ctx.save();
    const r = Math.min(w, h) * 0.35;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
    ctx.fillStyle = 'rgba(59,227,127,.2)';
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = 'rgba(59,227,127,.75)';
    ctx.lineWidth = 3;
    for (let i = -h; i < w + h; i += 16) {
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i - h, y + h);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.setLineDash([12, 8]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#3be37f';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- garments ---------- */

  const FRONT = 512;
  const BACK = 1536;

  function paintTorso(canvas, s, opts = {}) {
    const W = 2048;
    const H = 1024;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const c = s.colors;

    ctx.fillStyle = c.primary;
    ctx.fillRect(0, 0, W, H);

    const pat = s.pattern || {};
    if (pat.type && pat.type !== 'none') {
      if (pat.type === 'split') {
        // Half & half: viewer's left half of the front and matching half of the back.
        ctx.fillStyle = c.pattern;
        ctx.fillRect(FRONT, 0, 512, H);
        ctx.fillRect(BACK - 512, 0, 512, H);
      } else {
        paintPatternLayer(ctx, 0, 0, W / 2, H, pat.type, c.pattern, pat.scale, 11, pat.strength);
        paintPatternLayer(ctx, W / 2, 0, W / 2, H, pat.type, c.pattern, pat.scale, 23, pat.strength);
      }
    }

    // Side panels over the side seams (x=0/2048 and x=1024).
    if (s.sidePanels !== false) {
      ctx.fillStyle = c.secondary;
      ctx.fillRect(0, 150, 70, H);
      ctx.fillRect(W - 70, 150, 70, H);
      ctx.fillRect(1024 - 70, 150, 140, H);
    }

    // Hem trim.
    if (s.hemTrim !== false) {
      ctx.fillStyle = c.trim;
      ctx.fillRect(0, H - 26, W, 26);
    }

    // Neckline details on the front.
    ctx.fillStyle = c.trim;
    if (s.collar === 'v') {
      ctx.beginPath();
      ctx.moveTo(FRONT - 95, 0);
      ctx.lineTo(FRONT, 150);
      ctx.lineTo(FRONT + 95, 0);
      ctx.lineTo(FRONT + 70, 0);
      ctx.lineTo(FRONT, 118);
      ctx.lineTo(FRONT - 70, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = c.primary;
    } else if (s.collar === 'polo') {
      ctx.fillRect(FRONT - 22, 0, 44, 150);
      ctx.fillStyle = c.primary;
      [52, 104].forEach((y) => {
        ctx.beginPath();
        ctx.arc(FRONT, y, 7, 0, Math.PI * 2);
        ctx.fill();
      });
    } else if (s.collar === 'wrap') {
      ctx.beginPath();
      ctx.moveTo(FRONT - 90, 0);
      ctx.lineTo(FRONT + 30, 120);
      ctx.lineTo(FRONT + 60, 120);
      ctx.lineTo(FRONT - 50, 0);
      ctx.closePath();
      ctx.fill();
    }

    // Front: crest + number.
    const crest = s.crest || {};
    const cSize = { s: 110, m: 150, l: 210 }[crest.size || 'm'];
    const crestX = crest.placement === 'center' ? FRONT : crest.placement === 'right' ? FRONT - 175 : FRONT + 175;
    const crestY = crest.placement === 'center' ? 300 : 280;
    drawCrest(ctx, crest, crestX, crestY, cSize, opts.onAsync);

    const num = s.number || {};
    const printOpts = { font: num.font, color: c.number, outline: c.outline, bridge: c.primary };
    const nScale = { s: 0.8, m: 1, l: 1.25 }[num.size || 'm'];
    if (num.value && num.front && num.front !== 'none') {
      let nx = crest.placement === 'right' ? FRONT + 175 : FRONT - 175;
      let ny = 285;
      if (num.front === 'center') {
        nx = FRONT;
        ny = crest.placement === 'center' && crest.type !== 'none' ? 470 : 330;
      }
      drawText(ctx, num.value, nx, ny, 150 * nScale, printOpts);
    }

    // Back: motto, name, number.
    if (s.motto) {
      drawText(ctx, s.motto.toUpperCase(), BACK, 86, 34, { font: 'wide', color: c.number, maxWidth: 360 });
    }
    const name = (s.name && s.name.value) || '';
    if (name) {
      drawText(ctx, name, BACK, s.name.arch ? 230 : 250, 92, { ...printOpts, maxWidth: 620, arch: s.name.arch });
    }
    if (num.value) {
      drawText(ctx, num.value, BACK, name ? 560 : 500, 440 * nScale, printOpts);
    }

    construction(ctx, 'torso', W, H, s);
    return canvas;
  }

  function paintSleeve(canvas, s, side, opts = {}) {
    // Height follows the sleeve's real length/circumference so numbers and
    // patterns aren't stretched on the 3D garment.
    const W = 1024;
    const H = s.sleeve === 'short' ? 512 : 1536;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const c = s.colors;
    const mode = (s.pattern && s.pattern.sleeves) || 'solid';

    if (mode === 'match') {
      ctx.fillStyle = c.primary;
      ctx.fillRect(0, 0, W, H);
      if (s.pattern.type !== 'none' && s.pattern.type !== 'split') paintPatternLayer(ctx, 0, 0, W, H, s.pattern.type, c.pattern, s.pattern.scale, side === 'l' ? 31 : 37, s.pattern.strength);
    } else {
      ctx.fillStyle = c.secondary;
      ctx.fillRect(0, 0, W, H);
      if (mode === 'pattern' && s.pattern.type !== 'none' && s.pattern.type !== 'split') {
        paintPatternLayer(ctx, 0, 0, W, H, s.pattern.type, c.pattern, s.pattern.scale, side === 'l' ? 41 : 43, s.pattern.strength);
      }
    }

    if (s.cuffs !== false) {
      ctx.fillStyle = c.trim;
      ctx.fillRect(0, H - 44, W, 44);
    }

    const outer = side === 'r' ? 256 : 768;
    if (s.number && s.number.sleeve && s.number.value) {
      drawText(ctx, s.number.value, outer, 120, 96, { font: s.number.font, color: c.number, outline: c.outline, bridge: c.secondary });
    }
    if (opts.padding && opts.zones && opts.zones.includes('elbows') && s.sleeve !== 'short') {
      padZone(ctx, outer - 110, Math.round(H * 0.46), 220, 170);
    }
    construction(ctx, side === 'r' ? 'sleeveR' : 'sleeveL', W, H, s);
    return canvas;
  }

  function bottomsColour(s) {
    const b = s.colors.bottoms;
    if (!b || b === 'match') return s.colors.primary;
    if (b === 'secondary') return s.colors.secondary;
    return b;
  }

  function paintHip(canvas, s, opts = {}) {
    const W = 1024;
    const H = 256;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const c = s.colors;
    ctx.fillStyle = bottomsColour(s);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = c.trim;
    ctx.fillRect(0, 0, W, 34);
    ctx.fillStyle = c.secondary;
    ctx.fillRect(0, 34, 24, H);
    ctx.fillRect(W - 24, 34, 24, H);
    ctx.fillRect(512 - 24, 34, 48, H);
    if (opts.padding && opts.zones) {
      if (opts.zones.includes('hip')) {
        padZone(ctx, 20, 70, 120, 150);
        padZone(ctx, W - 140, 70, 120, 150);
        padZone(ctx, 512 - 70, 70, 140, 150);
      }
      if (opts.zones.includes('tailbone')) padZone(ctx, 768 - 90, 60, 180, 130);
    }
    construction(ctx, 'hip', W, H, s);
    return canvas;
  }

  function paintLeg(canvas, s, side, kind, opts = {}) {
    const W = 512;
    const H = kind === 'pants' ? 832 : 192;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const c = s.colors;
    ctx.fillStyle = bottomsColour(s);
    ctx.fillRect(0, 0, W, H);
    const outer = side === 'r' ? 128 : 384;
    ctx.fillStyle = c.secondary;
    ctx.fillRect(outer - 22, 0, 44, H);
    ctx.fillStyle = c.trim;
    ctx.fillRect(0, H - 30, W, 30);
    if (s.number && s.number.shorts && s.number.value && side === 'r') {
      drawText(ctx, s.number.value, 92, kind === 'pants' ? 150 : 92, kind === 'pants' ? 80 : 84, {
        font: s.number.font,
        color: c.number,
        outline: c.outline,
        bridge: bottomsColour(s),
      });
    }
    if (opts.padding && opts.zones) {
      const z = opts.zones;
      if (kind === 'pants') {
        if (z.includes('thigh')) padZone(ctx, outer - 70, 40, 140, 200);
        if (z.includes('knee')) {
          // The front of the leg sits on the texture seam (x=0 / x=512).
          const ky = Math.round(H * 0.4);
          padZone(ctx, -80, ky, 160, 130);
          padZone(ctx, W - 80, ky, 160, 130);
        }
      } else if (z.includes('thigh')) {
        padZone(ctx, outer - 80, 24, 160, H - 64);
      }
    }
    construction(ctx, side === 'r' ? 'legR' : 'legL', W, H, s);
    return canvas;
  }

  function paintSock(canvas, s) {
    const W = 256;
    const H = 512;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = s.colors.socks;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = s.colors.sockTop;
    ctx.fillRect(0, 0, W, 70);
    ctx.fillRect(0, 84, W, 12);
    return canvas;
  }


  /* ---------- construction details: seams, topstitching, branding ---------- */

  // Where the seams sit in each texture (x positions), matching the garment build.
  function seamLines(part, W, s) {
    if (part === 'torso') return s.sidePanels !== false ? [70, W - 70, 1024 - 70, 1024 + 70] : [2, W - 2, 1024];
    if (part === 'sleeveR') return [W * 0.75];
    if (part === 'sleeveL') return [W * 0.25];
    if (part === 'hip') return [2, W - 2, W / 2];
    if (part === 'legR') return [W * 0.75];
    if (part === 'legL') return [W * 0.25];
    return [];
  }

  function shadeOf(hex, amt) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return `rgba(0,0,0,${Math.abs(amt)})`;
    const n = parseInt(m[1], 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  function stitchRow(ctx, x0, y0, x1, y1, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  function brandMark(ctx, x, y, size, color) {
    // A3GK wordmark: goal-frame mark + letters, printed small like a kit logo.
    ctx.save();
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, size * 0.09);
    const m = size;
    ctx.strokeRect(x - m * 1.55, y - m * 0.42, m * 0.62, m * 0.72);
    ctx.font = `800 ${Math.round(m * 0.82)}px 'A3GK Sans', system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('A3GK', x - m * 0.8, y - m * 0.04);
    ctx.restore();
  }

  function construction(ctx, part, W, H, s) {
    const c = s.colors;
    const base = part === 'hip' || part === 'legR' || part === 'legL' ? bottomsColour(s) : part === 'torso' ? c.primary : (s.pattern && s.pattern.sleeves) === 'match' ? c.primary : c.secondary;
    const seam = shadeOf(base, -0.28);
    const thread = shadeOf(base, 0.22);
    // Seams: a fine shadow line with topstitching either side.
    seamLines(part, W, s).forEach((x) => {
      ctx.fillStyle = seam;
      ctx.fillRect(x - 1, 0, 2, H);
      stitchRow(ctx, x - 6, 0, x - 6, H, thread);
      stitchRow(ctx, x + 6, 0, x + 6, H, thread);
    });
    // Hems: twin-needle topstitching.
    const hemY = part === 'torso' ? H - 38 : part === 'hip' ? 44 : H - 40;
    stitchRow(ctx, 0, hemY, W, hemY, thread);
    stitchRow(ctx, 0, hemY + (part === 'hip' ? -8 : 8), W, hemY + (part === 'hip' ? -8 : 8), thread);
    if (part === 'hip') stitchRow(ctx, 0, 12, W, 12, thread);
    // Branding.
    const ink = c.trim && c.trim !== base ? c.trim : shadeOf(base, 0.6);
    if (part === 'torso') {
      brandMark(ctx, FRONT, 205, 22, ink); // below the collar, centre front
      brandMark(ctx, BACK, 40, 16, ink); // back neck
      // Woven size/care label at the front hem.
      ctx.fillStyle = shadeOf(base, 0.75);
      ctx.fillRect(FRONT + 320, H - 74, 34, 22);
      ctx.fillStyle = shadeOf(base, -0.2);
      ctx.font = "700 9px 'A3GK Sans', system-ui, sans-serif";
      ctx.textAlign = 'center';
      ctx.fillText('A3GK', FRONT + 337, H - 60);
    }
    if (part === 'sleeveR' || part === 'sleeveL') {
      const outer = part === 'sleeveR' ? W * 0.25 : W * 0.75;
      brandMark(ctx, outer, H - (s.sleeve === 'short' ? 110 : 150), 18, ink);
    }
    if (part === 'legL') brandMark(ctx, W * 0.15, H - (H > 400 ? 120 : 70), 14, ink);
  }

  /* ---------- surface detail (bump) maps ---------- */

  // Height maps: knit texture at real scale, seam grooves, hem folds, rib.
  function paintDetail(canvas, part, s, W, H) {
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.fillRect(0, 0, W, H);
    const tile = makeCanvas(48, 48);
    const t = tile.getContext('2d');
    t.fillStyle = 'rgb(128,128,128)';
    t.fillRect(0, 0, 48, 48);
    if (s.finish === 'mesh') {
      // Open mesh: rows of small holes.
      t.fillStyle = 'rgb(40,40,40)';
      for (let y = 4; y < 48; y += 12)
        for (let x = (y / 12) % 2 ? 4 : 10; x < 48; x += 12) {
          t.beginPath();
          t.arc(x, y, 3.2, 0, Math.PI * 2);
          t.fill();
        }
    } else {
      // Jersey knit: interlocking V loops in columns.
      for (let x = 0; x < 48; x += 4)
        for (let y = 0; y < 48; y += 4) {
          const g = t.createLinearGradient(x, y, x + 4, y + 4);
          g.addColorStop(0, 'rgb(150,150,150)');
          g.addColorStop(1, 'rgb(105,105,105)');
          t.fillStyle = g;
          t.beginPath();
          t.moveTo(x, y);
          t.lineTo(x + 2, y + 3);
          t.lineTo(x + 4, y);
          t.lineTo(x + 4, y + 1.2);
          t.lineTo(x + 2, y + 4);
          t.lineTo(x, y + 1.2);
          t.closePath();
          t.fill();
        }
    }
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, W, H);
    const groove = (x) => {
      const g = ctx.createLinearGradient(x - 7, 0, x + 7, 0);
      g.addColorStop(0, 'rgba(160,160,160,1)');
      g.addColorStop(0.45, 'rgba(60,60,60,1)');
      g.addColorStop(0.55, 'rgba(60,60,60,1)');
      g.addColorStop(1, 'rgba(160,160,160,1)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 7, 0, 14, H);
    };
    seamLines(part, W, s).forEach(groove);
    // Hem fold: a raised band with a groove above it.
    const band = (y0, y1) => {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, 'rgb(70,70,70)');
      g.addColorStop(0.3, 'rgb(170,170,170)');
      g.addColorStop(1, 'rgb(140,140,140)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y0, W, y1 - y0);
    };
    if (part === 'torso') band(H - 46, H);
    if (part === 'hip') {
      // Elastic waistband: gathered fabric ruching under a stitched band.
      band(0, 48);
      for (let x = 0; x < W; x += 9) {
        const g = ctx.createLinearGradient(x, 0, x + 9, 0);
        g.addColorStop(0, 'rgba(95,95,95,0.85)');
        g.addColorStop(0.5, 'rgba(178,178,178,0.85)');
        g.addColorStop(1, 'rgba(95,95,95,0.85)');
        ctx.fillStyle = g;
        ctx.fillRect(x, 4, 9, 30);
      }
      // Drawcord eyelets at centre front.
      ctx.fillStyle = 'rgb(40,40,40)';
      [W * 0.25 - 14, W * 0.25 + 14].forEach((ex) => {
        ctx.beginPath();
        ctx.arc(ex, 20, 5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    if (part.startsWith('leg')) band(H - 44, H);
    // Ribbed cuffs.
    if (part.startsWith('sleeve') && s.cuffs !== false) {
      for (let x = 0; x < W; x += 8) {
        ctx.fillStyle = 'rgb(175,175,175)';
        ctx.fillRect(x, H - 44, 4, 44);
        ctx.fillStyle = 'rgb(90,90,90)';
        ctx.fillRect(x + 4, H - 44, 4, 44);
      }
    }
    return canvas;
  }

  /* ---------- fabric bump (knit) ---------- */

  function knitCanvas(finish) {
    const c = makeCanvas(256, 256);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    const r = rng(99);
    if (finish === 'mesh') {
      ctx.fillStyle = '#3a3a3a';
      for (let y = 4; y < 256; y += 10) for (let x = (y / 10) % 2 ? 4 : 9; x < 256; x += 10) {
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      for (let y = 0; y < 256; y += 4) {
        for (let x = 0; x < 256; x += 4) {
          const v = 110 + Math.floor(r() * 50);
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(x, y, 4, 2);
        }
      }
    }
    return c;
  }

  /* ---------- flat (2D) view ---------- */

  // Silhouettes in a 400-wide space (same as the original flat builder).
  const SIL = {
    torsoFront: 'M150 62L165 58Q200 92 235 58L250 62L292 80L300 170L304 440Q200 452 96 440L100 170L108 80Z',
    torsoBack: 'M150 62L165 58Q200 72 235 58L250 62L292 80L300 170L304 440Q200 452 96 440L100 170L108 80Z',
    sleeveRLong: 'M292 80Q322 92 338 140L376 318L340 332L306 200L300 170Z',
    sleeveLLong: 'M108 80Q78 92 62 140L24 318L60 332L94 200L100 170Z',
    sleeveRShort: 'M292 80Q322 92 336 130L352 196L312 210L300 170Z',
    sleeveLShort: 'M108 80Q78 92 64 130L48 196L88 210L100 170Z',
    shorts: 'M88 50H312L336 250L214 262L200 120L186 262L64 250Z',
    pants: 'M108 50H292L300 530L214 536L200 140L186 536L100 530Z',
  };

  function drawRegion(ctx, path, src, sx, sy, sw, sh, dx, dy, dw, dh) {
    ctx.save();
    ctx.clip(new Path2D(path));
    ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.restore();
  }

  function shade(ctx, path, x0, x1) {
    ctx.save();
    ctx.clip(new Path2D(path));
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, 'rgba(0,0,0,.32)');
    g.addColorStop(0.22, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,.06)');
    g.addColorStop(0.78, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.32)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 400, 1200);
    ctx.restore();
  }

  // Paints a flat front or back view of the whole kit onto `canvas`.
  function paintFlat(canvas, s, view, tex, parts) {
    const hasJersey = parts.includes('jersey');
    const bottom = parts.find((p) => p !== 'jersey');
    const bottomH = bottom === 'pants' ? 560 : bottom === 'shorts' ? 290 : 0;
    const overlap = hasJersey && bottom ? 70 : 0;
    const H = (hasJersey ? 480 : 0) + bottomH - overlap + 10;
    const scale = 2;
    canvas.width = 400 * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, 400, H);

    const back = view === 'back';
    if (bottom) {
      const y = hasJersey ? 480 - overlap : 0;
      ctx.save();
      ctx.translate(0, y);
      const path = SIL[bottom];
      // Hip band from the hip texture, legs from the leg textures.
      const legH = bottom === 'pants' ? 500 : 220;
      const hipSrcX = back ? 512 : 0;
      drawRegion(ctx, path, tex.hip, hipSrcX, 0, 512, 256, 60, 30, 280, 110);
      const legL = back ? tex.legR : tex.legL;
      const legR = back ? tex.legL : tex.legR;
      drawRegion(ctx, path, legL, back ? 256 : 0, 0, 256, legL.height, 60, 130, 140, legH);
      drawRegion(ctx, path, legR, back ? 256 : 0, 0, 256, legR.height, 200, 130, 140, legH);
      ctx.fillStyle = s.colors.trim;
      ctx.fill(new Path2D(bottom === 'pants' ? 'M110 30H290L292 52H108Z' : 'M90 30H310L312 52H88Z'));
      shade(ctx, path, bottom === 'pants' ? 100 : 64, bottom === 'pants' ? 300 : 336);
      ctx.restore();
    }

    if (hasJersey) {
      const long = s.sleeve !== 'short';
      const sr = long ? SIL.sleeveRLong : SIL.sleeveRShort;
      const sl = long ? SIL.sleeveLLong : SIL.sleeveLShort;
      // From the front the viewer's right is the wearer's left sleeve.
      drawRegion(ctx, sr, back ? tex.sleeveR : tex.sleeveL, 0, 0, 1024, (back ? tex.sleeveR : tex.sleeveL).height, 290, 70, 100, 270);
      drawRegion(ctx, sl, back ? tex.sleeveL : tex.sleeveR, 0, 0, 1024, (back ? tex.sleeveL : tex.sleeveR).height, 10, 70, 100, 270);
      const torso = back ? SIL.torsoBack : SIL.torsoFront;
      const srcX = back ? 1024 + 110 : 110;
      drawRegion(ctx, torso, tex.torso, srcX, 0, 804, 1024, 96, 50, 208, 402);
      shade(ctx, torso, 96, 304);
      shade(ctx, sr, 290, 380);
      shade(ctx, sl, 20, 110);
      ctx.fillStyle = s.colors.trim;
      if (back) {
        ctx.fill(new Path2D('M165 58Q200 72 235 58L229 55Q200 64 171 55Z'));
      } else {
        ctx.fill(new Path2D('M165 58Q200 92 235 58L228 55Q200 80 172 55Z'));
      }
    }
    return canvas;
  }

  // Tiny preview of a pattern for option tiles.
  function patternThumb(type, colors, size = 72, strength = 'bold') {
    const c = makeCanvas(size * 2, size * 2);
    const ctx = c.getContext('2d');
    ctx.fillStyle = colors.primary;
    ctx.fillRect(0, 0, c.width, c.height);
    if (type !== 'none') {
      ctx.save();
      ctx.scale(0.28, 0.28);
      paintPatternLayer(ctx, 0, 0, c.width / 0.28, c.height / 0.28, type, colors.pattern, 'm', 11, strength === 'tonal' ? 'medium' : strength);
      ctx.restore();
    }
    return c;
  }

  window.A3GKPaint = {
    FONTS,
    PATTERNS,
    STRENGTH,
    makeCanvas,
    paintTorso,
    paintSleeve,
    paintHip,
    paintLeg,
    paintSock,
    paintFlat,
    patternThumb,
    knitCanvas,
    paintDetail,
    drawText,
    drawCrest,
  };
})();
