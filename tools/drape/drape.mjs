/*
  A3GK garment drape baker.

  Builds keeper kit garments the way 3D fashion tools do: flat pattern
  panels at real measurements, stitched together and draped over an
  invisible mannequin with a position-based cloth simulation (gravity,
  seams, stretch/shear/bend stiffness, body collision). The draped meshes
  are baked to assets/a3gk-kit-meshes.js, which the 3D designer loads.

  Units: centimetres. y = 0 at the crotch, +z is the front of the body.
  Run: node tools/drape/drape.mjs   (takes a minute or two)
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/* ---------------- math ---------------- */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function smin(a, b, k) {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}
function keyed(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    if (t <= t1) {
      const e = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * e * e * (3 - 2 * e);
    }
  }
  return keys[keys.length - 1][1];
}
const deg = Math.PI / 180;

/* ---------------- mannequin (adult M) ---------------- */

const BODY = {
  torsoRx: [[-2, 16.5], [8, 18], [28, 15], [45, 17.5], [52, 18], [56, 17], [60, 14], [63, 10], [66, 6.5], [70, 6]],
  torsoRz: [[-2, 11], [8, 12], [28, 11], [45, 12.5], [52, 12], [56, 10.5], [60, 8.5], [63, 7], [66, 6], [70, 6]],
  shoulder: { x: 17.8, y: 56.5, r: 5.4 },
  arm: { x: 19, y: 57, angle: 27 * deg, len: 62, r: [[0, 5.3], [25, 4.4], [30, 4.1], [55, 3.2], [62, 3.2]] },
  leg: { x: 9.6, y: 3, angle: 3 * deg, len: 88, r: [[0, 9.6], [30, 7], [42, 6], [58, 6.4], [80, 3.8], [88, 3.8]] },
};

function limb(x, y, z, ox, oy, angle, len, prof, zs = 0.95) {
  // Tapered limb hanging from a joint at (ox, oy), angled outward.
  const sg = Math.sign(ox) || 1;
  const ddx = sg * Math.sin(angle);
  const ddy = -Math.cos(angle);
  const dx = x - ox;
  const dy = y - oy;
  const along = dx * ddx + dy * ddy;
  const px = dx - ddx * along;
  const py = dy - ddy * along;
  const r = keyed(prof, clamp(along, 0, len));
  const radial = Math.hypot(px, py, z / zs) - r;
  return Math.max(radial, along - len, -along - 1);
}

function bodySdf(x, y, z) {
  const rx = keyed(BODY.torsoRx, y);
  const rz = keyed(BODY.torsoRz, y);
  let torso = (Math.hypot(x / rx, z / rz) - 1) * Math.min(rx, rz);
  torso = Math.max(torso, y - 76, -y - 4);
  const neck = Math.max(Math.hypot(x, z * 1.1) - 6, y - 80, 58 - y);
  let d = smin(torso, neck, 3);
  for (const s of [1, -1]) {
    const sh = BODY.shoulder;
    const ball = Math.hypot(x - s * sh.x, y - sh.y, z * 1.05) - sh.r;
    d = smin(d, ball, 3.5);
    const a = BODY.arm;
    d = smin(d, limb(x, y, z, s * a.x, a.y, a.angle, a.len, a.r), 2.2);
    const l = BODY.leg;
    d = smin(d, limb(x, y, z, s * l.x, l.y, l.angle, l.len, l.r, 0.92), 2.5);
  }
  return d;
}

