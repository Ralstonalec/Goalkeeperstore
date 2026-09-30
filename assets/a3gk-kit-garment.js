/*
  A3GK garment geometry.

  Builds jersey and shorts/pants meshes the way a ghost-mannequin product shot
  looks: one continuous garment surface with shoulders, set-in sleeves, soft
  folds and open hem, neck and cuffs.

  How: each garment is a signed distance field (torso + sleeves, or waist +
  legs, blended with a smooth union), meshed with surface nets, then trimmed
  at the openings. UVs match the texture layouts painted by a3gk-kit-paint.js
  (torso/hip wrap around the body, sleeves/legs wrap around their own axis),
  so the painter needs no changes. Ambient occlusion is baked from the field
  into vertex colours so armpits and folds read as real cloth.

  Pure geometry: returns { position, normal, uv, color, groups } arrays.
*/

/* ---------------- small math ---------------- */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// Polynomial smooth min / max (iq).
function smin(a, b, k) {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}
const smax = (a, b, k) => -smin(-a, -b, k);

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

/* ---------------- shared shape parameters ---------------- */

// Torso half-width (x) and half-depth (z) by height. Hem at y=0, neck ~2.42.
const TORSO_RX = [[-0.4, 0.97], [0, 0.97], [0.55, 0.92], [1.3, 0.97], [1.8, 0.99], [2.05, 0.97], [2.3, 0.9]];
const TORSO_RZ = [[-0.4, 0.6], [0, 0.6], [0.7, 0.55], [1.35, 0.6], [1.8, 0.58], [2.1, 0.5], [2.35, 0.4]];
export const torsoRx = (y) => keyed(TORSO_RX, y);
export const torsoRz = (y) => keyed(TORSO_RZ, y);

export const NECK_Y = 2.42;
const NECK_R = 0.31;

// Sleeve: shoulder joint, direction down the arm (same frame as the old
// cylinder: origin (±0.8, 2.06), rotated ±0.6 rad about z).
export const SLEEVE = { x: 0.8, y: 2.06, rot: 0.6, zScale: 0.8 };
export const sleeveLen = (long) => (long ? 1.6 : 0.62);

// Legs: origin (±0.44, -0.45), rotated ±0.04 (old frame) — slightly narrower
// and splayed so the legs separate below the crotch.
export const LEG = { x: 0.44, y: -0.45, rot: 0.04, zScale: 0.78 };
export const legLen = (pants) => (pants ? 2.05 : 0.72);
export const HIP_TOP = 0.15;
export const HIP_BOTTOM = -0.55;

/* ---------------- distance helpers ---------------- */

// Distance-ish to an elliptical cylinder cross-section (scaled for stable gradient).
function ellipseDist(x, z, rx, rz) {
  const q = Math.hypot(x / rx, z / rz);
  return (q - 1) * Math.min(rx, rz);
}

// Tapered, elliptical capsule along the -y axis of a local frame.
function limbDist(lx, ly, lz, len, r0, r1, zScale, extra) {
  const t = clamp(-ly / len, 0, 1);
  const r = r0 + (r1 - r0) * t;
  const radial = Math.hypot(lx, lz / zScale) - r;
  // Open-ended past both ends (clipped later) — extend a little so clipping is clean.
  const along = Math.max(ly - 0.25, -ly - (len + extra));
  return Math.max(radial, along);
}

function toLocal(px, py, pz, ox, oy, rot) {
  // Inverse of: rotate by rot around z, then translate by (ox, oy).
  const dx = px - ox;
  const dy = py - oy;
  const c = Math.cos(-rot);
  const s = Math.sin(-rot);
  return [dx * c - dy * s, dx * s + dy * c, pz];
}

/* ---------------- fields ---------------- */

