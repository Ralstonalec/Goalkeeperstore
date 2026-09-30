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
  ];

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
        const n = Math.round(14 / k);
        for (let i = 0; i < n; i++) {
          const cx = x + r() * w;
          const cy = y + r() * h;
          const s = (90 + r() * 160) * k;
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
        ctx.lineWidth = Math.max(2, 3 * k);
        ctx.globalAlpha = 0.9;
        const centres = [0, 1, 2].map(() => [x + r() * w, y + r() * h]);
        for (const [cx, cy] of centres) {
          for (let ring = 1; ring < 9; ring++) {
            ctx.beginPath();
            for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.1) {
              const wob = 1 + 0.18 * Math.sin(a * 3 + ring) + 0.08 * Math.sin(a * 7);
              const rr = ring * 38 * k * wob;
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
        ctx.lineWidth = 16 * k;
        ctx.lineJoin = 'miter';
        const bolts = Math.round(4 / k) + 1;
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
        paintPattern(ctx, 0, 0, W / 2, H, pat.type, c.pattern, pat.scale, 11);
        paintPattern(ctx, W / 2, 0, W / 2, H, pat.type, c.pattern, pat.scale, 23);
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

    return canvas;
  }

  function paintSleeve(canvas, s, side, opts = {}) {
    const W = 1024;
    const H = 512;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const c = s.colors;
    const mode = (s.pattern && s.pattern.sleeves) || 'solid';

    if (mode === 'match') {
      ctx.fillStyle = c.primary;
      ctx.fillRect(0, 0, W, H);
      if (s.pattern.type !== 'none' && s.pattern.type !== 'split') paintPattern(ctx, 0, 0, W, H, s.pattern.type, c.pattern, s.pattern.scale, side === 'l' ? 31 : 37);
    } else {
      ctx.fillStyle = c.secondary;
      ctx.fillRect(0, 0, W, H);
      if (mode === 'pattern' && s.pattern.type !== 'none' && s.pattern.type !== 'split') {
        paintPattern(ctx, 0, 0, W, H, s.pattern.type, c.pattern, s.pattern.scale, side === 'l' ? 41 : 43);
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
      padZone(ctx, outer - 110, 250, 220, 150);
    }
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
    return canvas;
  }

  function paintLeg(canvas, s, side, kind, opts = {}) {
    const W = 512;
    const H = 512;
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
      drawText(ctx, s.number.value, 92, kind === 'pants' ? 110 : 250, kind === 'pants' ? 70 : 120, {
        font: s.number.font,
        color: c.number,
        outline: c.outline,
        bridge: bottomsColour(s),
      });
    }
    if (opts.padding && opts.zones) {
      const z = opts.zones;
      if (kind === 'pants') {
        if (z.includes('thigh')) padZone(ctx, outer - 70, 40, 140, 120);
        if (z.includes('knee')) {
          // The front of the leg sits on the texture seam (x=0 / x=512).
          padZone(ctx, -80, 190, 160, 110);
          padZone(ctx, W - 80, 190, 160, 110);
        }
      } else if (z.includes('thigh')) {
        padZone(ctx, outer - 80, 150, 160, 220);
      }
    }
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
      drawRegion(ctx, path, legL, back ? 256 : 0, 0, 256, 512, 60, 130, 140, legH);
      drawRegion(ctx, path, legR, back ? 256 : 0, 0, 256, 512, 200, 130, 140, legH);
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
      drawRegion(ctx, sr, back ? tex.sleeveR : tex.sleeveL, 0, 0, 1024, 512, 290, 70, 100, 270);
      drawRegion(ctx, sl, back ? tex.sleeveL : tex.sleeveR, 0, 0, 1024, 512, 10, 70, 100, 270);
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
  function patternThumb(type, colors, size = 72) {
    const c = makeCanvas(size * 2, size * 2);
    const ctx = c.getContext('2d');
    ctx.fillStyle = colors.primary;
    ctx.fillRect(0, 0, c.width, c.height);
    if (type !== 'none') {
      ctx.save();
      ctx.scale(0.28, 0.28);
      paintPattern(ctx, 0, 0, c.width / 0.28, c.height / 0.28, type, colors.pattern, 'm', 11);
      ctx.restore();
    }
    return c;
  }

  window.A3GKPaint = {
    FONTS,
    PATTERNS,
    makeCanvas,
    paintTorso,
    paintSleeve,
    paintHip,
    paintLeg,
    paintSock,
    paintFlat,
    patternThumb,
    knitCanvas,
    drawText,
    drawCrest,
  };
})();