function bodyGrad(x, y, z) {
  const e = 0.05;
  const gx = bodySdf(x + e, y, z) - bodySdf(x - e, y, z);
  const gy = bodySdf(x, y + e, z) - bodySdf(x, y - e, z);
  const gz = bodySdf(x, y, z + e) - bodySdf(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}

/* ---------------- cloth ---------------- */

class Cloth {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.group = [];
    this.edges = []; // [a, b, rest, stiffness]
    this.sews = []; // [a, b]
    this.tris = []; // [a, b, c]
    this.tubes = [];
  }

  // A tube of cloth: nu columns around (periodic), nv rows along.
  // place(fu, fv) -> [x,y,z] initial (rest) position; keep(p, iu, iv) -> bool
  // reuse(iu, iv) -> index of an existing particle to share (welded edge), or -1.
  tube({ nu, nv, place, keep = () => true, uvOf, group, reuse = () => -1 }) {
    const idx = [];
    const local = []; // this piece's own pattern positions (rest shape)
    this.uvG = this.uvG || new Map();
    for (let iv = 0; iv < nv; iv++) {
      idx.push([]);
      for (let iu = 0; iu < nu; iu++) {
        local[iv] = local[iv] || [];
        local[iv][iu] = place(iu / nu, iv / (nv - 1));
        const shared = reuse(iu, iv);
        if (shared >= 0) {
          idx[iv].push(shared);
          this.uvG.set(`${shared}:${group}`, uvOf(iu / nu, iv / (nv - 1)));
          continue;
        }
        const p = local[iv][iu].slice();
        if (!keep(p, iu, iv)) {
          idx[iv].push(-1);
          continue;
        }
        idx[iv].push(this.pos.length);
        this.pos.push(p);
        this.uv.push(uvOf(iu / nu, iv / (nv - 1)));
        this.group.push(group);
      }
    }
    const at = (iu, iv) => (iv < 0 || iv >= nv ? -1 : idx[iv][((iu % nu) + nu) % nu]);
    // Rest lengths come from this piece's own pattern, not from wherever a
    // welded (shared) point happens to sit on another piece.
    const link = (a, b, k, la, lb) => {
      if (a < 0 || b < 0 || !la || !lb) return;
      this.edges.push([a, b, Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]), k]);
    };
    const L = (iu, iv) => (iv < 0 || iv >= nv ? null : local[iv][((iu % nu) + nu) % nu]);
    for (let iv = 0; iv < nv; iv++)
      for (let iu = 0; iu < nu; iu++) {
        const a = at(iu, iv);
        if (a < 0) continue;
        const la = L(iu, iv);
        link(a, at(iu + 1, iv), 1, la, L(iu + 1, iv));
        link(a, at(iu, iv + 1), 1, la, L(iu, iv + 1));
        link(a, at(iu + 1, iv + 1), 0.6, la, L(iu + 1, iv + 1));
        link(a, at(iu + 1, iv - 1), 0.6, la, L(iu + 1, iv - 1));
        link(a, at(iu + 2, iv), 0.35, la, L(iu + 2, iv));
        link(a, at(iu, iv + 2), 0.35, la, L(iu, iv + 2));
        // Triangles (with per-corner uv wrap handled at export).
        const b = at(iu + 1, iv);
        const c = at(iu + 1, iv + 1);
        const d = at(iu, iv + 1);
        const cells = [a, b, c, d];
        const present = cells.filter((v) => v >= 0).length;
        if (present === 4) {
          this.tris.push([a, b, c, iu === nu - 1, group]);
          this.tris.push([a, c, d, iu === nu - 1, group]);
        } else if (present === 3) {
          const t = cells.filter((v) => v >= 0);
          this.tris.push([t[0], t[1], t[2], iu === nu - 1, group]);
        }
      }
    const t = { nu, nv, idx, at };
    this.tubes.push(t);
    return t;
  }

  sew(a, b) {
    if (a >= 0 && b >= 0) this.sews.push([a, b]);
  }

  // Sew two polylines together along their length (by arc-length fraction).
  sewLines(A, B) {
    const frac = (L) => {
      const out = [0];
      for (let i = 1; i < L.length; i++) {
        const p = this.pos[L[i]];
        const q = this.pos[L[i - 1]];
        out.push(out[i - 1] + Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
      }
      const T = out[out.length - 1] || 1;
      return out.map((v) => v / T);
    };
    const fa = frac(A);
    const fb = frac(B);
    const nearest = (f, fl) => {
      let best = 0;
      for (let i = 1; i < fl.length; i++) if (Math.abs(fl[i] - f) < Math.abs(fl[best] - f)) best = i;
      return best;
    };
    (this.seams || (this.seams = [])).push([A.slice(), B.slice(), fa, fb]);
    A.forEach((a, i) => this.sew(a, B[nearest(fa[i], fb)]));
    B.forEach((b, i) => this.sew(A[nearest(fb[i], fa)], b));
  }

  simulate({ steps = 700, iters = 14, gravity = 981, dt = 1 / 90, thickness = 0.45, log = '', onStep = null }) {
    const n = this.pos.length;
    const P = new Float64Array(n * 3);
    const Q = new Float64Array(n * 3);
    this.pos.forEach((p, i) => {
      P.set(p, i * 3);
      Q.set(p, i * 3);
    });
    const E = this.edges;
    const S = this.sews;
    const collide = (friction) => {
      for (let i = 0; i < n; i++) {
        const x = P[i * 3];
        const y = P[i * 3 + 1];
        const z = P[i * 3 + 2];
        const d = bodySdf(x, y, z);
        if (d < thickness) {
          const g = bodyGrad(x, y, z);
          const push = thickness - d;
          P[i * 3] += g[0] * push;
          P[i * 3 + 1] += g[1] * push;
          P[i * 3 + 2] += g[2] * push;
          // Static friction: cancel this step's sliding along the body surface.
          const mx = P[i * 3] - Q[i * 3];
          const my = P[i * 3 + 1] - Q[i * 3 + 1];
          const mz = P[i * 3 + 2] - Q[i * 3 + 2];
          const mn = mx * g[0] + my * g[1] + mz * g[2];
          P[i * 3] -= (mx - g[0] * mn) * friction;
          P[i * 3 + 1] -= (my - g[1] * mn) * friction;
          P[i * 3 + 2] -= (mz - g[2] * mn) * friction;
        }
      }
    };
    const G = this.group;
    const neighbours = new Set();
    for (const [a, b] of E.map((e) => [e[0], e[1]])) neighbours.add(a * 100000 + b).add(b * 100000 + a);
    for (const [a, b] of S) neighbours.add(a * 100000 + b).add(b * 100000 + a);
    const repel = (minD) => {
      const cell = minD;
      const hash = new Map();
      for (let i = 0; i < n; i++) {
        const k = `${Math.floor(P[i * 3] / cell)},${Math.floor(P[i * 3 + 1] / cell)},${Math.floor(P[i * 3 + 2] / cell)}`;
        let l = hash.get(k);
        if (!l) hash.set(k, (l = []));
        l.push(i);
      }
      for (let i = 0; i < n; i++) {
        const cx = Math.floor(P[i * 3] / cell);
        const cy = Math.floor(P[i * 3 + 1] / cell);
        const cz = Math.floor(P[i * 3 + 2] / cell);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++) {
              const l = hash.get(`${cx + dx},${cy + dy},${cz + dz}`);
              if (!l) continue;
              for (const j of l) {
                if (j <= i || (G[i] === G[j] && Math.abs(i - j) < 400)) continue;
                if (neighbours.has(i * 100000 + j)) continue;
                const ex = P[j * 3] - P[i * 3];
                const ey = P[j * 3 + 1] - P[i * 3 + 1];
                const ez = P[j * 3 + 2] - P[i * 3 + 2];
                const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
                if (d >= minD || d < 1e-6) continue;
                const c = (0.5 * (minD - d)) / d;
                P[i * 3] -= ex * c;
                P[i * 3 + 1] -= ey * c;
                P[i * 3 + 2] -= ez * c;
                P[j * 3] += ex * c;
                P[j * 3 + 1] += ey * c;
                P[j * 3 + 2] += ez * c;
              }
            }
      }
    };
    for (let step = 0; step < steps; step++) {
      const phase = step / steps;
      const g = gravity * clamp((phase - 0.18) / 0.12, 0, 1); // seams close first, then gravity
      const sewK = clamp(phase / 0.2, 0.02, 1) * 0.9;
      const damp = phase < 0.3 ? 0.9 : 0.97;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        for (let k = 0; k < 3; k++) {
          const v = (P[o + k] - Q[o + k]) * damp;
          Q[o + k] = P[o + k];
          P[o + k] += v;
        }
        P[o + 1] -= g * dt * dt;
      }
      for (let it = 0; it < iters; it++) {
        for (let e = 0; e < E.length; e++) {
          const [a, b, rest, k] = E[e];
          const ax = a * 3;
          const bx = b * 3;
          const dx = P[bx] - P[ax];
          const dy = P[bx + 1] - P[ax + 1];
          const dz = P[bx + 2] - P[ax + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
          // Cloth barely stretches but compresses freely (it buckles into folds).
          let diff = (d - rest) / d;
          if (diff < 0) diff *= 0.75; // pressed sample garment: resists crumpling
          const c = 0.5 * k * diff;
          P[ax] += dx * c;
          P[ax + 1] += dy * c;
          P[ax + 2] += dz * c;
          P[bx] -= dx * c;
          P[bx + 1] -= dy * c;
          P[bx + 2] -= dz * c;
        }
        for (let s = 0; s < S.length; s++) {
          const ax = S[s][0] * 3;
          const bx = S[s][1] * 3;
          for (let k = 0; k < 3; k++) {
            const m = (P[bx + k] - P[ax + k]) * 0.5 * sewK;
            P[ax + k] += m;
            P[bx + k] -= m;
          }
        }
        collide(0.6);
      }
      // Panels can't pass through each other (sleeve vs body at the armpit, legs).
      if (phase > 0.15) {
        repel(1.3);
        repel(1.3);
      }
      // Strain limiting: woven/knit kit fabric barely stretches (~3%).
      for (let pass = 0; pass < 3; pass++) {
        for (let e = 0; e < E.length; e++) {
          const [a, b, rest, k] = E[e];
          if (k < 1) continue;
          const ax = a * 3;
          const bx = b * 3;
          const dx = P[bx] - P[ax];
          const dy = P[bx + 1] - P[ax + 1];
          const dz = P[bx + 2] - P[ax + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
          const max = rest * 1.03;
          if (d <= max) continue;
          const c = (0.5 * (d - max)) / d;
          P[ax] += dx * c;
          P[ax + 1] += dy * c;
          P[ax + 2] += dz * c;
          P[bx] -= dx * c;
          P[bx + 1] -= dy * c;
          P[bx + 2] -= dz * c;
        }
        collide(0.8);
      }
      if (onStep) onStep(step, P);
      if (log && step % 100 === 0) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < n; i++) {
          lo = Math.min(lo, P[i * 3 + 1]);
          hi = Math.max(hi, P[i * 3 + 1]);
        }
        process.stdout.write(`${log} ${step}/${steps} y ${lo.toFixed(1)}..${hi.toFixed(1)}\n`);
      }
    }
    if (log) process.stdout.write(`${log} done          \n`);
    // Close the seams exactly.
    for (let pass = 0; pass < 4; pass++)
      for (const [a, b] of S)
        for (let k = 0; k < 3; k++) {
          const m = (P[b * 3 + k] + P[a * 3 + k]) / 2;
          P[a * 3 + k] = m;
          P[b * 3 + k] = m;
        }
    this.out = P;
  }
}

