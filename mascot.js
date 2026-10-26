/* MoneyLife — живой персонаж в карточке баланса. Этап 1: «Слиток» (биткоин), стиль дизайнерских игрушек.
   Нужен three.js r128 (глобальный THREE). Рядом лежат three.min.js и voice-slitok.js (голос робота).
   Приложение вызывает:
     Mascot.init({ host, app })     — один раз; host — прозрачный слой поверх карточки баланса (#mascot);
     Mascot.sync(info)              — при каждой отрисовке главной (info: S, D, P, pct, go, fresh, offline, money);
     Mascot.number({ el, to, up })  — сумма баланса изменилась: Слиток сам «переставляет» цифры.
   Слиток ходит по карточке, сидит на её краю, свесив ноги, протирает цифры и говорит голосом робота.
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
  /* реактивное пламя из подошв */
  const flameTex = () => ctex(64, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h * 0.1, 0, w / 2, h * 0.1, h * 0.9);
    gr.addColorStop(0, 'rgba(255,252,230,1)'); gr.addColorStop(0.16, 'rgba(255,208,112,.95)'); gr.addColorStop(0.5, 'rgba(255,120,30,.42)'); gr.addColorStop(1, 'rgba(255,80,0,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(w / 2, h * 0.45, w * 0.44, h * 0.47, 0, 0, TAU); g.fill();
  });
  /* луч, которым Слиток «переставляет» цифры */
  const beamTex = () => ctex(128, 32, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,150,40,0)'); gr.addColorStop(0.32, 'rgba(255,170,70,.5)'); gr.addColorStop(0.5, 'rgba(255,250,235,1)'); gr.addColorStop(0.68, 'rgba(255,170,70,.5)'); gr.addColorStop(1, 'rgba(255,150,40,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    const fx = g.createLinearGradient(0, 0, w, 0);
    fx.addColorStop(0, 'rgba(0,0,0,0)'); fx.addColorStop(0.1, 'rgba(0,0,0,1)'); fx.addColorStop(0.88, 'rgba(0,0,0,1)'); fx.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fx; g.fillRect(0, 0, w, h);
  });
  /* окружение для бликов на глянце: тёплый верх, фиолетовый низ, два «окна» света */
  function envMap(renderer) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, '#fff6e6'); gr.addColorStop(0.42, '#d9c2ff'); gr.addColorStop(0.55, '#4a3570'); gr.addColorStop(1, '#140e24');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
    const spot = (x, y, r, a) => { const s = g.createRadialGradient(x, y, 0, x, y, r); s.addColorStop(0, 'rgba(255,255,255,' + a + ')'); s.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = s; g.fillRect(x - r, y - r, r * 2, r * 2); };
    spot(64, 26, 30, 1); spot(190, 34, 22, 0.75); spot(128, 14, 18, 0.6);
    const tex = new T.CanvasTexture(c); tex.mapping = T.EquirectangularReflectionMapping; tex.encoding = T.sRGBEncoding;
    const pm = new T.PMREMGenerator(renderer); const env = pm.fromEquirectangular(tex).texture; pm.dispose(); tex.dispose();
    return env;
  }

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
    const pts = [], n = 8;
    for (let i = 0; i <= n; i++) { const a = -PI / 2 + (i / n) * (PI / 2); pts.push(new T.Vector2(Math.max(1e-4, Math.cos(a) * r), -len / 2 + Math.sin(a) * r)); }
    for (let i = 0; i <= n; i++) { const a = (i / n) * (PI / 2); pts.push(new T.Vector2(Math.max(1e-4, Math.cos(a) * r), len / 2 + Math.sin(a) * r)); }
    return new T.LatheGeometry(pts, segs || 14);
  }

  /* ---------- материалы ---------- */
  function materials(cfg) {
    const std = (c, r, m, x) => new T.MeshStandardMaterial(Object.assign({ color: col(c), roughness: r, metalness: m }, x || {}));
    const basic = (c, x) => new T.MeshBasicMaterial(Object.assign({ color: col(c) }, x || {}));
    return {
      helmet: std(cfg.helmet, 0.4, 0.22), bezel: std(0x3a3d47, 0.45, 0.35), accent: std(cfg.accent, 0.36, 0.12),
      jacket: std(cfg.jacket, 0.66, 0), ribIn: std(cfg.rib, 0.85, 0, { side: T.DoubleSide }), rib: std(cfg.rib, 0.9, 0), pants: std(cfg.pants, 0.88, 0),
      glove: std(0x15161b, 0.5, 0.08), shoe: std(cfg.shoe, 0.48, 0.06), sole: std(0xeee6d8, 0.62, 0), lace: std(0xf3f0e8, 0.72, 0),
      gold: std(0xf2b43c, 0.24, 0.85), goldDeep: std(0xdc922e, 0.32, 0.7), steel: std(0xa3abb6, 0.28, 0.85), red: basic(0xff4d5e),
      pend: std(0xf2b43c, 0.24, 0.85, { emissive: col(0xff9a1f), emissiveIntensity: 0 }),
      gift: std(0xff5d8f, 0.38, 0), ribbon: std(0xffd34d, 0.32, 0.25), cloth: std(0x86d6ff, 0.85, 0), tablet: std(0x1e2233, 0.28, 0.35),
      shadow: new T.MeshBasicMaterial({ map: radialTex('rgba(6,3,20,0.72)', 'rgba(6,3,20,0)'), transparent: true, depthWrite: false })
    };
  }

  /* ---------- светящееся лицо на визоре: рисуем глаза на холсте, обновляем только при изменении ---------- */
  function Face() {
    const W = 512, H = 120, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding;
    let key = '';
    const rr = (x, y, w, h, r) => { r = Math.max(0, Math.min(r, w / 2, h / 2)); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    const starP = (ro, ri) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -PI / 2 + (i * PI) / 5, r = i % 2 ? ri : ro; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); };
    const text = (s, x, y, size) => { g.font = '900 ' + size + 'px system-ui,-apple-system,"Segoe UI",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y); };
    function eye(mode, x, y, open, tilt, sp) {
      g.save(); g.translate(x, y); g.rotate(tilt);
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
      g.restore();
    }
    function draw(st, cfg, t) {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      g.save(); g.shadowColor = cfg.glowCss; g.shadowBlur = 26; g.fillStyle = cfg.glowCore; g.strokeStyle = cfg.glowCore;
      const cx = W / 2 + st.ex * 900, cy = H * 0.5 + st.ey * -700, dx = 100, sp = t * 7;
      if (st.glyph === 'dots') text('• • • •', cx, cy + 4, 60);
      else if (st.glyph === 'scan') { const p = (Math.sin(t * 2.6) + 1) / 2; rr(W * 0.2 + p * W * 0.44, cy - 7, 92, 14, 7); g.fill(); }
      else if (st.glyph) { text(st.glyph, cx - dx, cy + 3, 86); text(st.glyph, cx + dx, cy + 3, 86); }
      else { eye(st.mode, cx - dx, cy, st.open, -st.tilt, sp); eye(st.mode, cx + dx, cy, st.open, st.tilt, -sp); }
      if (st.z) { const ph = (t * 0.7) % 1; g.shadowBlur = 10; g.globalAlpha = 1 - ph; text('z', W * 0.8 + ph * 26, H * 0.36 - ph * 24, 26 + ph * 14); g.globalAlpha = 1; }
      g.restore();
      g.fillStyle = 'rgba(0,0,0,0.28)';                 /* сетка светодиодов */
      for (let x = 0; x < W; x += 5) g.fillRect(x, 0, 1.2, H);
      for (let y = 0; y < H; y += 5) g.fillRect(0, y, W, 1.2);
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
    slitok: { name: 'Слиток', helmet: 0x2b2d35, accent: 0xff9a1f, glow: 0xff9a1f, glowCss: '#ff8a00', glowCore: '#ffc46a', jacket: 0xb4440f, rib: 0x18191e, pants: 0x1f2026, shoe: 0x1c1e24 }
  };
  function buildStreet(M, cfg) {
    const R = { kind: 'street', cfg };
    R.glowC = col(cfg.glow); R.ringMat = new T.MeshBasicMaterial({ color: R.glowC.clone() });
    R.root = new T.Group(); R.hop = new T.Group(); R.root.add(R.hop);
    const sph = new T.SphereGeometry(1, 32, 22);
    const flameMat = new T.SpriteMaterial({ map: flameTex(), transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0 });
    /* ноги на шарнирах: штанина, манжета, карман, лампас и кроссовок двигаются вместе */
    const legGeo = capsuleGeo(0.135, 0.2, 14);
    R.legs = [];
    for (const sx of [-1, 1]) {
      const lg = new T.Group(); lg.position.set(sx * 0.19, 0.62, 0.02); R.hop.add(lg);
      const l = new T.Mesh(legGeo, M.pants); l.position.y = -0.16; lg.add(l);
      const cuff = new T.Mesh(new T.TorusGeometry(0.12, 0.042, 8, 20), M.rib); cuff.rotation.x = PI / 2; cuff.position.set(0, -0.31, 0.005); lg.add(cuff);
      const pk = new T.Mesh(roundBox(0.035, 0.15, 0.17, 0.014), M.pants); pk.position.set(sx * 0.135, -0.14, 0); lg.add(pk);
      const lam = new T.Mesh(roundBox(0.02, 0.36, 0.035, 0.008), M.accent); lam.position.set(sx * 0.13, -0.16, -0.09); lg.add(lam);
      const s = new T.Group(); s.position.set(sx * 0.025, -0.62, 0.03); s.rotation.y = sx * 0.07; lg.add(s);
      const sole = new T.Mesh(ingotGeo(0.35, 0.11, 0.58, 0.05, 1, 1, 6), M.sole); sole.position.y = 0.055; s.add(sole);
      const up = new T.Mesh(ingotGeo(0.32, 0.2, 0.5, 0.085, 0.86, 0.8, 8), M.shoe); up.position.set(0, 0.2, -0.02); s.add(up);
      const stripe = new T.Mesh(roundBox(0.016, 0.06, 0.28, 0.007), M.accent); stripe.position.set(sx * 0.157, 0.18, 0.01); s.add(stripe);
      const toe = new T.Mesh(ingotGeo(0.29, 0.07, 0.13, 0.033, 1, 1, 6), M.sole); toe.position.set(0, 0.13, 0.22); s.add(toe);
      for (let i = 0; i < 3; i++) { const lc = new T.Mesh(roundBox(0.14, 0.02, 0.03, 0.009), M.lace); lc.position.set(0, 0.29 - i * 0.016, 0.085 + i * 0.056); lc.rotation.x = -0.38; s.add(lc); }
      const fl = new T.Sprite(flameMat.clone()); fl.center.set(0.5, 1); fl.position.set(0, 0.01, -0.02); fl.scale.set(0.24, 0.46, 1); fl.visible = false; s.add(fl);
      R.legs.push({ g: lg, shoe: s, flame: fl });
    }
    /* корпус: бомбер */
    R.bodyG = new T.Group(); R.bodyG.position.y = 0.58; R.hop.add(R.bodyG);
    const hips = new T.Mesh(roundBox(0.66, 0.2, 0.46, 0.09), M.pants); hips.position.y = 0.04; R.bodyG.add(hips);
    const torso = new T.Mesh(ingotGeo(0.94, 0.6, 0.62, 0.22, 0.9, 0.94, 12), M.jacket); torso.position.y = 0.36; R.bodyG.add(torso);
    const hem = new T.Mesh(ingotGeo(0.97, 0.09, 0.645, 0.045, 1, 1, 6), M.rib); hem.position.y = 0.1; R.bodyG.add(hem);
    const zip = new T.Mesh(new T.BoxGeometry(0.022, 0.5, 0.012), M.gold); zip.position.set(0, 0.37, 0.309); zip.rotation.x = -0.035; R.bodyG.add(zip);
    const collar = new T.Mesh(new T.TorusGeometry(0.21, 0.07, 10, 28), M.rib); collar.rotation.x = PI / 2; collar.position.y = 0.66; R.bodyG.add(collar);
    R.hoodDown = new T.Mesh(new T.TorusGeometry(0.3, 0.11, 10, 24, PI * 1.25), M.rib); R.hoodDown.rotation.set(-PI / 2, 0, -PI * 0.125); R.hoodDown.position.set(0, 0.66, -0.05); R.bodyG.add(R.hoodDown);
    const chain = new T.Mesh(new T.TorusGeometry(0.17, 0.02, 8, 36, PI), M.gold); chain.rotation.z = PI; chain.position.set(0, 0.6, 0.318); chain.rotation.x = -0.04; R.bodyG.add(chain);
    R.pend = new T.Mesh(ingotGeo(0.13, 0.08, 0.045, 0.016, 0.8, 0.9, 4), M.pend); R.pend.position.set(0, 0.4, 0.325); R.bodyG.add(R.pend);
    for (const sx of [-1, 1]) { const st = new T.Mesh(roundBox(0.03, 0.42, 0.012, 0.006), M.rib); st.position.set(sx * 0.475, 0.36, 0.0); st.rotation.z = sx * 0.05; R.bodyG.add(st); }
    /* руки в рукавах и перчатках */
    const sleeveGeo = capsuleGeo(0.125, 0.24, 14);
    const arm = sx => {
      const p = new T.Group(); p.position.set(sx * 0.5, 0.58, 0); R.bodyG.add(p);
      const a = new T.Mesh(sleeveGeo, M.jacket); a.position.y = -0.2; p.add(a);
      const cf = new T.Mesh(new T.TorusGeometry(0.105, 0.036, 8, 20), M.rib); cf.rotation.x = PI / 2; cf.position.y = -0.4; p.add(cf);
      if (sx < 0) { const patch = new T.Mesh(roundBox(0.03, 0.11, 0.14, 0.012), M.rib); patch.position.set(sx * 0.118, -0.12, 0.02); p.add(patch); const dot = new T.Mesh(new T.CircleGeometry(0.028, 16), R.ringMat); dot.rotation.y = -PI / 2; dot.position.set(sx * 0.135, -0.12, 0.02); p.add(dot); }
      const h = new T.Group(); h.position.y = -0.47; p.add(h);
      const gl = new T.Mesh(sph, M.glove); gl.scale.set(0.11, 0.105, 0.11); h.add(gl);
      const th = new T.Mesh(sph, M.glove); th.scale.set(0.045, 0.06, 0.045); th.position.set(-sx * 0.08, 0.03, 0.05); h.add(th);
      return { p, h };
    };
    R.armL = arm(-1); R.armR = arm(1);
    /* голова: шлем с визором */
    R.head = new T.Group(); R.head.position.y = 1.13; R.bodyG.add(R.head);
    const HS = new T.Vector3(1.04, 0.97, 1);
    const helm = new T.Mesh(new T.SphereGeometry(0.56, 48, 32), M.helmet); helm.scale.copy(HS); R.head.add(helm);
    const ridge = new T.Mesh(new T.TorusGeometry(0.578, 0.036, 8, 48, 2.3), M.accent); ridge.rotation.set(0, PI / 2, 0.25); ridge.scale.set(1, 0.97, 1); R.head.add(ridge);
    const VPH = 2.5, VT0 = 1.36, VTL = 0.62;
    const bez = new T.Mesh(new T.SphereGeometry(0.574, 48, 16, PI / 2 - (VPH + 0.14) / 2, VPH + 0.14, VT0 - 0.06, VTL + 0.12), M.bezel); bez.scale.copy(HS); R.head.add(bez);
    R.face = Face();
    R.visorMat = new T.MeshStandardMaterial({ color: col(0x050608), roughness: 0.05, metalness: 0.55, emissive: 0xffffff, emissiveMap: R.face.tex, emissiveIntensity: 1.25 });
    const vis = new T.Mesh(new T.SphereGeometry(0.584, 64, 20, PI / 2 - VPH / 2, VPH, VT0, VTL), R.visorMat); vis.scale.copy(HS); R.head.add(vis);
    const seam = new T.Mesh(new T.SphereGeometry(0.566, 48, 4, PI / 2 - 1.1, 2.2, VT0 + VTL + 0.2, 0.025), M.bezel); seam.scale.copy(HS); R.head.add(seam);
    /* наушники */
    R.phones = new T.Group(); R.head.add(R.phones);
    const band = new T.Mesh(new T.TorusGeometry(0.61, 0.034, 10, 48, PI), M.helmet); band.scale.set(1, 0.98, 1); R.phones.add(band);
    for (const sx of [-1, 1]) {
      const cup = new T.Mesh(new T.CylinderGeometry(0.165, 0.165, 0.13, 30), M.helmet); cup.rotation.z = PI / 2; cup.position.set(sx * 0.605, -0.04, 0); R.phones.add(cup);
      const cush = new T.Mesh(new T.TorusGeometry(0.13, 0.05, 10, 24), M.rib); cush.rotation.y = PI / 2; cush.position.set(sx * 0.55, -0.04, 0); R.phones.add(cush);
      const ring = new T.Mesh(new T.TorusGeometry(0.118, 0.017, 8, 32), R.ringMat); ring.rotation.y = PI / 2; ring.position.set(sx * 0.672, -0.04, 0); R.phones.add(ring);
      const cap = new T.Mesh(new T.CircleGeometry(0.1, 28), M.bezel); cap.rotation.y = sx * PI / 2; cap.position.set(sx * 0.671, -0.04, 0); R.phones.add(cap);
    }
    /* антенна (нет связи) */
    R.ant = new T.Group(); R.ant.visible = false; R.ant.position.set(-0.24, 0.47, -0.05); R.ant.rotation.z = 0.25; R.head.add(R.ant);
    const rod = new T.Mesh(new T.CylinderGeometry(0.012, 0.016, 0.3, 8), M.steel); rod.position.y = 0.15; R.ant.add(rod);
    R.antMat = M.red.clone(); const ball = new T.Mesh(new T.SphereGeometry(0.045, 14, 10), R.antMat); ball.position.y = 0.32; R.ant.add(ball);
    /* капюшон на голове: ночь, сон, скрытые суммы */
    R.hoodUp = new T.Mesh(new T.SphereGeometry(0.67, 40, 24, PI / 2 + 0.92, TAU - 1.84, 0, 2.2), M.ribIn); R.hoodUp.scale.set(1.04, 1.0, 1.02); R.hoodUp.position.set(0, 0.04, -0.03); R.hoodUp.visible = false; R.head.add(R.hoodUp);
    /* тряпочка (полирует шлем и цифры) и планшет */
    R.cloth = new T.Mesh(roundBox(0.22, 0.06, 0.17, 0.025), M.cloth); R.cloth.position.set(0, 0.02, 0.1); R.cloth.visible = false; R.armL.h.add(R.cloth);
    R.tablet = new T.Group(); R.tablet.visible = false; R.tablet.position.set(-0.1, 0.14, 0.14); R.armR.h.add(R.tablet);
    R.tablet.add(new T.Mesh(roundBox(0.46, 0.32, 0.035, 0.03), M.tablet));
    const scr = new T.Mesh(new T.PlaneGeometry(0.4, 0.26), new T.MeshBasicMaterial({ map: canvasTex(128, (g, s) => {
      g.fillStyle = '#0d1424'; g.fillRect(0, 0, s, s); g.strokeStyle = '#4fe3a8'; g.lineWidth = 6; g.lineJoin = 'round';
      g.beginPath(); [[8, 96], [30, 80], [48, 88], [70, 52], [90, 62], [118, 22]].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(118, 22, 7, 0, TAU); g.fill();
    }, true) }));
    scr.position.z = 0.019; R.tablet.add(scr);
    R.topY = 0.58 + 1.13 + 0.62;
    return R;
  }

  /* ---------- предметы для сцен ---------- */
  function buildProps(M, R, scene) {
    const P = {};
    /* монетка живёт в мировых координатах: летит из рук в цифры баланса */
    const coin = new T.Group(); coin.visible = false; scene.add(coin); P.coin = coin;
    const cd = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, 0.045, 28), M.gold); cd.rotation.x = PI / 2; coin.add(cd);
    const cr = new T.Mesh(new T.TorusGeometry(0.13, 0.014, 6, 28), M.goldDeep); cr.position.z = 0.024; coin.add(cr);
    const gift = new T.Group(); gift.visible = false; R.root.add(gift); P.gift = gift;
    const gb = new T.Mesh(roundBox(0.38, 0.32, 0.38, 0.04), M.gift); gb.position.y = 0.16; gift.add(gb);
    const r1 = new T.Mesh(new T.BoxGeometry(0.08, 0.33, 0.39), M.ribbon); r1.position.y = 0.16; gift.add(r1);
    const r2 = new T.Mesh(new T.BoxGeometry(0.39, 0.33, 0.08), M.ribbon); r2.position.y = 0.16; gift.add(r2);
    P.giftLid = new T.Group(); P.giftLid.position.y = 0.34; gift.add(P.giftLid);
    P.giftLid.add(new T.Mesh(roundBox(0.42, 0.08, 0.42, 0.03), M.gift));
    for (const sx of [-1, 1]) { const b = new T.Mesh(new T.TorusGeometry(0.07, 0.024, 8, 16), M.ribbon); b.position.set(sx * 0.065, 0.09, 0); b.rotation.z = sx * 0.6; P.giftLid.add(b); }
    const tro = new T.Group(); tro.visible = false; R.root.add(tro); P.trophy = tro;
    const prof = [[0.001, 0], [0.13, 0], [0.13, 0.035], [0.05, 0.06], [0.035, 0.17], [0.06, 0.2], [0.17, 0.25], [0.2, 0.43], [0.18, 0.44], [0.15, 0.27], [0.001, 0.23]].map(p => new T.Vector2(p[0], p[1]));
    tro.add(new T.Mesh(new T.LatheGeometry(prof, 28), M.gold));
    for (const sx of [-1, 1]) { const hdl = new T.Mesh(new T.TorusGeometry(0.07, 0.018, 8, 16, PI * 1.2), M.goldDeep); hdl.position.set(sx * 0.2, 0.33, 0); hdl.rotation.z = sx > 0 ? -PI * 0.6 : PI * 0.4; tro.add(hdl); }
    P.blocks = [0, 1, 2].map(() => { const b = new T.Mesh(roundBox(0.17, 0.17, 0.17, 0.035), M.goldDeep); b.visible = false; R.root.add(b); return b; });
    P.beam = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: beamTex(), color: col(0xffb54a), transparent: true, blending: T.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0 }));
    P.beam.visible = false; P.beam.renderOrder = 10; scene.add(P.beam);
    P.shadow = new T.Mesh(new T.PlaneGeometry(1.6, 0.34), M.shadow); P.shadow.position.z = -0.8; scene.add(P.shadow);
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

  /* ---------- фразы (их же читает голос; номер фразы = группа.индекс) ---------- */
  const PHRASES = /*PHRASES*/{"intro":["Привет! Я Слиток, робот-хранитель твоего биткоина. Нажми на меня!"],"tap":["Бип-буп!","Привет!","Щекотно!","Я на посту.","Слиток на связи!","Все системы в норме.","Всё под контролем.","Ой! Кто здесь?"],"tapNight":[{"t":"Тише… ночь.","w":1},{"t":"Я тут. Шепчу, чтобы никого не разбудить.","w":1}],"dizzy":["Ошибка! Голова кружится!","Перегрев! Перегрев!"],"dance":["Па-па-пам!","Танцевальный режим!"],"carry":["Эй! Куда несёшь?","Ух ты, я лечу!"],"drop":["Приземлился!","Мягкая посадка."],"deposit":["Пополнение принято!","Звенит приятно!","Ещё немного в копилку."],"buy":["Взяли. Теперь держим.","Покупка по плану — люблю.","Монета в копилке."],"sellProfit":["Прибыль в кармане!","Зафиксировали. Хорошая работа."],"sellLoss":["Бывает. Главное — остаться в игре.","Опыт — тоже капитал."],"airdrop":["Подарок с неба!","Бесплатно — моё любимое слово."],"signal":["Сигнал на покупку!","Уровень сработал — можно докупить."],"news":["Есть новый сигнал — загляни.","Пришёл сигнал, проверь."],"hunter":["Скидки! Лесенка сработала.","Распродажа, а не трагедия."],"ath":["Новый максимум биткоина!","Вот это высота!"],"athPort":["Портфель на максимуме!"],"milestone":["Новый рубеж взят!"],"coinUp":["Монета разогналась!"],"coinDown":["Монета просела."],"up":["Неплохо идём.","Рынок улыбается."],"rocket":["Ух, полетели!","Вот это день!"],"down":["Видали и хуже. Держим.","Терпение — моя суперсила."],"crash":["Спокойно. Паника — плохой советчик.","Шторм пройдёт. Держим курс."],"bored":["Скучновато…","Пересчитаю-ка блоки.",{"t":"21 миллион — и ни монетой больше.","s":"Двадцать один миллион — и ни монетой больше."}],"night":[{"t":"Ночь. Рынок не спит, а я посплю.","w":1}],"wake":["А? Я не сплю! Я на посту."],"hide":["Ничего не вижу!"],"offline":["Ищу сигнал…"],"screen":["Свежий подбор альткоинов готов!"],"wipe":["Протру цифры — пусть блестят.","Чистота — залог прибыли!"],"wipeDone":["Блестит!","Как новенькие."],"sit":["Посижу тут, посмотрю.","Отличный вид отсюда."],"zap":["Обновляю цифры!","Цена сменилась — переставлю."]}/*/PHRASES*/;
  const MILES = [1000, 2000, 3000, 5000, 7000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 200000, 250000, 500000, 1000000];

  /* ---------- стили: слой поверх карточки, облачко, табличка, перекатывание цифр ---------- */
  const CSS = `
.ms-cv{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
.ms-hit{position:absolute;left:0;top:0;width:56px;height:90px;pointer-events:auto;touch-action:pan-y;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;cursor:pointer;z-index:2;border-radius:28px;outline:none}
.ms-hit:focus-visible{box-shadow:0 0 0 2px rgba(255,154,31,.65)}
.ms-bubble{position:absolute;left:0;top:0;max-width:196px;width:max-content;padding:8px 11px;border-radius:14px 14px 4px 14px;background:rgba(22,15,44,.95);border:1px solid rgba(255,255,255,.14);color:#f5f1ff;font-size:13px;line-height:1.35;font-weight:500;box-shadow:0 10px 28px -10px #000;opacity:0;transition:opacity .2s;pointer-events:none;z-index:4}
.ms-bubble.r{border-radius:14px 14px 14px 4px}
.ms-bubble.on{opacity:1;pointer-events:auto}
.ms-bubble small{display:block;margin-top:3px;font-size:12px;color:#ffc46a;font-weight:700}
.ms-float{position:absolute;left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;z-index:3;white-space:nowrap;opacity:0;transition:opacity .2s}
.ms-float.on{opacity:1}
.ms-alert{width:22px;height:22px;border-radius:50%;background:#ff4d6d;color:#fff;font-weight:800;font-size:14px;display:grid;place-items:center;box-shadow:0 0 0 3px rgba(255,77,109,.25),0 6px 14px -4px #000}
.ms-alert.on{animation:msPop .6s cubic-bezier(.2,.9,.3,1.4)}
.ms-sign{padding:4px 9px;border-radius:9px;background:#fff7e0;color:#2b1a05;font-weight:800;font-size:12.5px;box-shadow:0 6px 14px -6px #000}
.ms-sign.neg{background:#ffe1e4;color:#5a0f1a}
.ms-zzz{color:#cfc3ff;font-weight:700;font-size:12px;letter-spacing:.04em}
.ms-zzz.on{animation:msZ 2.6s ease-in-out infinite}
@keyframes msPop{0%{transform:translate(-50%,-100%) scale(.2)}100%{transform:translate(-50%,-100%) scale(1)}}
@keyframes msZ{0%{opacity:0;margin-top:6px}25%{opacity:1}100%{opacity:0;margin-top:-18px}}
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
@media (prefers-reduced-motion:reduce){.ms-bubble,.ms-float{transition:none}.ms-alert.on,.ms-zzz.on,.ms-zing,.ms-shine{animation:none}}`;

  /* ---------- состояние ---------- */
  let host, hero, A = {}, renderer, scene, camera, M, R, PR, PT, raf = 0, inView = true, lastF = 0, inited = false, firstFrame = false;
  const ST = {
    mood: 'calm', moodSince: 0, pct: null, go: false, fresh: 0, offline: false, offSince: 0, hide: false, sound: true,
    lastInput: now(), lastEvent: now(), nextAct: 0, lastJob: '', nextSignal: 0, lastAuto: -1e9, lastEv: -1e9, lastTap: 0, tapTimer: 0, taps: [],
    nextBlink: 0, blinkT: -9, gx: 0, gy: 0, nextGaze: 0, spin: 0, spinV: 0, drag: null, reduced: false, intensity: 0.7, money: null,
    signText: '', signNeg: false, wiping: 0, talk: 0, lastZap: -1e9, numPend: null, numZap: null, hum: false, nextThr: 0, music: false, noBrain: false
  };
  const BL = { ready: false, tx: new Set(), real: 0, alert: '', ath: 0, screen: '' };
  let act = null, JOB = null; const queue = [];
  const C = {}; /* текущая поза (сглаженная) */
  const ui = {};
  /* раскладка: 1 единица сцены = U пикселей; ось y вверх от нижнего края слоя */
  const LY = { U: 38, W: 300, H: 260, heroL: 0, heroR: 8, edge: 1.3, top: 6, ground: 1.6, minX: 1, maxX: 7, home: 6.9, ok: false };
  const LOC = { x: 6.9, y: 1.6, yaw: -0.24, yawT: -0.24, mode: 'stand', tx: 0, ph: 0, sitK: 0, hop: null, fx: 0, fy: 0, flyDone: true, vx: 0, vy: 0, cx: 0, cy: 0, gx: 0, gy: 0, squash: -9, hold: false, frozen: false };
  const SEAT = 0.56, HAND_H = 1.18;

  /* ---------- раскладка: карточка баланса → координаты сцены ---------- */
  function measure() {
    if (!host || !camera) return false;
    const lr = host.getBoundingClientRect(); if (lr.width < 40 || lr.height < 40) return false;
    const hr = (hero || host).getBoundingClientRect(), U = LY.U;
    LY.W = lr.width; LY.H = lr.height;
    LY.heroL = (hr.left - lr.left) / U; LY.heroR = (hr.right - lr.left) / U;
    LY.edge = (lr.bottom - hr.bottom) / U; LY.top = (lr.bottom - hr.top) / U;
    LY.ground = LY.edge + 11 / U;
    LY.minX = LY.heroL + 0.8; LY.maxX = Math.max(LY.minX, LY.heroR - 0.8); LY.home = LY.maxX - 0.1;
    camera.left = 0; camera.right = LY.W / U; camera.top = LY.H / U; camera.bottom = 0; camera.updateProjectionMatrix();
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
  const pxX = x => x * LY.U, pxY = y => LY.H - y * LY.U;
  function toWorld(cx, cy) { const lr = host.getBoundingClientRect(); return { x: (cx - lr.left) / LY.U, y: (lr.bottom - cy) / LY.U }; }
  function rectW(r, lr) {
    lr = lr || host.getBoundingClientRect(); const U = LY.U;
    return { l: (r.left - lr.left) / U, r: (r.right - lr.left) / U, b: (lr.bottom - r.bottom) / U, t: (lr.bottom - r.top) / U, cx: (r.left + r.width / 2 - lr.left) / U, cy: (lr.bottom - (r.top + r.height / 2)) / U };
  }
  const isNight = () => { const h = ST.forceHour != null ? ST.forceHour : new Date().getHours(); return h < 7; };

  /* ---------- звук: голос робота (готовые фразы) и синтезированные звуки ---------- */
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
        case 'tap': tone(c, { type: 'square', f: 620, f2: 1240, t, d: 0.07, v: 0.05 * v, lp: 5000 }); tone(c, { f: 1500, f2: 2100, t: t + 0.065, d: 0.09, v: 0.07 * v }); break;
        case 'happy': [880, 1175, 1480, 1976].forEach((f, i) => tone(c, { type: 'square', f, f2: f * 1.05, t: t + i * 0.065, d: 0.08, v: 0.035 * v, lp: 4000 })); break;
        case 'blips': for (let i = 0; i < 5; i++) { const f = rnd(700, 2300); tone(c, { type: i % 2 ? 'square' : 'sine', f, f2: f * rnd(0.7, 1.4), t: t + i * 0.075, d: 0.06, v: 0.04 * v, lp: 5000 }); } break;
        case 'sad': tone(c, { type: 'sawtooth', f: 520, f2: 210, t, d: 0.6, v: 0.04 * v, lp: 1400, vib: [7, 18] }); break;
        case 'step': noise(c, { t, d: 0.035, v: 0.04 * v, f: 2400, q: 1.4 }); tone(c, { f: 170, f2: 90, t, d: 0.05, v: 0.03 * v }); break;
        case 'servo': tone(c, { type: 'sawtooth', f: up ? 120 : 240, f2: up ? 260 : 110, t, d: 0.3, v: 0.035 * v, lp: 900 }); break;
        case 'jump': tone(c, { f: 320, f2: 980, t, d: 0.2, v: 0.07 * v }); break;
        case 'land': tone(c, { f: 160, f2: 55, t, d: 0.16, v: 0.13 * v }); noise(c, { t, d: 0.07, v: 0.05 * v, f: 600, q: 0.7, type: 'lowpass' }); break;
        case 'whoosh': noise(c, { t, d: 0.4, v: 0.07 * v, f: 500, f2: 2200, q: 0.8 }); break;
        case 'whee': tone(c, { f: 500, f2: 1400, t, d: 0.35, v: 0.06 * v, vib: [9, 30] }); break;
        case 'fall': tone(c, { f: 1500, f2: 380, t, d: 0.5, v: 0.05 * v }); break;
        case 'spin': tone(c, { type: 'sawtooth', f: 260, f2: 900, t, d: 0.45, v: 0.03 * v, lp: 1600, vib: [16, 40] }); break;
        case 'zap': tone(c, { type: 'square', f: 1800, f2: 240, t, d: 0.17, v: 0.045 * v, lp: 5000 }); tone(c, { f: 2700, f2: 420, t, d: 0.13, v: 0.04 * v }); break;
        case 'flip': noise(c, { t, d: 0.025, v: 0.07 * v, f: 3800, q: 2, type: 'highpass' }); tone(c, { type: 'square', f: 1300, t: t + 0.004, d: 0.03, v: 0.025 * v, lp: 4000 }); break;
        case 'squeak': { const f = rnd(2100, 2500); tone(c, { f, f2: f * 1.2, t, d: 0.11, v: 0.03 * v, vib: [38, 120] }); break; }
        case 'coin': tone(c, { f: 1568, t, d: 0.13, v: 0.09 * v }); tone(c, { f: 2093, t: t + 0.07, d: 0.32, v: 0.08 * v }); break;
        case 'charge': tone(c, { type: 'triangle', f: 280, f2: 1250, t, d: 0.42, v: 0.05 * v }); break;
        case 'pop': tone(c, { type: 'triangle', f: 640, f2: 990, t, d: 0.11, v: 0.07 * v }); break;
        case 'alert': tone(c, { type: 'square', f: 880, t, d: 0.12, v: 0.045 * v, lp: 3500 }); tone(c, { type: 'square', f: 1175, t: t + 0.16, d: 0.14, v: 0.045 * v, lp: 3500 }); break;
        case 'fanfare': tone(c, { type: 'triangle', f: 523, t, d: 0.18, v: 0.07 * v }); tone(c, { type: 'triangle', f: 659, t: t + 0.1, d: 0.18, v: 0.07 * v }); tone(c, { type: 'triangle', f: 784, t: t + 0.2, d: 0.34, v: 0.08 * v }); break;
        case 'dizzy': tone(c, { type: 'square', f: 900, f2: 300, t, d: 0.9, v: 0.035 * v, lp: 2500, vib: [11, 120] }); tone(c, { type: 'sawtooth', f: 140, t: t + 0.05, d: 0.28, v: 0.03 * v, lp: 800 }); break;
        case 'powerup': tone(c, { type: 'sawtooth', f: 110, f2: 880, t, d: 0.5, v: 0.03 * v, lp: 2200 }); tone(c, { f: 1760, t: t + 0.45, d: 0.12, v: 0.05 * v }); break;
        case 'powerdown': tone(c, { type: 'sawtooth', f: 700, f2: 80, t, d: 0.7, v: 0.03 * v, lp: 1800 }); break;
      }
    } catch (e) {}
  }
  /* гул реактивных подошв, пока Слиток летит */
  function hum(on) {
    if (on) {
      const c = au(); if (!c || AU.hum) return;
      try {
        const s = c.createBufferSource(); s.buffer = AU.nb; s.loop = true;
        const bq = c.createBiquadFilter(); bq.type = 'bandpass'; bq.frequency.value = 950; bq.Q.value = 0.9;
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 72;
        const og = c.createGain(); og.gain.value = 0.5;
        const g = c.createGain(), t = c.currentTime; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045 * (isNight() ? 0.5 : 1), t + 0.25);
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
  /* громкость голоса прямо сейчас — по ней «говорят» глаза на визоре */
  function talkLevel() {
    if (!AU.cur || !AU.an) return 0;
    AU.an.getByteTimeDomainData(AU.td); let s = 0;
    for (let i = 0; i < AU.td.length; i++) { const v = (AU.td[i] - 128) / 128; s += v * v; }
    return clamp(Math.sqrt(s / AU.td.length) * 9, 0, 1);
  }

  /* ---------- речь: облачко + голос ---------- */
  /* на касание — всегда; о твоих действиях — не чаще раза в 15 с; фоновые — не чаще раза в минуту, ночью без голоса */
  const U_ = { user: true }, EV = { lvl: 'event' };
  function phrase(group, i) {
    const arr = PHRASES && PHRASES[group]; if (!arr || !arr.length) return null;
    if (i == null) { i = Math.floor(Math.random() * arr.length); if (arr.length > 1 && ST.lastSay === group + '.' + i) i = (i + 1) % arr.length; }
    const e = arr[i]; return { id: group + '.' + i, text: typeof e === 'string' ? e : e.t };
  }
  function say(group, opt) {
    opt = opt || {};
    const ph = phrase(group, opt.i); if (!ph) return false;
    const t = now(), ev = opt.lvl === 'event';
    if (!opt.user) {
      if (t < (ui.userUntil || 0)) { if (ev && !opt.retry) setTimeout(() => say(group, Object.assign({}, opt, { retry: true })), (ui.userUntil - t) * 1000 + 400); return false; }
      if (ev ? t - ST.lastEv < 15 : t - ST.lastAuto < 60) return false;
      ST.lastAuto = t; if (ev) ST.lastEv = t;
    }
    const b = ui.bubble; if (!b) return false;
    b.innerHTML = ''; b.appendChild(document.createTextNode(ph.text));
    if (opt.small) { const s = document.createElement('small'); s.textContent = opt.small; b.appendChild(s); }
    /* справа от суммы места мало: облачко уже, чтобы не закрывать цифры */
    let mw = 196;
    if (pxX(LOC.x) >= LY.W * 0.5) { const r = numRect(); if (r) mw = clamp(Math.round(LY.W - pxX(r.r) - 14), 128, 196); }
    b.style.maxWidth = mw + 'px';
    b.classList.add('on'); ui.bw = b.offsetWidth; ui.bh = b.offsetHeight; ui.bk = '';
    clearTimeout(ui.bubbleT);
    const vd = AU.pack && AU.pack.idx[ph.id] ? AU.pack.idx[ph.id][2] : 0;
    const ms = opt.ms || Math.max(Math.min(9500, 2600 + ph.text.length * 55), vd + 900);
    ui.userUntil = opt.user ? t + ms / 1000 : 0;
    ui.bubbleT = setTimeout(() => b.classList.remove('on'), ms);
    ST.lastSay = ph.id;
    if (!(isNight() && !opt.user && !ev)) voice(ph.id, opt);
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
  function numTarget(p) {
    const el = (p && p.el) || numEl(); if (!el || !el.isConnected || ST.hide || !host) return null;
    const lr = host.getBoundingClientRect(); let r = null;
    if (p && p.to != null && el.childNodes.length === 1 && el.firstChild.nodeType === 3) {
      const cur = el.textContent, d = diffRange(cur, p.to);
      if (d) { try { const rg = document.createRange(); rg.setStart(el.firstChild, d.s); rg.setEnd(el.firstChild, Math.min(cur.length, d.e + 1)); const b = rg.getBoundingClientRect(); if (b.width > 1) r = b; } catch (e) {} }
    }
    if (!r) r = textRect(el);
    if (!r || !r.width) return null;
    const w = rectW(r, lr); return { x: w.cx, y: w.cy };
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
  function numSparks() { const r = numRect(); if (!r) return; for (let i = 0; i < 7; i++) emit({ x: lerp(r.l, r.r, Math.random()), y: lerp(r.b, r.t, Math.random()), z: 1 }, 2, { colors: ['#ffffff', '#fff1b8'], speed: 0.3, gravity: 0, life: 0.9 }); }
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
  const BASE = () => ({ y: 0, sq: 1, tz: 0, tx: 0, yaw: 0, laZ: -0.3, laX: -0.05, raZ: 0.32, raX: -0.05, legL: 0, legR: 0, eo: 1, ex: 0, ey: 0, brow: 0, tarn: 0, hx: 0, hy: 0, hz: 0, thr: 0, pend: 0, cloth: 0, tablet: 0, eye: 'round', mouth: 'smile', gaze: false, cap: false, ant: false, glyph: '', zz: false });
  const RATE = { tarn: 3, cloth: 12, tablet: 12, thr: 9, pend: 6, legL: 16, legR: 16 };
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
      P.laZ = -1.5 - 0.45 * Math.sin(w); P.raZ = 1.5 - 0.45 * Math.sin(w + PI); P.mouth = 'grin'; P.eye = 'happy';
    } else if (m === 'down' || m === 'crash') {
      const deep = m === 'crash';
      P.tarn = deep ? 0.75 : 0.45; P.mouth = 'frown'; P.brow = deep ? 0.6 : 0.45; P.eo = deep ? 0.72 : 0.82; P.ey = -0.012;
      P.laZ = -0.12; P.raZ = 0.14; P.tx = (deep ? 0.08 : 0.04) * (I + 0.3); P.hx = deep ? 0.2 : 0.12; P.sq = 1 + 0.01 * Math.sin(t * 1.4);
      const c = (t % (deep ? 5 : 7)) / (deep ? 5 : 7); P.sq -= 0.045 * bell(c, 0, 0.25);
    } else if (m === 'hunter') {
      const w = t * 4.4, pump = Math.max(0, Math.sin(w)), pump2 = Math.max(0, Math.sin(w + PI));
      P.mouth = 'grin'; P.eye = 'star'; P.brow = -0.25;
      P.raZ = 1.5 + 0.9 * pump2; P.raX = -0.25; P.laZ = -1.5 - 0.9 * pump; P.laX = -0.25;
      P.y = 0.06 * I * Math.max(pump, pump2); P.hz = 0.06 * Math.sin(w);
    } else if (m === 'sleep') {
      P.eye = 'closed'; P.zz = true; P.cap = true; P.sq = 1 + 0.03 * Math.sin(t * 1.2); P.tz = 0.07; P.tx = 0.05; P.hx = 0.16; P.hz = 0.12; P.laZ = -0.15; P.raZ = 0.2; P.gaze = true;
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
      P.tx = lerp(P.tx, -0.1, sk);
      if (L.mode === 'sit' && ST.music && ST.mood !== 'sleep') { P.hx += 0.07 * Math.max(0, Math.sin(t * 7.4)); P.hz += 0.04 * Math.sin(t * 3.7); }
    }
    if (L.mode === 'hover' || L.mode === 'land') {
      P.thr = L.mode === 'land' ? 0.8 : 1;
      P.legL = 0.18 + 0.08 * Math.sin(t * 4); P.legR = 0.18 + 0.08 * Math.sin(t * 4 + 1.3);
      P.laZ -= 0.28; P.raZ += 0.28; P.y += 0.04 * Math.sin(t * 3.1);
    }
    if (ST.wiping) {
      const w = t * 9.5;
      P.cloth = 1; P.laZ = -1.42 + 0.24 * Math.sin(w); P.laX = -0.3 + 0.32 * Math.cos(w); P.raZ = 0.55; P.raX = -0.1;
      P.gaze = true; P.ex = -0.032; P.ey = 0.004; if (Math.sin(t * 1.3) > 0.6) P.eye = 'happy'; P.hz += 0.05 * Math.sin(w);
    }
    if (L.mode === 'carry') {
      P.laZ = -2.45 + 0.12 * Math.sin(t * 6); P.raZ = 2.45 - 0.12 * Math.sin(t * 6); P.laX = -0.15; P.raX = -0.15;
      P.legL = 0.45 * Math.sin(t * 10); P.legR = -0.45 * Math.sin(t * 10);
      P.tz = clamp(-L.vx * 0.09, -0.45, 0.45); P.mouth = 'O'; P.eo = 1.12;
    }
    if (L.mode === 'fall') { P.laZ = -2.2; P.raZ = 2.2; P.legL = 0.35; P.legR = -0.15; P.mouth = 'O'; }
    if (L.mode === 'hop' && L.hop) { const a = bell(clamp((t - L.hop.t0) / L.hop.dur, 0, 1), 0, 1); P.laZ -= 0.6 * a; P.raZ += 0.6 * a; }
    const q = t - L.squash; if (q < 0.32) P.sq -= 0.13 * Math.sin((q / 0.32) * PI);
  }

  /* ---------- помощники для сценок ---------- */
  const V1 = new T.Vector3(), V2 = new T.Vector3(), HA = new T.Vector3(), HB = new T.Vector3(), HM = new T.Vector3(), PW = new T.Vector3(), Q1 = new T.Quaternion();
  const handW = (h, out) => h.getWorldPosition(out);
  function handsW(out) { R.armL.h.getWorldPosition(HA); R.armR.h.getWorldPosition(HB); return out.copy(HA).add(HB).multiplyScalar(0.5); }
  function handL(h, out) { h.getWorldPosition(out); return R.root.worldToLocal(out); }
  function handsL(out) { handL(R.armL.h, HA); handL(R.armR.h, HB); return out.copy(HA).add(HB).multiplyScalar(0.5); }
  function emit(o, n, opt) { if (PT && !ST.reduced) PT.emit(o, n, opt); }
  function emitL(x, y, z, n, opt) { V1.set(x, y, z); R.root.localToWorld(V1); emit({ x: V1.x, y: V1.y, z: V1.z + 0.6 }, n, opt); }
  function fireworks(x) { emitL(x, R.topY + 0.35 + rnd(-0.1, 0.15), 0, 30, { colors: [pick(['#ffd36b', '#ff5d8f', '#5be0c4', '#a98bff']), '#ffffff'], speed: 1.4, gravity: 0.9, life: 1.1 }); }
  function clothSpark() { if (!R.cloth.visible) return; R.cloth.getWorldPosition(V1); emit({ x: V1.x, y: V1.y, z: 1 }, 3, { colors: ['#ffffff', '#fff1b8', '#ffd36b'], speed: 0.45, gravity: 0.3, life: 0.7 }); }
  /* навести руку на точку в сцене (для луча) */
  function aimArm(P, left, tgt, w) {
    if (w <= 0) return;
    const arm = left ? R.armL : R.armR;
    arm.p.getWorldPosition(V1);
    V2.set(tgt.x - V1.x, tgt.y - V1.y, 0.5).normalize();
    R.bodyG.getWorldQuaternion(Q1); Q1.invert(); V2.applyQuaternion(Q1);
    const z = Math.asin(clamp(V2.x, -1, 1)), x = Math.atan2(-V2.z, -V2.y);
    if (left) { P.laZ = lerp(P.laZ, z, w); P.laX = lerp(P.laX, x, w); } else { P.raZ = lerp(P.raZ, z, w); P.raX = lerp(P.raX, x, w); }
  }
  function beam(a, b, w, op) {
    const m = PR.beam; if (op <= 0.01 || !a || !b) { m.visible = false; return; }
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    m.visible = true; m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, 1.6); m.rotation.set(0, 0, Math.atan2(dy, dx)); m.scale.set(Math.max(0.01, len), w, 1); m.material.opacity = op;
  }

  /* ---------- сценки ---------- */
  const CLIPS = {
    hello: { dur: 2.4, pri: 2, run(P, k) { P.raZ = 2.45 + 0.35 * Math.sin(k * TAU * 3); P.raX = -0.25; P.mouth = 'grin'; P.eye = k > 0.25 && k < 0.75 ? 'happy' : 'round'; P.y += 0.08 * bell(k, 0, 0.18); } },
    tap: { dur: 0.9, pri: 2, run(P, k) { P.y += 0.11 * bell(k, 0, 0.55); P.sq = 1 - 0.1 * bell(k, 0, 0.14) + 0.06 * bell(k, 0.14, 0.5); P.eye = 'happy'; P.mouth = 'grin'; } },
    tapSpin: { dur: 1.0, pri: 2, run(P, k) { P.yaw += TAU * easeInOut(seg(k, 0.05, 0.8)); P.y += 0.1 * bell(k, 0.05, 0.8); P.laZ = -0.9; P.raZ = 0.9; P.eye = 'happy'; P.mouth = 'grin'; }, at: [[0.05, () => sfx('spin', { vol: 0.8 })]] },
    tapWave: { dur: 1.6, pri: 2, run(P, k) { const a = Math.min(1, bell(k, 0, 1) * 2.2); P.raZ = lerp(P.raZ, 2.4 + 0.32 * Math.sin(k * TAU * 2.5), a); P.raX = lerp(P.raX, -0.25, a); P.hz += 0.1 * Math.sin(k * TAU * 2.5) * a; P.eye = 'happy'; P.mouth = 'grin'; } },
    tapJump: {
      dur: 1.1, pri: 2,
      run(P, k) { const air = bell(k, 0.15, 0.75); P.y += 0.42 * air; P.sq = 1 - 0.14 * bell(k, 0, 0.15) - 0.1 * bell(k, 0.75, 0.9) + 0.06 * air; P.laZ = lerp(-0.3, -2.4, air); P.raZ = lerp(0.32, 2.4, air); P.legL = 0.25 * air; P.legR = -0.15 * air; P.eye = 'happy'; P.mouth = 'grin'; },
      at: [[0.15, () => sfx('jump')], [0.76, () => sfx('land', { vol: 0.6 })]]
    },
    dance: { dur: 3, pri: 2, run(P, k) { const w = k * TAU * 3; P.y += Math.abs(Math.sin(w)) * 0.12; P.tz = Math.sin(w) * 0.16; P.laZ = -1.6 - 0.5 * Math.sin(w); P.raZ = 1.6 - 0.5 * Math.sin(w + PI); P.legL = 0.3 * Math.max(0, Math.sin(w)); P.legR = 0.3 * Math.max(0, -Math.sin(w)); P.eye = 'happy'; P.mouth = 'grin'; } },
    dizzy: { dur: 2.8, pri: 2, run(P, k) { const w = k * TAU * 3.2, f = 1 - seg(k, 0.75, 1); P.eye = 'spiral'; P.hz = 0.28 * Math.sin(w) * f; P.tz = 0.12 * Math.sin(w + 1) * f; P.hx = 0.1 * Math.cos(w) * f; P.laZ = -1.0 - 0.6 * Math.sin(w * 1.3) * f; P.raZ = 1.0 + 0.6 * Math.sin(w * 1.1) * f; P.y += 0.04 * Math.abs(Math.sin(w)) * f; } },
    wake: { dur: 1.6, pri: 3, run(P, k) { P.eo = 1.15; P.glyph = k < 0.35 ? '!' : ''; P.mouth = k < 0.6 ? 'O' : 'smile'; P.y += 0.07 * bell(k, 0, 0.3); } },
    /* пополнение: монетка падает в руки, Слиток бросает её в сумму — и цифры перекатываются */
    deposit: {
      dur: 3.8, pri: 3,
      start(a) { a.num = takeNum(); a.tgt = numTarget(a.num); PR.coin.visible = true; PR.coin.scale.setScalar(0.001); a.p0 = null; },
      run(P, k, t, a) {
        const c = PR.coin; handsW(HM);
        if (k < 0.32) { const f = easeIn(seg(k, 0.04, 0.32)); c.position.set(HM.x + 0.05 * (1 - f), lerp(HM.y + 2.4, HM.y + 0.15, f), 1.1); c.rotation.set(0, k * 26, 0); c.scale.setScalar(k < 0.04 ? 0.001 : 1); }
        else if (k < 0.5) { c.position.set(HM.x, HM.y + 0.15, 1.1); c.rotation.set(0, 0, 0); c.scale.setScalar(1); }
        else if (k < 0.72) {
          if (!a.p0) a.p0 = c.position.clone();
          const f = easeInOut(seg(k, 0.5, 0.72));
          if (a.tgt) { c.position.set(lerp(a.p0.x, a.tgt.x, f), lerp(a.p0.y, a.tgt.y, f) + 0.9 * Math.sin(f * PI), 1.1); c.rotation.set(0, f * TAU * 2, 0); c.scale.setScalar(1 - 0.35 * f); }
          else { R.pend.getWorldPosition(PW); c.position.set(lerp(a.p0.x, PW.x, f), lerp(a.p0.y, PW.y, f), 1.1); c.scale.setScalar(Math.max(0.001, 1 - 0.85 * f)); }
        } else c.scale.setScalar(0.001);
        const up = seg(k, 0.2, 0.34) - seg(k, 0.48, 0.56);
        P.laZ = lerp(P.laZ, 0.55, up); P.raZ = lerp(P.raZ, -0.55, up); P.laX = lerp(P.laX, -1.35, up); P.raX = lerp(P.raX, -1.35, up);
        const th = bell(k, 0.46, 0.66);
        if (a.tgt) { if (a.tgt.x < LOC.x) { P.laZ -= 1.6 * th; P.laX -= 0.6 * th; } else { P.raZ += 1.6 * th; P.raX -= 0.6 * th; } }
        else P.pend = bell(k, 0.68, 0.98);
        P.sq = 1 - 0.08 * bell(k, 0.3, 0.38); P.eye = k > 0.74 ? 'happy' : 'round'; P.mouth = k > 0.3 ? 'grin' : 'o'; P.glyph = k > 0.32 && k < 0.5 ? '$' : '';
        P.gaze = true; P.ey = k < 0.32 ? 0.03 : a.tgt ? 0.02 : 0; P.ex = a.tgt && k > 0.5 && k < 0.8 ? 0.035 * Math.sign(a.tgt.x - LOC.x) : 0;
      },
      at: [[0.31, () => sfx('coin', { vol: 0.6 })], [0.72, a => {
        if (a.tgt) { roll(a.num, true); shine(); emit({ x: a.tgt.x, y: a.tgt.y, z: 1 }, 18, { colors: ['#ffd36b', '#fff1b8', '#ffb547'], up: true, speed: 1.2, gravity: 1.6 }); }
        else { R.pend.getWorldPosition(PW); emit({ x: PW.x, y: PW.y, z: 1 }, 12, { colors: ['#ffd36b', '#fff1b8'], up: true }); sfx('charge'); }
        sfx('coin');
      }]],
      end(a) { PR.coin.visible = false; if (a.num) roll(a.num, true); }
    },
    /* покупка: монетка в руке → в подвеску-слиток на груди, подвеска вспыхивает */
    buy: {
      dur: 3.0, pri: 3,
      start() { PR.coin.visible = true; PR.coin.scale.setScalar(0.001); },
      run(P, k) {
        const c = PR.coin; handW(R.armR.h, HB); R.pend.getWorldPosition(PW);
        if (k < 0.45) { c.position.set(HB.x - 0.04, HB.y + 0.2, 1.1); c.rotation.set(0, 0.3 * Math.sin(k * 12), 0); c.scale.setScalar(Math.max(0.001, backOut(seg(k, 0, 0.12)))); }
        else if (k < 0.62) { const f = easeInOut(seg(k, 0.45, 0.62)); c.position.set(lerp(HB.x - 0.04, PW.x, f), lerp(HB.y + 0.2, PW.y, f) + 0.25 * Math.sin(f * PI), 1.1); c.rotation.set(0, f * TAU * 2, 0); c.scale.setScalar(Math.max(0.001, 1 - 0.8 * f)); }
        else c.scale.setScalar(0.001);
        const up = seg(k, 0, 0.12) - seg(k, 0.45, 0.6), ch = bell(k, 0.42, 0.68);
        P.raX = lerp(P.raX, -1.25, up); P.raZ = lerp(P.raZ, -0.1, up); P.raX = lerp(P.raX, -0.9, ch); P.raZ = lerp(P.raZ, -0.55, ch);
        P.pend = bell(k, 0.6, 0.98); P.tx = 0.1 * bell(k, 0.62, 0.8);
        P.gaze = true; P.ex = k < 0.45 ? 0.03 : 0; P.ey = k < 0.45 ? 0.02 : -0.02;
        P.mouth = k > 0.6 ? 'grin' : 'smile'; P.eye = k > 0.85 ? 'happy' : 'round'; P.glyph = k > 0.62 && k < 0.85 ? '$' : '';
      },
      at: [[0.62, () => { R.pend.getWorldPosition(PW); emit({ x: PW.x, y: PW.y, z: 1 }, 12, { colors: ['#ffd36b', '#fff1b8'], up: true }); sfx('coin'); sfx('charge'); }]],
      end() { PR.coin.visible = false; }
    },
    sellProfit: { dur: 3, pri: 3, run(P, k) { const b = bell(k, 0.1, 0.8); P.raZ = lerp(0.32, 2.55, b); P.raX = lerp(-0.05, -0.8, b); P.tx = 0.15 * bell(k, 0.25, 0.65); P.hx = 0.1 * bell(k, 0.25, 0.65); P.eye = 'happy'; P.mouth = 'grin'; }, at: [[0.3, () => sfx('fanfare')]] },
    sellLoss: { dur: 3, pri: 3, run(P, k) { P.brow = 0.4; P.mouth = 'flat'; P.tx = 0.08 * Math.max(0, Math.sin(k * TAU * 2)); P.raX = -0.6; P.raZ = -0.35; P.eo = 0.9; }, at: [[0.1, () => sfx('sad')]] },
    airdrop: {
      dur: 4.2, pri: 3,
      start() { PR.gift.visible = true; PR.giftLid.position.set(0, 0.34, 0); PR.giftLid.rotation.set(0, 0, 0); },
      run(P, k) {
        const g = PR.gift, f = easeIn(seg(k, 0, 0.32));
        const hm = handsL(HM); g.position.set(lerp(0.08 * Math.sin(k * 14), hm.x, f), lerp(3.2, hm.y + 0.02, f), lerp(0.6, hm.z + 0.05, f)); g.rotation.z = 0.25 * Math.sin(k * 10) * (1 - f);
        g.scale.setScalar(Math.max(0.001, 1 - seg(k, 0.86, 1)));
        if (k > 0.55) { const o = easeOut(seg(k, 0.55, 0.8)); PR.giftLid.position.set(0.5 * o, 0.34 + 0.9 * o, 0); PR.giftLid.rotation.z = -2.4 * o; }
        const up = seg(k, 0.2, 0.32) - seg(k, 0.85, 0.95);
        P.laZ = lerp(-0.3, 0.6, up); P.raZ = lerp(0.32, -0.6, up); P.laX = lerp(-0.05, -1.3, up); P.raX = lerp(-0.05, -1.3, up);
        P.mouth = k < 0.3 ? 'o' : k < 0.55 ? 'O' : 'grin'; P.eye = k > 0.6 ? 'happy' : 'round'; P.y += 0.1 * bell(k, 0.6, 0.75);
        P.gaze = true; P.ey = k < 0.32 ? 0.03 : 0;
      },
      at: [[0.56, () => { emitL(0, 1.45, 0.55, 34, { colors: ['#ff5d8f', '#ffd34d', '#5be0c4', '#a98bff', '#ffffff'], up: true, speed: 1.6, gravity: 2.6 }); sfx('fanfare'); }]],
      end() { PR.gift.visible = false; }
    },
    /* сигнал на покупку: машет руками, на визоре «!», потом показывает вниз — на карточку сигнала */
    signal: {
      dur: 2.8, pri: 2,
      start() { floatOn('alert', true); },
      run(P, k) {
        const a = bell(k, 0, 0.5), b = bell(k, 0.45, 1);
        P.laZ = lerp(P.laZ, -2.3 + 0.35 * Math.sin(k * TAU * 5), a); P.raZ = lerp(P.raZ, 2.3 - 0.35 * Math.sin(k * TAU * 5), a);
        P.raX = lerp(P.raX, -0.95, b); P.raZ = lerp(P.raZ, 0.75, b);
        P.eo = 1.12; P.glyph = Math.floor(k * 10) % 2 ? '!' : ''; P.y += 0.06 * bell(k, 0, 0.15); P.gaze = true; P.ey = -0.012 * b; P.hz += 0.1 * a;
      },
      at: [[0.04, () => sfx('alert')]],
      end() { floatOn('alert', false); }
    },
    ath: {
      dur: 5, pri: 3,
      run(P, k) { P.y += 0.22 * ST.intensity * (bell(k, 0.08, 0.28) + bell(k, 0.48, 0.68)); P.laZ = -2.4; P.raZ = 2.4; P.laX = -0.2; P.raX = -0.2; P.eye = 'star'; P.mouth = 'grin'; },
      at: [[0.08, () => fireworks(-0.5)], [0.3, () => fireworks(0.55)], [0.52, () => fireworks(0)], [0.1, () => sfx('fanfare')]]
    },
    milestone: {
      dur: 5, pri: 3,
      start() { PR.trophy.visible = true; floatOn('sign', true); },
      run(P, k) {
        const t = PR.trophy; t.position.set(0, lerp(-0.9, R.topY + 0.12, backOut(seg(k, 0.05, 0.35))), 0.12); t.rotation.y = k * TAU; t.scale.setScalar(Math.max(0.001, 1 - seg(k, 0.88, 1)));
        const up = seg(k, 0.1, 0.32) - seg(k, 0.86, 0.96); P.laZ = lerp(-0.3, -2.6, up); P.raZ = lerp(0.32, 2.6, up); P.laX = -0.3 * up; P.raX = -0.3 * up; P.eye = 'star'; P.mouth = 'grin';
      },
      at: [[0.36, () => { emitL(0, R.topY + 0.35, 0.12, 26, { colors: ['#ffd36b', '#fff1b8', '#ffffff'], speed: 1.1, gravity: 1.2 }); sfx('fanfare'); }]],
      end() { PR.trophy.visible = false; floatOn('sign', false); }
    },
    coinMove: {
      dur: 4.2, pri: 2,
      start() { floatOn('sign', true); },
      run(P, k) { const up = seg(k, 0, 0.15) - seg(k, 0.85, 1); P.laZ = lerp(-0.3, -2.25, up); P.raZ = lerp(0.32, 2.25, up); P.glyph = up > 0.5 ? (ST.signNeg ? '▼' : '▲') : ''; P.gaze = true; P.ey = 0.02; },
      at: [[0.1, () => sfx(ST.signNeg ? 'sad' : 'happy', { vol: 0.7 })]],
      end() { floatOn('sign', false); }
    },
    screen: {
      dur: 4.2, pri: 2,
      run(P, k) { const up = seg(k, 0, 0.12) - seg(k, 0.85, 0.97); P.tablet = up; P.raX = lerp(-0.05, -1.25, up); P.raZ = lerp(0.32, 0.38, up); P.gaze = true; P.ex = k < 0.5 ? 0.035 : 0; P.ey = k < 0.5 ? -0.025 : 0; P.mouth = k > 0.5 ? 'grin' : 'o'; if (R) R.tablet.rotation.y = lerp(-0.9, 0, easeOut(seg(k, 0.5, 0.65))); },
      at: [[0.5, () => sfx('blips', { vol: 0.7 })]]
    },
    /* луч в цифры: при смене цены Слиток сам «переставляет» сумму */
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
        if (bo > 0.01) { handW(a.left ? R.armL.h : R.armR.h, HA); beam(HA, a.tgt, 0.12, bo); } else beam(null, null, 0, 0);
      },
      at: [[0.3, a => { if (!a.skip) sfx('zap'); }], [0.45, a => {
        if (a.skip) return;
        roll(a.num, true); if (ST.numZap === a.num) ST.numZap = null;
        emit({ x: a.tgt.x, y: a.tgt.y, z: 1 }, 12, { colors: ['#ffd36b', '#fff1b8', '#ff9a1f'], speed: 0.9, gravity: 0.6, life: 0.6 }); sfx('flip');
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
      run(P, k) { const up = seg(k, 0, 0.12) - seg(k, 0.85, 1), w = k * TAU * 4; P.cloth = up; P.laX = lerp(-0.05, -0.4 + 0.12 * Math.cos(w), up); P.laZ = lerp(-0.3, -2.7 + 0.14 * Math.sin(w), up); P.hz = -0.12 * up; P.eye = k > 0.2 && k < 0.8 ? 'happy' : 'round'; P.mouth = 'smile'; P.tarn = 0; P.gaze = true; P.ex = -0.02; },
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
        if (sd > 0) { P.raX = r; P.raZ = 0.55; } else { P.laX = r; P.laZ = -0.55; }
        P.mouth = k > 0.7 ? 'grin' : 'smile';
      },
      at: [[0.24, () => sfx('step')], [0.44, () => sfx('step')], [0.64, () => sfx('step')]],
      end() { PR.blocks.forEach(b => (b.visible = false)); }
    },
    yawn: { dur: 2.6, pri: 1, run(P, k) { const b = bell(k, 0.08, 0.75); P.laZ = lerp(-0.3, -2.5, b); P.raZ = lerp(0.32, 2.5, b); P.sq = 1 + 0.07 * b; P.mouth = b > 0.3 ? 'O' : 'smile'; P.eye = b > 0.3 ? 'closed' : 'round'; }, at: [[0.15, () => sfx('powerdown', { vol: 0.4 })]] }
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
    else if (name === 'milestone') { setSign(data && data.label ? data.label : 'Рубеж!', false); playClip('milestone'); say('milestone', Object.assign({ small: (data && data.label) || '' }, EV)); buzz([15, 50, 15]); }
    else if (name === 'coinMove') { setSign(data.label, data.neg); playClip('coinMove'); say(data.neg ? 'coinDown' : 'coinUp', Object.assign({ small: data.label }, EV)); }
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
  function firstData() {
    ST.lastInput = now();
    setTimeout(() => {
      if (!lsGet('ms-intro2', false)) { lsSet('ms-intro2', true); say('intro', { user: true, ms: 8000 }); playClip('hello'); }
      else if (!isNight()) playClip('hello');
    }, 900);
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
      floatOn('zzz', m === 'sleep');
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
  function apply(c, blink, t) {
    R.root.position.set(LOC.x, LOC.y, 0);
    R.root.rotation.y = LOC.yaw + c.yaw + ST.spin;
    R.hop.position.y = Math.max(0, c.y);
    const sq = c.sq, inv = 1 / Math.sqrt(sq); R.hop.scale.set(inv, sq, inv);
    R.bodyG.rotation.set(c.tx, 0, c.tz);
    R.head.rotation.set(c.hx - c.ey * 2.2, c.hy + c.ex * 2.4, c.hz);
    R.armL.p.rotation.set(c.laX, 0, c.laZ); R.armR.p.rotation.set(c.raX, 0, c.raZ);
    R.legs[0].g.rotation.x = -c.legL; R.legs[1].g.rotation.x = -c.legR;
    R.face.update(faceState(c, blink), R.cfg, t);
    const dim = 1 - 0.42 * clamp(c.tarn, 0, 1);
    R.visorMat.emissiveIntensity = (1.25 + 0.35 * ST.talk) * dim;
    const beat = ST.music && LOC.mode === 'sit' ? 0.75 + 0.45 * Math.max(0, Math.sin(t * 7.4)) : 1;
    R.ringMat.color.copy(R.glowC).multiplyScalar(dim * (0.8 + 0.2 * Math.sin(t * 2.1)) * beat);
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
    /* тень на «полу» карточки; когда сидит на краю — тени нет */
    const onFloor = LOC.mode !== 'sit' && LOC.sitK < 0.5 && LOC.y > LY.edge - 0.3;
    const lift = Math.max(0, LOC.y + Math.max(0, c.y) - LY.ground), ss = clamp(1 - lift * 0.35, 0.3, 1);
    PR.shadow.visible = onFloor; PR.shadow.position.set(LOC.x, LY.ground + 0.02, -0.8); PR.shadow.scale.set(ss, ss, 1); PR.shadow.material.opacity = clamp(1 - lift * 0.5, 0.15, 1) * 0.9;
  }
  /* облачко, «!», табличка, «Хррр» и зона касания следуют за персонажем */
  function overlays() {
    V1.set(0, R.topY + 0.05, 0); R.hop.localToWorld(V1);
    const hx = pxX(V1.x), hy = pxY(V1.y);
    for (const k of ['alert', 'sign']) { const el = ui[k]; if (el && el.classList.contains('on')) { el.style.left = hx + 'px'; el.style.top = Math.max(16, hy - 4) + 'px'; } }
    if (ui.zzz && ui.zzz.classList.contains('on')) { ui.zzz.style.left = (hx + 34) + 'px'; ui.zzz.style.top = Math.max(14, hy + 10) + 'px'; }
    const b = ui.bubble;
    if (b && b.classList.contains('on')) {
      /* облачко над головой; если сверху нет места — сбоку */
      const right = pxX(LOC.x) < LY.W * 0.5, bw = ui.bw || 160, bh = ui.bh || 40;
      let x, y, side = hy - bh - 8 < 2;
      if (!side) { x = right ? hx - 26 : hx + 26 - bw; y = hy - bh - 8; }
      else { x = right ? hx + 22 : hx - 22 - bw; y = hy - bh * 0.4; }
      x = Math.round(clamp(x, 4, LY.W - bw - 4)); y = Math.round(clamp(y, 2, LY.H - bh - 2));
      const k = x + ',' + y + (right ? 'r' : 'l');
      if (k !== ui.bk) { ui.bk = k; b.style.transform = 'translate(' + x + 'px,' + y + 'px)'; b.classList.toggle('r', right); }
    }
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
    if (!visible()) { hum(false); ST.hum = false; return; }
    raf = requestAnimationFrame(frame);
    const t = now(), fps = ST.reduced ? 12 : ST.mood === 'sleep' ? 15 : 30;
    if (t - lastF < 1 / fps - 0.004) return;
    const dt = Math.min(0.1, t - lastF); lastF = t;
    try { update(dt, t); renderer.render(scene, camera); } catch (e) { console.error(e); cancelAnimationFrame(raf); raf = 0; return; }
    if (!firstFrame) { firstFrame = true; host.classList.add('ms-live'); }
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
      LOC.cx = clamp(p.x + LOC.gx, 0.7, LY.W / LY.U - 0.7); LOC.cy = clamp(p.y + LOC.gy, 0.05, LY.H / LY.U - R.topY - 0.1);
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
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      if (!renderer.getContext()) return false;
    } catch (e) { return false; }
    if (!document.getElementById('ms-css')) { const st = document.createElement('style'); st.id = 'ms-css'; st.textContent = CSS; document.head.appendChild(st); }
    ST.reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
    renderer.setClearColor(0x000000, 0);
    const cv = renderer.domElement; cv.className = 'ms-cv'; cv.setAttribute('aria-hidden', 'true'); host.appendChild(cv);
    scene = new T.Scene(); scene.environment = envMap(renderer);
    camera = new T.OrthographicCamera(0, 8, 6, 0, 0.1, 60); camera.position.set(0, 0, 20); camera.lookAt(0, 0, 0);
    scene.add(new T.HemisphereLight(col(0xfff6e8), col(0x2a1d4a), 0.45));
    const key = new T.DirectionalLight(0xffffff, 1.3); key.position.set(2.5, 4, 5); scene.add(key);
    const front = new T.DirectionalLight(0xffffff, 0.32); front.position.set(0, 1.5, 6); scene.add(front);
    const rim = new T.DirectionalLight(col(0xc58bff), 0.9); rim.position.set(-4, 2.5, -3); scene.add(rim);
    const fill = new T.DirectionalLight(col(0xffd9a8), 0.35); fill.position.set(-3, 1, 3); scene.add(fill);
    const cfg = CFG.slitok; M = materials(cfg); R = buildStreet(M, cfg); scene.add(R.root);
    PR = buildProps(M, R, scene); PT = Particles(scene, sparkTex());
    const mk = (cls, txt) => { const d = document.createElement('div'); d.className = cls; if (txt) d.textContent = txt; host.appendChild(d); return d; };
    ui.hit = mk('ms-hit'); ui.hit.setAttribute('role', 'button'); ui.hit.setAttribute('aria-label', 'Слиток — нажми, чтобы поздороваться'); ui.hit.tabIndex = 0;
    ui.bubble = mk('ms-bubble'); ui.alert = mk('ms-float ms-alert', '!'); ui.sign = mk('ms-float ms-sign'); ui.zzz = mk('ms-float ms-zzz', 'Хррр');
    ui.bubble.addEventListener('click', () => ui.bubble.classList.remove('on'));
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
      state: () => ({ mood: ST.mood, act: act && act.name, job: JOB && JOB.name, loc: LOC.mode, x: +LOC.x.toFixed(2), y: +LOC.y.toFixed(2), queue: queue.map(q => q.name), raf: !!raf, frame: firstFrame, voice: !!AU.pack, talk: +ST.talk.toFixed(2), ly: { W: LY.W, H: LY.H, ground: +LY.ground.toFixed(2), edge: +LY.edge.toFixed(2), minX: +LY.minX.toFixed(2), maxX: +LY.maxX.toFixed(2), home: +LY.home.toFixed(2) } }),
      render: () => { if (renderer) { update(1 / 30, now()); renderer.render(scene, camera); } },
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
