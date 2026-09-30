/*
  A3GK 3D kit viewer.
  Builds a floating goalkeeper kit (jersey, sleeves, collar, shorts or pants,
  socks) from simple parametric geometry and wraps it in the textures painted
  by a3gk-kit-paint.js. Drag to rotate, scroll/pinch to zoom.

  Usage (ES module, THREE passed in so the theme controls the three.js file):
    const { createKitScene } = await import(kitUrl);
    const scene = createKitScene(THREE, container, { onRender });
    scene.update({ parts, sleeve, collar, finish, textures, knit });
    scene.setView('back');
*/
export function createKitScene(THREE, container, options = {}) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'a3k-canvas';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  let camDist = 12.5;
  let target = new THREE.Vector3(0, 0, 0);

  /* ---------- lights: dark studio, floodlight key, green rim ---------- */
  scene.add(new THREE.HemisphereLight(0xe9f2ec, 0x0b0c0a, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.3);
  key.position.set(-4, 6, 7);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7);
  fill.position.set(6, 2, 4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x3be37f, 1.6);
  rim.position.set(3, 4, -7);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xffffff, 0.9);
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
    const m = new THREE.MeshStandardMaterial({
      map,
      bumpMap: bump,
      bumpScale: finish === 'mesh' ? 2.2 : 0.8,
      roughness: finish === 'sheen' ? 0.48 : finish === 'mesh' ? 0.78 : 0.88,
      metalness: 0,
      side: THREE.FrontSide,
    });
    materials.push(m);
    return m;
  }
  const inner = new THREE.MeshStandardMaterial({ color: 0x0c0d0b, roughness: 1, side: THREE.BackSide });

  function texFrom(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }

  function withInner(geo, mat) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat));
    g.add(new THREE.Mesh(geo, inner));
    return g;
  }

  /* ---------- build ---------- */
  let textures = {};
  let bumpTex = null;
  let lastKey = '';

  function disposeKit() {
    kit.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    materials.splice(0).forEach((m) => m.dispose());
    kit.clear();
  }

  function build(spec) {
    disposeKit();
    const { parts, sleeve, collar, finish } = spec;
    const hasJersey = parts.includes('jersey');
    const bottom = parts.find((p) => p !== 'jersey');

    if (hasJersey) {
      const torso = new THREE.Group();
      torso.scale.set(1, 1, 0.62);
      torso.add(withInner(latheFrom(TORSO_KEYS, 0, 2.4), fabric(textures.torso, bumpTex, finish)));

      const tube = { crew: 0.035, v: 0.028, polo: 0.075, wrap: 0.05 }[collar] || 0.035;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.315, tube, 16, 96),
        new THREE.MeshStandardMaterial({ color: spec.trim, roughness: 0.8 })
      );
      materials.push(ring.material);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 2.39 + (collar === 'polo' ? 0.03 : 0);
      torso.add(ring);
      kit.add(torso);

      const long = sleeve !== 'short';
      const len = long ? 1.6 : 0.62;
      [1, -1].forEach((dir) => {
        const geo = new THREE.CylinderGeometry(0.29, long ? 0.19 : 0.25, len, 48, 12, true);
        geo.translate(0, -len / 2, 0);
        const arm = withInner(geo, fabric(dir > 0 ? textures.sleeveR : textures.sleeveL, bumpTex, finish));
        arm.position.set(0.8 * dir, 2.06, 0);
        arm.rotation.z = 0.6 * dir;
        arm.scale.set(1, 1, 0.8);
        kit.add(arm);
      });
    }

    if (bottom) {
      const hip = new THREE.Group();
      hip.scale.set(1, 1, 0.6); // sits just inside the jersey hem
      const hipKeys = [[-0.55, 0.93], [-0.2, 0.9], [0.15, 0.87]];
      hip.add(withInner(latheFrom(hipKeys, -0.55, 0.15, 12), fabric(textures.hip, bumpTex, finish)));
      kit.add(hip);

      const pants = bottom === 'pants';
      const legLen = pants ? 2.05 : 0.72;
      [1, -1].forEach((dir) => {
        const geo = new THREE.CylinderGeometry(0.47, pants ? 0.29 : 0.5, legLen, 48, 16, true);
        geo.translate(0, -legLen / 2, 0);
        const leg = withInner(geo, fabric(dir > 0 ? textures.legR : textures.legL, bumpTex, finish));
        leg.position.set(0.44 * dir, -0.45, 0);
        leg.rotation.z = 0.04 * dir;
        leg.scale.set(1, 1, 0.78);
        kit.add(leg);
      });

      if (spec.socks) {
        const sockTop = pants ? -2.3 : -1.32;
        const sockLen = pants ? 0.55 : 1.3;
        [1, -1].forEach((dir) => {
          const geo = new THREE.CylinderGeometry(0.235, 0.2, sockLen, 32, 4, true);
          geo.translate(0, -sockLen / 2, 0);
          const sock = withInner(geo, fabric(textures.sock, bumpTex, 'matte'));
          sock.position.set((pants ? 0.52 : 0.47) * dir, sockTop, 0);
          sock.scale.set(1, 1, 0.9);
          kit.add(sock);
        });
      }
    }

    // Frame the camera on whatever is being built.
    const top = hasJersey ? 2.45 : 0.2;
    const low = bottom ? (spec.socks ? (bottom === 'pants' ? -2.9 : -2.65) : bottom === 'pants' ? -2.55 : -1.25) : 0;
    target = new THREE.Vector3(0, (top + low) / 2, 0);
    camDist = Math.max(6.5, (top - low) * 2.35 + 1.5);
    floor.position.y = low - 0.02;
    floor.scale.set(hasJersey ? 1.2 : 1, 1, 1);
    frame();
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
      build(spec);
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
    cancelAnimationFrame(raf);
    disposeKit();
    renderer.dispose();
    el.remove();
  }

  return { update, setView, snapshot, dispose, requestRender };
}