/* ---------------- helpers ---------------- */

// Points around an ellipse at even arc length. u: 0 = -x side, .25 front, .5 +x, .75 back
function ellipseTable(rx, rz, m = 720) {
  const pts = [];
  let L = 0;
  const acc = [0];
  for (let i = 0; i <= m; i++) {
    const t = (i / m) * Math.PI * 2;
    pts.push([-rx * Math.cos(t), rz * Math.sin(t)]);
    if (i) {
      L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      acc.push(L);
    }
  }
  return (u) => {
    const target = u * L;
    let i = 1;
    while (i < acc.length - 1 && acc[i] < target) i++;
    const f = (target - acc[i - 1]) / (acc[i] - acc[i - 1] || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
  };
}

/* ---------------- jersey ---------------- */

// Fabric resolution in cm (particle spacing). Finer = sharper folds, slower bake.
const DS = Number(process.env.DRAPE_DS || 1.1);
// Nearest n with n % 4 === 2 (keeps front/back centre seams on whole columns).
const ring2 = (n) => Math.max(6, Math.round((n - 2) / 4) * 4 + 2);

function buildJersey({ long }) {
  const cloth = new Cloth();
  const ds = DS;
  const HEM = -6;
  const TOP = 67;
  const circ = 104;
  const nu = Math.round(circ / ds / 2) * 2;
  const nv = Math.round((TOP - HEM) / ds) + 1;
  const ell = ellipseTable(19.8, 13.6);
  const NECK_W = 7.8;
  const ARM_X = 15.6;
  const ARMPIT = 48.5;
  const topAt = (x, z) => {
    const ax = Math.abs(x);
    if (ax <= NECK_W) {
      const k = Math.sqrt(Math.max(0, 1 - (ax / NECK_W) ** 2));
      return z > 0 ? 66.5 - 8.5 * k : 66.5 - 2.2 * k;
    }
    return 66.5 - 0.36 * (ax - NECK_W);
  };
  // Rounded armhole (a real armscye is a smooth curve, not a box).
  const armholeCut = (x, y) => {
    const ax = Math.abs(x);
    if (y <= ARMPIT) return false;
    const t = clamp((y - ARMPIT) / 9, 0, 1);
    const edge = ARM_X - 4 + 4 * Math.sqrt(1 - (1 - t) * (1 - t));
    return ax > edge;
  };
  const torso = cloth.tube({
    nu,
    nv,
    group: 0,
    place: (fu, fv) => {
      const [x, z] = ell(fu);
      return [x, HEM + fv * (TOP - HEM), z];
    },
    keep: ([x, y, z]) => !armholeCut(x, y) && y <= topAt(x, z) + 0.01,
    uvOf: (fu, fv) => [fu, fv],
  });

  // Shoulder seams: each front column's top point to its mirror on the back.
  const topOf = (iu) => {
    for (let iv = torso.nv - 1; iv >= 0; iv--) if (torso.idx[iv][iu] >= 0) return torso.idx[iv][iu];
    return -1;
  };
  const colX = (iu) => ell(iu / nu)[0];
  const colZ = (iu) => ell(iu / nu)[1];
  const shoulderCols = { 1: [], [-1]: [] };
  for (let iu = 0; iu < nu; iu++) {
    const x = colX(iu);
    const z = colZ(iu);
    if (z <= 0 || Math.abs(x) <= NECK_W || Math.abs(x) > ARM_X) continue;
    const back = (nu - iu) % nu;
    cloth.sew(topOf(iu), topOf(back));
    shoulderCols[Math.sign(x)].push(iu);
  }

  // Neck opening ring (for the collar band), ordered around the neck.
  const neckCols = [];
  for (let iu = 0; iu < nu; iu++) if (Math.abs(colX(iu)) <= NECK_W + ds) neckCols.push(iu);
  neckCols.sort((a, b) => Math.atan2(colX(a), colZ(a)) - Math.atan2(colX(b), colZ(b)));
  cloth.neckRing = neckCols.map(topOf).filter((p) => p >= 0);

  // Sleeves.
  const lenS = long ? 61 : 23;
  for (const s of [1, -1]) {
    // Armhole loop: every kept particle bordering the armhole cut-out on this
    // side, ordered from the front shoulder, down round the armpit, up to the back.
    const placeAt = (iu, iv) => {
      const [x, z] = ell((((iu % nu) + nu) % nu) / nu);
      return [x, HEM + (iv / (nv - 1)) * (TOP - HEM), z];
    };
    const inArmhole = ([x, y]) => armholeCut(x, y);
    const boundary = [];
    for (let iv = 0; iv < nv; iv++)
      for (let iu = 0; iu < nu; iu++) {
        const p = torso.idx[iv][iu];
        if (p < 0 || Math.sign(colX(iu)) !== s) continue;
        const nb = [[iu + 1, iv], [iu - 1, iv], [iu, iv + 1], [iu, iv - 1]];
        if (nb.some(([u2, v2]) => v2 >= 0 && v2 < nv && torso.at(u2, v2) < 0 && inArmhole(placeAt(u2, v2)))) boundary.push(p);
      }
    const cy = ARMPIT + 10;
    const angleOf = (p) => Math.atan2(cloth.pos[p][2], cy - cloth.pos[p][1]);
    const loop = boundary.sort((p, q) => angleOf(q) - angleOf(p));

    const a = BODY.arm;
    const ang = a.angle;
    const d = [s * Math.sin(ang), -Math.cos(ang), 0];
    const X = [Math.cos(ang), s * Math.sin(ang), 0]; // +x-ish, perpendicular to the arm
    const J = [s * (a.x + 0.5), a.y + 1.5, 0];
    // Sleeve cap is cut to the armhole's length so the seam sits flat (no gathering).
    let loopLen = 0;
    for (let k = 0; k < loop.length; k++) {
      const a = cloth.pos[loop[k]];
      const b = cloth.pos[loop[(k + 1) % loop.length]];
      loopLen += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    }
    const capC = clamp(loopLen * 0.98, 44, 56);
    const circAt = long
      ? (t) => keyed([[0, capC], [10, 40], [30, 35], [48, 28], [lenS, 24]], t)
      : (t) => keyed([[0, capC], [10, 40], [lenS, 38]], t);
    // The sleeve cap shares the armhole's own points (welded), so the seam
    // can't open or fray. One sleeve column per armhole point.
    const snu = loop.length;
    const snv = Math.round(lenS / ds) + 1;
    const top = Math.round(snu * (s > 0 ? 0.25 : 0.75));
    const capWeld = (iu) => {
      const k = s > 0 ? (((top - iu) % snu) + snu) % snu : (((iu - top) % snu) + snu) % snu;
      return loop[k];
    };
    cloth.tube({
      nu: snu,
      nv: snv,
      group: s > 0 ? 1 : 2,
      reuse: (iu, iv) => (iv === 0 ? capWeld(iu) : -1),
      place: (fu, fv) => {
        const t = fv * lenS;
        const r = circAt(t) / (2 * Math.PI) + 1.2;
        const sa = Math.sin(2 * Math.PI * fu);
        const ca = Math.cos(2 * Math.PI * fu);
        return [J[0] + d[0] * t + r * (sa * X[0]), J[1] + d[1] * t + r * sa * X[1], r * ca];
      },
      uvOf: (fu, fv) => [fu, 1 - fv],
    });
  }
  return cloth;
}

/* ---------------- shorts & pants ---------------- */

function buildBottoms({ pants }) {
  const cloth = new Cloth();
  const ds = DS;
  const TOP = 28;
  const CROTCH = -1;
  const legLen = pants ? 79 : 15;
  // Hip/waist tube with an elastic waist.
  // Fitted under the jersey: the part hidden by the jersey hugs the body.
  // Seat to elastic waist (the waistband gathers the waist in).
  const hipCirc = (y) => keyed([[CROTCH, 108], [4, 106], [12, 102], [22, 92], [TOP, 86]], y);
  const nu = ring2(110 / ds);
  const nv = Math.round((TOP - CROTCH) / ds) + 1;
  const hip = cloth.tube({
    nu,
    nv,
    group: 0,
    place: (fu, fv) => {
      const y = CROTCH + fv * (TOP - CROTCH);
      const c = hipCirc(y);
      const k = c / 110;
      const [x, z] = ellipseTable(20.4 * k, 14.2 * k)(fu);
      return [x, y, z];
    },
    uvOf: (fu, fv) => [fu, fv],
  });
  const L = BODY.leg;
  const legs = {};
  for (const s of [1, -1]) {
    const ang = L.angle * 1.4;
    const d = [s * Math.sin(ang), -Math.cos(ang), 0];
    const X = [Math.cos(ang), s * Math.sin(ang), 0];
    const O = [s * 10.2, CROTCH, 0];
    const circAt = pants ? (t) => keyed([[0, 66], [30, 50], [45, 44], [legLen, 34]], t) : (t) => keyed([[0, 66], [legLen, 63]], t);
    const lnu = ring2(66 / ds);
    const lnv = Math.round(legLen / ds) + 1;
    // Weld the leg tops to the hip (outer arc) and to the other leg (crotch),
    // so these pieces share edge points and can't open at the seam.
    const half = nu / 2;
    const inner = lnu - half;
    const hipStart = nu / 4 - 0.5 + (s > 0 ? 0 : half);
    const legStart = (s > 0 ? lnu / 4 : (3 * lnu) / 4) - half / 2;
    const weld = new Map();
    for (let k = 0; k <= half; k++)
      weld.set((((legStart + k) % lnu) + lnu) % lnu, hip.idx[0][(((hipStart + k) % nu) + nu) % nu]);
    if (s < 0)
      for (let k = 1; k < inner; k++) {
        const rCol = (((lnu / 4 - half / 2 + half + k) % lnu) + lnu) % lnu;
        weld.set((((legStart - k) % lnu) + lnu) % lnu, legs[1].idx[0][rCol]);
      }
    legs[s] = cloth.tube({
      nu: lnu,
      nv: lnv,
      group: s > 0 ? 1 : 2,
      reuse: (iu, iv) => (iv === 0 && weld.has(iu) ? weld.get(iu) : -1),
      place: (fu, fv) => {
        const t = fv * legLen;
        const r = circAt(t) / (2 * Math.PI) + 0.8;
        const sa = Math.sin(2 * Math.PI * fu);
        const ca = Math.cos(2 * Math.PI * fu);
        return [O[0] + d[0] * t + r * sa * X[0], O[1] + d[1] * t + r * sa * X[1], r * ca * 0.92];
      },
      uvOf: (fu, fv) => [fu, 1 - fv],
    });
    legs[s].nu = lnu;
  }
  // Hip bottom half → each leg's outer arc; the legs' inner arcs → each other (crotch/inseam).
  const hipRow = (u0, u1) => {
    const out = [];
    const steps = Math.round(Math.abs(u1 - u0) * nu);
    for (let k = 0; k <= steps; k++) {
      const u = u0 + ((u1 - u0) * k) / steps;
      out.push(hip.idx[0][Math.round((((u % 1) + 1) % 1) * nu) % nu]);
    }
    return out;
  };
  const legRow = (s, u0, u1) => {
    const t = legs[s];
    const out = [];
    const steps = Math.round(Math.abs(u1 - u0) * t.nu);
    for (let k = 0; k <= steps; k++) {
      const u = u0 + ((u1 - u0) * k) / steps;
      out.push(t.idx[0][Math.round((((u % 1) + 1) % 1) * t.nu) % t.nu]);
    }
    return out;
  };
  // Real shorts pattern: each leg's top is ~82% outer arc (sewn to that half
  // of the hip) and ~18% crotch extension (sewn to the other leg's).
  // Leg u: 0 front, .25 +x, .5 back, .75 -x. Hip u: .25 front, .5 +x, .75 back.
  // (Leg tops are welded to the hip and to each other above; no sewing needed.)
  return cloth;
}


/* ---------------- baked ambient occlusion (cloth on cloth) ---------------- */

function computeAO(pos, index, { rays = 24, reach = 0.5 } = {}) {
  // pos in scene units. Uniform grid over triangles for ray casting.
  const nV = pos.length / 3;
  const nT = index.length / 3;
  const nrm = new Float32Array(pos.length);
  for (let t = 0; t < nT; t++) {
    const [a, b, c] = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      nrm[v * 3] += fx;
      nrm[v * 3 + 1] += fy;
      nrm[v * 3 + 2] += fz;
    }
  }
  for (let v = 0; v < nV; v++) {
    const l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]) || 1;
    nrm[v * 3] /= l;
    nrm[v * 3 + 1] /= l;
    nrm[v * 3 + 2] /= l;
  }
  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], pos[i + k]);
      mx[k] = Math.max(mx[k], pos[i + k]);
    }
  const cell = 0.12;
  const dims = [0, 1, 2].map((k) => Math.max(1, Math.ceil((mx[k] - mn[k]) / cell) + 1));
  const grid = new Map();
  for (let t = 0; t < nT; t++) {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let j = 0; j < 3; j++) {
      const v = index[t * 3 + j];
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], pos[v * 3 + k]);
        hi[k] = Math.max(hi[k], pos[v * 3 + k]);
      }
    }
    const a = lo.map((v, k) => Math.floor((v - mn[k]) / cell));
    const b = hi.map((v, k) => Math.floor((v - mn[k]) / cell));
    for (let x = a[0]; x <= b[0]; x++)
      for (let y = a[1]; y <= b[1]; y++)
        for (let z = a[2]; z <= b[2]; z++) {
          const key = x + dims[0] * (y + dims[1] * z);
          let list = grid.get(key);
          if (!list) grid.set(key, (list = []));
          list.push(t);
        }
  }
  const hit = (o, d, skip) => {
    // March the grid; test triangles in each visited cell (Möller–Trumbore).
    const stepLen = cell * 0.5;
    const seen = new Set();
    for (let s = stepLen * 0.5; s <= reach; s += stepLen) {
      const p = [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s];
      const c = p.map((v, k) => Math.floor((v - mn[k]) / cell));
      if (c.some((v, k) => v < 0 || v >= dims[k])) return false;
      const list = grid.get(c[0] + dims[0] * (c[1] + dims[1] * c[2]));
      if (!list) continue;
      for (const t of list) {
        if (seen.has(t)) continue;
        seen.add(t);
        const ia = index[t * 3], ib = index[t * 3 + 1], ic = index[t * 3 + 2];
        if (ia === skip || ib === skip || ic === skip) continue;
        const e1 = [pos[ib * 3] - pos[ia * 3], pos[ib * 3 + 1] - pos[ia * 3 + 1], pos[ib * 3 + 2] - pos[ia * 3 + 2]];
        const e2 = [pos[ic * 3] - pos[ia * 3], pos[ic * 3 + 1] - pos[ia * 3 + 1], pos[ic * 3 + 2] - pos[ia * 3 + 2]];
        const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
        const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
        if (Math.abs(det) < 1e-9) continue;
        const inv = 1 / det;
        const tv = [o[0] - pos[ia * 3], o[1] - pos[ia * 3 + 1], o[2] - pos[ia * 3 + 2]];
        const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv;
        if (u < 0 || u > 1) continue;
        const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
        const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) * inv;
        if (v < 0 || u + v > 1) continue;
        const dist = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv;
        if (dist > 0.004 && dist < reach) return true;
      }
    }
    return false;
  };
  // Fixed hemisphere directions (cosine-weighted, golden spiral).
  const dirs = [];
  for (let i = 0; i < rays; i++) {
    const r = Math.sqrt((i + 0.5) / rays);
    const th = i * 2.399963;
    dirs.push([r * Math.cos(th), r * Math.sin(th), Math.sqrt(1 - r * r)]);
  }
  const ao = new Uint8Array(nV);
  for (let v = 0; v < nV; v++) {
    const n = [nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]];
    const t1 = Math.abs(n[0]) < 0.9 ? [0, -n[2], n[1]] : [-n[2], 0, n[0]];
    const l1 = Math.hypot(...t1);
    const T = t1.map((x) => x / l1);
    const B = [n[1] * T[2] - n[2] * T[1], n[2] * T[0] - n[0] * T[2], n[0] * T[1] - n[1] * T[0]];
    const o = [pos[v * 3] + n[0] * 0.004, pos[v * 3 + 1] + n[1] * 0.004, pos[v * 3 + 2] + n[2] * 0.004];
    let open = 0;
    for (const [a, b, c] of dirs) {
      const d = [T[0] * a + B[0] * b + n[0] * c, T[1] * a + B[1] * b + n[1] * c, T[2] * a + B[2] * b + n[2] * c];
      if (!hit(o, d, v)) open++;
    }
    const f = open / rays;
    ao[v] = Math.round(255 * clamp(0.3 + 0.7 * f, 0, 1));
  }
  return ao;
}

