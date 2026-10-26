/* MoneyLife — живой персонаж в карточке баланса. Этап 1: «Слиток» (биткоин), стиль дизайнерских игрушек.
   Нужен three.js r128 (глобальный THREE). Рядом лежат three.min.js и voice-slitok.js (голос).
   Приложение вызывает:
     Mascot.init({ host, app })     — один раз; host — прозрачный слой поверх карточки баланса (#mascot);
     Mascot.sync(info)              — при каждой отрисовке главной (info: S, D, P, pct, go, fresh, offline, money);
     Mascot.number({ el, to, up })  — сумма баланса изменилась: Слиток сам «переставляет» цифры.
   Слиток ходит по карточке, сидит на её краю, свесив ноги, протирает цифры и говорит мягким голосом робота.
   Текста нет: только голос, выражение глаз и значки.
   Детализация: ткань, трикотаж, кожа и резина с рельефом (карты нормалей рисуются в коде), строчки швов,
   молния с зубчиками, цепочка из звеньев, перчатки с пальцами, кроссовки со шнуровкой, тени на самом персонаже.
   Персонаж придуман с нуля: ни логотипов монет, ни чужих маскотов. */
(function () {
  'use strict';
  const T = window.THREE;
  if (!T || window.Mascot) return;
  const SELF = (document.currentScript && document.currentScript.src) || '';
  const VOICE_URL = /mascot\.js/.test(SELF) ? SELF.replace(/mascot\.js/, 'voice-slitok.js') : 'voice-slitok.js';

  /* ---------- утилиты ---------- */
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const seg = (k, a, b) => clamp((k - a) / (b - a), 0, 1);
  const bell = (k, a, b) => Math.sin(seg(k, a, b) * PI);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeIn = t => t * t * t;
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const backOut = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const now = () => performance.now() / 1000;
  const damp = (a, b, r, dt) => a + (b - a) * (1 - Math.exp(-r * dt));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const dayKey = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const col = hex => new T.Color(hex).convertSRGBToLinear();
  const v2 = (x, y) => new T.Vector2(x, y == null ? x : y);

  /* ---------- текстуры, нарисованные в коде ---------- */
  function ctex(w, h, draw, srgb) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c); if (srgb) t.encoding = T.sRGBEncoding; return t;
  }
  const canvasTex = (size, draw, srgb) => ctex(size, size, (g, w) => draw(g, w), srgb);
  const radialTex = (inner, outer) => canvasTex(64, (g, s) => {
    const r = s / 2, gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
  const sparkTex = () => canvasTex(64, (g, s) => {
    const r = s / 2, gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(r, 4); g.lineTo(r, s - 4); g.moveTo(4, r); g.lineTo(s - 4, r); g.stroke();
  });
  const flameTex = () => ctex(64, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h * 0.1, 0, w / 2, h * 0.1, h * 0.9);
    gr.addColorStop(0, 'rgba(255,252,230,1)'); gr.addColorStop(0.16, 'rgba(255,208,112,.95)'); gr.addColorStop(0.5, 'rgba(255,120,30,.42)'); gr.addColorStop(1, 'rgba(255,80,0,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(w / 2, h * 0.45, w * 0.44, h * 0.47, 0, 0, TAU); g.fill();
  });
  const beamTex = () => ctex(128, 32, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,150,40,0)'); gr.addColorStop(0.32, 'rgba(255,170,70,.5)'); gr.addColorStop(0.5, 'rgba(255,250,235,1)'); gr.addColorStop(0.68, 'rgba(255,170,70,.5)'); gr.addColorStop(1, 'rgba(255,150,40,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    const fx = g.createLinearGradient(0, 0, w, 0);
    fx.addColorStop(0, 'rgba(0,0,0,0)'); fx.addColorStop(0.1, 'rgba(0,0,0,1)'); fx.addColorStop(0.88, 'rgba(0,0,0,1)'); fx.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fx; g.fillRect(0, 0, w, h);
  });
  /* блик на стекле визора: полоса, тающая к краям */
  const glintTex = () => ctex(128, 16, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.25, 'rgba(255,255,255,.9)'); gr.addColorStop(0.7, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    const fy = g.createLinearGradient(0, 0, 0, h); fy.addColorStop(0, 'rgba(0,0,0,0)'); fy.addColorStop(0.5, 'rgba(0,0,0,1)'); fy.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fy; g.fillRect(0, 0, w, h);
  });
  /* окружение для бликов на глянце: тёплый верх, фиолетовый низ, «софтбоксы» света */
  function envMap(renderer) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#fff6e6'); gr.addColorStop(0.42, '#d9c2ff'); gr.addColorStop(0.55, '#4a3570'); gr.addColorStop(1, '#140e24');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
    const spot = (x, y, r, a) => { const s = g.createRadialGradient(x, y, 0, x, y, r); s.addColorStop(0, 'rgba(255,255,255,' + a + ')'); s.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = s; g.fillRect(x - r, y - r, r * 2, r * 2); };
    spot(128, 52, 60, 1); spot(380, 68, 44, 0.75); spot(256, 28, 36, 0.6);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(96, 40, 64, 18); g.fillStyle = 'rgba(255,214,170,.6)'; g.fillRect(350, 60, 48, 12);
    const tex = new T.CanvasTexture(c); tex.mapping = T.EquirectangularReflectionMapping; tex.encoding = T.sRGBEncoding;
    const pm = new T.PMREMGenerator(renderer); const env = pm.fromEquirectangular(tex).texture; pm.dispose(); tex.dispose();
    return env;
  }

  /* ---------- процедурный рельеф материалов: шум, рубчик, строчки → карты нормалей ---------- */
  function hash2(x, y, s) { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  /* бесшовный (повторяющийся) шум: N×N точек, G×G узлов */
  function vnoise(N, G, seed) {
    const out = new Float32Array(N * N), c = N / G, L = new Float32Array((G + 1) * (G + 1));
    for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) L[j * (G + 1) + i] = hash2(i % G, j % G, seed);
    for (let y = 0; y < N; y++) {
      const gy = y / c, y0 = gy | 0, fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < N; x++) {
        const gx = x / c, x0 = gx | 0, fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
        const a = L[y0 * (G + 1) + x0], b = L[y0 * (G + 1) + x0 + 1], d0 = L[(y0 + 1) * (G + 1) + x0], d1 = L[(y0 + 1) * (G + 1) + x0 + 1];
        out[y * N + x] = (a + (b - a) * sx) * (1 - sy) + (d0 + (d1 - d0) * sx) * sy;
      }
    }
    return out;
  }
  function nrmTex(H, N, k) {
    const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N), d = img.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = (H[y * N + (x + 1) % N] - H[y * N + (x - 1 + N) % N]) * k, dy = (H[((y + 1) % N) * N + x] - H[((y - 1 + N) % N) * N + x]) * k;
      const l = Math.sqrt(dx * dx + dy * dy + 1), i = (y * N + x) * 4;
      d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (0.5 / l + 0.5) * 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4; return t;
  }
  /* панель со строчкой вдоль краёв (для граней «брусков») или с одним швом вдоль (для рукавов и штанин) */
  function seamTex(N, o) {
    const inset = o.inset || 0.07, dash = o.dash || 0.03, gap = o.gap || 0.018, w = o.w || 0.011;
    const n1 = vnoise(N, o.g1 || 5, o.seed || 1), n2 = vnoise(N, o.g2 || 20, (o.seed || 1) + 7);
    const H = new Float32Array(N * N), cv = document.createElement('canvas'); cv.width = cv.height = N;
    const g = cv.getContext('2d'), img = g.createImageData(N, N), d = img.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = 1 - y / N, i = y * N + x;
      let h = (o.amp || 1) * (0.65 * n1[i] + 0.35 * n2[i]), a = 0.92, dE, along;
      if (o.lineU != null) { dE = Math.abs(u - o.lineU); along = v * (o.alongK || 1); }
      else { const du = Math.min(u, 1 - u), dv = Math.min(v, 1 - v); if (du < dv) { dE = du; along = v; } else { dE = dv; along = u; } }
      if (Math.abs(dE - inset * 0.45) < w * 0.55) { h -= 0.45; a = 0.7; }
      if (Math.abs(dE - inset) < w && (along / (dash + gap)) % 1 < dash / (dash + gap)) { h += 0.55; a = 1; }
      if (o.quilt) {
        const q = o.quilt, vv = v * (o.quiltK || 1);
        let near = 9, lo = 0, hi = 1;
        for (let j = 0; j < q.length; j++) { const dq = Math.abs(vv - q[j]); if (dq < near) near = dq; if (q[j] <= vv) lo = Math.max(lo, q[j]); else hi = Math.min(hi, q[j]); }
        h += 0.55 * Math.sin(PI * clamp((vv - lo) / Math.max(0.01, hi - lo), 0, 1));
        if (near < w * 0.9) { h -= 0.9; a = 0.6; }
        else if (near < w * 1.8 && (u * 1 / (dash + gap)) % 1 < dash / (dash + gap)) a = Math.min(a, 0.85);
      }
      H[i] = h; const c8 = Math.round(a * 255); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = c8; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const map = new T.CanvasTexture(cv); map.wrapS = map.wrapT = T.RepeatWrapping; map.anisotropy = 4;
    return { map, nrm: nrmTex(H, N, o.k || 2.4) };
  }
  function makeTextures() {
    const N = 256, TX = {}, H = new Float32Array(N * N);
    const n4 = vnoise(N, 4, 11), n8 = vnoise(N, 8, 12), n16 = vnoise(N, 16, 15), n32 = vnoise(N, 32, 13), n64 = vnoise(N, 64, 14);
    for (let i = 0; i < N * N; i++) H[i] = 0.45 * n64[i] + 0.35 * n32[i] + 0.2 * n8[i];
    TX.fleece = nrmTex(H, N, 2.2);
    for (let i = 0; i < N * N; i++) { const v = n64[i]; H[i] = v * v * 0.8 + 0.2 * n32[i]; }
    TX.leather = nrmTex(H, N, 2.8);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) H[y * N + x] = Math.pow(Math.abs(Math.sin(PI * x / N * 8)), 0.6) + 0.06 * n32[y * N + x];
    TX.rib = nrmTex(H, N, 1.7);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) H[y * N + x] = 0.5 + 0.5 * Math.tanh(4 * Math.sin(2 * PI * y / N * 3)) + 0.04 * n32[y * N + x];
    TX.groove = nrmTex(H, N, 1.3);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const u = x / N, v = y / N; H[y * N + x] = 0.5 + 0.5 * Math.tanh(5 * Math.sin(2 * PI * (v * 6 + Math.abs(u - 0.5) * 2))); }
    TX.tread = nrmTex(H, N, 1.2);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) H[y * N + x] = 0.5 + 0.25 * Math.sin(2 * PI * x / N * 16) * Math.sin(2 * PI * y / N * 16);
    TX.weave = nrmTex(H, N, 1.4);
    for (let i = 0; i < N * N; i++) H[i] = 0.6 * n4[i] + 0.3 * n8[i] + 0.1 * n16[i];
    TX.nylon = nrmTex(H, N, 3.0);
    TX.jacket = seamTex(N, { seed: 3, amp: 0.8, k: 2.6, quilt: [0.3, 0.52, 0.74] });
    TX.sleeve = seamTex(N, { seed: 5, lineU: 0.5, alongK: 2, k: 2.4, amp: 0.8, quilt: [0.34, 0.5, 0.66] });
    TX.pants = seamTex(N, { seed: 7, lineU: 0.5, alongK: 2, g1: 16, g2: 48, amp: 0.7, k: 2.2 });
    TX.shoe = seamTex(N, { seed: 9, g1: 32, g2: 64, amp: 0.6, inset: 0.09, k: 2.6 });
    return TX;
  }
  const rep = (t, x, y) => { const c = t.clone(); c.needsUpdate = true; c.repeat.set(x, y == null ? x : y); return c; };

  /* ---------- геометрия ---------- */
  /* скруглённый брусок с сужением кверху; нормали считаются точно, без швов на рёбрах */
  function ingotGeo(w, h, d, r, tx, tz, segs) {
    const g = new T.BoxGeometry(w, h, d, segs, segs, segs);
    const pos = g.attributes.position, nor = g.attributes.normal;
    const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r, v = new T.Vector3(), n = new T.Vector3();
    const remap = (u, half) => { const a = Math.min(1, Math.abs(u) / half); return Math.sign(u) * half * (1 - Math.pow(1 - a, 2)); };
    const ds = (tx - 1) / h, dt = (tz - 1) / h;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      v.set(remap(v.x, w / 2), remap(v.y, h / 2), remap(v.z, d / 2));
      const ix = clamp(v.x, -hw, hw), iy = clamp(v.y, -hh, hh), iz = clamp(v.z, -hd, hd);
      n.set(v.x - ix, v.y - iy, v.z - iz);
      const len = n.length(); if (len > 1e-6) n.multiplyScalar(1 / len); else n.fromBufferAttribute(nor, i);
      v.set(ix + n.x * r, iy + n.y * r, iz + n.z * r);
      const ty = (v.y + h / 2) / h, s = lerp(1, tx, ty), t = lerp(1, tz, ty), x0 = v.x, z0 = v.z;
      v.x *= s; v.z *= t;
      n.set(n.x / s, n.y - ds * x0 * n.x / s - dt * z0 * n.z / t, n.z / t).normalize();
      pos.setXYZ(i, v.x, v.y, v.z); nor.setXYZ(i, n.x, n.y, n.z);
    }
    pos.needsUpdate = true; nor.needsUpdate = true;
    return g;
  }
  const roundBox = (w, h, d, r) => ingotGeo(w, h, d, r, 1, 1, 6);
  function capsuleGeo(r, len, segs) {
    const pts = [], n = 10;
    for (let i = 0; i <= n; i++) { const a = -PI / 2 + (i / n) * (PI / 2); pts.push(new T.Vector2(Math.max(1e-4, Math.cos(a) * r), -len / 2 + Math.sin(a) * r)); }
    for (let i = 0; i <= n; i++) { const a = (i / n) * (PI / 2); pts.push(new T.Vector2(Math.max(1e-4, Math.cos(a) * r), len / 2 + Math.sin(a) * r)); }
    return new T.LatheGeometry(pts, segs || 16);
  }
  /* своя форма полоски-«молнии» на боку кроссовка (dir — куда смотрит остриё) */
  function zigGeo(dir) {
    let p = [[-0.2, -0.032], [-0.035, 0.008], [-0.065, -0.026], [0.17, 0.032], [0.178, 0.048], [-0.015, 0.03], [0.012, 0.062], [-0.2, -0.004]];
    if (dir < 0) p = p.map(q => [-q[0], q[1]]).reverse();
    const s = new T.Shape(); p.forEach((q, i) => (i ? s.lineTo(q[0], q[1]) : s.moveTo(q[0], q[1]))); s.closePath();
    return new T.ExtrudeGeometry(s, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
  }
  /* объединяем неподвижные детали одного материала в одну сетку — меньше вызовов отрисовки на телефоне */
  function mergeStatic(group) {
    const by = new Map();
    for (const m of group.children.slice()) {
      if (!m.isMesh || m.isInstancedMesh || m.userData.keep || m.children.length || !m.geometry.attributes.uv) continue;
      const k = m.material.uuid; if (!by.has(k)) by.set(k, []); by.get(k).push(m);
    }
    by.forEach(list => {
      if (list.length < 2) return;
      let nV = 0, nI = 0;
      for (const m of list) { const g = m.geometry; nV += g.attributes.position.count; nI += g.index ? g.index.count : g.attributes.position.count; }
      const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), uv = new Float32Array(nV * 2), ind = nV > 65535 ? new Uint32Array(nI) : new Uint16Array(nI);
      const v = new T.Vector3(), nm = new T.Matrix3(); let vo = 0, io = 0;
      for (const m of list) {
        m.updateMatrix(); nm.getNormalMatrix(m.matrix);
        const g = m.geometry, P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, cnt = P.count;
        for (let i = 0; i < cnt; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(m.matrix); pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
          v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[(vo + i) * 3] = v.x; nor[(vo + i) * 3 + 1] = v.y; nor[(vo + i) * 3 + 2] = v.z;
          uv[(vo + i) * 2] = UV.getX(i); uv[(vo + i) * 2 + 1] = UV.getY(i);
        }
        if (g.index) { for (let i = 0; i < g.index.count; i++) ind[io + i] = g.index.getX(i) + vo; io += g.index.count; }
        else { for (let i = 0; i < cnt; i++) ind[io + i] = vo + i; io += cnt; }
        vo += cnt; group.remove(m);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
      geo.setIndex(new T.BufferAttribute(ind, 1)); geo.computeBoundingSphere();
      group.add(new T.Mesh(geo, list[0].material));
    });
  }

  /* ---------- материалы ---------- */
  function materials(cfg, TX) {
    const std = (c, r, m, x) => new T.MeshStandardMaterial(Object.assign({ color: col(c), roughness: r, metalness: m }, x || {}));
    const phys = (c, r, m, x) => new T.MeshPhysicalMaterial(Object.assign({ color: col(c), roughness: r, metalness: m }, x || {}));
    const basic = (c, x) => new T.MeshBasicMaterial(Object.assign({ color: col(c) }, x || {}));
    const rib = (rx, ry) => std(0x24262d, 0.9, 0, { normalMap: rep(TX.rib, rx, ry), normalScale: v2(1.5) });
    return {
      helmet: phys(cfg.helmet, 0.4, 0.2, { clearcoat: 1, clearcoatRoughness: 0.12 }),
      helmetDark: std(0x121318, 0.7, 0.15),
      bezel: phys(0x3a3d47, 0.36, 0.45, { clearcoat: 0.6, clearcoatRoughness: 0.2 }),
      accent: phys(cfg.accent, 0.32, 0.08, { clearcoat: 0.6, clearcoatRoughness: 0.25 }),
      jacket: phys(cfg.jacket, 0.55, 0, { map: TX.jacket.map, normalMap: TX.jacket.nrm, normalScale: v2(1.1), sheen: col(0xffb07a).multiplyScalar(0.15) }),
      sleeve: phys(cfg.jacket, 0.55, 0, { map: rep(TX.sleeve.map, 1, 1), normalMap: rep(TX.sleeve.nrm, 1, 1), normalScale: v2(1.1), sheen: col(0xffb07a).multiplyScalar(0.15) }),
      jacketDark: std(0x2a1306, 0.8, 0),
      ribCuff: rib(5, 1), ribCuff2: rib(4, 1), ribCollar: rib(7, 1), ribHem: rib(5.5, 1), rib: rib(1, 1),
      hood: std(cfg.rib, 0.9, 0, { normalMap: rep(TX.fleece, 3, 2), normalScale: v2(0.6) }),
      hoodIn: std(cfg.rib, 0.9, 0, { side: T.DoubleSide, normalMap: rep(TX.fleece, 4, 3), normalScale: v2(0.6) }),
      pants: phys(cfg.pants, 0.88, 0, { map: TX.pants.map, normalMap: TX.pants.nrm, normalScale: v2(0.6), sheen: col(0x8890a8).multiplyScalar(0.25) }),
      pantsFlat: std(cfg.pants, 0.9, 0, { normalMap: rep(TX.fleece, 2, 2), normalScale: v2(0.5) }),
      glove: std(0x2a2c33, 0.42, 0.05, { normalMap: rep(TX.leather, 3, 2), normalScale: v2(0.5) }),
      pad: std(0x101115, 0.5, 0.05, { normalMap: rep(TX.leather, 6, 2), normalScale: v2(0.5) }),
      shoe: std(0x26282e, 0.46, 0.04, { map: TX.shoe.map, normalMap: TX.shoe.nrm, normalScale: v2(0.4) }),
      shoeCap: std(0x34373f, 0.4, 0.05, { map: rep(TX.shoe.map, 1, 1), normalMap: rep(TX.shoe.nrm, 1, 1), normalScale: v2(0.4) }),
      sole: std(0xf1ebe0, 0.6, 0, { normalMap: rep(TX.groove, 1, 1), normalScale: v2(0.5) }),
      outsole: std(0x2a2b30, 0.85, 0, { normalMap: rep(TX.tread, 1, 1), normalScale: v2(0.8) }),
      lace: std(0xf3f0e8, 0.75, 0, { normalMap: rep(TX.weave, 1, 1), normalScale: v2(0.6) }),
      air: phys(0xbfe6ff, 0.05, 0, { transparent: true, opacity: 0.55, clearcoat: 1 }),
      cord: std(0xeceae4, 0.8, 0, { normalMap: rep(TX.weave, 1, 4), normalScale: v2(0.5) }),
      zipTape: std(0x1a1b20, 0.85, 0),
      gold: phys(0xf2b43c, 0.22, 1, { clearcoat: 0.4, clearcoatRoughness: 0.2 }),
      goldDeep: std(0xdc922e, 0.32, 0.7), steel: std(0xb7bec8, 0.26, 0.9), red: basic(0xff4d5e),
      pend: phys(0xf2b43c, 0.2, 1, { emissive: col(0xff9a1f), emissiveIntensity: 0, clearcoat: 0.5 }),
      gift: std(0xff5d8f, 0.38, 0), ribbon: std(0xffd34d, 0.32, 0.25), cloth: std(0x86d6ff, 0.85, 0, { normalMap: rep(TX.fleece, 1, 1) }), tablet: std(0x1e2233, 0.28, 0.35),
      glint: new T.MeshBasicMaterial({ map: glintTex(), transparent: true, opacity: 0.22, depthWrite: false, blending: T.AdditiveBlending }),
      shadow: new T.MeshBasicMaterial({ map: radialTex('rgba(6,3,20,0.75)', 'rgba(6,3,20,0)'), transparent: true, depthWrite: false })
    };
  }

  /* ---------- светящееся лицо на визоре: рисуем глаза на холсте, обновляем только при изменении ---------- */
  function Face() {
    const S = 1.25, W = 640, H = 150, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding; tex.anisotropy = 4;
    let key = '';
    const rr = (x, y, w, h, r) => { r = Math.max(0, Math.min(r, w / 2, h / 2)); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    const starP = (ro, ri) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -PI / 2 + (i * PI) / 5, r = i % 2 ? ri : ro; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); };
    const text = (s, x, y, size) => { g.font = '900 ' + size + 'px system-ui,-apple-system,"Segoe UI",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y); };
    function eye(mode, x, y, open, tilt, sp) {
      g.save(); g.translate(x, y); g.rotate(tilt); g.scale(S, S);
      const w = 88, h = 52 * open;
      if (mode === 'happy') { g.lineWidth = 13; g.lineCap = 'round'; g.beginPath(); g.arc(0, 16, 30, PI * 1.15, PI * 1.85); g.stroke(); }
      else if (mode === 'grin') { g.beginPath(); g.ellipse(0, 12, 38, 34 * Math.max(open, 0.3), 0, PI, TAU); g.closePath(); g.fill(); }
      else if (mode === 'closed') { g.lineWidth = 10; g.lineCap = 'round'; g.beginPath(); g.arc(0, -16, 30, PI * 0.18, PI * 0.82); g.stroke(); }
      else if (mode === 'sad') { rr(-w / 2, -h * 0.3, w, Math.max(6, h * 0.62), 14); g.fill(); }
      else if (mode === 'O') { g.lineWidth = 11; g.beginPath(); g.arc(0, 0, 25, 0, TAU); g.stroke(); }
      else if (mode === 'flat') { rr(-w / 2, -6, w, 12, 6); g.fill(); }
      else if (mode === 'star') starP(36, 15);
      else if (mode === 'spiral') { g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); for (let a = 0; a <= TAU * 2.3; a += 0.16) { const r = 3 + a * 4.2, px = Math.cos(a + sp) * r, py = Math.sin(a + sp) * r * 0.8; if (a === 0) g.moveTo(px, py); else g.lineTo(px, py); } g.stroke(); }
      else if (mode === 'wide') { rr(-w * 0.56, -h * 0.64, w * 1.12, Math.max(6, h * 1.28), 18); g.fill(); }
      else { rr(-w / 2, -h / 2, w, Math.max(5, h), 17); g.fill(); }
      /* блик-искорка в глазу */
      if ((mode === 'calm' || mode === 'wide' || mode === 'round') && h > 18) { g.save(); g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.6)'; rr(-w / 2 + 12, -h / 2 + 7, 15, Math.max(5, h * 0.24), 5); g.fill(); g.restore(); }
      g.restore();
    }
    function draw(st, cfg, t) {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      g.save(); g.shadowColor = cfg.glowCss; g.shadowBlur = 32; g.fillStyle = cfg.glowCore; g.strokeStyle = cfg.glowCore;
      const cx = W / 2 + st.ex * 900 * S, cy = H * 0.5 + st.ey * -700 * S, dx = 100 * S, sp = t * 7;
      if (st.glyph === 'dots') text('• • • •', cx, cy + 4, 60 * S);
      else if (st.glyph === 'scan') { const p = (Math.sin(t * 2.6) + 1) / 2; rr(W * 0.2 + p * W * 0.44, cy - 9, 115, 18, 9); g.fill(); }
      else if (st.glyph) { text(st.glyph, cx - dx, cy + 3, 86 * S); text(st.glyph, cx + dx, cy + 3, 86 * S); }
      else { eye(st.mode, cx - dx, cy, st.open, -st.tilt, sp); eye(st.mode, cx + dx, cy, st.open, st.tilt, -sp); }
      if (st.z) { const ph = (t * 0.7) % 1; g.shadowBlur = 12; g.globalAlpha = 1 - ph; text('z', W * 0.8 + ph * 32, H * 0.36 - ph * 30, (26 + ph * 14) * S); g.globalAlpha = 1; }
      g.restore();
      g.fillStyle = 'rgba(0,0,0,0.3)';                 /* сетка светодиодов */
      for (let x = 0; x < W; x += 6) g.fillRect(x, 0, 1.4, H);
      for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 1.4);
      tex.needsUpdate = true;
    }
    return {
      tex,
      update(st, cfg, t) {
        const k = [st.mode, st.glyph, Math.round(st.open * 14), Math.round(st.ex * 500), Math.round(st.ey * 500), Math.round(st.tilt * 24), st.z ? Math.floor(t * 7) : 0, st.glyph === 'scan' ? Math.floor(t * 24) : 0, st.mode === 'spiral' ? Math.floor(t * 14) : 0].join('|');
        if (k !== key) { key = k; draw(st, cfg, t); }
      }
    };
  }

  /* ---------- персонаж: шлем с визором, наушники, бомбер, джоггеры, кроссовки с реактивными подошвами ---------- */
  const CFG = {
    slitok: { name: 'Слиток', helmet: 0x2b2d35, accent: 0xff9a1f, glow: 0xff9a1f, glowCss: '#ff8a00', glowCore: '#ffc46a', jacket: 0xbf4a12, rib: 0x18191e, pants: 0x22232a, shoe: 0x1d1f25 }
  };
  /* фронт куртки: на какой глубине поверхность на высоте y (координаты корпуса) */
  const frontZ = y => 0.31 * lerp(1, 0.94, clamp((y - 0.36 + 0.3) / 0.6, 0, 1));
  function buildStreet(M, cfg) {
    const R = { kind: 'street', cfg };
    R.glowC = col(cfg.glow); R.ringMat = new T.MeshBasicMaterial({ color: R.glowC.clone() });
    R.root = new T.Group(); R.hop = new T.Group(); R.root.add(R.hop);
    const sph = new T.SphereGeometry(1, 32, 24);
    const add = (par, geo, mat, x, y, z, rx, ry, rz, s) => {
      const m = new T.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.rotation.set(rx || 0, ry || 0, rz || 0);
      if (s != null) { if (typeof s === 'number') m.scale.setScalar(s); else m.scale.set(s[0], s[1], s[2]); }
      par.add(m); return m;
    };
    const keep = m => { m.userData.keep = true; return m; };
    const UPV = new T.Vector3(0, 1, 0);
    /* положить деталь на поверхность шлема: phi — по кругу (π/2 — центр лица), theta — от макушки вниз */
    const onHelmet = (m, phi, th, r, axis) => {
      const d = new T.Vector3(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
      m.position.set(d.x * r * 1.04, d.y * r * 0.97, d.z * r);
      m.quaternion.setFromUnitVectors(axis || new T.Vector3(0, 0, 1), d.normalize());
      return m;
    };
    const flameMat = new T.SpriteMaterial({ map: flameTex(), transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0 });
    const eyeletGeo = new T.TorusGeometry(0.011, 0.0045, 6, 12);

    /* --- кроссовок: подошва из двух слоёв с бороздками, окошко «воздуха», носок, пятка, петля, шнуровка, «молнии» по бокам --- */
    function sneaker(s, sx) {
      add(s, ingotGeo(0.36, 0.08, 0.6, 0.035, 1, 1, 8), M.sole, 0, 0.076, 0);
      add(s, ingotGeo(0.37, 0.036, 0.61, 0.016, 1, 1, 6), M.outsole, 0, 0.018, 0);
      add(s, ingotGeo(0.364, 0.013, 0.604, 0.006, 1, 1, 6), M.accent, 0, 0.115, 0);
      add(s, roundBox(0.01, 0.034, 0.13, 0.006), M.air, sx * 0.181, 0.075, -0.16);
      add(s, ingotGeo(0.32, 0.2, 0.5, 0.085, 0.86, 0.8, 12), M.shoe, 0, 0.205, -0.02);
      add(s, ingotGeo(0.305, 0.115, 0.17, 0.05, 0.9, 0.82, 10), M.shoeCap, 0, 0.165, 0.165);
      add(s, ingotGeo(0.285, 0.055, 0.11, 0.026, 1, 1, 6), M.sole, 0, 0.13, 0.236);
      add(s, ingotGeo(0.315, 0.14, 0.15, 0.05, 0.92, 1, 10), M.shoeCap, 0, 0.18, -0.2);
      add(s, new T.TorusGeometry(0.03, 0.011, 6, 14, PI), M.accent, 0, 0.29, -0.263, 0, PI / 2, PI / 2);
      add(s, new T.TorusGeometry(0.105, 0.032, 10, 24), M.shoeCap, 0, 0.305, -0.05, PI / 2, 0, 0, [1, 1.25, 1]);
      add(s, roundBox(0.11, 0.02, 0.13, 0.008), M.shoe, 0, 0.31, 0.04);
      for (let i = 0; i < 4; i++) {
        const z = -0.015 + i * 0.045, y = 0.308 - i * 0.007;
        add(s, roundBox(0.15, 0.014, 0.02, 0.006), M.lace, 0, y + 0.009, z, 0, i % 2 ? 0.32 : -0.32, 0);
        for (const e of [-1, 1]) add(s, eyeletGeo, M.steel, e * 0.078, y + 0.003, z, PI / 2, 0, 0);
      }
      for (const side of [-1, 1]) add(s, zigGeo(side > 0 ? -1 : 1), M.accent, side * 0.151, 0.19, -0.03, 0, side * PI / 2, 0, [1.15, 1.15, 1]);
    }

    /* --- ноги: штанина со швом, манжета-рибана, карго-карман с клапаном и кнопкой, лампас, кроссовок --- */
    const legGeo = capsuleGeo(0.135, 0.2, 24);
    R.legs = [];
    for (const sx of [-1, 1]) {
      const lg = new T.Group(); lg.position.set(sx * 0.19, 0.62, 0.02); R.hop.add(lg);
      add(lg, legGeo, M.pants, 0, -0.16, 0);
      add(lg, new T.TorusGeometry(0.12, 0.044, 10, 32), M.ribCuff, 0, -0.31, 0.005, PI / 2, 0, 0);
      add(lg, roundBox(0.035, 0.15, 0.17, 0.014), M.pantsFlat, sx * 0.135, -0.14, 0);
      add(lg, roundBox(0.042, 0.042, 0.18, 0.012), M.pantsFlat, sx * 0.142, -0.066, 0);
      add(lg, new T.CylinderGeometry(0.014, 0.014, 0.009, 14), M.steel, sx * 0.165, -0.07, 0, 0, 0, PI / 2);
      add(lg, roundBox(0.02, 0.36, 0.035, 0.008), M.accent, sx * 0.13, -0.16, -0.09);
      const s = new T.Group(); s.position.set(sx * 0.025, -0.62, 0.03); s.rotation.y = sx * 0.07; lg.add(s);
      sneaker(s, sx); mergeStatic(s);
      const fl = new T.Sprite(flameMat.clone()); fl.center.set(0.5, 1); fl.position.set(0, 0.0, -0.02); fl.scale.set(0.24, 0.46, 1); fl.visible = false; s.add(fl);
      mergeStatic(lg);
      R.legs.push({ g: lg, shoe: s, flame: fl });
    }

    /* --- корпус: бомбер с рибаной, молнией, карманом, цепочкой и шнурками капюшона --- */
    const B = R.bodyG = new T.Group(); B.position.y = 0.58; R.hop.add(B);
    add(B, roundBox(0.66, 0.2, 0.46, 0.09), M.pantsFlat, 0, 0.04, 0);
    add(B, ingotGeo(0.94, 0.6, 0.62, 0.22, 0.9, 0.94, 16), M.jacket, 0, 0.36, 0);
    add(B, ingotGeo(0.97, 0.09, 0.645, 0.045, 1, 1, 8), M.ribHem, 0, 0.1, 0);
    add(B, new T.TorusGeometry(0.21, 0.072, 12, 40), M.ribCollar, 0, 0.66, 0, PI / 2, 0, 0);
    R.hoodDown = keep(add(B, new T.TorusGeometry(0.3, 0.11, 12, 32, PI * 1.25), M.hood, 0, 0.66, -0.05, -PI / 2, 0, -PI * 0.125));
    for (const sx of [-1, 1]) add(B, roundBox(0.03, 0.42, 0.012, 0.006), M.rib, sx * 0.475, 0.36, 0, 0, 0, sx * 0.05);
    /* молния: лента, зубчики, бегунок с язычком */
    { const y0 = 0.13, y1 = 0.6, tilt = -0.031, mid = (y0 + y1) / 2;
      for (const sx of [-1, 1]) add(B, new T.BoxGeometry(0.012, y1 - y0, 0.004), M.zipTape, sx * 0.0085, mid, frontZ(mid) + 0.002, tilt, 0, 0);
      const n = 40, teeth = new T.InstancedMesh(new T.BoxGeometry(0.014, 0.0065, 0.006), M.gold, n), m4 = new T.Matrix4(), q = new T.Quaternion().setFromEuler(new T.Euler(tilt, 0, 0)), p = new T.Vector3(), sc = new T.Vector3(1, 1, 1);
      for (let i = 0; i < n; i++) { const y = y0 + (i + 0.5) * (y1 - y0) / n; p.set(i % 2 ? 0.004 : -0.004, y, frontZ(y) + 0.006); teeth.setMatrixAt(i, m4.compose(p, q, sc)); }
      B.add(teeth);
      add(B, roundBox(0.024, 0.032, 0.013, 0.005), M.gold, 0, 0.585, frontZ(0.585) + 0.011, tilt, 0, 0);
      add(B, roundBox(0.013, 0.046, 0.005, 0.0025), M.gold, 0, 0.552, frontZ(0.552) + 0.019, tilt + 0.12, 0, 0); }
    /* нагрудный карман на молнии */
    add(B, roundBox(0.13, 0.014, 0.01, 0.005), M.jacketDark, 0.25, 0.52, frontZ(0.52) + 0.003, 0, 0, 0.22);
    add(B, roundBox(0.014, 0.03, 0.005, 0.0025), M.gold, 0.2, 0.497, frontZ(0.5) + 0.009, 0, 0, 0.22);
    /* цепочка из звеньев и подвеска-слиток на колечке */
    { const n = 26, im = new T.InstancedMesh(new T.TorusGeometry(0.0125, 0.0042, 6, 12), M.gold, n), m4 = new T.Matrix4(), q = new T.Quaternion(), qx = new T.Quaternion(), p = new T.Vector3(), sc = new T.Vector3(1.35, 1, 1), ZA = new T.Vector3(0, 0, 1), XA = new T.Vector3(1, 0, 0);
      for (let i = 0; i < n; i++) {
        const a = PI + (i + 0.5) / n * PI, y = 0.6 + 0.175 * Math.sin(a);
        p.set(0.175 * Math.cos(a), y, frontZ(y) + 0.013);
        q.setFromAxisAngle(ZA, Math.atan2(Math.cos(a), -Math.sin(a))); qx.setFromAxisAngle(XA, i % 2 ? PI / 2 : 0); q.multiply(qx);
        im.setMatrixAt(i, m4.compose(p, q, sc));
      }
      B.add(im); }
    R.pend = keep(add(B, ingotGeo(0.13, 0.08, 0.045, 0.016, 0.8, 0.9, 6), M.pend, 0, 0.4, 0.325));
    add(B, new T.TorusGeometry(0.016, 0.005, 6, 14), M.gold, 0, 0.447, 0.322);
    /* шнурки капюшона с металлическими наконечниками — чуть покачиваются */
    R.cords = [];
    for (const sx of [-1, 1]) {
      const cg = new T.Group(); cg.position.set(sx * 0.115, 0.625, frontZ(0.62) + 0.035); B.add(cg);
      add(cg, new T.CylinderGeometry(0.0085, 0.0085, 0.16, 8), M.cord, 0, -0.08, 0);
      add(cg, new T.CylinderGeometry(0.011, 0.0085, 0.034, 10), M.steel, 0, -0.172, 0);
      R.cords.push(cg);
    }

    /* --- руки: рукав со швом, манжета, карман-пенал на левом рукаве, перчатка с пальцами --- */
    const sleeveGeo = capsuleGeo(0.125, 0.24, 24);
    const hand = (p, sx) => {
      const h = new T.Group(); h.position.y = -0.47; p.add(h);
      add(h, sph, M.glove, 0, 0.004, 0, 0, 0, 0, [0.1, 0.094, 0.1]);
      add(h, new T.TorusGeometry(0.082, 0.02, 8, 24), M.accent, 0, 0.062, 0, PI / 2, 0, 0);
      const fingers = [];
      for (let i = 0; i < 4; i++) {
        const f = new T.Group(); f.position.set(-sx * 0.012, -0.06, 0.046 - i * 0.031); h.add(f);
        const len = [0.058, 0.064, 0.06, 0.048][i];
        add(f, capsuleGeo(0.0235, len, 10), M.glove, 0, -len / 2 - 0.008, 0);
        fingers.push(f);
      }
      const th = new T.Group(); th.position.set(-sx * 0.07, -0.005, 0.05); h.add(th);
      add(th, capsuleGeo(0.026, 0.045, 10), M.glove, 0, -0.032, 0);
      th.rotation.set(0.55, 0, -sx * 0.6);
      return { h, fingers, thumb: th };
    };
    const arm = sx => {
      const p = new T.Group(); p.position.set(sx * 0.5, 0.58, 0); B.add(p);
      add(p, sleeveGeo, M.sleeve, 0, -0.2, 0);
      add(p, new T.TorusGeometry(0.105, 0.038, 10, 28), M.ribCuff2, 0, -0.4, 0, PI / 2, 0, 0);
      if (sx < 0) {
        add(p, roundBox(0.03, 0.12, 0.15, 0.012), M.rib, sx * 0.118, -0.12, 0.02);
        const dot = add(p, new T.CircleGeometry(0.028, 18), R.ringMat, sx * 0.135, -0.12, 0.02, 0, -PI / 2, 0);
        dot.userData.keep = true;
        add(p, roundBox(0.006, 0.026, 0.012, 0.003), M.gold, sx * 0.136, -0.067, 0.062);
        for (const dz of [-0.035, -0.012]) add(p, capsuleGeo(0.006, 0.03, 8), M.steel, sx * 0.136, -0.065, dz);
      }
      const H = hand(p, sx);
      mergeStatic(p);
      return { p, h: H.h, fingers: H.fingers, thumb: H.thumb };
    };
    R.armL = arm(-1); R.armR = arm(1);

    /* --- голова: глянцевый шлем, гребень с канавками, визор со светодиодами и бликом, винтики, решётка на подбородке --- */
    const Hd = R.head = new T.Group(); Hd.position.y = 1.13; B.add(Hd);
    add(Hd, new T.SphereGeometry(0.56, 64, 48), M.helmet, 0, 0, 0, 0, 0, 0, [1.04, 0.97, 1]);
    add(Hd, new T.TorusGeometry(0.578, 0.036, 12, 72, 2.3), M.accent, 0, 0, 0, 0, PI / 2, 0.25, [1, 0.97, 1]);
    for (const sx of [-1, 1]) add(Hd, new T.TorusGeometry(0.5635, 0.0062, 6, 72, 2.2), M.helmetDark, sx * 0.064, 0, 0, 0, PI / 2, 0.3, [1, 0.97, 1]);
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) { const v = onHelmet(add(Hd, roundBox(0.012, 0.075, 0.014, 0.005), M.helmetDark), PI / 2 - sx * (0.62 + i * 0.1), 0.72, 0.557); v.rotateZ(sx * 0.25); }
    const VPH = 2.5, VT0 = 1.36, VTL = 0.62;
    add(Hd, new T.SphereGeometry(0.574, 64, 16, PI / 2 - (VPH + 0.14) / 2, VPH + 0.14, VT0 - 0.06, VTL + 0.12), M.bezel, 0, 0, 0, 0, 0, 0, [1.04, 0.97, 1]);
    R.face = Face();
    R.visorMat = new T.MeshPhysicalMaterial({ color: col(0x040507), roughness: 0.06, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.04, emissive: 0xffffff, emissiveMap: R.face.tex, emissiveIntensity: 1.25 });
    keep(add(Hd, new T.SphereGeometry(0.584, 80, 24, PI / 2 - VPH / 2, VPH, VT0, VTL), R.visorMat, 0, 0, 0, 0, 0, 0, [1.04, 0.97, 1]));
    keep(add(Hd, new T.SphereGeometry(0.5905, 40, 4, PI / 2 - 0.95, 0.75, VT0 + 0.07, 0.085), M.glint, 0, 0, 0, 0, 0, 0, [1.04, 0.97, 1])).castShadow = false;
    add(Hd, new T.SphereGeometry(0.566, 48, 4, PI / 2 - 1.1, 2.2, VT0 + VTL + 0.2, 0.025), M.bezel, 0, 0, 0, 0, 0, 0, [1.04, 0.97, 1]);
    const boltGeo = new T.CylinderGeometry(0.021, 0.023, 0.012, 18), slotGeo = new T.BoxGeometry(0.03, 0.0035, 0.004);
    for (const sx of [-1, 1]) {
      const b = onHelmet(add(Hd, boltGeo, M.steel), PI / 2 - sx * 1.02, VT0 + VTL + 0.04, 0.582, UPV);
      const s1 = onHelmet(add(Hd, slotGeo, M.helmetDark), PI / 2 - sx * 1.02, VT0 + VTL + 0.04, 0.589);
      s1.rotateZ(sx * 0.6);
      b.rotateY(0.3);
    }
    for (let i = 0; i < 3; i++) onHelmet(add(Hd, roundBox(0.11 - i * 0.022, 0.013, 0.012, 0.005), M.helmetDark), PI / 2, VT0 + VTL + 0.13 + i * 0.07, 0.557);
    /* наушники: оголовье с мягкой накладкой, кольца-подсветка, вилки, амбушюры из кожи */
    R.phones = new T.Group(); Hd.add(R.phones);
    add(R.phones, new T.TorusGeometry(0.61, 0.034, 12, 72, PI), M.helmet, 0, 0, 0, 0, 0, 0, [1, 0.98, 1]);
    add(R.phones, new T.TorusGeometry(0.643, 0.028, 10, 40, 0.95), M.pad, 0, 0, 0, 0, 0, PI / 2 - 0.475, [1, 0.98, 1.7]);
    const cupProf = [[0.001, -0.066], [0.13, -0.066], [0.156, -0.058], [0.166, -0.038], [0.166, 0.038], [0.156, 0.058], [0.13, 0.066], [0.001, 0.066]].map(q => new T.Vector2(q[0], q[1]));
    const cupGeo = new T.LatheGeometry(cupProf, 40);
    for (const sx of [-1, 1]) {
      add(R.phones, cupGeo, M.helmet, sx * 0.605, -0.04, 0, 0, 0, sx * PI / 2);
      add(R.phones, new T.TorusGeometry(0.13, 0.05, 12, 32), M.pad, sx * 0.55, -0.04, 0, 0, PI / 2, 0);
      keep(add(R.phones, new T.TorusGeometry(0.118, 0.017, 8, 40), R.ringMat, sx * 0.674, -0.04, 0, 0, PI / 2, 0));
      add(R.phones, new T.CircleGeometry(0.1, 32), M.bezel, sx * 0.673, -0.04, 0, 0, sx * PI / 2, 0);
      add(R.phones, new T.CylinderGeometry(0.022, 0.022, 0.006, 18), M.gold, sx * 0.676, -0.04, 0, 0, 0, PI / 2);
      add(R.phones, roundBox(0.03, 0.05, 0.05, 0.01), M.steel, sx * 0.598, 0.135, 0);
    }
    mergeStatic(R.phones);
    /* антенна (нет связи) */
    R.ant = new T.Group(); R.ant.visible = false; R.ant.position.set(-0.24, 0.47, -0.05); R.ant.rotation.z = 0.25; Hd.add(R.ant);
    add(R.ant, new T.CylinderGeometry(0.012, 0.016, 0.3, 10), M.steel, 0, 0.15, 0);
    R.antMat = M.red.clone(); add(R.ant, new T.SphereGeometry(0.045, 16, 12), R.antMat, 0, 0.32, 0);
    /* капюшон на голове: ночь, сон, скрытые суммы */
    R.hoodUp = keep(add(Hd, new T.SphereGeometry(0.67, 48, 28, PI / 2 + 0.92, TAU - 1.84, 0, 2.2), M.hoodIn, 0, 0.04, -0.03, 0, 0, 0, [1.04, 1, 1.02]));
    R.hoodUp.visible = false;
    /* тряпочка (полирует шлем и цифры) и планшет */
    R.cloth = add(R.armL.h, roundBox(0.22, 0.06, 0.17, 0.025), M.cloth, 0.03, -0.07, 0.06); R.cloth.visible = false;
    R.tablet = new T.Group(); R.tablet.visible = false; R.tablet.position.set(-0.09, -0.04, 0.13); R.armR.h.add(R.tablet);
    R.tablet.add(new T.Mesh(roundBox(0.46, 0.32, 0.035, 0.03), M.tablet));
    const scr = new T.Mesh(new T.PlaneGeometry(0.4, 0.26), new T.MeshBasicMaterial({ map: canvasTex(128, (g, s) => {
      g.fillStyle = '#0d1424'; g.fillRect(0, 0, s, s); g.strokeStyle = '#4fe3a8'; g.lineWidth = 6; g.lineJoin = 'round';
      g.beginPath(); [[8, 96], [30, 80], [48, 88], [70, 52], [90, 62], [118, 22]].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(118, 22, 7, 0, TAU); g.fill();
    }, true) }));
    scr.position.z = 0.019; R.tablet.add(scr);
    mergeStatic(B); mergeStatic(Hd);
    /* тени: персонаж отбрасывает тень сам на себя (голова на воротник, руки на куртку) */
    R.root.traverse(o => { if (o.isMesh && !(o.material && (o.material.transparent || o.material.isMeshBasicMaterial))) { o.castShadow = true; o.receiveShadow = true; } });
    R.topY = 0.58 + 1.13 + 0.62;
    return R;
  }

  /* ---------- предметы для сцен ---------- */
  function buildProps(M, R, scene) {
    const P = {};
    const coin = new T.Group(); coin.visible = false; scene.add(coin); P.coin = coin;
    const cd = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, 0.045, 36), M.gold); cd.rotation.x = PI / 2; coin.add(cd);
    const cr = new T.Mesh(new T.TorusGeometry(0.13, 0.014, 8, 36), M.goldDeep); cr.position.z = 0.024; coin.add(cr);
    const gift = new T.Group(); gift.visible = false; R.root.add(gift); P.gift = gift;
    const gb = new T.Mesh(roundBox(0.38, 0.32, 0.38, 0.04), M.gift); gb.position.y = 0.16; gift.add(gb);
    const r1 = new T.Mesh(new T.BoxGeometry(0.08, 0.33, 0.39), M.ribbon); r1.position.y = 0.16; gift.add(r1);
    const r2 = new T.Mesh(new T.BoxGeometry(0.39, 0.33, 0.08), M.ribbon); r2.position.y = 0.16; gift.add(r2);
    P.giftLid = new T.Group(); P.giftLid.position.y = 0.34; gift.add(P.giftLid);
    P.giftLid.add(new T.Mesh(roundBox(0.42, 0.08, 0.42, 0.03), M.gift));
    for (const sx of [-1, 1]) { const b = new T.Mesh(new T.TorusGeometry(0.07, 0.024, 8, 16), M.ribbon); b.position.set(sx * 0.065, 0.09, 0); b.rotation.z = sx * 0.6; P.giftLid.add(b); }
    const tro = new T.Group(); tro.visible = false; R.root.add(tro); P.trophy = tro;
    const prof = [[0.001, 0], [0.13, 0], [0.13, 0.035], [0.05, 0.06], [0.035, 0.17], [0.06, 0.2], [0.17, 0.25], [0.2, 0.43], [0.18, 0.44], [0.15, 0.27], [0.001, 0.23]].map(p => new T.Vector2(p[0], p[1]));
    tro.add(new T.Mesh(new T.LatheGeometry(prof, 32), M.gold));
    for (const sx of [-1, 1]) { const hdl = new T.Mesh(new T.TorusGeometry(0.07, 0.018, 8, 16, PI * 1.2), M.goldDeep); hdl.position.set(sx * 0.2, 0.33, 0); hdl.rotation.z = sx > 0 ? -PI * 0.6 : PI * 0.4; tro.add(hdl); }
    P.blocks = [0, 1, 2].map(() => { const b = new T.Mesh(roundBox(0.17, 0.17, 0.17, 0.035), M.goldDeep); b.visible = false; R.root.add(b); return b; });
    [coin, gift, tro].concat(P.blocks).forEach(o => o.traverse(m => { if (m.isMesh) m.castShadow = true; }));
    P.beam = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: beamTex(), color: col(0xffb54a), transparent: true, blending: T.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0 }));
    P.beam.visible = false; P.beam.renderOrder = 10; scene.add(P.beam);
    /* мягкая тень на «полу» карточки: горизонтальное пятно (камера смотрит чуть сверху — видно эллипсом) */
    P.shadow = new T.Mesh(new T.PlaneGeometry(1.5, 0.95), M.shadow); P.shadow.rotation.x = -PI / 2; scene.add(P.shadow);
    return P;
  }

  /* ---------- искры, конфетти, салют, пламя (в мировых координатах) ---------- */
  function Particles(parent, tex) {
    const N = 220, geo = new T.BufferGeometry(), pos = new Float32Array(N * 3), colr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = -99;
    geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('color', new T.BufferAttribute(colr, 3));
    const mat = new T.PointsMaterial({ size: 7, sizeAttenuation: false, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
    const pts = new T.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5; parent.add(pts);
    const P = Array.from({ length: N }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, gr: 0 }));
    let cur = 0;
    return {
      emit(o, n, opt) {
        opt = opt || {}; const cs = (opt.colors || ['#ffd36b']).map(c => new T.Color(c));
        for (let i = 0; i < n; i++) {
          const p = P[cur], j = cur * 3; cur = (cur + 1) % N;
          if (opt.vel) { const jt = opt.jit == null ? 0.15 : opt.jit; p.vx = opt.vel[0] + rnd(-jt, jt); p.vy = opt.vel[1] + rnd(-jt, jt); p.vz = opt.vel[2] || 0; }
          else {
            const a = Math.random() * TAU, e = (opt.up ? rnd(0.3, 1) : rnd(-1, 1)) * (opt.cone || PI / 2), sp = rnd(0.5, 1) * (opt.speed || 1.2);
            p.vx = Math.cos(a) * Math.cos(e) * sp; p.vy = Math.sin(e) * sp + (opt.lift || 0); p.vz = Math.sin(a) * Math.cos(e) * sp * 0.5;
          }
          p.life = p.max = rnd(0.6, 1) * (opt.life || 1); p.gr = opt.gravity == null ? 2.2 : opt.gravity;
          const c = pick(cs); p.r = c.r; p.g = c.g; p.b = c.b;
          pos[j] = o.x + rnd(-0.04, 0.04); pos[j + 1] = o.y; pos[j + 2] = (o.z || 0) + rnd(-0.04, 0.04);
        }
        this.dirty = true;
      },
      update(dt) {
        let any = false;
        for (let i = 0; i < N; i++) {
          const p = P[i], j = i * 3; if (p.life <= 0) continue; any = true;
          p.life -= dt; p.vy -= p.gr * dt;
          pos[j] += p.vx * dt; pos[j + 1] += p.vy * dt; pos[j + 2] += p.vz * dt;
          const f = clamp(p.life / p.max, 0, 1); colr[j] = p.r * f; colr[j + 1] = p.g * f; colr[j + 2] = p.b * f;
          if (p.life <= 0) pos[j + 1] = -99;
        }
        if (any || this.dirty) { geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; this.dirty = any; }
        return any;
      }
    };
  }

  /* ---------- фразы для голоса (номер фразы = группа.индекс); на экран не выводятся ---------- */
  const PHRASES = /*PHRASES*/{"intro":["Привет! Я Слиток, робот-хранитель твоего биткоина. Нажми на меня!"],"tap":["Бип-буп!","Привет!","Щекотно!","Я на посту.","Слиток на связи!","Все системы в норме.","Всё под контролем.","Ой! Кто здесь?"],"tapNight":[{"t":"Тише… ночь.","w":1},{"t":"Я тут. Шепчу, чтобы никого не разбудить.","w":1}],"dizzy":["Ошибка! Голова кружится!","Перегрев! Перегрев!"],"dance":["Па-па-пам!","Танцевальный режим!"],"carry":["Эй! Куда несёшь?","Ух ты, я лечу!"],"drop":["Приземлился!","Мягкая посадка."],"deposit":["Пополнение принято!","Звенит приятно!","Ещё немного в копилку."],"buy":["Взяли. Теперь держим.","Покупка по плану — люблю.","Монета в копилке."],"sellProfit":["Прибыль в кармане!","Зафиксировали. Хорошая работа."],"sellLoss":["Бывает. Главное — остаться в игре.","Опыт — тоже капитал."],"airdrop":["Подарок с неба!","Бесплатно — моё любимое слово."],"signal":["Сигнал на покупку!","Уровень сработал — можно докупить."],"news":["Есть новый сигнал — загляни.","Пришёл сигнал, проверь."],"hunter":["Скидки! Лесенка сработала.","Распродажа, а не трагедия."],"ath":["Новый максимум биткоина!","Вот это высота!"],"athPort":["Портфель на максимуме!"],"milestone":["Новый рубеж взят!"],"coinUp":["Монета разогналась!"],"coinDown":["Монета просела."],"up":["Неплохо идём.","Рынок улыбается."],"rocket":["Ух, полетели!","Вот это день!"],"down":["Видали и хуже. Держим.","Терпение — моя суперсила."],"crash":["Спокойно. Паника — плохой советчик.","Шторм пройдёт. Держим курс."],"bored":["Скучновато…","Пересчитаю-ка блоки.",{"t":"21 миллион — и ни монетой больше.","s":"Двадцать один миллион — и ни монетой больше."}],"night":[{"t":"Ночь. Рынок не спит, а я посплю.","w":1}],"wake":["А? Я не сплю! Я на посту."],"hide":["Ничего не вижу!"],"offline":["Ищу сигнал…"],"screen":["Свежий подбор альткоинов готов!"],"wipe":["Протру цифры — пусть блестят.","Чистота — залог прибыли!"],"wipeDone":["Блестит!","Как новенькие."],"sit":["Посижу тут, посмотрю.","Отличный вид отсюда."],"zap":["Обновляю цифры!","Цена сменилась — переставлю."]}/*/PHRASES*/;
  const MILES = [1000, 2000, 3000, 5000, 7000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 200000, 250000, 500000, 1000000];

  /* ---------- стили: слой поверх карточки, значки, табличка, перекатывание цифр ---------- */
  const CSS = `
.ms-cv{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
.ms-hit{position:absolute;left:0;top:0;width:56px;height:90px;pointer-events:auto;touch-action:pan-y;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;cursor:pointer;z-index:2;border-radius:28px;outline:none}
.ms-hit:focus-visible{box-shadow:0 0 0 2px rgba(255,154,31,.65)}
.ms-float{position:absolute;left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;z-index:3;white-space:nowrap;opacity:0;transition:opacity .2s}
.ms-float.on{opacity:1}
.ms-alert{width:22px;height:22px;border-radius:50%;background:#ff4d6d;color:#fff;font-weight:800;font-size:14px;display:grid;place-items:center;box-shadow:0 0 0 3px rgba(255,77,109,.25),0 6px 14px -4px #000}
.ms-alert.on{animation:msPop .6s cubic-bezier(.2,.9,.3,1.4)}
.ms-sign{padding:4px 9px;border-radius:9px;background:#fff7e0;color:#2b1a05;font-weight:800;font-size:12.5px;box-shadow:0 6px 14px -6px #000}
.ms-sign.neg{background:#ffe1e4;color:#5a0f1a}
@keyframes msPop{0%{transform:translate(-50%,-100%) scale(.2)}100%{transform:translate(-50%,-100%) scale(1)}}
.ms-dg{position:relative;display:inline-block}
.ms-dg>i{display:inline-block;font-style:normal;animation:msDgIn .5s cubic-bezier(.2,.9,.3,1.25) both}
.ms-dg>b{position:absolute;left:0;top:0;font-weight:inherit;animation:msDgOut .45s ease-in both;pointer-events:none}
.ms-dg.d>i{animation-name:msDgInD}.ms-dg.d>b{animation-name:msDgOutD}
@keyframes msDgIn{from{transform:translateY(.62em);opacity:0}to{transform:none;opacity:1}}
@keyframes msDgOut{to{transform:translateY(-.62em);opacity:0}}
@keyframes msDgInD{from{transform:translateY(-.62em);opacity:0}to{transform:none;opacity:1}}
@keyframes msDgOutD{to{transform:translateY(.62em);opacity:0}}
.ms-zing{animation:msZing .8s ease-out}
@keyframes msZing{0%{text-shadow:0 0 0 rgba(255,170,60,0)}25%{text-shadow:0 0 14px rgba(255,170,60,.95)}100%{text-shadow:0 0 0 rgba(255,170,60,0)}}
.ms-shine{animation:msShine 1.2s ease-out}
@keyframes msShine{0%{text-shadow:0 0 0 rgba(255,236,190,0);filter:none}30%{text-shadow:0 0 16px rgba(255,226,160,.95),0 0 3px #fff;filter:brightness(1.4)}100%{text-shadow:0 0 0 rgba(255,236,190,0);filter:none}}
@media (prefers-reduced-motion:reduce){.ms-float{transition:none}.ms-alert.on,.ms-zing,.ms-shine{animation:none}}`;

  /* ---------- состояние ---------- */
  let host, hero, A = {}, renderer, scene, camera, keyLight, M, R, PR, PT, raf = 0, inView = true, lastF = 0, inited = false, firstFrame = false;
  const ST = {
    mood: 'calm', moodSince: 0, pct: null, go: false, fresh: 0, offline: false, offSince: 0, hide: false, sound: true,
    lastInput: now(), lastEvent: now(), nextAct: 0, lastJob: '', nextSignal: 0, lastAuto: -1e9, lastEv: -1e9, lastTap: 0, tapTimer: 0, taps: [],
    nextBlink: 0, blinkT: -9, gx: 0, gy: 0, nextGaze: 0, spin: 0, spinV: 0, drag: null, reduced: false, intensity: 0.7, money: null,
    signText: '', signNeg: false, wiping: 0, talk: 0, lastZap: -1e9, numPend: null, numZap: null, hum: false, nextThr: 0, music: false, noBrain: false, userUntil: 0, introPending: false
  };
  const BL = { ready: false, tx: new Set(), real: 0, alert: '', ath: 0, screen: '' };
  let act = null, JOB = null; const queue = [];
  const C = {}; /* текущая поза (сглаженная) */
  const ui = {};
  /* раскладка: 1 единица сцены = U пикселей по горизонтали; камера смотрит чуть сверху (TILT) */
  const TILT = 0.157, CT = Math.cos(TILT), STL = Math.sin(TILT);
  const LY = { U: 42, W: 300, H: 260, yc: 3.4, heroL: 0, heroR: 8, edge: 1.3, top: 6, ground: 1.6, minX: 1, maxX: 7, home: 6.9, ok: false };
  const LOC = { x: 6.9, y: 1.6, yaw: -0.24, yawT: -0.24, mode: 'stand', tx: 0, ph: 0, sitK: 0, hop: null, fx: 0, fy: 0, flyDone: true, vx: 0, vy: 0, cx: 0, cy: 0, gx: 0, gy: 0, squash: -9, hold: false, frozen: false };
  const SEAT = 0.56, HAND_H = 1.18;

  /* ---------- раскладка: карточка баланса → координаты сцены ---------- */
  const pxX = x => x * LY.U;
  const pxY = (y, z) => LY.H / 2 - ((y - LY.yc) * CT - (z || 0) * STL) * LY.U;      /* мир → пиксели слоя сверху */
  const wY = (py, z) => LY.yc + ((LY.H / 2 - py) / LY.U + (z || 0) * STL) / CT;    /* пиксели слоя → мир на глубине z */
  const atZ = (p, z) => ({ x: p.x, y: p.y + z * STL / CT, z });                    /* та же точка экрана, но на глубине z */
  function measure() {
    if (!host || !camera) return false;
    const lr = host.getBoundingClientRect(); if (lr.width < 40 || lr.height < 40) return false;
    const hr = (hero || host).getBoundingClientRect(), U = LY.U;
    LY.W = lr.width; LY.H = lr.height; LY.yc = LY.H / U / 2;
    LY.heroL = (hr.left - lr.left) / U; LY.heroR = (hr.right - lr.left) / U;
    LY.edge = wY(hr.bottom - lr.top); LY.top = wY(hr.top - lr.top);
    LY.ground = wY(hr.bottom - lr.top - 11);
    LY.minX = LY.heroL + 0.8; LY.maxX = Math.max(LY.minX, LY.heroR - 0.8); LY.home = LY.maxX - 0.1;
    const hw = LY.W / U / 2, hh = LY.H / U / 2;
    camera.left = -hw; camera.right = hw; camera.top = hh; camera.bottom = -hh;
    camera.position.set(hw, LY.yc + 30 * STL, 30 * CT); camera.lookAt(hw, LY.yc, 0); camera.updateProjectionMatrix();
    renderer.setSize(LY.W, LY.H, false);
    if (!LY.ok) { LOC.x = LY.home; LOC.y = LY.ground; LY.ok = true; }
    else {
      LOC.x = clamp(LOC.x, LY.minX - 0.5, LY.maxX);
      if (LOC.mode === 'stand' || LOC.mode === 'walk') LOC.y = LY.ground; else if (LOC.mode === 'sit') LOC.y = LY.edge - SEAT;
    }
    return true;
  }
  const midX = () => (LY.heroL + LY.heroR) / 2;
  const idleYaw = () => (LOC.x > midX() ? -0.24 : 0.24);
  function toWorld(cx, cy) { const lr = host.getBoundingClientRect(); return { x: (cx - lr.left) / LY.U, y: wY(cy - lr.top) }; }
  function rectW(r, lr) {
    lr = lr || host.getBoundingClientRect(); const U = LY.U;
    return { l: (r.left - lr.left) / U, r: (r.right - lr.left) / U, b: wY(r.bottom - lr.top), t: wY(r.top - lr.top), cx: (r.left + r.width / 2 - lr.left) / U, cy: wY(r.top + r.height / 2 - lr.top) };
  }
  const isNight = () => { const h = ST.forceHour != null ? ST.forceHour : new Date().getHours(); return h < 7; };

  /* ---------- звук: голос (готовые фразы) и синтезированные звуки ---------- */
  const AU = { c: null, out: null, sfx: null, vo: null, an: null, td: null, nb: null, pack: null, raw: null, loading: false, failed: false, cache: new Map(), cur: null, hum: null, want: null, unlocked: false };
  function au() {
    if (!ST.sound || document.hidden || !A.audio) return null;
    let c = null; try { c = A.audio(); } catch (e) { c = null; }
    if (!c) return null;
    /* пока телефон не «разрешил» звук (до первого касания), ничего не копим — иначе всё прозвучит разом потом */
    if (c.state !== 'running' && now() - (AU.gestureT || -9) > 1.5) return null;
    if (AU.c !== c) {
      AU.c = c; AU.cache.clear(); AU.cur = null; AU.hum = null;
      AU.out = c.createGain(); AU.out.gain.value = 0.9; AU.out.connect(c.destination);
      AU.sfx = c.createGain(); AU.sfx.gain.value = 0.6; AU.sfx.connect(AU.out);
      AU.vo = c.createGain(); AU.vo.gain.value = 1;
      AU.an = c.createAnalyser(); AU.an.fftSize = 256; AU.td = new Uint8Array(AU.an.fftSize);
      AU.vo.connect(AU.an); AU.an.connect(AU.out);
      const n = c.sampleRate, nb = c.createBuffer(1, n, n), d = nb.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      AU.nb = nb;
    }
    return c;
  }
  /* первое касание экрана «разрешает» звук (так требуют iPhone и Android) */
  function unlock() {
    AU.gestureT = now();
    const c = au(); if (!c) return;
    if (!AU.unlocked) { try { const s = c.createBufferSource(); s.buffer = c.createBuffer(1, 1, 22050); s.connect(c.destination); s.start(0); AU.unlocked = true; } catch (e) {} }
    loadPack();
  }
  function tone(c, o) {
    const os = c.createOscillator(), g = c.createGain(), t0 = o.t, d = o.d;
    os.type = o.type || 'sine'; os.frequency.setValueAtTime(o.f, t0);
    if (o.f2) os.frequency.exponentialRampToValueAtTime(o.f2, t0 + (o.glide || d));
    if (o.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = o.vib[0]; lg.gain.value = o.vib[1]; l.connect(lg); lg.connect(os.frequency); l.start(t0); l.stop(t0 + d + 0.05); }
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.v), t0 + Math.min(0.012, d * 0.25)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    let out = g;
    if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; g.connect(f); out = f; }
    os.connect(g); out.connect(AU.sfx); os.start(t0); os.stop(t0 + d + 0.05);
  }
  function noise(c, o) {
    const s = c.createBufferSource(), bq = c.createBiquadFilter(), g = c.createGain(), t0 = o.t;
    s.buffer = AU.nb; bq.type = o.type || 'bandpass'; bq.frequency.setValueAtTime(o.f, t0); if (o.f2) bq.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.d); bq.Q.value = o.q || 1;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(o.v, t0 + Math.min(0.02, o.d * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.d);
    s.connect(bq); bq.connect(g); g.connect(AU.sfx); s.start(t0, Math.random() * 0.5); s.stop(t0 + o.d + 0.05);
  }
  function sfx(name, opt) {
    const c = au(); if (!c) return;
    const t = c.currentTime + 0.01, v = ((opt && opt.vol) || 1) * (isNight() ? 0.5 : 1), up = !!(opt && opt.up);
    try {
      switch (name) {
        case 'tap': tone(c, { type: 'triangle', f: 620, f2: 1240, t, d: 0.07, v: 0.05 * v, lp: 4000 }); tone(c, { f: 1500, f2: 2000, t: t + 0.065, d: 0.09, v: 0.06 * v }); break;
        case 'happy': [880, 1175, 1480, 1976].forEach((f, i) => tone(c, { type: 'triangle', f, f2: f * 1.05, t: t + i * 0.065, d: 0.09, v: 0.04 * v, lp: 4000 })); break;
        case 'blips': for (let i = 0; i < 5; i++) { const f = rnd(700, 2200); tone(c, { type: i % 2 ? 'triangle' : 'sine', f, f2: f * rnd(0.7, 1.4), t: t + i * 0.075, d: 0.06, v: 0.04 * v, lp: 4500 }); } break;
        case 'sad': tone(c, { type: 'triangle', f: 520, f2: 210, t, d: 0.6, v: 0.045 * v, lp: 1400, vib: [7, 18] }); break;
        case 'step': noise(c, { t, d: 0.035, v: 0.035 * v, f: 2200, q: 1.4 }); tone(c, { f: 170, f2: 90, t, d: 0.05, v: 0.03 * v }); break;
        case 'servo': tone(c, { type: 'sawtooth', f: up ? 120 : 240, f2: up ? 260 : 110, t, d: 0.3, v: 0.03 * v, lp: 800 }); break;
        case 'jump': tone(c, { f: 320, f2: 980, t, d: 0.2, v: 0.06 * v }); break;
        case 'land': tone(c, { f: 160, f2: 55, t, d: 0.16, v: 0.12 * v }); noise(c, { t, d: 0.07, v: 0.045 * v, f: 600, q: 0.7, type: 'lowpass' }); break;
        case 'whoosh': noise(c, { t, d: 0.4, v: 0.06 * v, f: 500, f2: 2000, q: 0.8 }); break;
        case 'whee': tone(c, { f: 500, f2: 1400, t, d: 0.35, v: 0.055 * v, vib: [9, 30] }); break;
        case 'fall': tone(c, { f: 1400, f2: 380, t, d: 0.5, v: 0.045 * v }); break;
        case 'spin': tone(c, { type: 'triangle', f: 260, f2: 900, t, d: 0.45, v: 0.035 * v, lp: 1600, vib: [16, 40] }); break;
        case 'zap': tone(c, { type: 'triangle', f: 1800, f2: 240, t, d: 0.17, v: 0.05 * v, lp: 4500 }); tone(c, { f: 2600, f2: 420, t, d: 0.13, v: 0.035 * v }); break;
        case 'flip': noise(c, { t, d: 0.025, v: 0.06 * v, f: 3600, q: 2, type: 'highpass' }); tone(c, { type: 'triangle', f: 1300, t: t + 0.004, d: 0.03, v: 0.03 * v, lp: 4000 }); break;
        case 'squeak': { const f = rnd(2000, 2400); tone(c, { f, f2: f * 1.2, t, d: 0.11, v: 0.025 * v, vib: [38, 110] }); break; }
        case 'coin': tone(c, { f: 1568, t, d: 0.13, v: 0.08 * v }); tone(c, { f: 2093, t: t + 0.07, d: 0.32, v: 0.07 * v }); break;
        case 'charge': tone(c, { type: 'triangle', f: 280, f2: 1250, t, d: 0.42, v: 0.045 * v }); break;
        case 'pop': tone(c, { type: 'triangle', f: 640, f2: 990, t, d: 0.11, v: 0.06 * v }); break;
        case 'alert': tone(c, { type: 'triangle', f: 880, t, d: 0.12, v: 0.06 * v, lp: 3500 }); tone(c, { type: 'triangle', f: 1175, t: t + 0.16, d: 0.14, v: 0.06 * v, lp: 3500 }); break;
        case 'fanfare': tone(c, { type: 'triangle', f: 523, t, d: 0.18, v: 0.06 * v }); tone(c, { type: 'triangle', f: 659, t: t + 0.1, d: 0.18, v: 0.06 * v }); tone(c, { type: 'triangle', f: 784, t: t + 0.2, d: 0.34, v: 0.07 * v }); break;
        case 'dizzy': tone(c, { type: 'triangle', f: 900, f2: 300, t, d: 0.9, v: 0.04 * v, lp: 2500, vib: [11, 110] }); break;
        case 'powerup': tone(c, { type: 'triangle', f: 110, f2: 880, t, d: 0.5, v: 0.035 * v, lp: 2200 }); tone(c, { f: 1760, t: t + 0.45, d: 0.12, v: 0.045 * v }); break;
        case 'powerdown': tone(c, { type: 'triangle', f: 700, f2: 80, t, d: 0.7, v: 0.035 * v, lp: 1800 }); break;
      }
    } catch (e) {}
  }
  /* гул реактивных подошв, пока Слиток летит */
  function hum(on) {
    if (on) {
      const c = au(); if (!c || AU.hum) return;
      try {
        const s = c.createBufferSource(); s.buffer = AU.nb; s.loop = true;
        const bq = c.createBiquadFilter(); bq.type = 'bandpass'; bq.frequency.value = 900; bq.Q.value = 0.9;
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 72;
        const og = c.createGain(); og.gain.value = 0.5;
        const g = c.createGain(), t = c.currentTime; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04 * (isNight() ? 0.5 : 1), t + 0.25);
        s.connect(bq); bq.connect(g); o.connect(og); og.connect(g); g.connect(AU.sfx); s.start(); o.start();
        AU.hum = { s, o, g, c };
      } catch (e) {}
    } else if (AU.hum) {
      const h = AU.hum; AU.hum = null;
      try { const t = h.c.currentTime; h.g.gain.cancelScheduledValues(t); h.g.gain.setValueAtTime(Math.max(0.0001, h.g.gain.value), t); h.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); h.s.stop(t + 0.35); h.o.stop(t + 0.35); } catch (e) {}
    }
  }
  /* голос: все фразы лежат одним файлом voice-slitok.js (кусочки MP3); раскрываем по одной, когда нужно */
  function loadPack() {
    if (AU.pack || AU.loading || AU.failed || !ST.sound) return;
    if (window.MS_VOICE && window.MS_VOICE.slitok) { prepPack(); return; }
    AU.loading = true;
    try {
      const s = document.createElement('script'); s.src = VOICE_URL; s.async = true;
      s.onload = () => { AU.loading = false; prepPack(); const w = AU.want; AU.want = null; if (w && now() - w.t < 2.5) voice(w.id, w.o); };
      s.onerror = () => { AU.loading = false; AU.failed = true; };
      document.head.appendChild(s);
    } catch (e) { AU.loading = false; AU.failed = true; }
  }
  function prepPack() {
    const v = window.MS_VOICE && window.MS_VOICE.slitok;
    if (!v || !v.b64) { if (!AU.raw) AU.failed = true; return; }
    try { const bin = atob(v.b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); AU.raw = u; AU.pack = v; v.b64 = ''; } catch (e) { AU.failed = true; }
  }
  function vbuf(c, id) {
    let p = AU.cache.get(id); if (p) return p;
    const e = AU.pack && AU.pack.idx[id]; if (!e) return Promise.reject(new Error('нет фразы ' + id));
    const ab = AU.raw.slice(e[0], e[0] + e[1]).buffer;
    p = new Promise((res, rej) => { try { const r = c.decodeAudioData(ab, res, rej); if (r && r.then) r.then(res, rej); } catch (x) { rej(x); } });
    AU.cache.set(id, p); p.catch(() => AU.cache.delete(id));
    if (AU.cache.size > 30) AU.cache.delete(AU.cache.keys().next().value);
    return p;
  }
  function voice(id, o) {
    o = o || {};
    const c = au(); if (!c) return;
    if (!AU.pack) { AU.want = { id, o, t: now() }; loadPack(); return; }
    vbuf(c, id).then(b => {
      if (!ST.sound || document.hidden) return;
      if (AU.cur) { try { AU.cur.stop(); } catch (e) {} }
      const s = c.createBufferSource(), g = c.createGain();
      s.buffer = b; g.gain.value = (o.vol || 1) * (isNight() ? 0.6 : 1);
      s.connect(g); g.connect(AU.vo); s.start();
      AU.cur = s;
      s.onended = () => { if (AU.cur === s) AU.cur = null; };
    }).catch(() => {});
  }
  function stopVoice() { if (AU.cur) { try { AU.cur.stop(); } catch (e) {} AU.cur = null; } }
  /* громкость голоса прямо сейчас — по ней «говорят» глаза на визоре и подсветка наушников */
  function talkLevel() {
    if (!AU.cur || !AU.an) return 0;
    AU.an.getByteTimeDomainData(AU.td); let s = 0;
    for (let i = 0; i < AU.td.length; i++) { const v = (AU.td[i] - 128) / 128; s += v * v; }
    return clamp(Math.sqrt(s / AU.td.length) * 9, 0, 1);
  }

  /* ---------- речь: только голос, без текста на экране ---------- */
  /* на касание — всегда; о твоих действиях — не чаще раза в 15 с; фоновые — не чаще раза в минуту и не ночью */
  const U_ = { user: true }, EV = { lvl: 'event' };
  function phrase(group, i) {
    const arr = PHRASES && PHRASES[group]; if (!arr || !arr.length) return null;
    if (i == null) { i = Math.floor(Math.random() * arr.length); if (arr.length > 1 && ST.lastSay === group + '.' + i) i = (i + 1) % arr.length; }
    return { id: group + '.' + i };
  }
  function say(group, opt) {
    opt = opt || {};
    const ph = phrase(group, opt.i); if (!ph || !ST.sound) return false;
    const t = now(), ev = opt.lvl === 'event';
    if (!opt.user) {
      if (t < ST.userUntil) { if (ev && !opt.retry) setTimeout(() => say(group, Object.assign({}, opt, { retry: true })), (ST.userUntil - t) * 1000 + 300); return false; }
      if (ev ? t - ST.lastEv < 15 : t - ST.lastAuto < 60) return false;
      if (!ev && isNight()) return false;
      ST.lastAuto = t; if (ev) ST.lastEv = t;
    }
    const dur = AU.pack && AU.pack.idx[ph.id] ? AU.pack.idx[ph.id][2] / 1000 : 2;
    if (opt.user) ST.userUntil = t + dur + 0.3;
    ST.lastSay = ph.id;
    voice(ph.id, opt);
    return true;
  }
  function floatOn(k, on) { const el = ui[k]; if (!el) return; el.classList.toggle('on', !!on); if (k === 'alert' && on) { el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); } }
  function setSign(text, neg) { ST.signText = text; ST.signNeg = !!neg; if (ui.sign) { ui.sign.textContent = text; ui.sign.classList.toggle('neg', !!neg); } }
  function buzz(p) { try { if (A.buzz) A.buzz(p); } catch (e) {} }

  /* ---------- цифры баланса: где они, перекатывание, блеск ---------- */
  const numEl = () => document.getElementById('hBal');
  function textRect(el) { try { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); if (b.width > 2) return b; } catch (e) {} return el.getBoundingClientRect(); }
  function numOK() { const el = numEl(); return !!(el && el.isConnected && !ST.hide && !(document.body && document.body.classList.contains('loading')) && /\d/.test(el.textContent || '')); }
  function numRect() { return numOK() ? rectW(textRect(numEl())) : null; }
  /* какие знаки текущего текста поменяются (выравнивание по правому краю) */
  function diffRange(a, b) {
    const n = Math.max(a.length, b.length); let i0 = -1, i1 = -1;
    for (let k = 0; k < n; k++) { if (a[a.length - 1 - k] !== b[b.length - 1 - k]) { if (i1 < 0) i1 = k; i0 = k; } }
    if (i1 < 0) return null;
    return { s: clamp(a.length - 1 - i0, 0, a.length - 1), e: clamp(a.length - 1 - i1, 0, a.length - 1) };
  }
  /* точка на экране, где стоят меняющиеся цифры (в мире — на глубине 0) */
  function numTarget(p) {
    const el = (p && p.el) || numEl(); if (!el || !el.isConnected || ST.hide || !host) return null;
    const lr = host.getBoundingClientRect(); let r = null;
    if (p && p.to != null && el.childNodes.length === 1 && el.firstChild.nodeType === 3) {
      const cur = el.textContent, d = diffRange(cur, p.to);
      if (d) { try { const rg = document.createRange(); rg.setStart(el.firstChild, d.s); rg.setEnd(el.firstChild, Math.min(cur.length, d.e + 1)); const b = rg.getBoundingClientRect(); if (b.width > 1) r = b; } catch (e) {} }
    }
    if (!r) r = textRect(el);
    if (!r || !r.width) return null;
    const w = rectW(r, lr); return { x: w.cx, y: w.cy, z: 0 };
  }
  function dg(o, n, cls) { const s = document.createElement('span'); s.className = cls; const b = document.createElement('b'); b.textContent = o; b.setAttribute('aria-hidden', 'true'); const i = document.createElement('i'); i.textContent = n; s.appendChild(b); s.appendChild(i); return s; }
  /* перекатить цифры, как на табло: старая уезжает, новая выезжает (вверх — если сумма выросла) */
  function roll(p, fx) {
    if (!p || p.done) return; p.done = true;
    const el = p.el; if (!el || !el.isConnected) return;
    if (el._msTo != null) { clearTimeout(el._msT); el.textContent = el._msTo; el._msTo = null; }
    el.classList.remove('ms-zing');
    const from = el.textContent || '', to = p.to;
    if (from === to) return;
    if (!fx || ST.reduced) { el.textContent = to; return; }
    el.textContent = '';
    const cls = p.up === false ? 'ms-dg d' : 'ms-dg';
    if (from.length !== to.length) el.appendChild(dg(from, to, cls));
    else {
      let run = '';
      for (let i = 0; i < to.length; i++) {
        if (from[i] === to[i]) { run += to[i]; continue; }
        if (run) { el.appendChild(document.createTextNode(run)); run = ''; }
        el.appendChild(dg(from[i], to[i], cls));
      }
      if (run) el.appendChild(document.createTextNode(run));
      const ds = el.querySelectorAll('.ms-dg');
      ds.forEach((d, i) => { const dl = ((ds.length - 1 - i) * 0.045).toFixed(3) + 's'; d.firstChild.style.animationDelay = dl; d.lastChild.style.animationDelay = dl; });
    }
    void el.offsetWidth; el.classList.add('ms-zing');
    el._msTo = to;
    el._msT = setTimeout(() => { if (el._msTo === to) { el.textContent = to; el._msTo = null; } el.classList.remove('ms-zing'); }, 900);
  }
  function shine() { const el = numEl(); if (!el) return; el.classList.remove('ms-shine'); void el.offsetWidth; el.classList.add('ms-shine'); setTimeout(() => el.classList.remove('ms-shine'), 1300); }
  function numSparks() { const r = numRect(); if (!r) return; for (let i = 0; i < 7; i++) emit(atZ({ x: lerp(r.l, r.r, Math.random()), y: lerp(r.b, r.t, Math.random()) }, 1), 2, { colors: ['#ffffff', '#fff1b8'], speed: 0.3, gravity: 0, life: 0.9 }); }
  /* приложение сообщает новую сумму; Слиток наводит палец, стреляет лучом — и цифры перекатываются */
  function number(p) {
    if (!p || !p.el || p.to == null) return;
    const el = p.el, cur = el._msTo != null ? el._msTo : el.textContent;
    if (ST.numZap && ST.numZap.el === el && !ST.numZap.done) { ST.numZap.to = p.to; ST.numZap.up = p.up !== false; return; }
    if (ST.numPend && ST.numPend.el === el) { ST.numPend.to = p.to; ST.numPend.up = p.up !== false; return; }
    if (cur === p.to) return;
    const q = { el, to: p.to, up: p.up !== false };
    const live = inited && visible();
    if (!live || ST.hide || ST.reduced || !BL.ready || now() < (BL.warm || 0)) { roll(q, live); return; }
    ST.numPend = q;
    setTimeout(() => {
      if (ST.numPend !== q) return; ST.numPend = null;
      const t = now();
      if ((act && act.c.pri >= 2) || LOC.mode === 'carry' || ST.wiping || t - ST.lastZap < 12) { roll(q, true); return; }
      ST.lastZap = t; ST.numZap = q; playClip('zap', q);
      if (!act || act.name !== 'zap') { ST.numZap = null; roll(q, true); }
    }, 0);
  }
  function takeNum() { const q = ST.numPend; ST.numPend = null; return q; }

  /* ---------- поза ---------- */
  /* fl/fr — насколько сжат кулак (0 — ладонь открыта), pl/pr — вытянут указательный палец */
  const BASE = () => ({ y: 0, sq: 1, tz: 0, tx: 0, yaw: 0, laZ: -0.3, laX: -0.05, raZ: 0.32, raX: -0.05, legL: 0, legR: 0, fl: 0.35, fr: 0.35, pl: 0, pr: 0, eo: 1, ex: 0, ey: 0, brow: 0, tarn: 0, hx: 0, hy: 0, hz: 0, thr: 0, pend: 0, cloth: 0, tablet: 0, eye: 'round', mouth: 'smile', gaze: false, cap: false, ant: false, glyph: '', zz: false });
  const RATE = { tarn: 3, cloth: 12, tablet: 12, thr: 9, pend: 6, legL: 16, legR: 16, fl: 12, fr: 12, pl: 12, pr: 12 };
  function smooth(P, dt) {
    for (const k in P) {
      const v = P[k];
      if (typeof v !== 'number') { C[k] = v; continue; }
      if (C[k] == null) { C[k] = v; continue; }
      C[k] += (v - C[k]) * (1 - Math.exp(-(RATE[k] || 14) * dt));
    }
  }
  function moodPose(P, m, t, I) {
    const br = Math.sin(t * 2.2);
    P.sq = 1 + 0.012 * br;
    P.laZ += 0.03 * Math.sin(t * 1.4); P.raZ -= 0.03 * Math.sin(t * 1.4 + 0.6);
    P.hz = 0.035 * Math.sin(t * 0.9);
    if (m === 'up') {
      const c = (t % 3.4) / 3.4; P.y = 0.1 * I * bell(c, 0, 0.16); P.sq -= 0.05 * bell(c, 0.15, 0.24);
      P.mouth = c < 0.3 ? 'grin' : 'smile'; P.eye = c > 0.02 && c < 0.2 ? 'happy' : 'round'; P.brow = -0.1; P.hz = 0.09 * bell(c, 0, 0.3);
    } else if (m === 'rocket') {
      const w = t * 5.2; P.y = Math.abs(Math.sin(w)) * 0.11 * I; P.tz = Math.sin(w) * 0.13 * I; P.hz = Math.sin(w) * 0.12;
      P.laZ = -1.5 - 0.45 * Math.sin(w); P.raZ = 1.5 - 0.45 * Math.sin(w + PI); P.mouth = 'grin'; P.eye = 'happy'; P.fl = P.fr = 0.1;
    } else if (m === 'down' || m === 'crash') {
      const deep = m === 'crash';
      P.tarn = deep ? 0.75 : 0.45; P.mouth = 'frown'; P.brow = deep ? 0.6 : 0.45; P.eo = deep ? 0.72 : 0.82; P.ey = -0.012;
      P.laZ = -0.12; P.raZ = 0.14; P.tx = (deep ? 0.08 : 0.04) * (I + 0.3); P.hx = deep ? 0.2 : 0.12; P.sq = 1 + 0.01 * Math.sin(t * 1.4);
      const c = (t % (deep ? 5 : 7)) / (deep ? 5 : 7); P.sq -= 0.045 * bell(c, 0, 0.25); P.fl = P.fr = 0.55;
    } else if (m === 'hunter') {
      const w = t * 4.4, pump = Math.max(0, Math.sin(w)), pump2 = Math.max(0, Math.sin(w + PI));
      P.mouth = 'grin'; P.eye = 'star'; P.brow = -0.25;
      P.raZ = 1.5 + 0.9 * pump2; P.raX = -0.25; P.laZ = -1.5 - 0.9 * pump; P.laX = -0.25;
      P.y = 0.06 * I * Math.max(pump, pump2); P.hz = 0.06 * Math.sin(w); P.fl = P.fr = 1;
    } else if (m === 'sleep') {
      P.eye = 'closed'; P.zz = true; P.cap = true; P.sq = 1 + 0.03 * Math.sin(t * 1.2); P.tz = 0.07; P.tx = 0.05; P.hx = 0.16; P.hz = 0.12; P.laZ = -0.15; P.raZ = 0.2; P.gaze = true; P.fl = P.fr = 0.25;
    } else if (m === 'night') {
      P.cap = true; P.eo = 0.6; P.sq = 1 + 0.02 * Math.sin(t * 1.5); P.tz = 0.03; P.hx = 0.06;
    } else if (m === 'hide') {
      const c = (t % 6) / 6, peek = bell(c, 0.62, 0.86);
      P.cap = true; P.glyph = peek > 0.25 ? '' : 'dots'; P.gaze = true; P.ex = 0.035 * peek; P.mouth = peek > 0.25 ? 'o' : 'smile'; P.hz = 0.06;
    } else if (m === 'offline') {
      P.ant = true; P.glyph = 'scan'; P.gaze = true; P.hy = 0.3 * Math.sin(t * 1.7); P.brow = -0.1;
    }
  }
  /* поза от передвижения: шаг, сидение на краю, полёт, «на руках» у пальца */
  function locPose(P, t) {
    const L = LOC;
    if (L.mode === 'walk' && !L.hold) {
      const s = Math.sin(L.ph);
      P.legL = 0.5 * s; P.legR = -0.5 * s;
      P.laX += 0.45 * s; P.raX -= 0.45 * s;
      P.y += 0.045 * Math.abs(Math.cos(L.ph)); P.tz += 0.045 * s; P.hz -= 0.03 * s;
    }
    const sk = L.sitK;
    if (sk > 0.001) {
      const sw = Math.sin(t * 2.4);
      P.legL = lerp(P.legL, 0.95 + 0.26 * sw, sk); P.legR = lerp(P.legR, 0.95 - 0.26 * sw, sk);
      P.laZ = lerp(P.laZ, -0.62, sk); P.raZ = lerp(P.raZ, 0.62, sk); P.laX = lerp(P.laX, 0.18, sk); P.raX = lerp(P.raX, 0.18, sk);
      P.tx = lerp(P.tx, -0.1, sk); P.fl = lerp(P.fl, 0.55, sk); P.fr = lerp(P.fr, 0.55, sk);
      if (L.mode === 'sit' && ST.music && ST.mood !== 'sleep') { P.hx += 0.07 * Math.max(0, Math.sin(t * 7.4)); P.hz += 0.04 * Math.sin(t * 3.7); }
    }
    if (L.mode === 'hover' || L.mode === 'land') {
      P.thr = L.mode === 'land' ? 0.8 : 1;
      P.legL = 0.18 + 0.08 * Math.sin(t * 4); P.legR = 0.18 + 0.08 * Math.sin(t * 4 + 1.3);
      P.laZ -= 0.28; P.raZ += 0.28; P.y += 0.04 * Math.sin(t * 3.1); P.fl = P.fr = 0.15;
    }
    if (ST.wiping) {
      const w = t * 9.5;
      P.cloth = 1; P.laZ = -1.42 + 0.24 * Math.sin(w); P.laX = -0.3 + 0.32 * Math.cos(w); P.raZ = 0.55; P.raX = -0.1; P.fl = 0.8;
      P.gaze = true; P.ex = -0.032; P.ey = 0.004; if (Math.sin(t * 1.3) > 0.6) P.eye = 'happy'; P.hz += 0.05 * Math.sin(w);
    }
    if (L.mode === 'carry') {
      P.laZ = -2.45 + 0.12 * Math.sin(t * 6); P.raZ = 2.45 - 0.12 * Math.sin(t * 6); P.laX = -0.15; P.raX = -0.15; P.fl = P.fr = 0.05;
      P.legL = 0.45 * Math.sin(t * 10); P.legR = -0.45 * Math.sin(t * 10);
      P.tz = clamp(-L.vx * 0.09, -0.45, 0.45); P.mouth = 'O'; P.eo = 1.12;
    }
    if (L.mode === 'fall') { P.laZ = -2.2; P.raZ = 2.2; P.legL = 0.35; P.legR = -0.15; P.mouth = 'O'; P.fl = P.fr = 0; }
    if (L.mode === 'hop' && L.hop) { const a = bell(clamp((t - L.hop.t0) / L.hop.dur, 0, 1), 0, 1); P.laZ -= 0.6 * a; P.raZ += 0.6 * a; }
    const q = t - L.squash; if (q < 0.32) P.sq -= 0.13 * Math.sin((q / 0.32) * PI);
  }

  /* ---------- помощники для сценок ---------- */
  const V1 = new T.Vector3(), V2 = new T.Vector3(), HA = new T.Vector3(), HB = new T.Vector3(), HM = new T.Vector3(), PW = new T.Vector3(), Q1 = new T.Quaternion();
  const handW = (h, out) => h.getWorldPosition(out);
  function handsW(out) { R.armL.h.getWorldPosition(HA); R.armR.h.getWorldPosition(HB); return out.copy(HA).add(HB).multiplyScalar(0.5); }
  function handL(h, out) { h.getWorldPosition(out); return R.root.worldToLocal(out); }
  function handsL(out) { handL(R.armL.h, HA); handL(R.armR.h, HB); return out.copy(HA).add(HB).multiplyScalar(0.5); }
  const toDepth = (p, z) => ({ x: p.x, y: p.y + (z - (p.z || 0)) * STL / CT, z });   /* та же точка экрана на другой глубине */
  function emit(o, n, opt) { if (PT && !ST.reduced) PT.emit(o, n, opt); }
  function emitL(x, y, z, n, opt) { V1.set(x, y, z); R.root.localToWorld(V1); emit(toDepth(V1, V1.z + 0.6), n, opt); }
  function fireworks(x) { emitL(x, R.topY + 0.35 + rnd(-0.1, 0.15), 0, 30, { colors: [pick(['#ffd36b', '#ff5d8f', '#5be0c4', '#a98bff']), '#ffffff'], speed: 1.4, gravity: 0.9, life: 1.1 }); }
  function clothSpark() { if (!R.cloth.visible) return; R.cloth.getWorldPosition(V1); emit(toDepth(V1, 1), 3, { colors: ['#ffffff', '#fff1b8', '#ffd36b'], speed: 0.45, gravity: 0.3, life: 0.7 }); }
  /* навести руку на точку экрана (для луча): цель берём на глубине плеча */
  function aimArm(P, left, tgt, w) {
    if (w <= 0) return;
    const arm = left ? R.armL : R.armR;
    arm.p.getWorldPosition(V1);
    const tg = toDepth(tgt, V1.z + 0.5);
    V2.set(tg.x - V1.x, tg.y - V1.y, 0.5).normalize();
    R.bodyG.getWorldQuaternion(Q1); Q1.invert(); V2.applyQuaternion(Q1);
    const z = Math.asin(clamp(V2.x, -1, 1)), x = Math.atan2(-V2.z, -V2.y);
    if (left) { P.laZ = lerp(P.laZ, z, w); P.laX = lerp(P.laX, x, w); P.pl = Math.max(P.pl, w); }
    else { P.raZ = lerp(P.raZ, z, w); P.raX = lerp(P.raX, x, w); P.pr = Math.max(P.pr, w); }
  }
  /* луч рисуем на глубине 1,6 — переводим концы так, чтобы на экране они совпали с пальцем и цифрами */
  function beam(a, b, w, op) {
    const m = PR.beam; if (op <= 0.01 || !a || !b) { m.visible = false; return; }
    const A1 = toDepth(a, 1.6), B1 = toDepth(b, 1.6), dx = B1.x - A1.x, dy = B1.y - A1.y, len = Math.hypot(dx, dy);
    m.visible = true; m.position.set((A1.x + B1.x) / 2, (A1.y + B1.y) / 2, 1.6); m.rotation.set(0, 0, Math.atan2(dy, dx)); m.scale.set(Math.max(0.01, len), w, 1); m.material.opacity = op;
  }

  /* ---------- сценки ---------- */
  const CLIPS = {
    hello: { dur: 2.4, pri: 2, run(P, k) { P.raZ = 2.45 + 0.35 * Math.sin(k * TAU * 3); P.raX = -0.25; P.fr = 0; P.mouth = 'grin'; P.eye = k > 0.25 && k < 0.75 ? 'happy' : 'round'; P.y += 0.08 * bell(k, 0, 0.18); } },
    tap: { dur: 0.9, pri: 2, run(P, k) { P.y += 0.11 * bell(k, 0, 0.55); P.sq = 1 - 0.1 * bell(k, 0, 0.14) + 0.06 * bell(k, 0.14, 0.5); P.eye = 'happy'; P.mouth = 'grin'; P.fl = P.fr = 0.1; } },
    tapSpin: { dur: 1.0, pri: 2, run(P, k) { P.yaw += TAU * easeInOut(seg(k, 0.05, 0.8)); P.y += 0.1 * bell(k, 0.05, 0.8); P.laZ = -0.9; P.raZ = 0.9; P.fl = P.fr = 0; P.eye = 'happy'; P.mouth = 'grin'; }, at: [[0.05, () => sfx('spin', { vol: 0.8 })]] },
    tapWave: { dur: 1.6, pri: 2, run(P, k) { const a = Math.min(1, bell(k, 0, 1) * 2.2); P.raZ = lerp(P.raZ, 2.4 + 0.32 * Math.sin(k * TAU * 2.5), a); P.raX = lerp(P.raX, -0.25, a); P.fr = lerp(P.fr, 0, a); P.hz += 0.1 * Math.sin(k * TAU * 2.5) * a; P.eye = 'happy'; P.mouth = 'grin'; } },
    tapJump: {
      dur: 1.1, pri: 2,
      run(P, k) { const air = bell(k, 0.15, 0.75); P.y += 0.42 * air; P.sq = 1 - 0.14 * bell(k, 0, 0.15) - 0.1 * bell(k, 0.75, 0.9) + 0.06 * air; P.laZ = lerp(-0.3, -2.4, air); P.raZ = lerp(0.32, 2.4, air); P.fl = P.fr = lerp(0.35, 0, air); P.legL = 0.25 * air; P.legR = -0.15 * air; P.eye = 'happy'; P.mouth = 'grin'; },
      at: [[0.15, () => sfx('jump')], [0.76, () => sfx('land', { vol: 0.6 })]]
    },
    dance: { dur: 3, pri: 2, run(P, k) { const w = k * TAU * 3; P.y += Math.abs(Math.sin(w)) * 0.12; P.tz = Math.sin(w) * 0.16; P.laZ = -1.6 - 0.5 * Math.sin(w); P.raZ = 1.6 - 0.5 * Math.sin(w + PI); P.fl = P.fr = 0.15; P.legL = 0.3 * Math.max(0, Math.sin(w)); P.legR = 0.3 * Math.max(0, -Math.sin(w)); P.eye = 'happy'; P.mouth = 'grin'; } },
    dizzy: { dur: 2.8, pri: 2, run(P, k) { const w = k * TAU * 3.2, f = 1 - seg(k, 0.75, 1); P.eye = 'spiral'; P.hz = 0.28 * Math.sin(w) * f; P.tz = 0.12 * Math.sin(w + 1) * f; P.hx = 0.1 * Math.cos(w) * f; P.laZ = -1.0 - 0.6 * Math.sin(w * 1.3) * f; P.raZ = 1.0 + 0.6 * Math.sin(w * 1.1) * f; P.fl = P.fr = 0.1; P.y += 0.04 * Math.abs(Math.sin(w)) * f; } },
    wake: { dur: 1.6, pri: 3, run(P, k) { P.eo = 1.15; P.glyph = k < 0.35 ? '!' : ''; P.mouth = k < 0.6 ? 'O' : 'smile'; P.y += 0.07 * bell(k, 0, 0.3); P.fl = P.fr = 0; } },
    /* пополнение: монетка падает в руки, Слиток бросает её в сумму — и цифры перекатываются */
    deposit: {
      dur: 3.8, pri: 3,
      start(a) { a.num = takeNum(); a.tgt = numTarget(a.num); PR.coin.visible = true; PR.coin.scale.setScalar(0.001); a.p0 = null; },
      run(P, k, t, a) {
        const c = PR.coin, H1 = toDepth(handsW(HM), 1.1);
        if (k < 0.32) { const f = easeIn(seg(k, 0.04, 0.32)); c.position.set(H1.x + 0.05 * (1 - f), lerp(H1.y + 2.4, H1.y + 0.15, f), 1.1); c.rotation.set(0, k * 26, 0); c.scale.setScalar(k < 0.04 ? 0.001 : 1); }
        else if (k < 0.5) { c.position.set(H1.x, H1.y + 0.15, 1.1); c.rotation.set(0, 0, 0); c.scale.setScalar(1); }
        else if (k < 0.72) {
          if (!a.p0) a.p0 = c.position.clone();
          const f = easeInOut(seg(k, 0.5, 0.72));
          if (a.tgt) { const T1 = atZ(a.tgt, 1.1); c.position.set(lerp(a.p0.x, T1.x, f), lerp(a.p0.y, T1.y, f) + 0.9 * Math.sin(f * PI), 1.1); c.rotation.set(0, f * TAU * 2, 0); c.scale.setScalar(1 - 0.35 * f); }
          else { const P1 = toDepth(R.pend.getWorldPosition(PW), 1.1); c.position.set(lerp(a.p0.x, P1.x, f), lerp(a.p0.y, P1.y, f), 1.1); c.scale.setScalar(Math.max(0.001, 1 - 0.85 * f)); }
        } else c.scale.setScalar(0.001);
        const up = seg(k, 0.2, 0.34) - seg(k, 0.48, 0.56);
        P.laZ = lerp(P.laZ, 0.55, up); P.raZ = lerp(P.raZ, -0.55, up); P.laX = lerp(P.laX, -1.35, up); P.raX = lerp(P.raX, -1.35, up); P.fl = P.fr = lerp(0.35, 0.05, up);
        const th = bell(k, 0.46, 0.66);
        if (a.tgt) { if (a.tgt.x < LOC.x) { P.laZ -= 1.6 * th; P.laX -= 0.6 * th; P.fl = lerp(P.fl, 0, th); } else { P.raZ += 1.6 * th; P.raX -= 0.6 * th; P.fr = lerp(P.fr, 0, th); } }
        else P.pend = bell(k, 0.68, 0.98);
        P.sq = 1 - 0.08 * bell(k, 0.3, 0.38); P.eye = k > 0.74 ? 'happy' : 'round'; P.mouth = k > 0.3 ? 'grin' : 'o'; P.glyph = k > 0.32 && k < 0.5 ? '$' : '';
        P.gaze = true; P.ey = k < 0.32 ? 0.03 : a.tgt ? 0.02 : 0; P.ex = a.tgt && k > 0.5 && k < 0.8 ? 0.035 * Math.sign(a.tgt.x - LOC.x) : 0;
      },
      at: [[0.31, () => sfx('coin', { vol: 0.6 })], [0.72, a => {
        if (a.tgt) { roll(a.num, true); shine(); emit(atZ(a.tgt, 1), 18, { colors: ['#ffd36b', '#fff1b8', '#ffb547'], up: true, speed: 1.2, gravity: 1.6 }); }
        else { emit(toDepth(R.pend.getWorldPosition(PW), 1), 12, { colors: ['#ffd36b', '#fff1b8'], up: true }); sfx('charge'); }
        sfx('coin');
      }]],
      end(a) { PR.coin.visible = false; if (a.num) roll(a.num, true); }
    },
    /* покупка: монетка в руке → в подвеску-слиток на груди, подвеска вспыхивает */
    buy: {
      dur: 3.0, pri: 3,
      start() { PR.coin.visible = true; PR.coin.scale.setScalar(0.001); },
      run(P, k) {
        const c = PR.coin, H1 = toDepth(handW(R.armR.h, HB), 1.1), P1 = toDepth(R.pend.getWorldPosition(PW), 1.1);
        if (k < 0.45) { c.position.set(H1.x - 0.04, H1.y + 0.2, 1.1); c.rotation.set(0, 0.3 * Math.sin(k * 12), 0); c.scale.setScalar(Math.max(0.001, backOut(seg(k, 0, 0.12)))); }
        else if (k < 0.62) { const f = easeInOut(seg(k, 0.45, 0.62)); c.position.set(lerp(H1.x - 0.04, P1.x, f), lerp(H1.y + 0.2, P1.y, f) + 0.25 * Math.sin(f * PI), 1.1); c.rotation.set(0, f * TAU * 2, 0); c.scale.setScalar(Math.max(0.001, 1 - 0.8 * f)); }
        else c.scale.setScalar(0.001);
        const up = seg(k, 0, 0.12) - seg(k, 0.45, 0.6), ch = bell(k, 0.42, 0.68);
        P.raX = lerp(P.raX, -1.25, up); P.raZ = lerp(P.raZ, -0.1, up); P.raX = lerp(P.raX, -0.9, ch); P.raZ = lerp(P.raZ, -0.55, ch); P.fr = lerp(0.35, 0.05, up);
        P.pend = bell(k, 0.6, 0.98); P.tx = 0.1 * bell(k, 0.62, 0.8);
        P.gaze = true; P.ex = k < 0.45 ? 0.03 : 0; P.ey = k < 0.45 ? 0.02 : -0.02;
        P.mouth = k > 0.6 ? 'grin' : 'smile'; P.eye = k > 0.85 ? 'happy' : 'round'; P.glyph = k > 0.62 && k < 0.85 ? '$' : '';
      },
      at: [[0.62, () => { emit(toDepth(R.pend.getWorldPosition(PW), 1), 12, { colors: ['#ffd36b', '#fff1b8'], up: true }); sfx('coin'); sfx('charge'); }]],
      end() { PR.coin.visible = false; }
    },
    sellProfit: { dur: 3, pri: 3, run(P, k) { const b = bell(k, 0.1, 0.8); P.raZ = lerp(0.32, 2.55, b); P.raX = lerp(-0.05, -0.8, b); P.fr = lerp(0.35, 0, b); P.tx = 0.15 * bell(k, 0.25, 0.65); P.hx = 0.1 * bell(k, 0.25, 0.65); P.eye = 'happy'; P.mouth = 'grin'; }, at: [[0.3, () => sfx('fanfare')]] },
    sellLoss: { dur: 3, pri: 3, run(P, k) { P.brow = 0.4; P.mouth = 'flat'; P.tx = 0.08 * Math.max(0, Math.sin(k * TAU * 2)); P.raX = -0.6; P.raZ = -0.35; P.eo = 0.9; P.fr = 0.1; }, at: [[0.1, () => sfx('sad')]] },
    airdrop: {
      dur: 4.2, pri: 3,
      start() { PR.gift.visible = true; PR.giftLid.position.set(0, 0.34, 0); PR.giftLid.rotation.set(0, 0, 0); },
      run(P, k) {
        const g = PR.gift, f = easeIn(seg(k, 0, 0.32));
        const hm = handsL(HM); g.position.set(lerp(0.08 * Math.sin(k * 14), hm.x, f), lerp(3.2, hm.y + 0.02, f), lerp(0.6, hm.z + 0.05, f)); g.rotation.z = 0.25 * Math.sin(k * 10) * (1 - f);
        g.scale.setScalar(Math.max(0.001, 1 - seg(k, 0.86, 1)));
        if (k > 0.55) { const o = easeOut(seg(k, 0.55, 0.8)); PR.giftLid.position.set(0.5 * o, 0.34 + 0.9 * o, 0); PR.giftLid.rotation.z = -2.4 * o; }
        const up = seg(k, 0.2, 0.32) - seg(k, 0.85, 0.95);
        P.laZ = lerp(-0.3, 0.6, up); P.raZ = lerp(0.32, -0.6, up); P.laX = lerp(-0.05, -1.3, up); P.raX = lerp(-0.05, -1.3, up); P.fl = P.fr = lerp(0.35, 0.1, up);
        P.mouth = k < 0.3 ? 'o' : k < 0.55 ? 'O' : 'grin'; P.eye = k > 0.6 ? 'happy' : 'round'; P.y += 0.1 * bell(k, 0.6, 0.75);
        P.gaze = true; P.ey = k < 0.32 ? 0.03 : 0;
      },
      at: [[0.56, () => { emitL(0, 1.45, 0.55, 34, { colors: ['#ff5d8f', '#ffd34d', '#5be0c4', '#a98bff', '#ffffff'], up: true, speed: 1.6, gravity: 2.6 }); sfx('fanfare'); }]],
      end() { PR.gift.visible = false; }
    },
    /* сигнал на покупку: машет руками, на визоре «!», потом показывает пальцем вниз — на карточку сигнала */
    signal: {
      dur: 2.8, pri: 2,
      start() { floatOn('alert', true); },
      run(P, k) {
        const a = bell(k, 0, 0.5), b = bell(k, 0.45, 1);
        P.laZ = lerp(P.laZ, -2.3 + 0.35 * Math.sin(k * TAU * 5), a); P.raZ = lerp(P.raZ, 2.3 - 0.35 * Math.sin(k * TAU * 5), a); P.fl = P.fr = lerp(0.35, 0, a);
        P.raX = lerp(P.raX, -0.95, b); P.raZ = lerp(P.raZ, 0.75, b); P.pr = b;
        P.eo = 1.12; P.glyph = Math.floor(k * 10) % 2 ? '!' : ''; P.y += 0.06 * bell(k, 0, 0.15); P.gaze = true; P.ey = -0.012 * b; P.hz += 0.1 * a;
      },
      at: [[0.04, () => sfx('alert')]],
      end() { floatOn('alert', false); }
    },
    ath: {
      dur: 5, pri: 3,
      run(P, k) { P.y += 0.22 * ST.intensity * (bell(k, 0.08, 0.28) + bell(k, 0.48, 0.68)); P.laZ = -2.4; P.raZ = 2.4; P.laX = -0.2; P.raX = -0.2; P.fl = P.fr = 0; P.eye = 'star'; P.mouth = 'grin'; },
      at: [[0.08, () => fireworks(-0.5)], [0.3, () => fireworks(0.55)], [0.52, () => fireworks(0)], [0.1, () => sfx('fanfare')]]
    },
    milestone: {
      dur: 5, pri: 3,
      start() { PR.trophy.visible = true; floatOn('sign', true); },
      run(P, k) {
        const t = PR.trophy; t.position.set(0, lerp(-0.9, R.topY + 0.12, backOut(seg(k, 0.05, 0.35))), 0.12); t.rotation.y = k * TAU; t.scale.setScalar(Math.max(0.001, 1 - seg(k, 0.88, 1)));
        const up = seg(k, 0.1, 0.32) - seg(k, 0.86, 0.96); P.laZ = lerp(-0.3, -2.6, up); P.raZ = lerp(0.32, 2.6, up); P.laX = -0.3 * up; P.raX = -0.3 * up; P.fl = P.fr = lerp(0.35, 0, up); P.eye = 'star'; P.mouth = 'grin';
      },
      at: [[0.36, () => { emitL(0, R.topY + 0.35, 0.12, 26, { colors: ['#ffd36b', '#fff1b8', '#ffffff'], speed: 1.1, gravity: 1.2 }); sfx('fanfare'); }]],
      end() { PR.trophy.visible = false; floatOn('sign', false); }
    },
    coinMove: {
      dur: 4.2, pri: 2,
      start() { floatOn('sign', true); },
      run(P, k) { const up = seg(k, 0, 0.15) - seg(k, 0.85, 1); P.laZ = lerp(-0.3, -2.25, up); P.raZ = lerp(0.32, 2.25, up); P.fl = P.fr = lerp(0.35, 0, up); P.glyph = up > 0.5 ? (ST.signNeg ? '▼' : '▲') : ''; P.gaze = true; P.ey = 0.02; },
      at: [[0.1, () => sfx(ST.signNeg ? 'sad' : 'happy', { vol: 0.7 })]],
      end() { floatOn('sign', false); }
    },
    screen: {
      dur: 4.2, pri: 2,
      run(P, k) { const up = seg(k, 0, 0.12) - seg(k, 0.85, 0.97); P.tablet = up; P.raX = lerp(-0.05, -1.25, up); P.raZ = lerp(0.32, 0.38, up); P.fr = lerp(0.35, 0.75, up); P.gaze = true; P.ex = k < 0.5 ? 0.035 : 0; P.ey = k < 0.5 ? -0.025 : 0; P.mouth = k > 0.5 ? 'grin' : 'o'; if (R) R.tablet.rotation.y = lerp(-0.9, 0, easeOut(seg(k, 0.5, 0.65))); },
      at: [[0.5, () => sfx('blips', { vol: 0.7 })]]
    },
    /* луч в цифры: при смене цены Слиток сам «переставляет» сумму, показывая пальцем */
    zap: {
      dur: 1.2, pri: 1.5,
      start(a) { a.num = a.data; a.tgt = numTarget(a.num); if (!a.tgt) { a.skip = true; a.dur = 0.01; roll(a.num, true); if (ST.numZap === a.num) ST.numZap = null; return; } a.left = a.tgt.x < LOC.x; LOC.hold = true; },
      run(P, k, t, a) {
        if (a.skip) return;
        const up = seg(k, 0, 0.22) - seg(k, 0.78, 1);
        aimArm(P, a.left, a.tgt, up);
        const dx = a.tgt.x - LOC.x, dy = a.tgt.y - (LOC.y + 1.9);
        P.gaze = true; P.ex = clamp(dx * 0.02, -0.035, 0.035) * up; P.ey = clamp(dy * 0.02, -0.025, 0.03) * up; P.hx -= clamp(dy * 0.08, -0.25, 0.25) * up;
        P.glyph = k > 0.42 && k < 0.85 ? (a.num.up ? '▲' : '▼') : '';
        const bo = bell(k, 0.3, 0.6);
        if (bo > 0.01) { HA.set(0, -0.08, 0); (a.left ? R.armL : R.armR).fingers[0].localToWorld(HA); beam({ x: HA.x, y: HA.y, z: HA.z }, a.tgt, 0.12, bo); } else beam(null, null, 0, 0);
      },
      at: [[0.3, a => { if (!a.skip) sfx('zap'); }], [0.45, a => {
        if (a.skip) return;
        roll(a.num, true); if (ST.numZap === a.num) ST.numZap = null;
        emit(atZ(a.tgt, 1), 12, { colors: ['#ffd36b', '#fff1b8', '#ff9a1f'], speed: 0.9, gravity: 0.6, life: 0.6 }); sfx('flip');
        if (Math.random() < 0.15) say('zap');
      }]],
      end(a) { beam(null, null, 0, 0); LOC.hold = false; if (a.num && !a.num.done) roll(a.num, true); if (ST.numZap === a.num) ST.numZap = null; }
    },
    /* разглядывает цифры баланса и одобрительно кивает */
    peek: {
      dur: 3.2, pri: 1,
      start(a) { a.tgt = numTarget(null); },
      run(P, k, t, a) {
        if (!a.tgt) return;
        const up = seg(k, 0, 0.15) - seg(k, 0.85, 1), dx = a.tgt.x - LOC.x, dy = a.tgt.y - (LOC.y + 1.9);
        P.gaze = true; P.ex = clamp(dx * 0.02, -0.035, 0.035) * up; P.ey = clamp(dy * 0.02, -0.02, 0.03) * up;
        P.hy += clamp(dx * 0.12, -0.5, 0.5) * up; P.hx -= clamp(dy * 0.07, -0.2, 0.2) * up;
        P.hx += 0.12 * bell(k, 0.5, 0.62) + 0.12 * bell(k, 0.64, 0.76);
        if (k > 0.5 && k < 0.85) P.eye = 'happy';
      },
      at: [[0.52, () => sfx('blips', { vol: 0.5 })]]
    },
    polish: {
      dur: 4.5, pri: 1,
      run(P, k) { const up = seg(k, 0, 0.12) - seg(k, 0.85, 1), w = k * TAU * 4; P.cloth = up; P.fl = lerp(0.35, 0.8, up); P.laX = lerp(-0.05, -0.4 + 0.12 * Math.cos(w), up); P.laZ = lerp(-0.3, -2.7 + 0.14 * Math.sin(w), up); P.hz = -0.12 * up; P.eye = k > 0.2 && k < 0.8 ? 'happy' : 'round'; P.mouth = 'smile'; P.tarn = 0; P.gaze = true; P.ex = -0.02; },
      at: [[0.3, () => sfx('squeak')], [0.45, () => sfx('squeak')], [0.6, () => sfx('squeak')], [0.84, () => emitL(-0.45, 1.85, 0.3, 10, { colors: ['#ffffff', '#fff1b8'], speed: 0.6, gravity: 0, life: 0.8 })]]
    },
    blocks: {
      dur: 5, pri: 1,
      start(a) { a.side = LOC.x > midX() ? -1 : 1; PR.blocks.forEach(b => { b.visible = true; b.scale.setScalar(0.001); }); },
      run(P, k, t, a) {
        const sd = a.side;
        PR.blocks.forEach((b, i) => { const s = backOut(seg(k, 0.12 + i * 0.2, 0.24 + i * 0.2)) * (1 - seg(k, 0.88, 0.98)); b.scale.setScalar(Math.max(0.001, s)); b.position.set(sd * (1.02 + 0.03 * Math.sin(k * 30) * bell(k, 0.7, 0.86) * i), 0.09 + i * 0.175, 0.2); b.rotation.y = i * 0.25; });
        P.yaw += 0.46 * sd; P.gaze = true; P.ex = 0.035 * sd;
        const r = -0.75 * Math.max(bell(k, 0.08, 0.26), bell(k, 0.28, 0.46), bell(k, 0.48, 0.66));
        if (sd > 0) { P.raX = r; P.raZ = 0.55; P.fr = 0.7; } else { P.laX = r; P.laZ = -0.55; P.fl = 0.7; }
        P.mouth = k > 0.7 ? 'grin' : 'smile';
      },
      at: [[0.24, () => sfx('step')], [0.44, () => sfx('step')], [0.64, () => sfx('step')]],
      end() { PR.blocks.forEach(b => (b.visible = false)); }
    },
    yawn: { dur: 2.6, pri: 1, run(P, k) { const b = bell(k, 0.08, 0.75); P.laZ = lerp(-0.3, -2.5, b); P.raZ = lerp(0.32, 2.5, b); P.fl = P.fr = lerp(0.35, 0.9, b); P.sq = 1 + 0.07 * b; P.mouth = b > 0.3 ? 'O' : 'smile'; P.eye = b > 0.3 ? 'closed' : 'round'; }, at: [[0.15, () => sfx('powerdown', { vol: 0.4 })]] }
  };

  /* ---------- проигрывание сценок ---------- */
  function playClip(name, data) {
    const c = CLIPS[name]; if (!c) return;
    const t = now();
    if (act && act.c.pri < c.pri) endClip();
    if (act) { if (queue.length < 3 && !queue.find(q => q.name === name)) queue.push({ name, data }); return; }
    if (c.pri >= 3 && JOB) endJob(false);
    act = { name, c, t0: t, dur: c.dur, data, fired: {} };
    if (c.start) c.start(act);
    if (c.pri >= 2) ST.lastEvent = t;
    wakeLoop();
  }
  function endClip() { if (!act) return; const a = act; act = null; if (a.c.end) a.c.end(a); if (R) R.tablet.rotation.y = 0; }

  /* ---------- передвижение по карточке ---------- */
  function walkTo(x) { LOC.tx = clamp(x, LY.minX, LY.maxX); if (Math.abs(LOC.tx - LOC.x) < 0.03) return false; LOC.mode = 'walk'; return true; }
  function hopTo(x, y, mode, dur, h) { LOC.hop = { t0: now(), dur, x0: LOC.x, y0: LOC.y, x1: x, y1: y, h, to: mode, s0: LOC.sitK, s1: mode === 'sit' ? 1 : 0 }; LOC.mode = 'hop'; }
  function sitDown() { if (LOC.mode !== 'stand') return false; LOC.yawT = LOC.x > midX() ? -0.14 : 0.14; hopTo(LOC.x, LY.edge - SEAT, 'sit', 0.55, 0.3); sfx('jump', { vol: 0.5 }); return true; }
  function standUp() { if (LOC.mode !== 'sit') return false; hopTo(LOC.x, LY.ground, 'stand', 0.45, 0.34); sfx('servo', { up: 1 }); return true; }
  function flyTo(x, y) { if (LOC.mode !== 'hover') sfx('whoosh'); LOC.mode = 'hover'; LOC.fx = clamp(x, LY.minX - 0.4, LY.maxX); LOC.fy = y; LOC.flyDone = false; }
  function land() { if (LOC.mode === 'hover') LOC.mode = 'land'; }
  function settle() { ST.wiping = 0; if (LOC.mode === 'hover') land(); else if (LOC.mode === 'sit') standUp(); else if (LOC.mode === 'walk') { LOC.mode = 'stand'; LOC.yawT = idleYaw(); } }
  function updateLoc(dt, t) {
    const L = LOC;
    switch (L.mode) {
      case 'walk': {
        if (L.hold || L.frozen) break;
        const d = L.tx - L.x, dir = Math.sign(d), st = Math.min(Math.abs(d), (isNight() ? 0.9 : 1.3) * dt);
        L.x += dir * st; const p0 = Math.floor(L.ph / PI); L.ph += (st / 0.3) * PI; if (Math.floor(L.ph / PI) !== p0) sfx('step', { vol: 0.8 });
        L.yawT = dir * 1.15; L.y = damp(L.y, LY.ground, 12, dt);
        if (Math.abs(L.tx - L.x) < 0.005) { L.x = L.tx; L.mode = 'stand'; L.yawT = idleYaw(); }
        break;
      }
      case 'stand': L.y = damp(L.y, LY.ground, 12, dt); break;
      case 'sit': L.y = damp(L.y, LY.edge - SEAT, 12, dt); L.sitK = damp(L.sitK, 1, 10, dt); break;
      case 'hop': {
        const h = L.hop, k = clamp((t - h.t0) / h.dur, 0, 1), e = easeInOut(k);
        L.x = lerp(h.x0, h.x1, e); L.y = lerp(h.y0, h.y1, e) + h.h * 4 * k * (1 - k); L.sitK = lerp(h.s0, h.s1, easeInOut(seg(k, 0.15, 0.85)));
        if (k >= 1) { L.mode = h.to; L.hop = null; L.squash = t; sfx('land', { vol: 0.5 }); if (L.mode === 'stand') L.yawT = idleYaw(); }
        break;
      }
      case 'hover': {
        const ax = L.fx - L.x, ay = L.fy - L.y, d = Math.hypot(ax, ay);
        if (d < 0.01) L.flyDone = true;
        else { const st = Math.min(d, (0.5 + 2.2 * Math.min(1, d)) * dt); L.x += (ax / d) * st; L.y += (ay / d) * st; if (Math.abs(ax) > 0.05 && !ST.wiping) L.yawT = Math.sign(ax) * 0.7; }
        if (ST.wiping) L.yawT = -0.32; else if (d < 0.05) L.yawT = -0.3;
        break;
      }
      case 'land': {
        L.y -= (0.9 + 1.4 * Math.min(1, Math.max(0, L.y - LY.ground) / 1.5)) * dt;
        if (L.y <= LY.ground) { L.y = LY.ground; L.mode = 'stand'; L.squash = t; L.yawT = idleYaw(); sfx('land', { vol: 0.7 }); }
        break;
      }
      case 'fall': {
        L.vy -= 20 * dt; L.y += L.vy * dt; L.x = clamp(L.x + L.vx * dt, LY.minX, LY.maxX); L.vx *= Math.exp(-1.5 * dt);
        if (L.y <= LY.ground && L.vy <= 0) { L.y = LY.ground; L.mode = 'stand'; L.squash = t; L.yawT = idleYaw(); sfx('land'); buzz(12); if (Math.random() < 0.6) say('drop', U_); }
        break;
      }
      case 'carry': {
        const px = L.x, py = L.y, k = Math.max(dt, 1e-3);
        L.x = damp(L.x, L.cx, 18, dt); L.y = damp(L.y, L.cy, 18, dt);
        L.vx = damp(L.vx, (L.x - px) / k, 10, dt); L.vy = damp(L.vy, (L.y - py) / k, 10, dt);
        L.yawT = clamp(L.vx * 0.15, -0.6, 0.6) - 0.1;
        break;
      }
    }
    if (L.mode !== 'sit' && L.mode !== 'hop') L.sitK = damp(L.sitK, 0, 10, dt);
    L.yaw = damp(L.yaw, L.yawT, 7, dt);
  }

  /* ---------- дела: последовательности шагов (дойти, сесть, взлететь, протереть…) ---------- */
  function job(name, steps) { endJob(true); JOB = { name, steps, i: -1 }; nextStep(); }
  function nextStep() {
    const j = JOB; if (!j) return;
    const prev = j.steps[j.i]; if (prev && prev.exit) prev.exit(prev);
    j.i++;
    if (j.i >= j.steps.length) { if (JOB === j) JOB = null; return; }
    const s = j.steps[j.i]; s.t0 = now();
    if (s.enter && s.enter(s) === false && JOB === j) JOB = null;
  }
  function stepJob(dt, t) { const j = JOB; if (!j) return; const s = j.steps[j.i]; if (!s) { JOB = null; return; } if (!s.upd || s.upd(s, dt, t)) nextStep(); }
  function endJob(quiet) { const j = JOB; JOB = null; if (j) { const s = j.steps[j.i]; if (s && s.exit) s.exit(s); } if (!quiet) settle(); }
  const val = v => (typeof v === 'function' ? v() : v);
  const SP = {
    walk: x => ({ enter: () => { if (LOC.mode === 'stand') walkTo(val(x)); }, upd: s => LOC.mode !== 'walk' && now() - s.t0 > 0.05 }),
    wait: d => ({ upd: s => now() - s.t0 >= d }),
    face: y => ({ enter: () => { LOC.yawT = val(y); }, upd: s => now() - s.t0 > 0.35 }),
    clip: n => ({ enter: () => { playClip(n); }, upd: s => !act || now() - s.t0 > 9 }),
    call: f => ({ enter: s => { f(s); } }),
    sit: () => ({ enter: () => (sitDown() ? undefined : false), upd: () => LOC.mode === 'sit' }),
    stand: () => ({ enter: () => { standUp(); }, upd: () => LOC.mode !== 'sit' && LOC.mode !== 'hop' }),
    fly: (x, y) => ({ enter: () => { flyTo(val(x), val(y)); }, upd: () => LOC.flyDone || LOC.mode !== 'hover' }),
    land: () => ({ enter: () => { land(); }, upd: () => LOC.mode !== 'hover' && LOC.mode !== 'land' }),
    wipe: x1 => ({
      enter: s => { if (LOC.mode !== 'hover') return false; s.x = LOC.x; s.y = LOC.fy; s.next = 0; ST.wiping = -1; },
      upd: (s, dt, t) => { s.x -= 0.7 * dt; LOC.fx = s.x; LOC.fy = s.y + 0.04 * Math.sin(t * 8); if (t > s.next) { s.next = t + 0.17; clothSpark(); sfx('squeak'); } return s.x <= x1; },
      exit: () => { ST.wiping = 0; }
    })
  };
  function runJob(name) {
    const home = () => LY.home;
    if (name === 'stroll') job(name, [SP.walk(rnd(LY.minX + (LY.maxX - LY.minX) * 0.3, LY.maxX)), SP.face(idleYaw), SP.wait(rnd(1.5, 3.5))]);
    else if (name === 'home') job(name, [SP.walk(home), SP.face(idleYaw)]);
    else if (name === 'sit') {
      const x = Math.random() < 0.7 ? rnd(midX(), LY.maxX) : rnd(LY.minX, LY.maxX); ST.music = Math.random() < 0.5;
      job(name, [SP.walk(x), SP.sit(), SP.call(() => { if (Math.random() < 0.35) say('sit'); }), SP.wait(rnd(14, 30)), SP.stand()]);
    } else if (name === 'wipe') {
      const r = numRect(); if (!r) return;
      const hy = Math.max(LY.ground + 0.4, r.cy - HAND_H), x0 = clamp(r.r + 0.95, LY.minX, LY.maxX), x1 = Math.max(LY.minX - 0.4, r.l + 0.95);
      if (x0 - x1 < 0.3) return;
      job(name, [SP.walk(x0), SP.face(-0.3), SP.fly(x0, hy), SP.call(() => { if (Math.random() < 0.6) say('wipe'); }), SP.wipe(x1),
        SP.call(() => { shine(); numSparks(); sfx('happy', { vol: 0.6 }); if (Math.random() < 0.5) say('wipeDone'); }), SP.wait(0.6), SP.land(), SP.walk(home), SP.face(idleYaw)]);
    } else if (CLIPS[name]) job(name, [SP.clip(name)]);
  }
  /* чем заняться, когда ничего не происходит */
  function brain(t) {
    if (act || JOB || queue.length || ST.drag || ST.noBrain) return;
    const m = ST.mood;
    if (LOC.mode === 'sit') { job('sitStay', [SP.wait(m === 'sleep' ? 1e6 : rnd(5, 12)), SP.stand()]); return; }
    if (LOC.mode !== 'stand' || t < ST.nextAct) return;
    if (t - ST.lastInput < 4) { ST.nextAct = t + 2; return; }
    ST.nextAct = t + rnd(7, 15);
    if (m === 'sleep') return;
    if (m === 'hide' || m === 'offline') { if (Math.abs(LOC.x - LY.home) > 0.3) runJob('home'); return; }
    if (ST.reduced) return;
    const away = Math.abs(LOC.x - LY.home) > 0.5;
    let opts = [['stroll', 3], ['sit', m === 'night' ? 5 : 3], ['peek', 1.2], ['yawn', m === 'night' ? 2 : 0.6]];
    if (numOK() && m !== 'night' && t - (ST.lastWipe || -1e9) > 120) opts.push(['wipe', 1.6]);
    if (m !== 'night') opts.push(['polish', 1], ['blocks', 1]);
    if (away) opts.push(['home', 3.5]);
    if (m === 'hunter') opts = [['stroll', 2], ['peek', 1]].concat(away ? [['home', 3]] : []);
    let tot = 0; for (const o of opts) if (o[0] !== ST.lastJob) tot += o[1];
    let r = Math.random() * tot, name = 'stroll';
    for (const o of opts) { if (o[0] === ST.lastJob) continue; r -= o[1]; if (r <= 0) { name = o[0]; break; } }
    ST.lastJob = name; if (name === 'wipe') ST.lastWipe = t; runJob(name);
    if ((name === 'polish' || name === 'blocks' || name === 'yawn') && Math.random() < 0.3) say('bored');
  }

  /* ---------- события из приложения ---------- */
  function trigger(name, data) {
    if (name === 'deposit') { playClip('deposit'); say('deposit', EV); buzz([10, 40, 10]); }
    else if (name === 'buy') { playClip('buy'); say('buy', EV); }
    else if (name === 'sellProfit') { playClip('sellProfit'); say('sellProfit', EV); }
    else if (name === 'sellLoss') { playClip('sellLoss'); say('sellLoss', EV); }
    else if (name === 'airdrop') { playClip('airdrop'); say('airdrop', EV); buzz([10, 40, 10]); }
    else if (name === 'signal') { playClip('signal'); say(data && data.news ? 'news' : 'signal', EV); buzz(20); }
    else if (name === 'ath') { playClip('ath'); say(data && data.port ? 'athPort' : 'ath', EV); buzz([15, 50, 15]); }
    else if (name === 'milestone') { setSign(data && data.label ? data.label : '★', false); playClip('milestone'); say('milestone', EV); buzz([15, 50, 15]); }
    else if (name === 'coinMove') { setSign(data.label, data.neg); playClip('coinMove'); say(data.neg ? 'coinDown' : 'coinUp', EV); }
    else if (name === 'screen') { playClip('screen'); say('screen', EV); }
    ST.lastEvent = now();
  }
  function baseline(S, D) {
    BL.tx = new Set((S.tx || []).map(t => t && t.id).filter(Boolean));
    BL.real = D.realized || 0;
    BL.alert = S.alerts && S.alerts[0] ? String(S.alerts[0].ts || '') : '';
    BL.ath = +(S.cycle && S.cycle.ath) || 0;
    BL.screen = (S.screen && S.screen.updatedAt) || '';
    if (lsGet('ms-mile', null) == null && D.total > 0) lsSet('ms-mile', MILES.filter(m => m <= D.total).pop() || 0);
    BL.ready = true;
  }
  function detect(S, D) {
    const ev = [];
    let dep = false, buy = false, sell = false, air = false;
    for (const t of S.tx || []) {
      if (!t || !t.id || BL.tx.has(t.id)) continue;
      BL.tx.add(t.id);
      const ts = Date.parse(t.ts || ''); if (isFinite(ts) && Date.now() - ts > 3 * 864e5) continue;
      const ty = t.type;
      if (ty === 'deposit' || ty === 'reserve_in' || ty === 'income') dep = true;
      else if (ty === 'buy' || ty === 'dca' || ty === 'dip' || ty === 'start') buy = true;
      else if (ty === 'sell') sell = true;
      else if (ty === 'airdrop') air = true;
    }
    const dR = (D.realized || 0) - BL.real; BL.real = D.realized || 0;
    if (sell) ev.push([dR >= 0 ? 'sellProfit' : 'sellLoss']);
    if (air) ev.push(['airdrop']);
    if (dep) ev.push(['deposit']);
    if (buy) ev.push(['buy']);
    const ath = +(S.cycle && S.cycle.ath) || 0;
    if (BL.ath && ath > BL.ath * 1.0005) ev.push(['ath', {}]);
    if (ath) BL.ath = Math.max(BL.ath, ath);
    const top = S.alerts && S.alerts[0], tts = top ? String(top.ts || '') : '';
    if (tts && tts > BL.alert) {
      const fresh = S.alerts.filter(a => String(a.ts || '') > BL.alert); BL.alert = tts;
      const kinds = new Set(fresh.map(a => a.kind));
      if (kinds.has('ath') && !ev.find(e => e[0] === 'ath')) ev.push(['ath', {}]);
      if ([...kinds].some(k => k !== 'ath')) ev.push(['signal', { news: true }]);
    }
    const su = (S.screen && S.screen.updatedAt) || '';
    if (su && BL.screen && su !== BL.screen) ev.push(['screen']);
    if (su) BL.screen = su;
    if (S.live && S.live.status === 'ok' && D.total > 0) {
      const mile = lsGet('ms-mile', 0) || 0, reached = MILES.filter(m => m <= D.total).pop() || 0;
      if (reached > mile) { lsSet('ms-mile', reached); ev.push(['milestone', { label: ST.hide ? '' : fmtMoney(reached) }]); }
      const peak = lsGet('ms-peak', { v: 0, d: '' });
      if (peak.v > 0 && D.total > peak.v * 1.01 && peak.d !== dayKey() && !ev.find(e => e[0] === 'milestone')) { ev.push(['ath', { port: true }]); peak.d = dayKey(); }
      if (D.total > peak.v) peak.v = D.total;
      lsSet('ms-peak', peak);
      const mv = lsGet('ms-mv', {}), dk = dayKey();
      let best = null;
      for (const s of D.syms || []) {
        const ch = S.live.change && S.live.change[s], p = +(D.prices && D.prices[s]) || 0, v = p * ((D.h && D.h[s] && D.h[s].qty) || 0);
        if (ch == null || v < 20 || Math.abs(ch) < 10 || mv[s] === dk) continue;
        if (!best || Math.abs(ch) > Math.abs(best.ch)) best = { s, ch };
      }
      if (best) { mv[best.s] = dk; lsSet('ms-mv', mv); ev.push(['coinMove', { sym: best.s, neg: best.ch < 0, label: best.s + ' ' + (best.ch > 0 ? '+' : '−') + Math.abs(best.ch).toFixed(1).replace('.', ',') + '%' }]); }
    }
    for (const e of ev) trigger(e[0], e[1]);
  }
  function fmtMoney(v) { try { if (ST.money) return ST.money(v, { d: 0, show: true }); } catch (e) {} return '$' + Math.round(v).toLocaleString('ru-RU'); }
  function sync(info) {
    if (!info || !info.S || !info.D) return;
    const S = info.S, D = info.D, P = info.P || {}, wasHide = ST.hide;
    ST.hide = !!P.hide; ST.sound = P.msVoice !== false; ST.go = !!info.go; ST.fresh = info.fresh || 0; ST.money = info.money || ST.money;
    if (!ST.sound) { stopVoice(); hum(false); }
    if (ST.hide && !wasHide && JOB && JOB.name === 'wipe') endJob(false);
    const off = !!info.offline; if (off && !ST.offline) ST.offSince = now(); ST.offline = off;
    ST.pct = info.pct == null || !isFinite(info.pct) ? null : info.pct;
    if (!S.ready) return;
    /* первые 2,5 с после загрузки только запоминаем состояние: данные приходят частями (сделки, сигналы, план) */
    if (!BL.ready) { baseline(S, D); BL.warm = now() + 2.5; firstData(); return; }
    if (now() < BL.warm) { baseline(S, D); return; }
    detect(S, D);
    wakeLoop();
  }
  /* знакомство: звук на телефоне включается только после касания, поэтому приветствие звучит на первое нажатие */
  function firstData() {
    ST.lastInput = now();
    if (!lsGet('ms-intro2', false)) ST.introPending = true;
    setTimeout(() => { if (!isNight()) playClip('hello'); }, 900);
  }

  /* ---------- настроение ---------- */
  function resolveMood(t) {
    const idle = t - Math.max(ST.lastInput, ST.lastEvent), duty = ST.go || ST.fresh > 0;
    if (ST.hide) return 'hide';
    if (ST.offline && t - ST.offSince > 60) return 'offline';
    if (!duty && idle > 180) return 'sleep';
    if (isNight() && !duty) return 'night';
    if (ST.go) return 'hunter';
    const p = ST.pct;
    if (p == null) return 'calm';
    if (p <= -7) return 'crash'; if (p <= -2) return 'down'; if (p >= 7) return 'rocket'; if (p >= 2) return 'up';
    return 'calm';
  }
  function schedule(t) {
    if (act) return;
    if (queue.length) { const q = queue.shift(); playClip(q.name, q.data); return; }
    if ((ST.go || ST.fresh > 0) && t > ST.nextSignal && ST.mood !== 'hide' && LOC.mode !== 'carry') { ST.nextSignal = t + 30; playClip('signal'); if (ST.go) say('signal'); return; }
    brain(t);
  }

  /* ---------- кадр ---------- */
  function update(dt, t) {
    const m = resolveMood(t);
    if (m !== ST.mood) {
      const prev = ST.mood; ST.mood = m; ST.moodSince = t;
      if (prev === 'sleep') { playClip('wake'); sfx('powerup'); if (JOB && JOB.name === 'sitStay') job('sitStay', [SP.wait(2), SP.stand()]); }
      if (m === 'sleep') sfx('powerdown', { vol: 0.6 });
      const g = { up: 'up', rocket: 'rocket', down: 'down', crash: 'crash', hunter: 'hunter', hide: 'hide', offline: 'offline', night: 'night' }[m];
      if (g && t - ST.lastInput > 0.5 && BL.ready) setTimeout(() => { if (ST.mood === m && say(g)) sfx(m === 'down' || m === 'crash' ? 'sad' : m === 'up' || m === 'rocket' || m === 'hunter' ? 'happy' : 'blips', { vol: 0.7 }); }, 1200);
    }
    schedule(t);
    stepJob(dt, t);
    updateLoc(dt, t);
    const P = BASE(), I = ST.reduced ? 0.25 : ST.intensity;
    moodPose(P, m, t, I);
    locPose(P, t);
    if (act) {
      if (act.hold != null) act.t0 = t - act.hold * act.dur;
      const k = clamp((t - act.t0) / act.dur, 0, 1);
      act.c.run(P, k, t, act);
      if (act && act.c.at) for (let i = 0; i < act.c.at.length; i++) { const a = act.c.at[i]; if (k >= a[0] && !act.fired[i]) { act.fired[i] = 1; a[1](act); } }
      if (act && k >= 1) endClip();
    }
    if (ST.reduced) { P.y *= 0.25; P.tz *= 0.25; }
    if (!P.gaze) {
      if (t > ST.nextGaze) { ST.gx = rnd(-0.035, 0.035); ST.gy = rnd(-0.025, 0.02); ST.nextGaze = t + rnd(1.4, 3.8); }
      P.ex += ST.gx; P.ey += ST.gy;
    }
    smooth(P, dt);
    ST.talk = damp(ST.talk, talkLevel(), 18, dt);
    if (t > ST.nextBlink) { ST.blinkT = t; ST.nextBlink = t + rnd(2.4, 5.5); }
    const bk = t - ST.blinkT, blink = bk < 0.16 ? 1 - 0.92 * Math.sin((bk / 0.16) * PI) : 1;
    apply(C, blink, t);
    if (!(ST.drag && ST.drag.spin)) { ST.spinV *= Math.exp(-3 * dt); ST.spin += ST.spinV * dt; ST.spin += (0 - ST.spin) * (1 - Math.exp(-2.5 * dt)); }
    if (C.thr > 0.3 && !ST.reduced && t > ST.nextThr) {
      ST.nextThr = t + 0.06;
      for (const L of R.legs) { L.shoe.getWorldPosition(V1); emit({ x: V1.x, y: V1.y - 0.04, z: 0.3 }, 1, { vel: [0, -1.6, 0], jit: 0.35, colors: ['#ffb547', '#ff7a1a', '#fff1b8'], gravity: 0, life: 0.32 }); }
    }
    const wantHum = C.thr > 0.35; if (wantHum !== ST.hum) { ST.hum = wantHum; hum(wantHum); }
    if (PT) PT.update(dt);
    overlays();
  }
  const antOn = col(0xff4d5e), antOff = col(0x5a1820);
  function faceState(c, blink) {
    let mode = 'calm';
    if (c.eye === 'closed') mode = 'closed'; else if (c.eye === 'happy') mode = 'happy'; else if (c.eye === 'star') mode = 'star'; else if (c.eye === 'spiral') mode = 'spiral';
    else if (c.mouth === 'O' || c.mouth === 'o') mode = 'O'; else if (c.mouth === 'frown') mode = 'sad'; else if (c.mouth === 'flat') mode = 'flat'; else if (c.mouth === 'grin') mode = 'grin';
    if (mode === 'calm' && c.eo > 1.05) mode = 'wide';
    const bl = mode === 'calm' || mode === 'wide' || mode === 'sad' || mode === 'grin';
    const tk = ST.talk > 0.04 && (bl || mode === 'O') ? 0.78 + 0.55 * ST.talk : 1;
    return { mode, glyph: c.glyph || '', open: clamp(c.eo, 0.08, 1.2) * (bl ? blink : 1) * tk, ex: c.ex, ey: c.ey, tilt: clamp(c.brow, -1, 1) * 0.32, z: !!c.zz };
  }
  /* пальцы: кулак, открытая ладонь или указательный палец */
  function fingers(H, fist, point, sx) {
    for (let i = 0; i < 4; i++) H.fingers[i].rotation.z = -sx * lerp(fist, i === 0 ? 0 : 1, point) * 1.45;
    H.thumb.rotation.z = -sx * (0.6 + 0.55 * Math.max(fist, point));
  }
  const KEY_OFF = new T.Vector3(2.5, 4, 5);
  function apply(c, blink, t) {
    R.root.position.set(LOC.x, LOC.y, 0);
    R.root.rotation.y = LOC.yaw + c.yaw + ST.spin;
    R.hop.position.y = Math.max(0, c.y);
    const sq = c.sq, inv = 1 / Math.sqrt(sq); R.hop.scale.set(inv, sq, inv);
    R.bodyG.rotation.set(c.tx, 0, c.tz);
    R.head.rotation.set(c.hx - c.ey * 2.2, c.hy + c.ex * 2.4, c.hz);
    R.armL.p.rotation.set(c.laX, 0, c.laZ); R.armR.p.rotation.set(c.raX, 0, c.raZ);
    fingers(R.armL, c.fl, c.pl, -1); fingers(R.armR, c.fr, c.pr, 1);
    R.legs[0].g.rotation.x = -c.legL; R.legs[1].g.rotation.x = -c.legR;
    for (const g of R.cords) { g.rotation.z = -c.tz * 1.1 + 0.04 * Math.sin(t * 1.7 + g.position.x * 20); g.rotation.x = -c.tx * 1.2 + 0.03 * Math.sin(t * 1.3 + g.position.x * 9); }
    R.face.update(faceState(c, blink), R.cfg, t);
    const dim = 1 - 0.42 * clamp(c.tarn, 0, 1);
    R.visorMat.emissiveIntensity = (1.25 + 0.35 * ST.talk) * dim;
    const beat = ST.music && LOC.mode === 'sit' ? 0.75 + 0.45 * Math.max(0, Math.sin(t * 7.4)) : 1;
    R.ringMat.color.copy(R.glowC).multiplyScalar(dim * (0.8 + 0.2 * Math.sin(t * 2.1)) * beat * (1 + 0.7 * ST.talk));
    R.hoodUp.visible = !!c.cap; R.hoodDown.visible = !c.cap; R.phones.visible = !c.cap;
    R.ant.visible = !!c.ant; if (c.ant) R.antMat.color.copy(Math.sin(t * 6) > 0 ? antOn : antOff);
    R.pend.material.emissiveIntensity = 2.2 * clamp(c.pend, 0, 1);
    R.cloth.visible = c.cloth > 0.02; R.cloth.scale.setScalar(Math.max(0.001, c.cloth));
    R.tablet.visible = c.tablet > 0.02; R.tablet.scale.setScalar(Math.max(0.001, c.tablet * 1.3)); R.tablet.rotation.x = -c.raX;
    const th = clamp(c.thr, 0, 1);
    for (const L of R.legs) {
      L.flame.visible = th > 0.03;
      if (L.flame.visible) { const f = 0.8 + 0.2 * Math.sin(t * 47 + L.g.position.x * 9); L.flame.material.opacity = th * f; L.flame.scale.set(0.24 + 0.1 * th, (0.32 + 0.38 * th) * f, 1); }
    }
    /* свет с тенями следует за персонажем */
    keyLight.position.set(LOC.x + KEY_OFF.x, LOC.y + 1.2 + KEY_OFF.y, KEY_OFF.z); keyLight.target.position.set(LOC.x, LOC.y + 1.2, 0); keyLight.target.updateMatrixWorld();
    /* тень на «полу» карточки; когда сидит на краю — тени нет */
    const onFloor = LOC.mode !== 'sit' && LOC.sitK < 0.5 && LOC.y > LY.edge - 0.3;
    const lift = Math.max(0, LOC.y + Math.max(0, c.y) - LY.ground), ss = clamp(1 - lift * 0.35, 0.3, 1);
    PR.shadow.visible = onFloor; PR.shadow.position.set(LOC.x, LY.ground + 0.003, 0.02); PR.shadow.scale.set(ss, ss, 1); PR.shadow.material.opacity = clamp(1 - lift * 0.5, 0.15, 1) * 0.9;
  }
  /* «!», табличка и зона касания следуют за персонажем */
  function overlays() {
    V1.set(0, R.topY + 0.05, 0); R.hop.localToWorld(V1);
    const hx = pxX(V1.x), hy = pxY(V1.y, V1.z);
    for (const k of ['alert', 'sign']) { const el = ui[k]; if (el && el.classList.contains('on')) { el.style.left = hx + 'px'; el.style.top = Math.max(16, hy - 4) + 'px'; } }
    const sitting = LOC.mode === 'sit' || (LOC.mode === 'hop' && LOC.sitK > 0.5);
    const top = Math.round(hy - 6), bot = sitting ? pxY(LY.edge) + 4 : pxY(LOC.y + Math.max(0, C.y || 0)) + 2;
    const w = Math.round(1.5 * LY.U), l = Math.round(pxX(LOC.x) - w / 2), h = Math.round(Math.max(30, bot - top));
    const hk = l + ',' + top + ',' + h;
    if (hk !== ui.hk) { ui.hk = hk; ui.hit.style.transform = 'translate(' + l + 'px,' + top + 'px)'; ui.hit.style.width = w + 'px'; ui.hit.style.height = h + 'px'; }
  }

  /* ---------- цикл отрисовки ---------- */
  function visible() {
    if (!host || document.hidden || !inView || !LY.ok) return false;
    if (host.offsetParent === null) return false;
    if (document.querySelector('.sheet.open')) return false;
    return true;
  }
  function frame() {
    raf = 0;
    if (!visible()) { hum(false); ST.hum = false; QG.last = 0; return; }
    raf = requestAnimationFrame(frame);
    const t = now(), fps = ST.reduced ? 12 : ST.mood === 'sleep' ? 15 : 30;
    if (t - lastF < 1 / fps - 0.004) return;
    const dt = Math.min(0.1, t - lastF); lastF = t;
    try { update(dt, t); renderer.render(scene, camera); } catch (e) { console.error(e); cancelAnimationFrame(raf); raf = 0; return; }
    govern(t, fps);
    if (!firstFrame) { firstFrame = true; host.classList.add('ms-live'); }
  }
  /* если телефон не успевает рисовать 30 кадров в секунду — понемногу снижаем качество (чёткость, затем тени) */
  const QG = { ema: 0, level: 0, next: 0, last: 0, off: false };
  function quality(level) {
    QG.level = level; const dpr = window.devicePixelRatio || 1;
    if (level >= 1) renderer.setPixelRatio(Math.min(dpr, 2));
    if (level >= 2) keyLight.castShadow = false;
    if (level >= 3) renderer.setPixelRatio(Math.min(dpr, 1.5));
    measure();
  }
  function govern(t, fps) {
    if (QG.off || fps < 30) { QG.last = 0; return; }
    if (QG.last) {
      const iv = t - QG.last, tgt = 1 / fps;
      if (iv < 0.5) { QG.ema = QG.ema ? QG.ema * 0.92 + iv * 0.08 : iv; if (QG.ema > tgt * 1.45 && t > QG.next && QG.level < 3) { quality(QG.level + 1); QG.next = t + 4; QG.ema = tgt; } }
    }
    QG.last = t;
  }
  function wakeLoop() { if (!raf && inited && (LY.ok || measure()) && visible()) { lastF = now(); raf = requestAnimationFrame(frame); } }

  /* ---------- касания: тап, двойной тап, много тапов, долгое нажатие — взять на руки, свайп — покрутить ---------- */
  function userInput(t) { const wasSleep = ST.mood === 'sleep'; ST.lastInput = t || now(); if (wasSleep) { ST.wokeAt = now(); wakeLoop(); } }
  function onDown(e) {
    unlock(); const t = now(); userInput(t);
    if (e.button > 0) return;
    ST.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: t, moved: false, spin: false, carry: false };
    clearTimeout(ST.longT);
    ST.longT = setTimeout(() => { const d = ST.drag; if (d && !d.moved) startCarry(d); }, 420);
    try { ui.hit.setPointerCapture(e.pointerId); } catch (x) {}
  }
  function onMove(e) {
    const d = ST.drag; if (!d || e.pointerId !== d.id) return;
    if (d.carry) {
      const p = toWorld(e.clientX, e.clientY);
      LOC.cx = clamp(p.x + LOC.gx, 0.7, LY.W / LY.U - 0.7); LOC.cy = clamp(p.y + LOC.gy, wY(LY.H - 4), wY(6) - R.topY);
      d.x = e.clientX; d.y = e.clientY; return;
    }
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(dx, dy) > 9) { d.moved = true; clearTimeout(ST.longT); d.spin = Math.abs(dx) > Math.abs(dy); }
    if (d.moved && d.spin) { const step = e.clientX - d.x; ST.spin += step * 0.016; ST.spinV = step * 0.9; }
    d.x = e.clientX; d.y = e.clientY;
  }
  function onUp(e) {
    const d = ST.drag; if (!d || (e && e.pointerId !== d.id)) return;
    ST.drag = null; clearTimeout(ST.longT);
    if (d.carry) { endCarry(); return; }
    if (d.moved) { if (d.spin && Math.abs(ST.spinV) > 4) sfx('spin', { vol: 0.8 }); return; }
    tapped();
  }
  function onCancel() { const d = ST.drag; ST.drag = null; clearTimeout(ST.longT); if (d && d.carry) endCarry(); }
  function tapped() {
    const t = now();
    ST.taps = ST.taps.filter(x => t - x < 2.4); ST.taps.push(t);
    if (ST.taps.length >= 5) { ST.taps = []; clearTimeout(ST.tapTimer); ST.lastTap = 0; endClip(); playClip('dizzy'); sfx('dizzy'); say('dizzy', U_); buzz([20, 30, 20]); return; }
    if (t - ST.lastTap < 0.32) { clearTimeout(ST.tapTimer); ST.lastTap = 0; if (act && act.c.pri < 3) endClip(); playClip('dance'); sfx('happy'); say('dance', U_); return; }
    ST.lastTap = t; sfx('tap');
    ST.tapTimer = setTimeout(() => {
      if (now() - (ST.wokeAt || -9) < 1.2) { say('wake', U_); return; }
      if (LOC.mode === 'carry' || (act && act.c.pri >= 3)) return;
      if (act) endClip();
      if (ST.introPending && ST.sound) { ST.introPending = false; lsSet('ms-intro2', true); playClip('tapWave'); say('intro', U_); return; }
      const air = LOC.mode === 'sit' || LOC.mode === 'hop' || LOC.mode === 'hover' || LOC.mode === 'land';
      playClip(air ? 'tapWave' : pick(['tap', 'tapSpin', 'tapWave', 'tapJump']));
      if (!AU.cur) say(isNight() ? 'tapNight' : 'tap', U_);
    }, 260);
  }
  function startCarry(d) {
    d.carry = true; endJob(true); if (act && act.c.pri < 3) endClip();
    ST.wiping = 0; if (LOC.mode === 'hover' || LOC.mode === 'land') { hum(false); ST.hum = false; }
    const p = toWorld(d.x, d.y);
    LOC.gx = LOC.x - p.x; LOC.gy = LOC.y - p.y; LOC.cx = LOC.x; LOC.cy = LOC.y + 0.25; LOC.vx = LOC.vy = 0; LOC.hop = null;
    LOC.mode = 'carry';
    sfx('whee'); buzz(15); say('carry', U_);
  }
  function endCarry() {
    const L = LOC; if (L.mode !== 'carry') return;
    const nearEdge = Math.abs(L.y + SEAT - LY.edge) < 0.3 && L.x > LY.minX - 0.2 && L.x < LY.maxX + 0.2;
    L.x = clamp(L.x, LY.minX, LY.maxX);
    if (nearEdge || L.y < LY.ground - 0.15) { hopTo(L.x, LY.edge - SEAT, 'sit', 0.3, 0.12); job('sitStay', [SP.wait(rnd(8, 16)), SP.stand()]); }
    else { L.mode = 'fall'; L.vx = clamp(L.vx, -4, 4); L.vy = clamp(L.vy, -3, 5); if (L.y - LY.ground > 0.6) sfx('fall'); }
  }

  /* ---------- запуск ---------- */
  function init(opts) {
    if (inited) return true;
    opts = opts || {}; host = opts.host; A = opts.app || {};
    if (!host) return false;
    hero = (host.closest && host.closest('.hero')) || host.parentElement;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
      if (!renderer.getContext()) return false;
    } catch (e) { return false; }
    if (!document.getElementById('ms-css')) { const st = document.createElement('style'); st.id = 'ms-css'; st.textContent = CSS; document.head.appendChild(st); }
    ST.reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
    renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    const cv = renderer.domElement; cv.className = 'ms-cv'; cv.setAttribute('aria-hidden', 'true'); host.appendChild(cv);
    scene = new T.Scene(); scene.environment = envMap(renderer);
    camera = new T.OrthographicCamera(-4, 4, 3, -3, 1, 80);
    scene.add(new T.HemisphereLight(col(0xfff6e8), col(0x2a1d4a), 0.45));
    keyLight = new T.DirectionalLight(0xffffff, 1.35); keyLight.castShadow = true; keyLight.shadow.mapSize.set(1024, 1024);
    const sc = keyLight.shadow.camera; sc.left = -1.7; sc.right = 1.7; sc.top = 1.8; sc.bottom = -1.8; sc.near = 0.5; sc.far = 20;
    keyLight.shadow.bias = -0.0008; keyLight.shadow.normalBias = 0.02; keyLight.shadow.radius = 3;
    scene.add(keyLight); scene.add(keyLight.target);
    const front = new T.DirectionalLight(0xffffff, 0.32); front.position.set(0, 1.5, 6); scene.add(front);
    const rim = new T.DirectionalLight(col(0xc58bff), 0.9); rim.position.set(-4, 2.5, -3); scene.add(rim);
    const fill = new T.DirectionalLight(col(0xffd9a8), 0.35); fill.position.set(-3, 1, 3); scene.add(fill);
    const top = new T.DirectionalLight(0xffffff, 0.28); top.position.set(0.5, 6, 1.5); scene.add(top);
    const cfg = CFG.slitok, TX = makeTextures(); M = materials(cfg, TX); R = buildStreet(M, cfg); scene.add(R.root);
    PR = buildProps(M, R, scene); PT = Particles(scene, sparkTex());
    const mk = (cls, txt) => { const d = document.createElement('div'); d.className = cls; if (txt) d.textContent = txt; host.appendChild(d); return d; };
    ui.hit = mk('ms-hit'); ui.hit.setAttribute('role', 'button'); ui.hit.setAttribute('aria-label', 'Слиток — нажми, чтобы поздороваться'); ui.hit.tabIndex = 0;
    ui.alert = mk('ms-float ms-alert', '!'); ui.sign = mk('ms-float ms-sign');
    measure();
    const remeasure = () => { if (measure()) wakeLoop(); };
    if (window.ResizeObserver) { const ro = new ResizeObserver(remeasure); ro.observe(host); if (hero && hero !== host) ro.observe(hero); }
    window.addEventListener('resize', remeasure);
    if (window.IntersectionObserver) new IntersectionObserver(es => { inView = es[0].isIntersecting; if (inView) wakeLoop(); }).observe(host);
    document.addEventListener('visibilitychange', () => { if (document.hidden) { hum(false); ST.hum = false; stopVoice(); } else { userInput(); wakeLoop(); } });
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, e => { if (ev === 'pointerdown' || ev === 'keydown') unlock(); if (!host.contains(e.target)) userInput(); }, { passive: true }));
    ui.hit.addEventListener('pointerdown', onDown); ui.hit.addEventListener('pointermove', onMove); ui.hit.addEventListener('pointerup', onUp); ui.hit.addEventListener('pointercancel', onCancel);
    ui.hit.addEventListener('touchmove', e => { if (ST.drag && ST.drag.carry) e.preventDefault(); }, { passive: false });
    ui.hit.addEventListener('contextmenu', e => e.preventDefault());
    ui.hit.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); unlock(); userInput(); tapped(); } });
    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); host.classList.remove('ms-live'); cancelAnimationFrame(raf); raf = 0; });
    setInterval(() => { if (!raf) wakeLoop(); }, 700);
    ST.nextBlink = now() + 1.5; ST.nextGaze = now() + 1; ST.nextAct = now() + 9;
    setTimeout(loadPack, 2500);
    inited = true; wakeLoop();
    return true;
  }

  window.Mascot = {
    init, sync, number,
    event: (name, data) => trigger(name, data),
    _hold: k => { if (act) act.hold = k; },
    debug: {
      clip: (n, d) => { endClip(); playClip(n, d); },
      at: (n, k, d) => { endClip(); playClip(n, d); if (act) act.hold = k; },
      hour: h => { ST.forceHour = h; },
      mood: m => { if (ST.forceHour == null) ST.forceHour = 12; ST.pct = { calm: 0, up: 3, rocket: 9, down: -3, crash: -9 }[m]; ST.go = m === 'hunter'; ST.hide = m === 'hide'; if (m === 'sleep') { ST.lastInput = ST.lastEvent = now() - 400; } else ST.lastInput = now(); if (m === 'offline') { ST.offline = true; ST.offSince = now() - 120; } else ST.offline = false; },
      say: (g, o) => say(g, Object.assign({ user: true }, o || {})),
      state: () => ({ mood: ST.mood, act: act && act.name, job: JOB && JOB.name, loc: LOC.mode, x: +LOC.x.toFixed(2), y: +LOC.y.toFixed(2), queue: queue.map(q => q.name), raf: !!raf, frame: firstFrame, voice: !!AU.pack, talk: +ST.talk.toFixed(2), said: ST.lastSay || '', calls: renderer ? renderer.info.render.calls : 0, tris: renderer ? renderer.info.render.triangles : 0, ly: { W: LY.W, H: LY.H, ground: +LY.ground.toFixed(2), edge: +LY.edge.toFixed(2), minX: +LY.minX.toFixed(2), maxX: +LY.maxX.toFixed(2), home: +LY.home.toFixed(2) } }),
      render: () => { if (renderer) { update(1 / 30, now()); renderer.render(scene, camera); } },
      box: () => { const r = host.getBoundingClientRect(); return { x: r.left + pxX(LOC.x) - 1.05 * LY.U, y: r.top + pxY(LOC.y + R.topY + 0.15), w: 2.1 * LY.U, h: pxY(LOC.y - 0.25) - pxY(LOC.y + R.topY + 0.15) }; },
      pr: v => { QG.off = true; renderer.setPixelRatio(v); measure(); },
      quality: () => ({ level: QG.level, ema: +QG.ema.toFixed(3) }),
      job: n => { endJob(true); runJob(n); },
      still: on => { ST.noBrain = on !== false; },
      loc: o => { endJob(true); Object.assign(LOC, o); if (o.mode === 'sit') { LOC.sitK = 1; LOC.y = LY.edge - SEAT; } else if (o.mode === 'stand' || o.mode === 'walk') { LOC.sitK = 0; LOC.y = LY.ground; } if (o.yaw != null) LOC.yawT = o.yaw; },
      voice: id => voice(id, {}),
      sfx: n => sfx(n),
      au: () => ({ ctx: !!AU.c, state: AU.c && AU.c.state, pack: !!AU.pack, failed: AU.failed, cache: AU.cache.size, cur: !!AU.cur }),
      vbuf: id => { const c = au(); return c && AU.pack ? vbuf(c, id).then(b => b.duration) : Promise.resolve(-1); }
    }
  };
})();