function jerseyField(opts) {
  const long = opts.sleeve !== 'short';
  const len = sleeveLen(long);
  const r0 = 0.3;
  const r1 = long ? 0.19 : 0.25;

  function parts(x, y, z) {
    const rx = torsoRx(y);
    const rz = torsoRz(y);
    let torso = ellipseDist(x, z, rx, rz);
    // Shoulder line: slopes from the neck down to the shoulder point,
    // and rolls off towards front and back.
    const ax = Math.abs(x);
    const roof = NECK_Y + 0.03 - 0.36 * Math.max(0, ax - 0.25) - 0.22 * (z / 0.5) * (z / 0.5);
    torso = smax(torso, y - roof, 0.16);
    torso = Math.max(torso, -y - 0.35); // closed below the hem (clipped away)

    const sl = [];
    for (const dir of [1, -1]) {
      const [lx, ly, lz] = toLocal(x, y, z, SLEEVE.x * dir, SLEEVE.y, SLEEVE.rot * dir);
      let d = limbDist(lx, ly, lz, len, r0, r1, SLEEVE.zScale, 0.2);
      // Soft ripples at the elbow crease on long sleeves.
      const t = -ly / len;
      const under = smoothstep(0, 0.2, -lx * dir); // underside of the arm
      // Armpit pulls near the shoulder, elbow crease on long sleeves.
      d += 0.012 * Math.sin(t * 26 + lz * 9) * under * smoothstep(0.02, 0.1, t) * (1 - smoothstep(0.22, 0.4, t));
      if (long) d += 0.009 * Math.sin(t * 34 + lx * 6) * smoothstep(0.35, 0.5, t) * (1 - smoothstep(0.62, 0.78, t));
      sl.push(d);
    }
    // Cloth folds: vertical drape falling from the armpits down the sides,
    // a soft wave at the hem, and shallow pulls across the waist.
    const phi = Math.atan2(x / rx, z / rz); // 0 front, ±π/2 sides
    const side = Math.pow(Math.abs(Math.sin(phi)), 3);
    torso += 0.016 * Math.sin(phi * 11 + y * 1.3) * side * smoothstep(0.1, 0.5, y) * (1 - smoothstep(1.55, 1.9, y));
    torso += 0.012 * Math.sin(phi * 7 + 0.6) * (1 - smoothstep(0.0, 0.35, y));
    torso += 0.006 * Math.sin(y * 13 + x * 2.2) * smoothstep(0.15, 0.35, y) * (1 - smoothstep(0.7, 1.0, y));
    torso += 0.008 * Math.sin(x * 9 - y * 6) * smoothstep(1.2, 1.6, y) * (1 - smoothstep(1.85, 2.1, y)) * (1 - side);
    return { torso, sleeveR: sl[0], sleeveL: sl[1] };
  }

  function sdf(x, y, z) {
    const p = parts(x, y, z);
    return smin(smin(p.torso, p.sleeveR, 0.14), p.sleeveL, 0.14);
  }

  return {
    sdf,
    parts,
    bounds: { min: [-2.1, -0.5, -0.78], max: [2.1, 2.62, 0.78] },
    cutters: [
      // Open hem
      planeCutter([0, -1, 0], 0),
      // Open neck
      neckCutter(),
      // Open cuffs
      ...[1, -1].map((dir) => {
        const a = SLEEVE.rot * dir;
        const nx = Math.sin(a);
        const ny = -Math.cos(a);
        // plane: point at shoulder + dir*len, normal along the arm
        const px = SLEEVE.x * dir + nx * len;
        const py = SLEEVE.y + ny * len;
        return planeCutter([nx, ny, 0], px * nx + py * ny);
      }),
    ],
    label(x, y, z) {
      const p = parts(x, y, z);
      const s = Math.min(p.sleeveR, p.sleeveL);
      return { f: s - p.torso, g: p.sleeveR <= p.sleeveL ? 1 : 2 };
    },
    uvOf(group, x, y, z) {
      if (group === 0) return wrapUv(x, z, torsoRx(y), torsoRz(y), clamp(y / NECK_Y, 0, 1));
      const dir = group === 1 ? 1 : -1;
      const [lx, ly, lz] = toLocal(x, y, z, SLEEVE.x * dir, SLEEVE.y, SLEEVE.rot * dir);
      return limbUv(lx, ly, lz / SLEEVE.zScale, len);
    },
  };
}