/* ---------------- export ---------------- */

const UNIT = 26; // scene unit in cm
const Y0 = -6; // jersey hem at scene y = 0

// Taubin smoothing (shrink-free): irons out simulation noise, keeps the drape.
function smoothCloth(cloth, iterations = 6) {
  const P = cloth.out;
  const n = cloth.pos.length;
  const nb = Array.from({ length: n }, () => []);
  for (const [a, b, , k] of cloth.edges) {
    if (k < 1) continue;
    nb[a].push(b);
    nb[b].push(a);
  }
  const step = (f) => {
    const Q = Float64Array.from(P);
    for (let i = 0; i < n; i++) {
      const l = nb[i];
      if (l.length < 3) continue; // keep borders (hems, cuffs, neck) crisp
      let x = 0;
      let y = 0;
      let z = 0;
      for (const j of l) {
        x += Q[j * 3];
        y += Q[j * 3 + 1];
        z += Q[j * 3 + 2];
      }
      x /= l.length;
      y /= l.length;
      z /= l.length;
      P[i * 3] += (x - Q[i * 3]) * f;
      P[i * 3 + 1] += (y - Q[i * 3 + 1]) * f;
      P[i * 3 + 2] += (z - Q[i * 3 + 2]) * f;
    }
    for (const [a, b] of cloth.sews)
      for (let k = 0; k < 3; k++) {
        const m = (P[a * 3 + k] + P[b * 3 + k]) / 2;
        P[a * 3 + k] = m;
        P[b * 3 + k] = m;
      }
  };
  for (let it = 0; it < iterations; it++) {
    step(0.5);
    step(-0.53);
  }
}

