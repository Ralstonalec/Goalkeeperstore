/*
  A3GK 3D kit viewer.
  Builds a floating goalkeeper kit (jersey, sleeves, collar, shorts or pants,
  socks) from simple parametric geometry and wraps it in the textures painted
  by a3gk-kit-paint.js. Drag to rotate, scroll/pinch to zoom.

  Usage (classic script; exposes window.A3GKKit3D):
    const { createKitScene } = window.A3GKKit3D;
    const scene = createKitScene(THREE, container, { garment, onRender });
  garment is the a3gk-kit-garment.js module (passed in so asset URLs stay
  versioned by the theme).
    scene.update({ parts, sleeve, collar, finish, textures, knit });
    scene.setView('back');
*/
(function () {
'use strict';

function createKitScene(THREE, container, options = {}) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  // Soft shadows: sleeves shade the body, folds shade themselves, the kit sits on the floor.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'a3k-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  let camDist = 12.5;
  let target = new THREE.Vector3(0, 0, 0);

  /* ---------- studio: soft environment + floodlight key + green rim ---------- */
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = (() => {
    // A small softbox room, pre-filtered for image-based lighting.
    const room = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(12, 8, 12), new THREE.MeshBasicMaterial({ color: 0x15171a, side: THREE.BackSide }));
    room.add(box);
    const panel = (w, h, color, x, y, z, ry, rx = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, 0);
      room.add(m);
    };
    panel(5, 3, 0xffffff, -3.5, 2.5, 4, Math.PI * 0.8); // key softbox
    panel(3, 5, 0x9aa2a8, 5.5, 0.5, 1, -Math.PI / 2); // fill strip
    panel(2, 5, 0x48d98a, 3, 1, -5.5, 0); // green rim strip
    panel(2, 5, 0xd8dde2, -4, 1, -5, 0.3); // back rim
    panel(8, 8, 0x5c6066, 0, 3.9, 0, 0, Math.PI / 2); // ceiling bounce
    const env = pmrem.fromScene(room, 0.04).texture;
    room.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    return env;
  })();
  scene.add(new THREE.HemisphereLight(0xe9f2ec, 0x0b0c0a, 0.25));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-5, 5, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 5, bottom: -5, near: 1, far: 30 });
  scene.add(key);
  scene.add(key.target);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.25);
  fill.position.set(6, 2, 4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x3be37f, 2.2);
  rim.position.set(3, 4, -7);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xffffff, 1.4);
  rim2.position.set(-5, 3, -6);
  scene.add(rim2);

  /* ---------- floor shadow ---------- */
  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(0,0,0,.6)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 1.6),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.28 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);

  const kit = new THREE.Group();
  scene.add(kit);

  /* ---------- geometry helpers ---------- */
  const SEAM = -Math.PI / 2; // puts the texture seam on the wearer's right side

  function smooth(keys, h) {
    for (let i = 0; i < keys.length - 1; i++) {
      const [h0, r0] = keys[i];
      const [h1, r1] = keys[i + 1];
      if (h >= h0 && h <= h1) {
        const t = (h - h0) / (h1 - h0);
        const e = t * t * (3 - 2 * t);
        return r0 + (r1 - r0) * e;
      }
    }
    return keys[keys.length - 1][1];
  }

  function latheFrom(keys, h0, h1, steps = 48) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const h = h0 + ((h1 - h0) * i) / steps;
      pts.push(new THREE.Vector2(smooth(keys, h), h));
    }
    return new THREE.LatheGeometry(pts, 96, SEAM, Math.PI * 2);
  }

  const TORSO_KEYS = [
    [0, 0.9], [0.5, 0.92], [1.2, 0.95], [1.7, 0.98], [1.95, 0.95], [2.12, 0.8], [2.25, 0.56], [2.34, 0.37], [2.4, 0.31],
  ];

  const materials = [];
  function fabric(map, bump, finish) {
    const m = new THREE.MeshPhysicalMaterial({
      map,
      vertexColors: true, // baked ambient occlusion
      bumpMap: bump,
      bumpScale: finish === 'mesh' ? 2.2 : 1.4,
      roughness: finish === 'sheen' ? 0.55 : finish === 'mesh' ? 0.85 : 0.8,
      metalness: 0,
      // Fabric sheen: the soft grazing highlight that makes cloth (and
      // especially dark cloth) read as cloth.
      sheen: 1,
      sheenRoughness: finish === 'sheen' ? 0.3 : finish === 'mesh' ? 0.55 : 0.45,
      sheenColor: new THREE.Color(finish === 'sheen' ? 0xc8c8c8 : finish === 'mesh' ? 0x8c8c8c : 0xa8a8a8),
      envMapIntensity: finish === 'sheen' ? 1.1 : 0.85,
      side: THREE.FrontSide,
    });
    materials.push(m);
    return m;
  }
  const inner = new THREE.MeshStandardMaterial({ color: 0x0b0c0a, roughness: 1, side: THREE.BackSide, vertexColors: true });

  // Garment meshes are generated in a background worker (they take a moment
  // to build) and cached, so the page never freezes. If workers aren't
  // available they're built on the main thread instead.
  const geoCache = new Map();
  let worker = null;
  const pending = new Map();
  let seq = 0;
  if (options.garmentUrl && typeof Worker !== 'undefined') {
    try {
      const abs = new URL(options.garmentUrl, location.href).href;
      const code = `self.window = self; importScripts(${JSON.stringify(abs)});
onmessage = function (e) {
  var d = e.data;
  try {
    var g = self.A3GKGarment.buildGarment(d.kind, d.opts);
    postMessage({ id: d.id, g: g }, [g.position.buffer, g.normal.buffer, g.uv.buffer, g.color.buffer]);
  } catch (err) { postMessage({ id: d.id, error: String(err && err.message || err) }); }
};`;
      const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      // A small pool so jersey, shorts and socks build at the same time.
      const size = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
      const pool = Array.from({ length: size }, () => new Worker(blobUrl));
      let next = 0;
      worker = {
        postMessage: (m) => pool[next++ % pool.length].postMessage(m),
        terminate: () => pool.forEach((w) => w.terminate()),
      };
      const onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error));
        else p.resolve(e.data.g);
      };
      const onerror = () => {
        if (worker) worker.terminate();
        worker = null;
        pending.forEach((p) => p.fallback());
        pending.clear();
      };
      pool.forEach((w) => {
        w.onmessage = onmessage;
        w.onerror = onerror;
      });
    } catch (e) {
      worker = null;
    }
  }

  function toGeometry(g) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(g.color, 3));
    g.groups.forEach((r) => geo.addGroup(r.start, r.count, r.materialIndex));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  // Draped garments baked by tools/drape/drape.mjs (a3gk-kit-meshes.js).
  function bakedName(kind, opts) {
    if (kind === 'jersey') return opts.sleeve === 'short' ? 'jerseyShort' : 'jerseyLong';
    if (kind === 'bottoms') return opts.bottom === 'pants' ? 'pants' : 'shorts';
    return null;
  }
  function decode(b64, Type) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Type(u8.buffer);
  }
  function bakedGeometry(m) {
    const q = decode(m.pos, Uint16Array);
    const pos = new Float32Array(q.length);
    for (let i = 0; i < q.length; i += 3)
      for (let k = 0; k < 3; k++) pos[i + k] = m.min[k] + (q[i + k] / 65535) * (m.max[k] - m.min[k]);
    const qu = decode(m.uv, Uint16Array);
    const uv = new Float32Array(qu.length);
    for (let i = 0; i < qu.length; i++) uv[i] = (qu[i] / 65535) * 2;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (m.ao) {
      const a = decode(m.ao, Uint8Array);
      const col = new Float32Array(a.length * 3);
      for (let i = 0; i < a.length; i++) col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = a[i] / 255;
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    } else {
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length).fill(1), 3));
    }
    geo.setIndex(new THREE.BufferAttribute(decode(m.index, m.index32 ? Uint32Array : Uint16Array), 1));
    m.groups.forEach(([start, count, mat]) => geo.addGroup(start, count, mat));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }

  function garmentGeometry(kind, opts) {
    const k = kind + JSON.stringify(opts);
    const baked = window.A3GKMeshes && window.A3GKMeshes[bakedName(kind, opts)];
    if (!geoCache.has(k) && baked) geoCache.set(k, Promise.resolve().then(() => bakedGeometry(baked)));
    if (!geoCache.has(k)) {
      const buildHere = () => Promise.resolve().then(() => options.garment.buildGarment(kind, opts));
      const raw = worker
        ? new Promise((resolve, reject) => {
            const id = ++seq;
            pending.set(id, { resolve, reject, fallback: () => buildHere().then(resolve, reject) });
            worker.postMessage({ id, kind, opts });
          })
        : buildHere();
      geoCache.set(k, raw.then(toGeometry));
    }
    return geoCache.get(k);
  }

  // Warm the cache with the other variants once the first kit is up.
  function prebuild() {
    [['jersey', { sleeve: 'long' }], ['jersey', { sleeve: 'short' }], ['bottoms', { bottom: 'shorts' }], ['bottoms', { bottom: 'pants' }], ['socks', { bottom: 'shorts' }], ['socks', { bottom: 'pants' }]].forEach(([k, o]) =>
      garmentGeometry(k, o).catch(() => {})
    );
  }

  // Per-part surface detail painted in garment UV space (knit, seams, hems, rib);
  // falls back to the tiled knit.
  function detailBump(k) {
    const t = textures[`${k}Bump`];
    return t ? wrapRepeat(t) : bumpTex;
  }

  function wrapRepeat(t) {
    if (t && t.wrapS !== THREE.RepeatWrapping) {
      t.wrapS = THREE.RepeatWrapping;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      t.needsUpdate = true;
    }
    return t;
  }

  // Vertical rib texture for the collar band.
  const ribTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 8;
    const g = c.getContext('2d');
    for (let x = 0; x < 64; x++) {
      const v = 128 + 110 * Math.sin((x / 64) * Math.PI * 2 * 8);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, 0, 1, 8);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(12, 1);
    return t;
  })();

  // A strip rising from the neck edge, leaning in (crew) or out (polo).
  function collarBand(pts, height, lean) {
    const n = pts.length;
    const pos = [];
    const uv = [];
    const index = [];
    for (let i = 0; i <= n; i++) {
      const [x, y, z] = pts[i % n];
      const r = Math.hypot(x, z) || 1;
      const ox = (x / r) * 0.012;
      const oz = (z / r) * 0.012;
      pos.push(x + ox, y - 0.02, z + oz);
      pos.push(x + ox - (x / r) * lean, y + height, z + oz - (z / r) * lean);
      uv.push(i / n, 0, i / n, 1);
      if (i < n) {
        const a = i * 2;
        index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    return geo;
  }

  function withInner(geo, mats) {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(geo, mats);
    outer.castShadow = true;
    outer.receiveShadow = true;
    g.add(outer);
    g.add(new THREE.Mesh(geo, inner));
    return g;
  }

  /* ---------- build ---------- */
  let textures = {};
  let bumpTex = null;
  let lastKey = '';

  function disposeKit() {
    kit.traverse((o) => {
      // Garment geometry is cached; only dispose one-off parts (collar, socks).
      if (o.geometry && !o.userData.cached) o.geometry.dispose();
    });
    materials.splice(0).forEach((m) => m.dispose());
    kit.clear();
  }

  let buildToken = 0;
  let firstBuilt = null;
  let firstFailed = null;
  const ready = new Promise((res, rej) => {
    firstBuilt = res;
    firstFailed = rej;
  });

  async function build(spec) {
    const token = ++buildToken;
    const { parts, sleeve, collar, finish } = spec;
    const hasJersey = parts.includes('jersey');
    const bottom = parts.find((p) => p !== 'jersey');
    const [jGeo, bGeo, sGeo] = await Promise.all([
      hasJersey ? garmentGeometry('jersey', { sleeve: sleeve === 'short' ? 'short' : 'long' }) : null,
      bottom ? garmentGeometry('bottoms', { bottom }) : null,
      bottom && spec.socks ? garmentGeometry('socks', { bottom }) : null,
    ]);
    if (token !== buildToken) return; // a newer build started meanwhile
    disposeKit();

    if (jGeo) {
      const mats = ['torso', 'sleeveR', 'sleeveL'].map((k) => fabric(wrapRepeat(textures[k]), detailBump(k), finish));
      const jersey = withInner(jGeo, mats);
      jersey.children.forEach((c) => (c.userData.cached = true));
      kit.add(jersey);

      // Ribbed collar band that follows the real neck opening.
      const bakedJ = window.A3GKMeshes && window.A3GKMeshes[bakedName('jersey', { sleeve })];
      const pts = bakedJ && bakedJ.neck && bakedJ.neck.length > 8 ? bakedJ.neck : options.garment.neckCurve({ sleeve });
      const height = { crew: 0.07, v: 0.05, polo: 0.16, wrap: 0.1 }[collar] || 0.07;
      const band = collarBand(pts, height, collar === 'polo' ? 0.05 : 0.012);
      const bandMat = new THREE.MeshPhysicalMaterial({
        color: spec.trim,
        roughness: 0.8,
        sheen: 1,
        sheenRoughness: 0.5,
        sheenColor: new THREE.Color(0x555555),
        bumpMap: ribTex,
        bumpScale: 1.4,
        side: THREE.DoubleSide,
      });
      materials.push(bandMat);
      kit.add(new THREE.Mesh(band, bandMat));
    }

    if (bGeo) {
      const mats = ['hip', 'legR', 'legL'].map((k) => fabric(wrapRepeat(textures[k]), detailBump(k), finish));
      const bottoms = withInner(bGeo, mats);
      bottoms.children.forEach((c) => (c.userData.cached = true));
      kit.add(bottoms);
    }
    if (sGeo) {
      const socks = withInner(sGeo, [fabric(wrapRepeat(textures.sock), bumpTex, 'matte')]);
      socks.children.forEach((c) => (c.userData.cached = true));
      kit.add(socks);
    }

    // Frame the camera on whatever was built.
    const box = new THREE.Box3();
    [jGeo, bGeo, sGeo].forEach((g) => g && box.union(g.boundingBox));
    const top = box.max.y + 0.1;
    const low = box.min.y;
    target = new THREE.Vector3(0, (top + low) / 2, 0);
    const h = top - low;
    const w = box.max.x - box.min.x;
    const fit = Math.max(h, w / Math.max(0.6, camera.aspect));
    camDist = fit / (2 * Math.tan((camera.fov * Math.PI) / 360)) * 1.18 + 1;
    floor.position.y = low - 0.02;
    shadowCatcher.position.y = low - 0.03;
    key.target.position.copy(target);
    key.position.set(target.x - 5, target.y + 5, target.z + 6);
    floor.scale.set(Math.max(1, w / 3.2), 1, 1);
    frame();
    requestRender();
    if (firstBuilt) {
      firstBuilt();
      firstBuilt = firstFailed = null;
      setTimeout(prebuild, 400);
    }
  }

  function update(spec) {
    textures = spec.textures;
    if (!bumpTex || spec.finishChanged) {
      if (bumpTex) bumpTex.dispose();
      bumpTex = new THREE.CanvasTexture(spec.knit);
      bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
      bumpTex.repeat.set(10, 5);
    }
    const key = [spec.parts.join(','), spec.sleeve, spec.collar, spec.finish, spec.socks, spec.trim].join('|');
    if (key !== lastKey) {
      lastKey = key;
      build(spec).catch((e) => {
        console.warn('A3GK: garment build failed', e);
        if (firstFailed) firstFailed(e);
      });
    } else {
      materials.forEach((m) => {
        if (m.map) m.map.needsUpdate = true;
      });
    }
    requestRender();
  }

  /* ---------- camera & interaction ---------- */
  let yaw = 0.35;
  let pitch = 0.06;
  let zoom = 1;
  let targetYaw = yaw;
  let velocity = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let idleAt = performance.now();
  let needsRender = true;
  let raf = 0;

  function frame() {
    const d = camDist * zoom;
    camera.position.set(target.x, target.y + d * 0.12, target.z + d);
    camera.lookAt(target.x, target.y + 0.05, target.z);
  }

  function resize() {
    const w = container.clientWidth || 600;
    const h = container.clientHeight || 600;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    requestRender();
  }

  function requestRender() {
    needsRender = true;
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function loop() {
    raf = 0;
    const now = performance.now();
    let animating = false;

    if (!dragging) {
      if (Math.abs(velocity) > 0.0005) {
        targetYaw += velocity;
        velocity *= 0.92;
        animating = true;
      } else if (!reduceMotion && now - idleAt > 5000 && !options.noAutoRotate) {
        targetYaw += 0.0035;
        animating = true;
      }
    }
    const dy = targetYaw - yaw;
    if (Math.abs(dy) > 0.0005) {
      yaw += dy * 0.14;
      animating = true;
    }
    kit.rotation.y = yaw;
    kit.rotation.x = pitch;

    if (needsRender || animating) {
      renderer.render(scene, camera);
      needsRender = false;
      if (options.onRender) options.onRender();
    }
    if (animating || dragging) raf = requestAnimationFrame(loop);
  }

  const el = renderer.domElement;
  el.style.touchAction = 'pan-y';
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    velocity = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    el.setPointerCapture(e.pointerId);
    requestRender();
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dyp = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    targetYaw += dx * 0.012;
    velocity = dx * 0.0025;
    pitch = Math.max(-0.35, Math.min(0.45, pitch + dyp * 0.004));
    idleAt = performance.now();
    requestRender();
  });
  const end = () => {
    dragging = false;
    idleAt = performance.now();
    requestRender();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoom = Math.max(0.6, Math.min(1.4, zoom + e.deltaY * 0.0012));
      frame();
      idleAt = performance.now();
      requestRender();
    },
    { passive: false }
  );

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  function setView(view) {
    const turns = Math.round(yaw / (Math.PI * 2)) * Math.PI * 2;
    const angle = { front: 0, back: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[view] ?? 0;
    targetYaw = turns + angle;
    velocity = 0;
    idleAt = performance.now();
    requestRender();
  }

  function snapshot() {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  }

  function dispose() {
    ro.disconnect();
    geoCache.forEach((p) => p.then((g) => g.dispose(), () => {}));
    if (worker) worker.terminate();
    cancelAnimationFrame(raf);
    disposeKit();
    renderer.dispose();
    el.remove();
  }

  return { update, setView, snapshot, dispose, requestRender, ready };
}

window.A3GKKit3D = { createKitScene };
})();