function bottomsField(opts) {
  const pants = opts.bottom === 'pants';
  const len = legLen(pants);
  const r0 = 0.44;
  const r1 = pants ? 0.28 : 0.47;

  function parts(x, y, z) {
    const rx = keyed([[-0.6, 0.93], [0, 0.9], [0.2, 0.9]], y);
    const rz = rx * 0.58;
    let hip = ellipseDist(x, z, rx, rz);
    hip = Math.max(hip, y - (HIP_TOP + 0.25));
    hip = smax(hip, -(y - HIP_BOTTOM) - 0.02, 0.12);
    const lg = [];
    for (const dir of [1, -1]) {
      const [lx, ly, lz] = toLocal(x, y, z, LEG.x * dir, LEG.y, LEG.rot * dir * 1.8);
      let d = limbDist(lx, ly, lz, len, r0, r1, LEG.zScale, 0.2);
      const t = -ly / len;
      // Crotch pulls, a soft wave at the hem, knee crease on pants.
      d += 0.012 * Math.sin(Math.atan2(lx, lz) * 5 + t * 8) * (1 - smoothstep(0.0, pants ? 0.2 : 0.45, t)) * smoothstep(0, 0.15, -lx * dir);
      d += 0.01 * Math.sin(Math.atan2(lx, lz) * 6) * smoothstep(0.75, 1, t);
      if (pants) d += 0.009 * Math.sin(t * 30 + lz * 5) * smoothstep(0.42, 0.52, t) * (1 - smoothstep(0.6, 0.72, t));
      lg.push(d);
    }
    return { hip, legR: lg[0], legL: lg[1] };
  }

  function sdf(x, y, z) {
    const p = parts(x, y, z);
    return smin(p.hip, Math.min(p.legR, p.legL), 0.1);
  }

  return {
    sdf,
    parts,
    bounds: { min: [-1.35, -len - 0.8, -0.72], max: [1.35, HIP_TOP + 0.45, 0.72] },
    cutters: [
      planeCutter([0, 1, 0], HIP_TOP),
      ...[1, -1].map((dir) => {
        const a = LEG.rot * dir * 1.8;
        const nx = Math.sin(a);
        const ny = -Math.cos(a);
        const px = LEG.x * dir + nx * len;
        const py = LEG.y + ny * len;
        return planeCutter([nx, ny, 0], px * nx + py * ny);
      }),
    ],
    label(x, y, z) {
      const p = parts(x, y, z);
      const l = Math.min(p.legR, p.legL);
      // Legs take over below the crotch line.
      let f = l - p.hip - 0.02;
      if (y < HIP_BOTTOM + 0.05) f = Math.min(f, y - (HIP_BOTTOM + 0.05));
      return { f, g: p.legR <= p.legL ? 1 : 2 };
    },
    uvOf(group, x, y, z) {
      if (group === 0) {
        const rx = keyed([[-0.6, 0.93], [0, 0.9], [0.2, 0.9]], y);
        return wrapUv(x, z, rx, rx * 0.58, clamp((y - HIP_BOTTOM) / (HIP_TOP - HIP_BOTTOM), 0, 1));
      }
      const dir = group === 1 ? 1 : -1;
      const [lx, ly, lz] = toLocal(x, y, z, LEG.x * dir, LEG.y, LEG.rot * dir * 1.8);
      return limbUv(lx, ly, lz / LEG.zScale, len);
    },
  };
}

/* ---------------- UV helpers (match the painter's layouts) ---------------- */

// Body wrap: u=0 on the wearer's right side, 0.25 front centre, 0.75 back centre.
function wrapUv(x, z, rx, rz, v) {
  const phi = Math.atan2(x / rx, z / rz); // 0 = front
  let u = (phi + Math.PI / 2) / (Math.PI * 2);
  u -= Math.floor(u);
  return [u, v];
}

// Limb wrap, same convention as THREE.CylinderGeometry: u=0 facing +z.
function limbUv(lx, ly, lz, len) {
  let u = Math.atan2(lx, lz) / (Math.PI * 2);
  u -= Math.floor(u);
  return [u, clamp(1 + ly / len, 0, 1)];
}

/* ---------------- cutters ---------------- */

// Removes geometry where dot(n, p) > d; boundary snaps onto the plane.
function planeCutter(n, d) {
  return {
    inside: (p) => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] > d,
    snap(p) {
      const k = n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - d;
      return [p[0] - n[0] * k, p[1] - n[1] * k, p[2] - n[2] * k];
    },
  };
}

function neckCutter() {
  const zs = 1.25;
  return {
    inside: (p) => p[1] > NECK_Y - 0.28 && Math.hypot(p[0], p[2] * zs) < NECK_R,
    snap(p) {
      const r = Math.hypot(p[0], p[2] * zs) || 1;
      return [(p[0] / r) * NECK_R, p[1], (p[2] / r) * (NECK_R / zs)];
    },
  };
}

/* ---------------- surface nets ---------------- */

const CUBE_EDGES = (() => {
  const e = [];
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 3; j++) {
      const k = i ^ (1 << j);
      if (i < k) e.push([i, k]);
    }
  return e;
})();