function exportCloth(cloth) {
  smoothCloth(cloth);
  const P = cloth.out;
  const n = cloth.pos.length;
  // Vertices are split per triangle corner only where the u wrap needs it.
  const verts = [];
  const key = new Map();
  const uvFor = (i, g) => ((cloth.uvG && cloth.uvG.get(`${i}:${g}`)) || cloth.uv[i]);
  const vid = (i, wrap, g = cloth.group[i]) => {
    const k = `${i}:${g}${wrap ? 'w' : ''}`;
    if (key.has(k)) return key.get(k);
    const uv = uvFor(i, g).slice();
    if (wrap && uv[0] < 0.5) uv[0] += 1;
    verts.push({ i, uv, g });
    key.set(k, verts.length - 1);
    return verts.length - 1;
  };
  const groups = [[], [], []];
  for (let [a, b, c, edge, tg] of cloth.tris) {
    const g = tg ?? cloth.group[a];
    // Face away from the body so the fabric side is outside.
    const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]];
    const pb = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]];
    const pc = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const fn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const cen = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
    const out = bodyGrad(cen[0], cen[1], cen[2]);
    if (fn[0] * out[0] + fn[1] * out[1] + fn[2] * out[2] < 0) [b, c] = [c, b];
    const us = [a, b, c].map((i) => uvFor(i, g)[0]);
    const wrap = Math.max(...us) - Math.min(...us) > 0.5;
    groups[g].push([vid(a, wrap && us[0] < 0.5, g), vid(b, wrap && us[1] < 0.5, g), vid(c, wrap && us[2] < 0.5, g)]);
  }
  void n;
  // Seam fill: zip each sewn pair of edges together with thin strips so
  // pieces with different stitch spacing leave no notches. B-side corners
  // borrow the UV of their A-side partner (the strips are hairline-thin).
  const extra = (i, uv, g) => {
    verts.push({ i, uv, g });
    return verts.length - 1;
  };
  for (const [A, B, fa, fb] of cloth.seams || []) {
    const g = cloth.group[A[0]];
    const partner = (fbj) => {
      let best = 0;
      for (let k = 1; k < fa.length; k++) if (Math.abs(fa[k] - fbj) < Math.abs(fa[best] - fbj)) best = k;
      return A[best];
    };
    const bv = B.map((b, j) => extra(b, cloth.uv[partner(fb[j])].slice(), g));
    const av = A.map((a) => extra(a, cloth.uv[a].slice(), g));
    let i = 0;
    let j = 0;
    while (i < A.length - 1 || j < B.length - 1) {
      const advanceA = j >= B.length - 1 || (i < A.length - 1 && fa[i + 1] <= fb[j + 1]);
      if (advanceA) {
        groups[g].push([av[i], av[i + 1], bv[j]]);
        groups[g].push([av[i], bv[j], av[i + 1]]);
        i++;
      } else {
        groups[g].push([av[i], bv[j + 1], bv[j]]);
        groups[g].push([av[i], bv[j], bv[j + 1]]);
        j++;
      }
    }
  }
  const pos = new Float32Array(verts.length * 3);
  const uv = new Float32Array(verts.length * 2);
  verts.forEach((v, k) => {
    pos[k * 3] = P[v.i * 3] / UNIT;
    pos[k * 3 + 1] = (P[v.i * 3 + 1] - Y0) / UNIT;
    pos[k * 3 + 2] = P[v.i * 3 + 2] / UNIT;
    uv[k * 2] = v.uv[0];
    uv[k * 2 + 1] = v.uv[1];
  });
  const index = [];
  const ranges = [];
  groups.forEach((list, gi) => {
    const start = index.length;
    list.forEach((t) => index.push(...t));
    ranges.push([start, index.length - start, gi]);
  });
  const idx32 = Uint32Array.from(index);
  const neck = (cloth.neckRing || []).map((i) => [P[i * 3] / UNIT, (P[i * 3 + 1] - Y0) / UNIT, P[i * 3 + 2] / UNIT].map((v) => +v.toFixed(4)));
  return { pos, uv, index: idx32, groups: ranges, ao: computeAO(pos, idx32), neck };
}

