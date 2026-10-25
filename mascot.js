/* MoneyLife — живой персонаж в карточке баланса. Этап 1: «Слиток» (биткоин).
   Нужен three.js r128 (глобальный THREE), файл three.min.js лежит рядом.
   Приложение вызывает:
     Mascot.init({ host, app })  — один раз, host — контейнер в карточке баланса;
     Mascot.sync(info)           — при каждой отрисовке главной (info: S, D, P, pct, go, fresh, offline, money).
   Персонаж придуман с нуля: ни логотипов монет, ни чужих маскотов. */
(function () {
  'use strict';
  const T = window.THREE;
  if (!T || window.Mascot) return;

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
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const dayKey = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  const col = hex => new T.Color(hex).convertSRGBToLinear();

  /* ---------- текстуры, нарисованные в коде ---------- */
  function canvasTex(size, draw, srgb) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new T.CanvasTexture(c); if (srgb) t.encoding = T.sRGBEncoding; return t;
  }
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
  function starGeo(ro, ri, n) {
    const s = new T.Shape();
    for (let i = 0; i < n * 2; i++) { const a = PI / 2 + (i * PI) / n, r = i % 2 ? ri : ro, x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) s.lineTo(x, y); else s.moveTo(x, y); }
    s.closePath(); return new T.ShapeGeometry(s);
  }

  /* ---------- материалы ---------- */
  function materials() {
    const std = (c, r, m, x) => new T.MeshStandardMaterial(Object.assign({ color: col(c), roughness: r, metalness: m }, x || {}));
    const basic = (c, x) => new T.MeshBasicMaterial(Object.assign({ color: col(c) }, x || {}));
    return {
      gold: std(0xf4b740, 0.3, 0.62), goldDeep: std(0xdc922e, 0.34, 0.6),
      helmet: std(0x2d3f7c, 0.3, 0.05), helmetRim: std(0x223062, 0.38, 0.05),
      lampBody: std(0x9aa3b6, 0.32, 0.75), lens: basic(0xfff3c4),
      white: std(0xffffff, 0.16, 0), pupil: std(0x1b1426, 0.22, 0.1), glint: basic(0xffffff),
      dark: std(0x3b1a0f, 0.45, 0), tongue: std(0xff6f7d, 0.4, 0), brow: std(0x6b3a12, 0.5, 0),
      cheek: basic(0xff8f7d, { transparent: true, opacity: 0.45, depthWrite: false }),
      wood: std(0x8f5c2c, 0.6, 0), woodDark: std(0x6b4220, 0.6, 0), steel: std(0xc9d1db, 0.22, 0.9),
      star: basic(0xfff0a8), cap: std(0x4560db, 0.55, 0), capTrim: std(0xf6f2ff, 0.75, 0), red: basic(0xff4d5e),
      gift: std(0xff5d8f, 0.38, 0), ribbon: std(0xffd34d, 0.32, 0.25), cloth: std(0x86d6ff, 0.85, 0),
      tablet: std(0x1e2233, 0.28, 0.35), shades: std(0x15111f, 0.1, 0.35),
      shadow: new T.MeshBasicMaterial({ map: radialTex('rgba(12,6,32,0.6)', 'rgba(12,6,32,0)'), transparent: true, depthWrite: false })
    };
  }

  /* ---------- «Слиток»: золотой слиток в шахтёрской каске ---------- */
  function buildSlitok(M) {
    const R = {}, W = 1.36, H = 0.98, D = 0.92, TX = 0.82, TZ = 0.88, BY = 0.18;
    R.root = new T.Group();
    R.hop = new T.Group(); R.root.add(R.hop);
    R.shadow = new T.Mesh(new T.PlaneGeometry(1.9, 1.15), M.shadow); R.shadow.rotation.x = -PI / 2; R.shadow.position.y = 0.004; R.root.add(R.shadow);
    const sph = new T.SphereGeometry(1, 28, 20);
    for (const sx of [-1, 1]) { const f = new T.Mesh(sph, M.goldDeep); f.scale.set(0.2, 0.12, 0.25); f.position.set(sx * 0.33, 0.1, 0.07); R.hop.add(f); }
    R.bodyG = new T.Group(); R.bodyG.position.y = BY; R.hop.add(R.bodyG);
    R.goldMats = [M.gold, M.goldDeep];
    const body = new T.Mesh(ingotGeo(W, H, D, 0.2, TX, TZ, 14), M.gold); body.position.y = H / 2; R.bodyG.add(body);

    /* лицо на передней грани, с учётом её наклона */
    const zf = yl => (D / 2) * lerp(1, TZ, (yl + H / 2) / H);
    const face = new T.Group(); face.position.set(0, H / 2 + 0.02, zf(0.02)); face.rotation.x = -Math.atan((D / 2) * (1 - TZ) / H); R.bodyG.add(face); R.face = face;
    R.eyes = [];
    const happyGeo = new T.TorusGeometry(0.1, 0.026, 8, 20, PI), starG = starGeo(0.085, 0.036, 5);
    for (const sx of [-1, 1]) {
      const e = new T.Group(); e.position.set(sx * 0.245, 0.1, 0); face.add(e);
      const scl = new T.Mesh(sph, M.white); scl.scale.set(0.155, 0.172, 0.07); e.add(scl);
      const pup = new T.Group(); pup.position.z = 0.055; e.add(pup);
      const pm = new T.Mesh(sph, M.pupil); pm.scale.set(0.088, 0.098, 0.03); pup.add(pm);
      const g1 = new T.Mesh(sph, M.glint); g1.scale.set(0.027, 0.027, 0.01); g1.position.set(0.03, 0.04, 0.029); pup.add(g1);
      const g2 = new T.Mesh(sph, M.glint); g2.scale.set(0.012, 0.012, 0.006); g2.position.set(-0.026, -0.03, 0.029); pup.add(g2);
      const star = new T.Mesh(starG, M.star); star.position.z = 0.034; star.visible = false; pup.add(star);
      const happy = new T.Mesh(happyGeo, M.dark); happy.position.set(0, -0.035, 0.03); happy.visible = false; face.add(happy); happy.position.x = sx * 0.245; happy.position.y = 0.065;
      const closed = new T.Mesh(happyGeo, M.dark); closed.rotation.z = PI; closed.position.set(sx * 0.245, 0.13, 0.03); closed.visible = false; face.add(closed);
      R.eyes.push({ e, scl, pup, pm, g1, g2, star, happy, closed });
    }
    R.shades = new T.Group(); R.shades.visible = false; R.shades.position.set(0, 0.1, 0.1); face.add(R.shades);
    const lensG = roundBox(0.36, 0.24, 0.04, 0.08);
    for (const sx of [-1, 1]) { const l = new T.Mesh(lensG, M.shades); l.position.x = sx * 0.245; R.shades.add(l); }
    const bridge = new T.Mesh(new T.BoxGeometry(0.14, 0.035, 0.03), M.shades); bridge.position.y = 0.05; R.shades.add(bridge);
    R.brows = [];
    for (const sx of [-1, 1]) { const b = new T.Mesh(sph, M.brow); b.scale.set(0.1, 0.026, 0.03); b.position.set(sx * 0.245, 0.31, 0.02); face.add(b); R.brows.push(b); }
    for (const sx of [-1, 1]) { const c = new T.Mesh(new T.CircleGeometry(0.075, 20), M.cheek); c.scale.set(1.2, 0.78, 1); c.position.set(sx * 0.39, -0.08, 0.006); face.add(c); }
    const mouth = new T.Group(); mouth.position.set(0, -0.17, 0.012); face.add(mouth);
    const mk = (geo, mat, f) => { const m = new T.Mesh(geo, mat); if (f) f(m); m.visible = false; mouth.add(m); return m; };
    const grin = new T.Group(); grin.visible = false; grin.position.y = 0.05; mouth.add(grin);
    grin.add(new T.Mesh(new T.CircleGeometry(0.13, 28, PI, PI), M.dark));
    const tg = new T.Mesh(new T.CircleGeometry(0.06, 20), M.tongue); tg.scale.set(1.25, 0.7, 1); tg.position.set(0, -0.085, 0.002); grin.add(tg);
    R.mouth = {
      smile: mk(new T.TorusGeometry(0.12, 0.026, 8, 24, PI), M.dark, m => { m.rotation.z = PI; m.position.y = 0.06; }),
      frown: mk(new T.TorusGeometry(0.1, 0.026, 8, 24, PI), M.dark, m => { m.position.y = -0.07; }),
      grin,
      o: mk(new T.CircleGeometry(0.055, 20), M.dark, m => m.scale.set(1, 1.25, 1)),
      O: mk(new T.CircleGeometry(0.095, 24), M.dark, m => m.scale.set(1, 1.2, 1)),
      flat: mk(new T.BoxGeometry(0.17, 0.03, 0.01), M.dark)
    };

    /* каска */
    R.helmY = H - 0.01;
    R.helm = new T.Group(); R.helm.position.y = R.helmY; R.bodyG.add(R.helm);
    R.hat = new T.Group(); R.helm.add(R.hat);
    const dome = new T.Mesh(new T.SphereGeometry(0.5, 40, 20, 0, TAU, 0, PI / 2), M.helmet); dome.scale.set(1.1, 0.8, 0.88); R.hat.add(dome);
    const brim = new T.Mesh(new T.CylinderGeometry(0.6, 0.62, 0.05, 48), M.helmetRim); brim.scale.z = 0.86; brim.position.y = 0.01; R.hat.add(brim);
    const ridge = new T.Mesh(new T.TorusGeometry(0.44, 0.032, 8, 32, PI), M.helmetRim); ridge.rotation.y = PI / 2; ridge.scale.y = 0.9; R.hat.add(ridge);
    const lamp = new T.Group(); lamp.position.set(0, 0.2, 0.37); lamp.rotation.x = -0.3; R.hat.add(lamp);
    const lb = new T.Mesh(new T.CylinderGeometry(0.095, 0.11, 0.1, 24), M.lampBody); lb.rotation.x = PI / 2; lamp.add(lb);
    R.lensMat = M.lens.clone(); const lens = new T.Mesh(new T.CircleGeometry(0.08, 24), R.lensMat); lens.position.z = 0.052; lamp.add(lens);
    R.glow = new T.Sprite(new T.SpriteMaterial({ map: radialTex('rgba(255,244,210,1)', 'rgba(255,200,120,0)'), color: 0xffe2a0, transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0 }));
    R.glow.position.z = 0.12; R.glow.scale.set(0.6, 0.6, 1); lamp.add(R.glow);
    /* антенна (нет связи) */
    R.ant = new T.Group(); R.ant.visible = false; R.ant.position.set(0.2, 0.33, 0); R.hat.add(R.ant);
    const rod = new T.Mesh(new T.CylinderGeometry(0.012, 0.016, 0.3, 8), M.steel); rod.position.y = 0.15; R.ant.add(rod);
    R.antMat = M.red.clone(); const ball = new T.Mesh(new T.SphereGeometry(0.045, 14, 10), R.antMat); ball.position.y = 0.32; R.ant.add(ball);
    /* ночной колпак */
    R.cap = new T.Group(); R.cap.visible = false; R.helm.add(R.cap);
    const cone = new T.Mesh(new T.CylinderGeometry(0.035, 0.5, 0.8, 32), M.cap); cone.position.set(0.08, 0.38, -0.02); cone.rotation.z = -0.35; R.cap.add(cone);
    const trim = new T.Mesh(new T.TorusGeometry(0.5, 0.075, 10, 40), M.capTrim); trim.rotation.x = PI / 2; trim.scale.set(1.08, 0.88, 1); trim.position.y = 0.03; R.cap.add(trim);
    const pom = new T.Mesh(new T.SphereGeometry(0.1, 16, 12), M.capTrim); pom.position.set(0.22, 0.76, -0.02); R.cap.add(pom);

    /* руки и кирка */
    const armGeo = capsuleGeo(0.085, 0.3, 14), handGeo = new T.SphereGeometry(0.115, 20, 14);
    const arm = sx => {
      const p = new T.Group(); p.position.set(sx * 0.6, H / 2 + 0.04, 0.04); R.bodyG.add(p);
      const a = new T.Mesh(armGeo, M.gold); a.position.y = -0.2; p.add(a);
      const h = new T.Group(); h.position.y = -0.4; p.add(h); h.add(new T.Mesh(handGeo, M.goldDeep));
      return { p, h };
    };
    R.armL = arm(-1); R.armR = arm(1);
    R.pick = new T.Group(); R.armR.h.add(R.pick);
    const handle = new T.Mesh(new T.CylinderGeometry(0.034, 0.042, 0.8, 12), M.wood); handle.position.y = 0.3; R.pick.add(handle);
    const ph = new T.Group(); ph.position.y = 0.66; R.pick.add(ph);
    const PR_ = 0.25, PA = 1.0;
    const bar = new T.Mesh(new T.TorusGeometry(PR_, 0.05, 10, 24, PA * 2), M.steel); bar.rotation.z = PI / 2 - PA; bar.position.y = -PR_; ph.add(bar);
    const tipG = new T.ConeGeometry(0.05, 0.14, 12);
    for (const sx of [-1, 1]) { const tip = new T.Mesh(tipG, M.steel); const ex = sx * PR_ * Math.sin(PA), ey = PR_ * Math.cos(PA) - PR_; tip.position.set(ex + sx * Math.cos(PA) * 0.06, ey - Math.sin(PA) * 0.06, 0); tip.rotation.z = sx < 0 ? PI - 0.571 : -(PI - 0.571); ph.add(tip); }
    const collar = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.1, 12), M.steel); collar.position.y = 0; ph.add(collar);
    /* тряпочка для полировки — в левой руке */
    R.cloth = new T.Mesh(roundBox(0.22, 0.06, 0.17, 0.025), M.cloth); R.cloth.position.set(0, -0.06, 0.08); R.cloth.visible = false; R.armL.h.add(R.cloth);
    /* планшет — в правой руке */
    R.tablet = new T.Group(); R.tablet.visible = false; R.tablet.position.set(-0.1, 0.14, 0.14); R.armR.h.add(R.tablet);
    R.tablet.add(new T.Mesh(roundBox(0.46, 0.32, 0.035, 0.03), M.tablet));
    const scr = new T.Mesh(new T.PlaneGeometry(0.4, 0.26), new T.MeshBasicMaterial({ map: canvasTex(128, (g, s) => {
      g.fillStyle = '#0d1424'; g.fillRect(0, 0, s, s); g.strokeStyle = '#4fe3a8'; g.lineWidth = 6; g.lineJoin = 'round';
      g.beginPath(); [[8, 96], [30, 80], [48, 88], [70, 52], [90, 62], [118, 22]].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(118, 22, 7, 0, TAU); g.fill();
    }, true) }));
    scr.position.z = 0.019; R.tablet.add(scr);
    R.H = H; R.BY = BY;
    return R;
  }

  /* ---------- предметы для сцен ---------- */
  function buildProps(M, parent) {
    const P = {};
    const coin = new T.Group(); coin.visible = false; parent.add(coin); P.coin = coin;
    const cd = new T.Mesh(new T.CylinderGeometry(0.17, 0.17, 0.045, 28), M.gold); cd.rotation.x = PI / 2; coin.add(cd);
    const cr = new T.Mesh(new T.TorusGeometry(0.13, 0.014, 6, 28), M.goldDeep); cr.position.z = 0.024; coin.add(cr);
    const chest = new T.Group(); chest.visible = false; parent.add(chest); P.chest = chest;
    const cb = new T.Mesh(roundBox(0.52, 0.3, 0.36, 0.05), M.wood); cb.position.y = 0.15; chest.add(cb);
    for (const x of [-0.17, 0.17]) { const b = new T.Mesh(new T.BoxGeometry(0.06, 0.31, 0.37), M.gold); b.position.set(x, 0.15, 0); chest.add(b); }
    const lock = new T.Mesh(roundBox(0.09, 0.1, 0.03, 0.012), M.gold); lock.position.set(0, 0.26, 0.19); chest.add(lock);
    P.lid = new T.Group(); P.lid.position.set(0, 0.3, -0.18); chest.add(P.lid);
    const lid = new T.Mesh(new T.CylinderGeometry(0.18, 0.18, 0.52, 20, 1, false, 0, PI), M.woodDark); lid.rotation.z = PI / 2; lid.position.z = 0.18; P.lid.add(lid);
    const gift = new T.Group(); gift.visible = false; parent.add(gift); P.gift = gift;
    const gb = new T.Mesh(roundBox(0.38, 0.32, 0.38, 0.04), M.gift); gb.position.y = 0.16; gift.add(gb);
    const r1 = new T.Mesh(new T.BoxGeometry(0.08, 0.33, 0.39), M.ribbon); r1.position.y = 0.16; gift.add(r1);
    const r2 = new T.Mesh(new T.BoxGeometry(0.39, 0.33, 0.08), M.ribbon); r2.position.y = 0.16; gift.add(r2);
    P.giftLid = new T.Group(); P.giftLid.position.y = 0.34; gift.add(P.giftLid);
    P.giftLid.add(new T.Mesh(roundBox(0.42, 0.08, 0.42, 0.03), M.gift));
    for (const sx of [-1, 1]) { const b = new T.Mesh(new T.TorusGeometry(0.07, 0.024, 8, 16), M.ribbon); b.position.set(sx * 0.065, 0.09, 0); b.rotation.z = sx * 0.6; P.giftLid.add(b); }
    const tro = new T.Group(); tro.visible = false; parent.add(tro); P.trophy = tro;
    const prof = [[0.001, 0], [0.13, 0], [0.13, 0.035], [0.05, 0.06], [0.035, 0.17], [0.06, 0.2], [0.17, 0.25], [0.2, 0.43], [0.18, 0.44], [0.15, 0.27], [0.001, 0.23]].map(p => new T.Vector2(p[0], p[1]));
    tro.add(new T.Mesh(new T.LatheGeometry(prof, 28), M.gold));
    for (const sx of [-1, 1]) { const hdl = new T.Mesh(new T.TorusGeometry(0.07, 0.018, 8, 16, PI * 1.2), M.goldDeep); hdl.position.set(sx * 0.2, 0.33, 0); hdl.rotation.z = sx > 0 ? -PI * 0.6 : PI * 0.4; tro.add(hdl); }
    P.blocks = [0, 1, 2].map(i => { const b = new T.Mesh(roundBox(0.17, 0.17, 0.17, 0.035), M.goldDeep); b.visible = false; parent.add(b); return b; });
    return P;
  }

  /* ---------- искры, конфетти, салют ---------- */
  function Particles(parent, tex) {
    const N = 180, geo = new T.BufferGeometry(), pos = new Float32Array(N * 3), colr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) pos[i * 3 + 1] = -99;
    geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('color', new T.BufferAttribute(colr, 3));
    const mat = new T.PointsMaterial({ size: 0.14, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending });
    const pts = new T.Points(geo, mat); pts.frustumCulled = false; parent.add(pts);
    const P = Array.from({ length: N }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1, gr: 0 }));
    let cur = 0;
    return {
      emit(o, n, opt) {
        opt = opt || {}; const cs = (opt.colors || ['#ffd36b']).map(c => new T.Color(c));
        for (let i = 0; i < n; i++) {
          const p = P[cur], j = cur * 3; cur = (cur + 1) % N;
          const a = Math.random() * TAU, e = (opt.up ? rnd(0.3, 1) : rnd(-1, 1)) * (opt.cone || PI / 2), sp = rnd(0.5, 1) * (opt.speed || 1.2);
          p.vx = Math.cos(a) * Math.cos(e) * sp; p.vy = Math.sin(e) * sp + (opt.lift || 0); p.vz = Math.sin(a) * Math.cos(e) * sp * 0.5;
          p.life = p.max = rnd(0.6, 1) * (opt.life || 1); p.gr = opt.gravity == null ? 2.2 : opt.gravity;
          const c = pick(cs); p.r = c.r; p.g = c.g; p.b = c.b;
          pos[j] = o.x + rnd(-0.04, 0.04); pos[j + 1] = o.y; pos[j + 2] = o.z + rnd(-0.04, 0.04);
        }
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

  /* ---------- фразы и советы ---------- */
  const PHR = {
    intro: 'Привет! Я Слиток, хранитель твоего биткоина. Нажми на меня, а удержи палец — дам совет из книг.',
    deposit: ['Ещё немного в копилку.', 'Звенит приятно!', 'Пополнение принято.'],
    buy: ['Взяли. Теперь держим.', 'В сундук!', 'Покупка по плану — люблю.'],
    sellProfit: ['Зафиксировали. Хорошая работа.', 'Прибыль в кармане.'],
    sellLoss: ['Бывает. Главное — остаться в игре.', 'Опыт тоже капитал.'],
    airdrop: ['Подарок с неба!', 'Бесплатно — моё любимое слово.'],
    signal: ['Уровень сработал — время докупить.', 'Смотри: можно докупить по плану.'],
    news: ['Есть новый сигнал — загляни.', 'Пришёл сигнал, проверь.'],
    hunter: ['Скидки! Лесенка сработала.', 'Распродажа, а не трагедия.'],
    ath: ['Новый максимум биткоина!', 'Вот это высота!'],
    athPort: ['Портфель на максимуме!'],
    up: ['Неплохо идём.', 'Рынок улыбается.'],
    rocket: ['Ух, полетели!', 'Вот это день!'],
    down: ['Видали и хуже. Держим.', 'Терпение — моя суперсила.'],
    crash: ['Спокойно. Паника — плохой советчик.', 'Шторм пройдёт. Держим курс.'],
    bored: ['Скучновато…', 'Пересчитаю-ка блоки.', '21 миллион, и ни монетой больше.'],
    night: ['Ночь. Рынок не спит, а я посплю.'],
    wake: ['А? Я не сплю! Я на посту.'],
    hide: ['Ничего не вижу!'],
    offline: ['Ищу сигнал…'],
    screen: ['Свежий подбор альткоинов готов!'],
    tap: ['Хе-хе!', 'Щекотно!', 'Я тут, на посту.', 'Привет!'],
    dance: ['Па-па-пам!']
  };
  /* строки из конспектов проекта «Финансы» */
  const TIPS = {
    down: [['Волатильность — плата за доходность, а не штраф.', 'Хаузел, «Психология денег», гл. 15'],
      ['Падение котировок — не убыток, если продавать не нужно.', 'Грэхем, «Разумный инвестор», гл. 5, 8'],
      ['Особенно важно поведение в моменты паники.', 'Хаузел, «Психология денег», гл. 6']],
    up: [['Не покупай сразу после сильного роста и не продавай сразу после сильного падения.', 'Грэхем, «Разумный инвестор», гл. 8'],
      ['Будь оптимистом в долгосрочном плане и параноиком в краткосрочном.', 'Хаузел, «Психология денег», гл. 5, 17']],
    hunter: [['Колебания рынка — возможность, а не указание к действию.', 'Грэхем, «Разумный инвестор»'],
      ['Волатильность — плата за доходность, а не штраф.', 'Хаузел, «Психология денег», гл. 15']],
    calm: [['Главный критерий любого решения — спокойный сон.', 'Хаузел, «Психология денег», гл. 19'],
      ['Главный фактор богатства — время.', 'Хаузел, «Психология денег», гл. 4'],
      ['Финансовое поведение важнее интеллекта.', 'Хаузел, «Психология денег», введение'],
      ['Сначала заплати себе: часть каждого дохода — в капитал, до трат.', '«Свод», принцип П1'],
      ['Сначала выжить: никакой ставки, где проигрыш выбивает из игры.', '«Свод», принцип П9'],
      ['Спекуляции — отдельно и мало.', '«Свод», принцип П13'],
      ['Не занимай деньги для покупки ценных бумаг.', 'Грэхем, «Разумный инвестор», гл. 3']]
  };
  const MILES = [1000, 2000, 3000, 5000, 7000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 200000, 250000, 500000, 1000000];

  /* ---------- стили подсказок поверх сцены ---------- */
  const CSS = `
.ms-cv{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:pan-y;-webkit-tap-highlight-color:transparent;cursor:pointer;outline:none}
.ms-bubble{position:absolute;right:calc(100% - 22px);top:6px;max-width:190px;width:max-content;padding:8px 11px;border-radius:14px 14px 4px 14px;background:rgba(22,15,44,.94);border:1px solid rgba(255,255,255,.14);color:#f5f1ff;font-size:13px;line-height:1.35;font-weight:500;box-shadow:0 10px 28px -10px #000;opacity:0;transform:translateY(4px) scale(.96);transform-origin:100% 100%;transition:opacity .22s,transform .22s;pointer-events:none;z-index:3}
.ms-bubble.on{opacity:1;transform:none;pointer-events:auto}
.ms-bubble small{display:block;margin-top:4px;font-size:11px;color:#b7a9e0;font-weight:400}
.ms-float{position:absolute;left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;z-index:2;white-space:nowrap;opacity:0;transition:opacity .2s}
.ms-float.on{opacity:1}
.ms-alert{width:22px;height:22px;border-radius:50%;background:#ff4d6d;color:#fff;font-weight:800;font-size:14px;display:grid;place-items:center;box-shadow:0 0 0 3px rgba(255,77,109,.25),0 6px 14px -4px #000}
.ms-alert.on{animation:msPop .6s cubic-bezier(.2,.9,.3,1.4)}
.ms-sign{padding:4px 9px;border-radius:9px;background:#fff7e0;color:#2b1a05;font-weight:800;font-size:12.5px;box-shadow:0 6px 14px -6px #000}
.ms-sign.neg{background:#ffe1e4;color:#5a0f1a}
.ms-zzz{color:#cfc3ff;font-weight:700;font-size:12px;letter-spacing:.04em}
.ms-zzz.on{animation:msZ 2.6s ease-in-out infinite}
@keyframes msPop{0%{transform:translate(-50%,-100%) scale(.2)}100%{transform:translate(-50%,-100%) scale(1)}}
@keyframes msZ{0%{opacity:0;margin-top:6px}25%{opacity:1}100%{opacity:0;margin-top:-18px}}
@media (prefers-reduced-motion:reduce){.ms-bubble,.ms-float{transition:none}.ms-alert.on,.ms-zzz.on{animation:none}}`;

  /* ---------- состояние ---------- */
  let host, A = {}, renderer, scene, camera, M, R, PR, PT, raf = 0, inView = true, lastF = 0, inited = false, firstFrame = false;
  const ST = {
    mood: 'calm', moodSince: 0, pending: null, pct: null, go: false, fresh: 0, offline: false, offSince: 0, hide: false, sound: false,
    lastInput: now(), lastEvent: now(), nextHobby: 0, lastHobby: '', nextSignal: 0, lastAuto: -1e9, lastTap: 0, tapTimer: 0,
    nextBlink: 0, blinkT: -9, gx: 0, gy: 0, nextGaze: 0, spin: 0, spinV: 0, drag: null, reduced: false, intensity: 0.7, money: null,
    signText: '', signNeg: false
  };
  const BL = { ready: false, tx: new Set(), real: 0, alert: '', ath: 0, screen: '' };
  let act = null; const queue = [];
  const C = {}; /* текущая поза (сглаженная) */
  let ui = {};

  /* ---------- поза ---------- */
  const BASE = () => ({ y: 0, sq: 1, tz: 0, tx: 0, yaw: 0, laZ: -0.3, laX: -0.05, raZ: 0.32, raX: -0.05, eo: 1, ex: 0, ey: 0, brow: 0, browY: 0, lamp: 0.15, tarn: 0, hl: 0, hr: 0, pickV: 1, pickX: 0, pickZ: 0, eye: 'round', mouth: 'smile', gaze: false, cap: false, ant: false, cloth: 0, tablet: 0, shades: 0, shadesY: 0 });
  const RATE = { tarn: 3, lamp: 10, pickV: 9, cloth: 12, tablet: 12, shades: 10 };
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
    P.sq = 1 + 0.014 * br;
    P.laZ += 0.03 * Math.sin(t * 1.4); P.raZ -= 0.03 * Math.sin(t * 1.4 + 0.6);
    if (m === 'up') {
      const c = (t % 3.4) / 3.4; P.y = 0.1 * I * bell(c, 0, 0.16); P.sq -= 0.05 * bell(c, 0.15, 0.24);
      P.mouth = c < 0.3 ? 'grin' : 'smile'; P.eye = c > 0.02 && c < 0.2 ? 'happy' : 'round'; P.brow = -0.1; P.browY = 0.012;
    } else if (m === 'rocket') {
      const w = t * 5.2; P.y = Math.abs(Math.sin(w)) * 0.11 * I; P.tz = Math.sin(w) * 0.13 * I;
      P.laZ = -1.5 - 0.45 * Math.sin(w); P.raZ = 1.5 - 0.45 * Math.sin(w + PI); P.mouth = 'grin'; P.eye = 'happy';
    } else if (m === 'down' || m === 'crash') {
      const deep = m === 'crash';
      P.tarn = deep ? 0.75 : 0.45; P.mouth = 'frown'; P.brow = deep ? 0.6 : 0.45; P.eo = deep ? 0.72 : 0.82; P.ey = -0.02;
      P.laZ = -0.12; P.raZ = 0.14; P.tx = (deep ? 0.09 : 0.05) * (I + 0.3); P.sq = 1 + 0.01 * Math.sin(t * 1.4);
      const c = (t % (deep ? 5 : 7)) / (deep ? 5 : 7); P.sq -= 0.045 * bell(c, 0, 0.25); P.y -= 0.0;
      P.lamp = 0.05;
    } else if (m === 'hunter') {
      P.mouth = 'grin'; P.eye = 'star'; P.lamp = 0.85 + 0.15 * Math.sin(t * 6); P.brow = -0.25;
      const w = t * 4.4, pump = Math.max(0, Math.sin(w));
      P.raZ = 2.25 + 0.18 * Math.sin(w); P.raX = -0.2; P.pickZ = 0.3; P.laZ = -1.2 - 0.9 * pump; P.laX = -0.25;
      P.y = 0.06 * I * pump; P.sq = 1 - 0.04 * Math.max(0, -Math.sin(w));
    } else if (m === 'sleep') {
      P.eye = 'closed'; P.mouth = 'o'; P.sq = 1 + 0.03 * Math.sin(t * 1.2); P.tz = 0.07; P.tx = 0.06; P.laZ = -0.15; P.raZ = 0.2; P.lamp = 0; P.gaze = true;
    } else if (m === 'night') {
      P.cap = true; P.eo = 0.62; P.sq = 1 + 0.02 * Math.sin(t * 1.5); P.lamp = 0; P.pickV = 0; P.tz = 0.03;
    } else if (m === 'hide') {
      const c = (t % 6) / 6, peek = bell(c, 0.62, 0.86);
      P.shades = 1; P.shadesY = -0.13 * peek; P.mouth = peek > 0.3 ? 'o' : 'smile'; P.brow = -0.15; P.browY = 0.03 * peek; P.tz = 0.05; P.gaze = true; P.ey = 0.02;
    } else if (m === 'offline') {
      P.ant = true; P.gaze = true; P.ex = 0.04 * Math.sin(t * 1.7); P.ey = 0.01; P.brow = -0.1; P.browY = 0.02; P.mouth = 'flat';
    }
  }

  /* ---------- сценки ---------- */
  const CLIPS = {
    hello: { dur: 2.4, pri: 2, run(P, k) { P.raZ = 2.45 + 0.35 * Math.sin(k * TAU * 3); P.raX = -0.25; P.mouth = 'grin'; P.eye = k > 0.25 && k < 0.75 ? 'happy' : 'round'; P.y = 0.08 * bell(k, 0, 0.18); P.pickV = 0; } },
    tap: { dur: 0.9, pri: 2, run(P, k) { P.y = 0.11 * bell(k, 0, 0.55); P.sq = 1 - 0.1 * bell(k, 0, 0.14) + 0.06 * bell(k, 0.14, 0.5); P.eye = 'happy'; P.mouth = 'grin'; } },
    dance: { dur: 3, pri: 2, run(P, k) { const w = k * TAU * 3; P.y = Math.abs(Math.sin(w)) * 0.12; P.tz = Math.sin(w) * 0.16; P.laZ = -1.6 - 0.5 * Math.sin(w); P.raZ = 1.6 - 0.5 * Math.sin(w + PI); P.eye = 'happy'; P.mouth = 'grin'; P.pickV = 0; } },
    wake: { dur: 1.6, pri: 3, run(P, k) { P.eo = 1.15; P.browY = 0.05 * bell(k, 0, 0.6); P.mouth = k < 0.45 ? 'O' : 'smile'; P.y = 0.07 * bell(k, 0, 0.3); } },
    deposit: {
      dur: 4, pri: 3, sfx: 'coin',
      start(a) { PR.chest.visible = true; PR.coin.visible = true; a.burst = false; },
      run(P, k) {
        const ch = PR.chest; ch.position.set(-1.12, lerp(-0.7, 0, backOut(seg(k, 0, 0.18))) - 0.7 * easeIn(seg(k, 0.82, 1)), 0.15);
        PR.lid.rotation.x = -1.2 * (seg(k, 0.4, 0.48) - seg(k, 0.68, 0.76));
        const c = PR.coin, hm = hands(); c.rotation.y = k < 0.4 ? k * TAU * 3 : 0;
        if (k < 0.4) { const f = easeIn(seg(k, 0.08, 0.4)); c.position.set(lerp(0, hm.x, f), lerp(3.1, hm.y + 0.16, f), lerp(0.6, hm.z + 0.06, f)); c.scale.setScalar(k < 0.08 ? 0.001 : 1); }
        else if (k < 0.45) c.position.set(hm.x, hm.y + 0.16, hm.z + 0.06);
        else if (k < 0.66) { const f = easeInOut(seg(k, 0.45, 0.66)); c.position.set(lerp(hm.x, -1.12, f), lerp(hm.y + 0.16, 0.42, f) + 0.6 * Math.sin(f * PI), lerp(hm.z + 0.06, 0.15, f)); c.rotation.y = f * TAU; c.scale.setScalar(1); }
        else c.scale.setScalar(Math.max(0.001, 1 - seg(k, 0.66, 0.7)));
        const up = seg(k, 0.18, 0.36) - seg(k, 0.6, 0.75);
        P.laZ = lerp(-0.3, 0.55, up); P.raZ = lerp(0.32, -0.55, up); P.laX = lerp(-0.05, -1.35, up); P.raX = lerp(-0.05, -1.35, up);
        P.pickV = 1 - seg(k, 0.08, 0.16) + seg(k, 0.8, 0.9); P.yaw = -0.35 * bell(k, 0.42, 0.78);
        P.sq = 1 - 0.08 * bell(k, 0.37, 0.45); P.eye = k > 0.38 ? 'happy' : 'round'; P.mouth = k > 0.38 ? 'grin' : 'o';
        P.gaze = true; P.ey = k < 0.38 ? 0.03 : 0; P.ex = k > 0.42 && k < 0.7 ? -0.035 : 0;
      },
      at: [[0.66, a => { emitAt(PR.chest.position, 0.45, 18, { colors: ['#ffd36b', '#fff1b8', '#ffb547'], up: true, speed: 1.3 }); snd('coin'); }]],
      end() { PR.chest.visible = false; PR.coin.visible = false; }
    },
    buy: {
      dur: 3.2, pri: 3,
      start() { PR.chest.visible = true; PR.coin.visible = true; },
      run(P, k) {
        const ch = PR.chest; ch.position.set(-1.12, lerp(-0.7, 0, backOut(seg(k, 0.12, 0.3))) - 0.7 * easeIn(seg(k, 0.82, 1)), 0.15);
        PR.lid.rotation.x = -1.2 * (seg(k, 0.42, 0.5) - seg(k, 0.66, 0.74));
        const c = PR.coin; handPos(R.armR.h, HB);
        if (k < 0.45) { c.position.set(HB.x - 0.04, HB.y + 0.2, HB.z + 0.08); c.rotation.y = 0.3 * Math.sin(k * 12); c.scale.setScalar(backOut(seg(k, 0, 0.12))); }
        else if (k < 0.64) { const f = easeInOut(seg(k, 0.45, 0.64)); c.position.set(lerp(HB.x - 0.04, -1.12, f), lerp(HB.y + 0.2, 0.42, f) + 0.55 * Math.sin(f * PI), lerp(HB.z + 0.08, 0.15, f)); c.rotation.y = f * TAU * 2; c.scale.setScalar(1); }
        else c.scale.setScalar(Math.max(0.001, 1 - seg(k, 0.64, 0.68)));
        const up = seg(k, 0, 0.12) - seg(k, 0.45, 0.6);
        P.raX = lerp(-0.05, -1.25, up); P.raZ = lerp(0.32, -0.1, up); P.pickV = 1 - seg(k, 0, 0.1) + seg(k, 0.8, 0.9);
        P.tx = 0.12 * bell(k, 0.7, 0.85); P.gaze = true; P.ex = k < 0.45 ? 0.03 : -0.03; P.ey = k < 0.45 ? 0.02 : 0;
        P.mouth = k > 0.6 ? 'grin' : 'smile'; P.eye = k > 0.66 ? 'happy' : 'round';
      },
      at: [[0.64, () => { emitAt(PR.chest.position, 0.45, 12, { colors: ['#ffd36b', '#fff1b8'], up: true }); snd('coin'); }]],
      end() { PR.chest.visible = false; PR.coin.visible = false; }
    },
    sellProfit: { dur: 3, pri: 3, run(P, k) { const b = bell(k, 0.1, 0.8); P.laZ = lerp(-0.3, -2.1, b); P.laX = lerp(-0.05, -0.5, b); P.hl = 0.32 * b; P.hr = -0.35 * b; P.tx = 0.18 * bell(k, 0.25, 0.65); P.eye = 'happy'; P.mouth = 'grin'; }, at: [[0.3, () => snd('fanfare')]] },
    sellLoss: { dur: 3, pri: 3, run(P, k) { P.brow = 0.4; P.mouth = 'flat'; P.tx = 0.08 * Math.max(0, Math.sin(k * TAU * 2)); P.raX = -0.6; P.raZ = -0.35; P.pickV = 0; P.eo = 0.9; } },
    airdrop: {
      dur: 4.2, pri: 3,
      start(a) { PR.gift.visible = true; PR.giftLid.position.set(0, 0.34, 0); PR.giftLid.rotation.set(0, 0, 0); },
      run(P, k) {
        const g = PR.gift, f = easeIn(seg(k, 0, 0.32));
        const hm = hands(); g.position.set(lerp(0.08 * Math.sin(k * 14), hm.x, f), lerp(3.2, hm.y + 0.02, f), lerp(0.6, hm.z + 0.05, f)); g.rotation.z = 0.25 * Math.sin(k * 10) * (1 - f);
        g.scale.setScalar(Math.max(0.001, 1 - seg(k, 0.86, 1)));
        if (k > 0.55) { const o = easeOut(seg(k, 0.55, 0.8)); PR.giftLid.position.set(0.5 * o, 0.34 + 0.9 * o, 0); PR.giftLid.rotation.z = -2.4 * o; }
        const up = seg(k, 0.2, 0.32) - seg(k, 0.85, 0.95);
        P.laZ = lerp(-0.3, 0.6, up); P.raZ = lerp(0.32, -0.6, up); P.laX = lerp(-0.05, -1.3, up); P.raX = lerp(-0.05, -1.3, up); P.pickV = 1 - up;
        P.mouth = k < 0.3 ? 'o' : k < 0.55 ? 'O' : 'grin'; P.eye = k > 0.6 ? 'happy' : 'round'; P.y = 0.1 * bell(k, 0.6, 0.75);
        P.gaze = true; P.ey = k < 0.32 ? 0.03 : 0;
      },
      at: [[0.56, () => { emit({ x: 0, y: 1.45, z: 0.55 }, 34, { colors: ['#ff5d8f', '#ffd34d', '#5be0c4', '#a98bff', '#ffffff'], up: true, speed: 1.6, gravity: 2.6 }); snd('fanfare'); }]],
      end() { PR.gift.visible = false; }
    },
    signal: {
      dur: 2.6, pri: 2,
      start() { floatOn('alert', true); },
      run(P, k) { P.lamp = 0.45 + 0.55 * Math.abs(Math.sin(k * PI * 6)); P.raX = -1.25 * bell(k, 0, 0.9); P.raZ = 0.2; P.pickX = -0.6 * bell(k, 0, 0.9); P.eo = 1.12; P.browY = 0.04; P.mouth = 'o'; P.y = 0.06 * bell(k, 0, 0.15); P.gaze = true; P.ey = -0.02; },
      at: [[0.05, () => snd('alert')]],
      end() { floatOn('alert', false); }
    },
    ath: {
      dur: 5, pri: 3,
      run(P, k) { P.y = 0.22 * ST.intensity * (bell(k, 0.08, 0.28) + bell(k, 0.48, 0.68)); P.laZ = -2.4; P.raZ = 2.4; P.laX = -0.2; P.raX = -0.2; P.eye = 'star'; P.mouth = 'grin'; P.lamp = 1; },
      at: [[0.08, () => fireworks(-0.5)], [0.3, () => fireworks(0.55)], [0.52, () => fireworks(0)], [0.1, () => snd('fanfare')]]
    },
    milestone: {
      dur: 5, pri: 3,
      start() { PR.trophy.visible = true; floatOn('sign', true); },
      run(P, k) {
        const t = PR.trophy; t.position.set(0, lerp(-0.9, 2.08, backOut(seg(k, 0.05, 0.35))), 0.12); t.rotation.y = k * TAU; t.scale.setScalar(Math.max(0.001, 1 - seg(k, 0.88, 1)));
        const up = seg(k, 0.1, 0.32) - seg(k, 0.86, 0.96); P.laZ = lerp(-0.3, -2.6, up); P.raZ = lerp(0.32, 2.6, up); P.laX = -0.3 * up; P.raX = -0.3 * up; P.pickV = 1 - up; P.eye = 'star'; P.mouth = 'grin';
      },
      at: [[0.36, () => { emit({ x: 0, y: 2.3, z: 0.12 }, 26, { colors: ['#ffd36b', '#fff1b8', '#ffffff'], speed: 1.1, gravity: 1.2 }); snd('fanfare'); }]],
      end() { PR.trophy.visible = false; floatOn('sign', false); }
    },
    coinMove: {
      dur: 4.2, pri: 2,
      start() { floatOn('sign', true); },
      run(P, k) { const up = seg(k, 0, 0.15) - seg(k, 0.85, 1); P.laZ = lerp(-0.3, -2.25, up); P.raZ = lerp(0.32, 2.25, up); P.pickV = 1 - up; P.mouth = ST.signNeg ? 'frown' : 'grin'; P.brow = ST.signNeg ? 0.35 : -0.1; P.gaze = true; P.ey = 0.03; },
      end() { floatOn('sign', false); }
    },
    screen: {
      dur: 4.2, pri: 2,
      run(P, k) { const up = seg(k, 0, 0.12) - seg(k, 0.85, 0.97); P.tablet = up; P.pickV = 1 - up; P.raX = lerp(-0.05, -1.25, up); P.raZ = lerp(0.32, 0.38, up); P.gaze = true; P.ex = k < 0.5 ? 0.035 : 0; P.ey = k < 0.5 ? -0.025 : 0; P.mouth = k > 0.5 ? 'grin' : 'o'; if (R) R.tablet.rotation.y = lerp(-0.9, 0, easeOut(seg(k, 0.5, 0.65))); }
    },
    polish: {
      dur: 4.5, pri: 1,
      run(P, k) { const up = seg(k, 0, 0.12) - seg(k, 0.85, 1), w = k * TAU * 4; P.cloth = up; P.laX = lerp(-0.05, -1.05 + 0.15 * Math.cos(w), up); P.laZ = lerp(-0.3, 0.55 + 0.22 * Math.sin(w), up); P.eye = k > 0.2 && k < 0.8 ? 'happy' : 'round'; P.mouth = 'smile'; P.tarn = Math.max(0, (P.tarn || 0) - 0.4); P.gaze = true; P.ey = -0.02; },
      at: [[0.84, () => emitAt({ x: 0, y: 0.6, z: 0.5 }, 0, 10, { colors: ['#ffffff', '#fff1b8'], speed: 0.6, gravity: 0, life: 0.8 })]]
    },
    blocks: {
      dur: 5, pri: 1,
      start() { PR.blocks.forEach(b => { b.visible = true; b.scale.setScalar(0.001); }); },
      run(P, k) {
        PR.blocks.forEach((b, i) => { const s = backOut(seg(k, 0.12 + i * 0.2, 0.24 + i * 0.2)) * (1 - seg(k, 0.88, 0.98)); b.scale.setScalar(Math.max(0.001, s)); b.position.set(1.02 + 0.03 * Math.sin(k * 30) * bell(k, 0.7, 0.86) * i, 0.09 + i * 0.175, 0.2); b.rotation.y = i * 0.25; });
        P.yaw = 0.22; P.gaze = true; P.ex = 0.035; P.pickV = 0; P.raX = -0.75 * Math.max(bell(k, 0.08, 0.26), bell(k, 0.28, 0.46), bell(k, 0.48, 0.66)); P.raZ = 0.55; P.mouth = k > 0.7 ? 'grin' : 'smile';
      },
      end() { PR.blocks.forEach(b => (b.visible = false)); }
    },
    yawn: { dur: 2.6, pri: 1, run(P, k) { const b = bell(k, 0.08, 0.75); P.laZ = lerp(-0.3, -2.5, b); P.raZ = lerp(0.32, 2.5, b); P.sq = 1 + 0.07 * b; P.mouth = b > 0.3 ? 'O' : 'smile'; P.eye = b > 0.3 ? 'closed' : 'round'; P.pickV = 1 - b; } },
    tapPick: {
      dur: 3, pri: 1,
      run(P, k) { const s = Math.max(bell(k, 0.1, 0.32), bell(k, 0.38, 0.6), bell(k, 0.66, 0.88)); P.raX = -0.25 - 0.9 * s; P.pickX = 0.9 * s; P.gaze = true; P.ex = 0.03; P.ey = -0.03; P.mouth = 'smile'; },
      at: [[0.3, () => dust()], [0.58, () => dust()], [0.86, () => dust()]]
    }
  };
  const HOBBIES = ['polish', 'blocks', 'yawn', 'tapPick'];

  const _hv = new T.Vector3();
  function handPos(h, out) { h.getWorldPosition(_hv); R.root.worldToLocal(_hv); return out.copy(_hv); }
  const HA = new T.Vector3(), HB = new T.Vector3(), HM = new T.Vector3();
  function hands() { handPos(R.armL.h, HA); handPos(R.armR.h, HB); return HM.copy(HA).add(HB).multiplyScalar(0.5); }
  function emit(o, n, opt) { if (PT && !ST.reduced) PT.emit(o, n, opt); }
  function emitAt(p, dy, n, opt) { emit({ x: p.x, y: p.y + dy, z: p.z }, n, opt); }
  function fireworks(x) { emit({ x, y: 2.35 + rnd(-0.1, 0.15), z: 0 }, 30, { colors: [pick(['#ffd36b', '#ff5d8f', '#5be0c4', '#a98bff']), '#ffffff'], speed: 1.4, gravity: 0.9, life: 1.1 }); }
  function dust() { emit({ x: 0.95, y: 0.05, z: 0.3 }, 8, { colors: ['#c9b48a', '#8a7a5a'], up: true, speed: 0.5, gravity: 1.5, life: 0.6 }); snd('tick'); }

  /* ---------- проигрывание сценок ---------- */
  function playClip(name, data) {
    const c = CLIPS[name]; if (!c) return;
    const t = now();
    if (act && act.c.pri < c.pri) endClip();
    if (act) { if (queue.length < 3 && !queue.find(q => q.name === name)) queue.push({ name, data }); return; }
    act = { name, c, t0: t, dur: c.dur / (ST.reduced ? 1 : 1), data, fired: {} };
    if (c.start) c.start(act);
    if (c.pri >= 2) ST.lastEvent = t;
    wakeLoop();
  }
  function endClip() { if (!act) return; if (act.c.end) act.c.end(act); act = null; if (R) { R.tablet.rotation.y = 0; } }

  /* ---------- речь ---------- */
  /* фразы: на касание — всегда; о твоих действиях — не чаще раза в 15 с; фоновые — не чаще раза в минуту */
  function say(text, opt) {
    opt = opt || {};
    const t = now(), ev = opt.lvl === 'event';
    if (!opt.user) {
      if (t < (ui.userUntil || 0)) { if (ev && !opt.retry) setTimeout(() => say(text, Object.assign({}, opt, { retry: true })), (ui.userUntil - t) * 1000 + 400); return false; }
      if (ev ? t - (ST.lastEv || -1e9) < 15 : t - ST.lastAuto < 60) return false;
      ST.lastAuto = t; if (ev) ST.lastEv = t;
    }
    const b = ui.bubble; if (!b) return false;
    b.innerHTML = ''; b.appendChild(document.createTextNode(text));
    if (opt.src) { const s = document.createElement('small'); s.textContent = opt.src; b.appendChild(s); }
    b.classList.add('on');
    clearTimeout(ui.bubbleT);
    const ms = opt.ms || Math.min(9500, 3200 + text.length * 55);
    ui.userUntil = opt.user ? t + ms / 1000 : 0;
    ui.bubbleT = setTimeout(() => b.classList.remove('on'), ms);
    return true;
  }
  function floatOn(k, on) { const el = ui[k]; if (!el) return; el.classList.toggle('on', !!on); if (k === 'alert' && on) { el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); } }

  /* ---------- звуки (по умолчанию выключены) ---------- */
  function snd(kind) {
    if (!ST.sound || !A.audio) return;
    const c = A.audio(); if (!c) return;
    const t0 = c.currentTime + 0.01;
    const tone = (f, dt, dur, type, vol) => { const o = c.createOscillator(), g = c.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0 + dt); g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(vol || 0.1, t0 + dt + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + dur); o.connect(g); g.connect(c.destination); o.start(t0 + dt); o.stop(t0 + dt + dur + 0.05); };
    if (kind === 'coin') { tone(1568, 0, 0.12, 'sine', 0.09); tone(2093, 0.07, 0.28, 'sine', 0.08); }
    else if (kind === 'pop') tone(660, 0, 0.12, 'triangle', 0.08);
    else if (kind === 'alert') { tone(880, 0, 0.12, 'square', 0.04); tone(880, 0.16, 0.12, 'square', 0.04); }
    else if (kind === 'fanfare') { tone(523, 0, 0.18, 'triangle', 0.07); tone(659, 0.1, 0.18, 'triangle', 0.07); tone(784, 0.2, 0.32, 'triangle', 0.08); }
    else if (kind === 'tick') tone(320, 0, 0.05, 'square', 0.03);
  }

  /* ---------- события из приложения ---------- */
  const EV = { lvl: 'event' };
  function trigger(name, data) {
    const ph = PHR[name];
    if (name === 'deposit') { playClip('deposit'); say(pick(ph), EV); buzz([10, 40, 10]); }
    else if (name === 'buy') { playClip('buy'); say(pick(ph), EV); }
    else if (name === 'sellProfit') { playClip('sellProfit'); say(pick(ph), EV); }
    else if (name === 'sellLoss') { playClip('sellLoss'); say(pick(ph), EV); }
    else if (name === 'airdrop') { playClip('airdrop'); say(pick(ph), EV); buzz([10, 40, 10]); }
    else if (name === 'signal') { playClip('signal'); say(pick(data && data.news ? PHR.news : PHR.signal), EV); buzz(20); }
    else if (name === 'ath') { playClip('ath'); say(pick(data && data.port ? PHR.athPort : PHR.ath), EV); buzz([15, 50, 15]); }
    else if (name === 'milestone') { setSign(data && data.label ? data.label : 'Рубеж!', false); playClip('milestone'); say(data && data.label ? data.label + ' — рубеж взят!' : 'Новый рубеж взят!', EV); buzz([15, 50, 15]); }
    else if (name === 'coinMove') { setSign(data.label, data.neg); playClip('coinMove'); say(data.neg ? data.sym + ' просел.' : data.sym + ' разогнался!', EV); }
    else if (name === 'screen') { playClip('screen'); say(pick(ph), EV); }
    ST.lastEvent = now();
  }
  function buzz(p) { try { if (A.buzz) A.buzz(p); } catch (e) {} }
  function setSign(text, neg) { ST.signText = text; ST.signNeg = !!neg; if (ui.sign) { ui.sign.textContent = text; ui.sign.classList.toggle('neg', !!neg); } }

  function baseline(S, D) {
    BL.tx = new Set((S.tx || []).map(t => t && t.id).filter(Boolean));
    BL.real = D.realized || 0;
    BL.alert = S.alerts && S.alerts[0] ? String(S.alerts[0].ts || '') : '';
    BL.ath = +(S.cycle && S.cycle.ath) || 0;
    BL.screen = (S.screen && S.screen.updatedAt) || '';
    if (lsGet('ms-mile', null) == null && D.total > 0) lsSet('ms-mile', MILES.filter(m => m <= D.total).pop() || 0);
    BL.ready = true;
  }
  function detect(S, D, info) {
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
    const S = info.S, D = info.D, P = info.P || {};
    ST.hide = !!P.hide; ST.sound = !!P.msSound; ST.go = !!info.go; ST.fresh = info.fresh || 0; ST.money = info.money || ST.money;
    const off = !!info.offline; if (off && !ST.offline) ST.offSince = now(); ST.offline = off;
    ST.pct = info.pct == null || !isFinite(info.pct) ? null : info.pct;
    if (!S.ready) return;
    /* первые 2,5 с после загрузки только запоминаем состояние: данные приходят частями (сделки, сигналы, план) */
    if (!BL.ready) { baseline(S, D); BL.warm = now() + 2.5; firstData(); return; }
    if (now() < BL.warm) { baseline(S, D); return; }
    detect(S, D, info);
    wakeLoop();
  }
  function firstData() {
    const t = now(); ST.lastInput = t;
    setTimeout(() => {
      const h = ST.forceHour != null ? ST.forceHour : new Date().getHours();
      if (!lsGet('ms-intro', false)) { lsSet('ms-intro', true); say(PHR.intro, { user: true, ms: 8000 }); playClip('hello'); }
      else if (h >= 7) playClip('hello');
    }, 900);
  }

  /* ---------- настроение ---------- */
  function resolveMood(t) {
    const idle = t - Math.max(ST.lastInput, ST.lastEvent), duty = ST.go || ST.fresh > 0;
    if (ST.hide) return 'hide';
    if (ST.offline && t - ST.offSince > 60) return 'offline';
    if (!duty && idle > 180) return 'sleep';
    const h = ST.forceHour != null ? ST.forceHour : new Date().getHours();
    if (h < 7 && !duty) return 'night';
    if (ST.go) return 'hunter';
    const p = ST.pct;
    if (p == null) return 'calm';
    if (p <= -7) return 'crash'; if (p <= -2) return 'down'; if (p >= 7) return 'rocket'; if (p >= 2) return 'up';
    return 'calm';
  }
  function schedule(t) {
    const m = ST.mood, idle = t - Math.max(ST.lastInput, ST.lastEvent);
    if (act) return;
    if (queue.length) { const q = queue.shift(); playClip(q.name, q.data); return; }
    if ((ST.go || ST.fresh > 0) && t > ST.nextSignal && m !== 'hide') { ST.nextSignal = t + 30; playClip('signal'); if (ST.go) say(pick(PHR.signal)); return; }
    if ((m === 'calm' || m === 'up' || m === 'down') && idle > 40 && !ST.reduced && t > ST.nextHobby) {
      let h = pick(HOBBIES); if (h === ST.lastHobby) h = pick(HOBBIES); ST.lastHobby = h; ST.nextHobby = t + rnd(9, 14);
      playClip(h); if (Math.random() < 0.35) say(pick(PHR.bored)); return;
    }
  }

  /* ---------- кадр ---------- */
  const V = new T.Vector3();
  function update(dt, t) {
    const m = resolveMood(t);
    if (m !== ST.mood) {
      const prev = ST.mood; ST.mood = m; ST.moodSince = t;
      if (prev === 'sleep' && m !== 'sleep') playClip('wake');
      if (m === 'sleep' || m === 'night') floatOn('zzz', m === 'sleep');
      else floatOn('zzz', false);
      const ph = { up: PHR.up, rocket: PHR.rocket, down: PHR.down, crash: PHR.crash, hunter: PHR.hunter, hide: PHR.hide, offline: PHR.offline, night: PHR.night }[m];
      if (ph && t - ST.lastInput > 0.5 && BL.ready) setTimeout(() => { if (ST.mood === m) say(pick(ph)); }, 1200);
      if (m === 'sleep') floatOn('zzz', true);
    }
    schedule(t);
    const P = BASE(), I = ST.reduced ? 0.25 : ST.intensity;
    moodPose(P, m, t, I);
    if (act) {
      if (act.hold != null) act.t0 = t - act.hold * act.dur;
      const k = clamp((t - act.t0) / act.dur, 0, 1);
      act.c.run(P, k, t, act);
      if (act.c.at) for (let i = 0; i < act.c.at.length; i++) { const a = act.c.at[i]; if (k >= a[0] && !act.fired[i]) { act.fired[i] = 1; a[1](act); } }
      if (k >= 1) endClip();
    }
    if (ST.reduced) { P.y *= 0.25; P.tz *= 0.25; }
    if (!P.gaze) {
      if (t > ST.nextGaze) { ST.gx = rnd(-0.035, 0.035); ST.gy = rnd(-0.025, 0.02); ST.nextGaze = t + rnd(1.4, 3.8); }
      P.ex += ST.gx; P.ey += ST.gy;
    }
    if (ST.drag) { P.ex = clamp(ST.drag.ex, -0.045, 0.045); P.ey = clamp(ST.drag.ey, -0.035, 0.035); }
    smooth(P, dt);
    if (t > ST.nextBlink) { ST.blinkT = t; ST.nextBlink = t + rnd(2.4, 5.5); }
    const bk = t - ST.blinkT, blink = bk < 0.16 ? 1 - 0.92 * Math.sin((bk / 0.16) * PI) : 1;
    apply(C, blink, t);
    if (!ST.drag) { ST.spinV *= Math.exp(-3 * dt); ST.spin += ST.spinV * dt; ST.spin += (0 - ST.spin) * (1 - Math.exp(-2.5 * dt)); }
    if (PT) PT.update(dt);
    overlays();
  }
  const goldA = col(0xf4b740), goldB = col(0xdc922e), dullA = col(0xb39663), dullB = col(0x9a7d4d), lensOn = col(0xfff3c4), lensOff = col(0x7a6646);
  function apply(c, blink, t) {
    R.root.rotation.y = c.yaw + ST.spin;
    R.hop.position.y = Math.max(0, c.y);
    const sq = c.sq, inv = 1 / Math.sqrt(sq); R.hop.scale.set(inv, sq, inv);
    R.bodyG.rotation.set(c.tx, 0, c.tz);
    R.armL.p.rotation.set(c.laX, 0, c.laZ); R.armR.p.rotation.set(c.raX, 0, c.raZ);
    const mode = c.eye, open = clamp(c.eo, 0.05, 1.2) * blink;
    for (const e of R.eyes) {
      const round = mode === 'round' || mode === 'star';
      e.scl.visible = round; e.pup.visible = round; e.happy.visible = mode === 'happy'; e.closed.visible = mode === 'closed';
      e.e.scale.set(1, round ? open : 1, 1);
      e.pup.position.x = c.ex; e.pup.position.y = c.ey;
      e.star.visible = mode === 'star'; e.pm.visible = mode !== 'star'; e.g1.visible = mode !== 'star'; e.g2.visible = mode !== 'star';
      if (mode === 'star') e.star.rotation.z = t * 1.5;
    }
    R.brows[0].rotation.z = c.brow * 0.55; R.brows[1].rotation.z = -c.brow * 0.55;
    const by = 0.31 + c.browY - (1 - clamp(c.eo, 0, 1)) * 0.05; R.brows[0].position.y = by; R.brows[1].position.y = by;
    for (const k in R.mouth) R.mouth[k].visible = k === c.mouth;
    R.helm.position.y = R.helmY + c.hl; R.helm.rotation.x = c.hr;
    R.hat.visible = !c.cap; R.cap.visible = !!c.cap; R.ant.visible = !!c.ant;
    if (c.ant) R.antMat.color.copy(Math.sin(t * 6) > 0 ? col(0xff4d5e) : col(0x5a1820));
    const L = clamp(c.lamp, 0, 1); R.lensMat.color.copy(lensOff).lerp(lensOn, L); R.glow.material.opacity = L * L * 0.75; R.glow.scale.setScalar(0.22 + 0.3 * L);
    const tn = clamp(c.tarn, 0, 1);
    M.gold.color.copy(goldA).lerp(dullA, tn); M.goldDeep.color.copy(goldB).lerp(dullB, tn);
    M.gold.roughness = lerp(0.3, 0.62, tn); M.gold.metalness = lerp(0.62, 0.35, tn); M.goldDeep.roughness = M.gold.roughness; M.goldDeep.metalness = M.gold.metalness;
    const pv = clamp(c.pickV, 0, 1); R.pick.visible = pv > 0.02; R.pick.scale.setScalar(Math.max(0.001, pv)); R.pick.rotation.set(0.25 + c.pickX, 0, -0.62 + c.pickZ);
    R.shades.visible = c.shades > 0.02; R.shades.scale.setScalar(Math.max(0.001, c.shades)); R.shades.position.y = 0.1 + c.shadesY;
    R.cloth.visible = c.cloth > 0.02; R.cloth.scale.setScalar(Math.max(0.001, c.cloth));
    R.tablet.visible = c.tablet > 0.02; R.tablet.scale.setScalar(Math.max(0.001, c.tablet * 1.3)); R.tablet.rotation.x = -c.raX;
    const lift = Math.max(0, c.y); R.shadow.scale.setScalar(1 - lift * 0.9); R.shadow.material.opacity = 1 - lift * 1.6;
  }
  function overlays() {
    const any = ['alert', 'sign', 'zzz'].some(k => ui[k] && ui[k].classList.contains('on'));
    if (!any) return;
    V.set(0, R.BY + R.H + 0.62, 0); R.hop.localToWorld(V); V.project(camera);
    const w = host.clientWidth, h = host.clientHeight, x = (V.x + 1) / 2 * w, y = (1 - V.y) / 2 * h;
    for (const k of ['alert', 'sign']) { const el = ui[k]; if (el && el.classList.contains('on')) { el.style.left = x + 'px'; el.style.top = Math.max(18, y) + 'px'; } }
    if (ui.zzz) { ui.zzz.style.left = (x + w * 0.16) + 'px'; ui.zzz.style.top = Math.max(16, y + 8) + 'px'; }
  }

  /* ---------- цикл отрисовки ---------- */
  function visible() {
    if (!host || document.hidden || !inView) return false;
    if (host.offsetParent === null) return false;
    if (document.querySelector('.sheet.open')) return false;
    return true;
  }
  function frame() {
    raf = 0;
    if (!visible()) return;
    raf = requestAnimationFrame(frame);
    const t = now(), fps = ST.reduced ? 12 : ST.mood === 'sleep' ? 15 : 30;
    if (t - lastF < 1 / fps - 0.004) return;
    const dt = Math.min(0.1, t - lastF); lastF = t;
    try { update(dt, t); renderer.render(scene, camera); } catch (e) { console.error(e); cancelAnimationFrame(raf); raf = 0; return; }
    if (!firstFrame) { firstFrame = true; host.classList.add('ms-live'); }
  }
  function wakeLoop() { if (!raf && inited && visible()) { lastF = now(); raf = requestAnimationFrame(frame); } }

  /* ---------- касания ---------- */
  function onDown(e) {
    const t = now(); userInput(t);
    const r = host.getBoundingClientRect();
    ST.drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, t0: t, moved: false, ex: 0, ey: 0, r };
    clearTimeout(ST.longT);
    ST.longT = setTimeout(() => { if (ST.drag && !ST.drag.moved) { ST.drag.long = true; tip(); } }, 550);
  }
  function onMove(e) {
    const d = ST.drag; if (!d) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    d.ex = ((e.clientX - d.r.left) / d.r.width - 0.5) * 0.09; d.ey = -((e.clientY - d.r.top) / d.r.height - 0.4) * 0.07;
    if (!d.moved && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { d.moved = true; clearTimeout(ST.longT); }
    if (d.moved) { const step = e.clientX - d.x; ST.spin += step * 0.016; ST.spinV = step * 0.9; }
    d.x = e.clientX;
  }
  function onUp() {
    const d = ST.drag; ST.drag = null; clearTimeout(ST.longT);
    if (!d || d.moved || d.long) return;
    const t = now();
    if (t - ST.lastTap < 0.32) { clearTimeout(ST.tapTimer); ST.lastTap = 0; endClip(); playClip('dance'); say(pick(PHR.dance), { user: true }); snd('fanfare'); return; }
    ST.lastTap = t;
    ST.tapTimer = setTimeout(() => {
      if (ST.mood === 'sleep') { ST.lastInput = now(); say(pick(PHR.wake), { user: true }); return; }
      playClip('tap'); snd('pop');
      if (t - (ST.lastTapSay || 0) > 8) { ST.lastTapSay = t; say(pick(PHR.tap), { user: true }); }
    }, 260);
  }
  function tip() {
    const m = ST.mood, set = m === 'down' || m === 'crash' ? TIPS.down : m === 'up' || m === 'rocket' ? TIPS.up : m === 'hunter' ? TIPS.hunter : TIPS.calm;
    let tp = pick(set); if (ST.lastTip === tp[0]) tp = pick(set); ST.lastTip = tp[0];
    say(tp[0], { user: true, src: tp[1], ms: 8000 }); playClip('tap'); buzz(12);
  }
  function userInput(t) { const wasSleep = ST.mood === 'sleep'; ST.lastInput = t || now(); if (wasSleep) wakeLoop(); }

  /* ---------- запуск ---------- */
  function init(opts) {
    if (inited) return true;
    opts = opts || {}; host = opts.host; A = opts.app || {};
    if (!host) return false;
    try {
      renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      if (!renderer.getContext()) return false;
    } catch (e) { return false; }
    if (!document.getElementById('ms-css')) { const st = document.createElement('style'); st.id = 'ms-css'; st.textContent = CSS; document.head.appendChild(st); }
    ST.reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.02;
    renderer.setClearColor(0x000000, 0);
    const cv = renderer.domElement; cv.className = 'ms-cv'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Слиток — персонаж портфеля'); host.appendChild(cv);
    scene = new T.Scene(); scene.environment = envMap(renderer);
    camera = new T.PerspectiveCamera(28, 1, 0.1, 50);
    scene.add(new T.HemisphereLight(col(0xfff6e8), col(0x2a1d4a), 0.55));
    const key = new T.DirectionalLight(0xffffff, 1.15); key.position.set(2.5, 4, 5); scene.add(key);
    const rim = new T.DirectionalLight(col(0xc58bff), 0.9); rim.position.set(-4, 2.5, -3); scene.add(rim);
    const fill = new T.DirectionalLight(col(0xffd9a8), 0.35); fill.position.set(-3, 1, 3); scene.add(fill);
    M = materials(); R = buildSlitok(M); scene.add(R.root);
    PR = buildProps(M, R.root); PT = Particles(R.root, sparkTex());
    const mk = (cls, txt) => { const d = document.createElement('div'); d.className = cls; if (txt) d.textContent = txt; host.appendChild(d); return d; };
    ui.bubble = mk('ms-bubble'); ui.alert = mk('ms-float ms-alert', '!'); ui.sign = mk('ms-float ms-sign'); ui.zzz = mk('ms-float ms-zzz', 'Хррр');
    ui.bubble.addEventListener('click', () => ui.bubble.classList.remove('on'));
    const size = () => { const w = host.clientWidth || 140, h = host.clientHeight || 150; renderer.setSize(w, h, false); camera.aspect = w / h; camera.position.set(-0.3, 1.3, 5.9); camera.lookAt(-0.11, 1.03, 0); camera.updateProjectionMatrix(); };
    size();
    if (window.ResizeObserver) new ResizeObserver(size).observe(host);
    if (window.IntersectionObserver) new IntersectionObserver(es => { inView = es[0].isIntersecting; if (inView) wakeLoop(); }).observe(host);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { userInput(); wakeLoop(); } });
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, e => { if (!host.contains(e.target)) userInput(); }, { passive: true }));
    cv.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove, { passive: true }); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', () => { ST.drag = null; clearTimeout(ST.longT); });
    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); host.classList.remove('ms-live'); cancelAnimationFrame(raf); raf = 0; });
    setInterval(() => { if (!raf) wakeLoop(); }, 700);
    ST.nextBlink = now() + 1.5; ST.nextGaze = now() + 1; ST.nextHobby = now() + 5;
    inited = true; wakeLoop();
    return true;
  }

  window.Mascot = {
    init, sync,
    event: (name, data) => trigger(name, data),
    _hold: k => { if (act) act.hold = k; },
    debug: {
      clip: (n, d) => { endClip(); playClip(n, d); },
      at: (n, k, d) => { endClip(); playClip(n, d); if (act) act.hold = k; },
      hour: h => { ST.forceHour = h; },
      mood: m => { if (ST.forceHour == null) ST.forceHour = 12; ST.pct = { calm: 0, up: 3, rocket: 9, down: -3, crash: -9 }[m]; ST.go = m === 'hunter'; ST.hide = m === 'hide'; if (m === 'sleep') { ST.lastInput = ST.lastEvent = now() - 400; } else ST.lastInput = now(); if (m === 'offline') { ST.offline = true; ST.offSince = now() - 120; } else ST.offline = false; },
      say: (t, src) => say(t, { user: true, src }),
      state: () => ({ mood: ST.mood, act: act && act.name, queue: queue.map(q => q.name), pct: ST.pct, go: ST.go, fresh: ST.fresh, raf: !!raf, frame: firstFrame }),
      render: () => { if (renderer) { update(1 / 30, now()); renderer.render(scene, camera); } }
    }
  };
})();