function mesh(field, h) {
  const { min, max } = field.bounds;
  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const F = new Float32Array(nx * ny * nz);
  const idx = (i, j, k) => i + nx * (j + ny * k);
  // Narrow band: sample a coarse grid first and only evaluate the fine grid
  // near the surface. Far points keep the coarse value (only the sign matters).
  const S = 4;
  const cx = Math.ceil((nx - 1) / S) + 1;
  const cy = Math.ceil((ny - 1) / S) + 1;
  const cz = Math.ceil((nz - 1) / S) + 1;
  const C = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) C[i + cx * (j + cy * k)] = field.sdf(min[0] + i * S * h, min[1] + j * S * h, min[2] + k * S * h);
  const band = S * h * 1.1;
  for (let k = 0; k < nz; k++) {
    const z = min[2] + k * h;
    const ck = Math.round(k / S);
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * h;
      const cj = Math.round(j / S);
      for (let i = 0; i < nx; i++) {
        const cv = C[Math.round(i / S) + cx * (cj + cy * ck)];
        F[idx(i, j, k)] = Math.abs(cv) > band ? cv : field.sdf(min[0] + i * h, y, z);
      }
    }
  }

  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cidx = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const verts = [];
  const corner = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = F[idx(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [a, b] of CUBE_EDGES) {
          const va = corner[a];
          const vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          n++;
        }
        cellVert[cidx(i, j, k)] = verts.length;
        verts.push([min[0] + (i + sx / n) * h, min[1] + (j + sy / n) * h, min[2] + (k + sz / n) * h]);
      }

  const quads = [];
  const pushQuad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    quads.push(flip ? [a, d, c, b] : [a, b, c, d]);
  };
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const inside = F[idx(i, j, k)] < 0;
        // x edge
        if (i < nx - 1 && inside !== F[idx(i + 1, j, k)] < 0)
          pushQuad(cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j - 1, k)], !inside);
        // y edge
        if (j < ny - 1 && inside !== F[idx(i, j + 1, k)] < 0)
          pushQuad(cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i - 1, j, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j, k - 1)], !inside);
        // z edge
        if (k < nz - 1 && inside !== F[idx(i, j, k + 1)] < 0)
          pushQuad(cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)], !inside);
      }
  return { verts, quads };
}