function quantize(mesh) {
  // int16 positions over the bounding box, uint16 uvs (0..2 range for wrap).
  let mn = [Infinity, Infinity, Infinity];
  let mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], mesh.pos[i + k]);
      mx[k] = Math.max(mx[k], mesh.pos[i + k]);
    }
  const q = new Uint16Array(mesh.pos.length);
  for (let i = 0; i < mesh.pos.length; i += 3)
    for (let k = 0; k < 3; k++) q[i + k] = Math.round(((mesh.pos[i + k] - mn[k]) / (mx[k] - mn[k] || 1)) * 65535);
  const quv = new Uint16Array(mesh.uv.length);
  for (let i = 0; i < mesh.uv.length; i++) quv[i] = Math.round((mesh.uv[i] / 2) * 65535);
  const b64 = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
  const idx = mesh.index.length && Math.max(...mesh.index) < 65536 ? Uint16Array.from(mesh.index) : mesh.index;
  return {
    min: mn.map((v) => +v.toFixed(5)),
    max: mx.map((v) => +v.toFixed(5)),
    pos: b64(q),
    uv: b64(quv),
    index: b64(idx),
    index32: idx instanceof Uint32Array,
    ao: b64(mesh.ao),
    neck: mesh.neck,
    groups: mesh.groups,
  };
}