function gradient(sdf, p, e = 0.004) {
  const gx = sdf(p[0] + e, p[1], p[2]) - sdf(p[0] - e, p[1], p[2]);
  const gy = sdf(p[0], p[1] + e, p[2]) - sdf(p[0], p[1] - e, p[2]);
  const gz = sdf(p[0], p[1], p[2] + e) - sdf(p[0], p[1], p[2] - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}

/* ---------------- build ---------------- */

export function buildGarment(kind, opts = {}, h = 0.03) {
  const field = kind === 'jersey' ? jerseyField(opts) : bottomsField(opts);
  const { sdf } = field;
  const { verts, quads } = mesh(field, h);

  // Project vertices onto the surface for a smooth, exact silhouette.
  for (const p of verts) {
    for (let it = 0; it < 2; it++) {
      const d = sdf(p[0], p[1], p[2]);
      const g = gradient(sdf, p);
      p[0] -= g[0] * d;
      p[1] -= g[1] * d;
      p[2] -= g[2] * d;
    }
  }

  // Openings: drop vertices inside a cutter unless they border kept geometry,
  // in which case snap them onto the cut so the edge is clean.
  const n = verts.length;
  const state = new Uint8Array(n); // 0 keep, 1 inside (candidate), 2 drop
  const cutOf = new Int8Array(n).fill(-1);
  for (let v = 0; v < n; v++)
    field.cutters.forEach((c, ci) => {
      if (cutOf[v] < 0 && c.inside(verts[v])) {
        cutOf[v] = ci;
        state[v] = 1;
      }
    });
  const borders = new Uint8Array(n);
  for (const q of quads) {
    const anyKeep = q.some((v) => state[v] === 0);
    if (anyKeep) q.forEach((v) => (borders[v] = 1));
  }
  for (let v = 0; v < n; v++) {
    if (state[v] !== 1) continue;
    if (borders[v]) {
      verts[v] = field.cutters[cutOf[v]].snap(verts[v]);
      state[v] = 0;
    } else state[v] = 2;
  }

  // Normals and baked ambient occlusion from the field.
  const normals = verts.map((p) => gradient(sdf, p));
  const ao = verts.map((p, i) => {
    const nn = normals[i];
    let occ = 0;
    let w = 1;
    for (let s = 1; s <= 5; s++) {
      const dist = 0.045 * s;
      const d = sdf(p[0] + nn[0] * dist, p[1] + nn[1] * dist, p[2] + nn[2] * dist);
      occ += (dist - d) * w;
      w *= 0.55;
    }
    return clamp(1 - occ * 2.6, 0.35, 1);
  });

  // Triangles, each assigned to one texture group, with per-corner UVs so
  // seams (sides, shoulders) stay crisp like real panel seams.
  const out = { position: [], normal: [], uv: [], color: [], groups: [[], [], []] };
  const tri = (a, b, c) => {
    if (state[a] === 2 || state[b] === 2 || state[c] === 2) return;
    // Wind every triangle to face outward (along the field gradient).
    const A = verts[a];
    const B = verts[b];
    const C = verts[c];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const nA = normals[a], nB = normals[b], nC = normals[c];
    if (fx * (nA[0] + nB[0] + nC[0]) + fy * (nA[1] + nB[1] + nC[1]) + fz * (nA[2] + nB[2] + nC[2]) < 0) {
      const t = b;
      b = c;
      c = t;
    }
    // Split the triangle cleanly along the panel seam (body vs sleeve/leg).
    const V = [a, b, c].map((v) => {
      const L = field.label(verts[v][0], verts[v][1], verts[v][2]);
      return { p: verts[v], n: normals[v], ao: ao[v], f: L.f, g: L.g };
    });
    const neg = V.filter((v) => v.f < 0);
    if (neg.length === 0 || neg.length === 3) {
      emit(V, neg.length ? pickGroup(neg) : 0);
      return;
    }
    const gNeg = pickGroup(neg);
    const pos = [];
    const negPoly = [];
    for (let i = 0; i < 3; i++) {
      const P = V[i];
      const Q = V[(i + 1) % 3];
      (P.f < 0 ? negPoly : pos).push(P);
      if (P.f < 0 !== Q.f < 0) {
        const t = P.f / (P.f - Q.f);
        const X = lerpVert(P, Q, t);
        pos.push(X);
        negPoly.push(X);
      }
    }
    fan(pos, 0);
    fan(negPoly, gNeg);
  };
  const pickGroup = (list) => list.reduce((m, v) => (v.f < m.f ? v : m)).g;
  const fan = (poly, g) => {
    for (let i = 1; i < poly.length - 1; i++) emit([poly[0], poly[i], poly[i + 1]], g);
  };
  const lerpVert = (P, Q, t) => {
    const p = [0, 1, 2].map((k) => P.p[k] + (Q.p[k] - P.p[k]) * t);
    const n = [0, 1, 2].map((k) => P.n[k] + (Q.n[k] - P.n[k]) * t);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return { p, n: [n[0] / l, n[1] / l, n[2] / l], ao: P.ao + (Q.ao - P.ao) * t, f: 0, seam: true };
  };
  const emit = (tri3, g) => {
    const uvs = tri3.map((v) => field.uvOf(g, v.p[0], v.p[1], v.p[2]));
    const us = uvs.map((t) => t[0]);
    if (Math.max(...us) - Math.min(...us) > 0.5) uvs.forEach((t) => (t[0] < 0.5 ? (t[0] += 1) : 0));
    out.groups[g].push(tri3.map((v, k) => ({ ...v, uv: uvs[k] })));
  };
  for (const [a, b, c, d] of quads) {
    // Split along the shorter diagonal.
    const dac = dist2(verts[a], verts[c]);
    const dbd = dist2(verts[b], verts[d]);
    if (dac < dbd) {
      tri(a, b, c);
      tri(a, c, d);
    } else {
      tri(a, b, d);
      tri(b, c, d);
    }
  }

  const ranges = [];
  let start = 0;
  out.groups.forEach((list, gi) => {
    for (const t3 of list)
      for (const v of t3) {
        // Stitched seams read slightly darker, like a real panel join.
        const seam = v.seam ? 0.72 : 1;
        out.position.push(v.p[0], v.p[1], v.p[2]);
        out.normal.push(v.n[0], v.n[1], v.n[2]);
        out.uv.push(v.uv[0], v.uv[1]);
        out.color.push(v.ao * seam, v.ao * seam, v.ao * seam);
      }
    ranges.push({ start, count: list.length * 3, materialIndex: gi });
    start += list.length * 3;
  });
  return {
    position: new Float32Array(out.position),
    normal: new Float32Array(out.normal),
    uv: new Float32Array(out.uv),
    color: new Float32Array(out.color),
    groups: ranges,
  };
}

function dist2(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/* Closed curve along the neck opening, for the collar tube. */
export function neckCurve(opts = {}, steps = 96) {
  const field = jerseyField(opts);
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = Math.sin(t) * NECK_R;
    const z = (Math.cos(t) * NECK_R) / 1.25;
    // Walk down from above until we hit the surface.
    let lo = NECK_Y - 0.4;
    let hi = NECK_Y + 0.3;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (field.sdf(x * 1.04, mid, z * 1.04) < 0) lo = mid;
      else hi = mid;
    }
    pts.push([x, lo, z]);
  }
  return pts;
}