/* ---------------- main ---------------- */

const only = process.argv[2];
const jobs = {
  jerseyLong: () => buildJersey({ long: true }),
  jerseyShort: () => buildJersey({ long: false }),
  shorts: () => buildBottoms({ pants: false }),
  pants: () => buildBottoms({ pants: true }),
};
const outFile = process.env.DRAPE_OUT || path.join(ROOT, 'assets/a3gk-kit-meshes.js');
let existing = {};
if (fs.existsSync(outFile)) {
  const m = fs.readFileSync(outFile, 'utf8').match(/window\.A3GKMeshes = (\{[\s\S]*\});/);
  if (m) existing = JSON.parse(m[1]);
}
const out = { ...existing };
for (const [name, make] of Object.entries(jobs)) {
  if (only && only !== name) continue;
  const t = Date.now();
  const cloth = make();
  cloth.simulate({ log: name, steps: 700 });
  out[name] = quantize(exportCloth(cloth));
  console.log(`${name}: ${cloth.pos.length} particles, ${cloth.tris.length} triangles, ${((Date.now() - t) / 1000).toFixed(1)}s`);
}
fs.writeFileSync(
  outFile,
  `/* Draped A3GK garment meshes, baked by tools/drape/drape.mjs. Do not edit by hand. */\nwindow.A3GKMeshes = ${JSON.stringify(out)};\n`
);
console.log(`wrote ${path.relative(ROOT, outFile)} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
