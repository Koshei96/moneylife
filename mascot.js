/* MoneyLife — голосовой помощник «Орион» (11.11.2026, решение владельца: «как Джарвис, только в мире крипты и по этому приложению»).
   Характер: спокойный, вежливый, с лёгкой иронией; сам докладывает о событиях, обращается по имени, на «вы». Советов не даёт —
   напоминает план и говорит «решение за вами». Имя «Джарвис» и голос актёра не используем (права Marvel).
   Вид — живая сфера рядом с суммой (canvas 2D); цвет — настроение рынка; во время речи вокруг сферы бегут тонкие дуги.
   Голос — синтез речи телефона (speechSynthesis, русский голос); где голоса нет или звук выключен — только субтитры.
   Приложение вызывает:
     Mascot.init({ host, app: { buzz, askName } }) — один раз; host — слой поверх блока баланса (#mascot);
     Mascot.sync(info)              — при каждой отрисовке главной (info: S, D, P, pct, go, fresh, offline, money);
     Mascot.number({ el, to, up })  — сумма изменилась: цифры перекатываются, как на табло;
     Mascot.event(name, data)       — событие (рубеж 14 дней и т. п.);
     Mascot.greet(name)             — имя сохранено: Орион знакомится.
   Нажатие на сферу — сводка голосом; во время речи нажатие на сферу или на субтитры — тишина. */
(function () {
  'use strict';
  if (window.Mascot) return;

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const now = () => performance.now() / 1000;
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const dayKey = () => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

  const CSS = `
.hero .ms{position:absolute;inset:0;z-index:3;pointer-events:none}
.ms-cv{position:absolute;right:-14px;top:50%;width:132px;height:132px;margin-top:-66px;display:block;pointer-events:none}
.ms-hit{position:absolute;right:20px;top:50%;width:64px;height:64px;margin-top:-32px;padding:0;border:0;background:none;border-radius:50%;pointer-events:auto;cursor:pointer;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;outline:none}
.ms-hit:focus-visible{box-shadow:0 0 0 2px var(--fg,#fff)}
.or-cap{position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom,0px));z-index:45;width:min(calc(100% - 32px),520px);transform:translate(-50%,12px);display:grid;grid-template-columns:26px minmax(0,1fr);gap:4px 12px;align-items:start;padding:12px 16px 13px 14px;border:0;border-radius:18px;background:var(--raise,#222227);color:var(--fg,#f5f5f7);font:inherit;text-align:left;box-shadow:0 18px 44px -20px #000;opacity:0;pointer-events:none;transition:opacity .25s,transform .3s cubic-bezier(.2,.8,.3,1);cursor:pointer;-webkit-tap-highlight-color:transparent}
.or-cap.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.or-cap i{grid-row:span 2;width:26px;height:26px;margin-top:2px;border-radius:50%;background:radial-gradient(circle at 38% 34%,#fff 0,var(--oc,#8b7dff) 46%,#07070a 100%);box-shadow:0 0 14px var(--oc,#8b7dff)}
.or-cap.talk i{animation:orPulse 1.1s ease-in-out infinite}
.or-cap.listen i{animation:orPulse .6s ease-in-out infinite;box-shadow:0 0 0 6px color-mix(in srgb,var(--oc,#8b7dff) 25%,transparent),0 0 18px var(--oc,#8b7dff)}
.or-cap b{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--mute,#a3a3ae)}
.or-cap span{font-size:14.5px;line-height:1.45;overflow-wrap:anywhere}
.or-cap:focus-visible{outline:2px solid var(--fg,#fff);outline-offset:2px}
@keyframes orPulse{50%{transform:scale(1.12)}}
.ms-dg{position:relative;display:inline-block}
.ms-dg>i{display:inline-block;font-style:normal;animation:msDgIn .5s cubic-bezier(.2,.9,.3,1.25) both}
.ms-dg>b{position:absolute;left:0;top:0;font-weight:inherit;animation:msDgOut .45s ease-in both;pointer-events:none}
.ms-dg.d>i{animation-name:msDgInD}.ms-dg.d>b{animation-name:msDgOutD}
@keyframes msDgIn{from{transform:translateY(.62em);opacity:0}to{transform:none;opacity:1}}
@keyframes msDgOut{to{transform:translateY(-.62em);opacity:0}}
@keyframes msDgInD{from{transform:translateY(-.62em);opacity:0}to{transform:none;opacity:1}}
@keyframes msDgOutD{to{transform:translateY(.62em);opacity:0}}
@media (prefers-reduced-motion:reduce){.or-cap{transition:none}.or-cap.talk i{animation:none}.ms-dg>i,.ms-dg>b{animation:none}.ms-dg>b{display:none}}`;

  let host, A = {}, cv, g, raf = 0, inView = true, inited = false, firstFrame = false, lastF = 0, W = 132, DPR = 1;
  const ui = {};
  const ST = {
    mood: 'calm', moodSince: 0, pct: null, go: false, fresh: 0, offline: false, offSince: 0, hide: false, sound: true, name: '',
    lastInput: now(), lastEvent: now(), nextSignal: 0, reduced: false, money: null,
    talk: 0, lvl: 0.05, pulse: 0, pulseT: 0, S: null, D: null, lastSay: '', t0: now(), autoT: 0, asked: false
  };
  const BL = { ready: false, tx: new Set(), real: 0, alert: '', ath: 0, screen: '' };
  const MILES = [1000, 2000, 3000, 5000, 7000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 200000, 250000, 500000, 1000000];
  /* ночью (23:00–7:00) Орион сам не заговаривает — только если его спросить */
  /* под автотестами (webdriver) Орион сам не заговаривает — субтитры не закрывают кнопки; проверки зовут его через debug */
  const AUTO = !navigator.webdriver;
  const isNight = () => { const h = ST.forceHour != null ? ST.forceHour : new Date().getHours(); return h < 7 || h >= 23; };
  function dg(o, n, cls) { const s = document.createElement('span'); s.className = cls; const b = document.createElement('b'); b.textContent = o; b.setAttribute('aria-hidden', 'true'); const i = document.createElement('i'); i.textContent = n; s.appendChild(b); s.appendChild(i); return s; }
  /* перекатить цифры, как на табло: старая уезжает, новая выезжает (вверх — если сумма выросла) */
  function roll(p, fx) {
    if (!p || p.done) return; p.done = true;
    const el = p.el; if (!el || !el.isConnected) return;
    if (el._msTo != null) { clearTimeout(el._msT); el.textContent = el._msTo; el._msTo = null; }
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
    el._msTo = to;
    el._msT = setTimeout(() => { if (el._msTo === to) { el.textContent = to; el._msTo = null; } }, 900);
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
      if (reached > mile) { lsSet('ms-mile', reached); ev.push(['milestone', { v: reached }]); }
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
      if (best) { mv[best.s] = dk; lsSet('ms-mv', mv); ev.push(['coinMove', { sym: best.s, neg: best.ch < 0, ch: best.ch }]); }
    }
    for (const e of ev) trigger(e[0], e[1]);
  }
  function fmtMoney(v) { try { if (ST.money) return ST.money(v, { d: 0, show: true }); } catch (e) {} return '$' + Math.round(v).toLocaleString('ru-RU'); }
  /* ---------- речь: голос телефона + субтитры ---------- */
  const TTS = { ok: !!(window.speechSynthesis && window.SpeechSynthesisUtterance), voice: null, cur: null, beat: 0, sim: 0, guard: 0, q: [] };
  function pickVoice() {
    if (!TTS.ok) return null;
    let vs = []; try { vs = speechSynthesis.getVoices() || []; } catch (e) {}
    const ru = vs.filter(v => /^ru/i.test(v.lang || ''));
    if (!ru.length) return (TTS.voice = null);
    /* мужской голос, если в телефоне он есть, иначе голос Google, иначе любой русский */
    TTS.voice = ru.find(v => /(dmitr|pavel|yuri|maxim|male|муж)/i.test(v.name)) || ru.find(v => /google/i.test(v.name)) || ru.find(v => v.localService) || ru[0];
    return TTS.voice;
  }
  if (TTS.ok) { try { speechSynthesis.addEventListener('voiceschanged', pickVoice); } catch (e) {} pickVoice(); }
  const speaking = () => !!TTS.cur;
  function capShow(text) {
    if (!ui.cap) return;
    ui.capT.textContent = text;
    ui.cap.classList.add('on', 'talk');
    ui.cap.setAttribute('aria-label', 'Орион: ' + text + '. Нажмите, чтобы остановить');
  }
  function capDone(cur, quick) {
    if (!ui.cap) return;
    ui.cap.classList.remove('talk');
    clearTimeout(ui.capOff);
    ui.capOff = setTimeout(() => { if (!TTS.cur) ui.cap.classList.remove('on'); }, quick ? 0 : 2200);
  }
  function finish(cur, quick) {
    if (TTS.cur !== cur) return; TTS.cur = null; clearInterval(TTS.sim); clearTimeout(TTS.guard); TTS.sim = 0; capDone(cur, quick); wake();
    if (quick) { TTS.q = []; return; }   /* остановили рукой — очередь не договариваем */
    if (cur.follow && AUTO && SRC && !document.hidden) { setTimeout(() => { if (!TTS.cur && !ST.rec) listen({ follow: true }); }, 450); return; }   /* разговор: после ответа слушаем следующий вопрос */
    setTimeout(() => { if (TTS.cur) return; let x; while ((x = TTS.q.shift()) && now() - x.at > 40) {} if (x) speak(x.text, Object.assign({}, x.o, { queue: false })); }, 700);
  }
  function stopVoice() {
    const c = TTS.cur; if (!c) return;
    (VO.srcs || []).forEach(x => { try { x.onended = null; x.stop(); } catch (e) {} }); VO.srcs = []; VO.src = null;
    if (TTS.ok) try { speechSynthesis.cancel(); } catch (e) {}
    finish(c, true);
  }
  /* без голоса — субтитры держатся столько, сколько их читать; сфера «говорит» в такт */
  function silent(cur) {
    if (TTS.cur !== cur) return;
    clearInterval(TTS.sim);
    const dur = Math.min(16, 1.4 + cur.text.split(/\s+/).length * 0.38);
    TTS.sim = setInterval(() => { TTS.beat = now(); }, 300);
    TTS.guard = setTimeout(() => finish(cur), dur * 1000);
  }
  function speak(text, o) {
    o = o || {};
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    if (TTS.cur && (TTS.cur.pri || 0) > (o.pri || 0)) {   /* занят важным — скажет следом (не больше двух в очереди) */
      if (o.queue !== false && TTS.q.length < 2 && !TTS.q.some(x => x.text === text)) TTS.q.push({ text, o, at: now() });
      return false;
    }
    stopVoice();
    const cur = { text, pri: o.pri || 0, follow: !!o.follow }; TTS.cur = cur; ST.lastSay = text; ST.lastEvent = now(); TTS.beat = now();
    pulse(0.6);
    if (premiumOK()) {   /* субтитры появляются вместе со звуком, а не раньше (не дольше 4 секунд ожидания) */
      cur.wait = true; cur.cap = () => { if (!cur.capOn && TTS.cur === cur) { cur.capOn = true; capShow(text); } }; setTimeout(cur.cap, 4000);
      premium(cur).then(ok => { cur.wait = false; if (!ok && TTS.cur === cur) phone(cur); }); wake(); return true;
    }
    capShow(text); cur.capOn = true;
    phone(cur);
    wake();
    return true;
  }
  /* голос телефона (запасной путь) */
  function phone(cur) {
    if (!cur.capOn) { cur.capOn = true; capShow(cur.text); }
    const text = cur.text, v = TTS.voice || pickVoice();
    TTS.engine = 'phone';
    if (!ST.sound || !TTS.ok || !v || document.hidden) { silent(cur); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[«»]/g, '').replace(/—/g, ','));
      u.voice = v; u.lang = v.lang || 'ru-RU'; u.rate = 1.0; u.pitch = 0.9; u.volume = 1;
      u.onstart = () => { TTS.beat = now(); };
      u.onboundary = () => { if (TTS.cur === cur) TTS.beat = now(); };
      u.onend = () => finish(cur);
      u.onerror = () => { if (TTS.cur === cur && !TTS.sim) silent(cur); };
      speechSynthesis.speak(u);
      /* движок не ответил (нет активации, голос не загружен) — продолжаем субтитрами */
      TTS.guard = setTimeout(() => { if (TTS.cur === cur && !speechSynthesis.speaking && !TTS.sim) silent(cur); }, 2500);
      /* если голос не шлёт границ слов — сфера всё равно «говорит» */
      TTS.sim = setInterval(() => { if (TTS.cur === cur && now() - TTS.beat > 0.45) TTS.beat = now() - 0.12; }, 320);
    } catch (e) { silent(cur); }
    wake();
  }

  /* ---------- живой голос (ElevenLabs через серверную функцию) и звуковая обработка «как в шлеме» ----------
     Цепочка: голос → плотный низ (160 Гц) → разборчивость (3 кГц) → ровная громкость → сухой сигнал + короткое эхо зала.
     Перед фразой — тихий двойной звук включения. Сфера и дуги пульсируют по реальной громкости голоса. */
  const VO = { ctx: null, inp: null, wet: null, an: null, src: null, buf: new Map(), off: 0, data: null };
  function voCtx() {
    if (VO.ctx) return VO.ctx;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    let c; try { c = new C(); } catch (e) { return null; }
    const inp = c.createGain(), low = c.createBiquadFilter(), pres = c.createBiquadFilter(), comp = c.createDynamicsCompressor(), dry = c.createGain(), conv = c.createConvolver(), wet = c.createGain(), out = c.createGain(), an = c.createAnalyser();
    low.type = 'lowshelf'; low.frequency.value = 160; low.gain.value = 3.5;
    pres.type = 'peaking'; pres.frequency.value = 3000; pres.Q.value = 0.9; pres.gain.value = 2.5;
    comp.threshold.value = -22; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.18;
    dry.gain.value = 0.92; wet.gain.value = 0.17; out.gain.value = 1;
    /* эхо зала: 1,4 с затухающего шума — «большое пустое помещение», без чужих записей */
    const sr = c.sampleRate, len = Math.round(sr * 1.4), ir = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) { const k = i / len; d[i] = i < sr * 0.012 ? 0 : (Math.random() * 2 - 1) * Math.pow(1 - k, 3.4); } }
    conv.buffer = ir;
    inp.connect(low); low.connect(pres); pres.connect(comp); comp.connect(dry); comp.connect(conv); conv.connect(wet);
    dry.connect(out); wet.connect(out); out.connect(an); an.connect(c.destination);
    an.fftSize = 512; VO.data = new Uint8Array(an.fftSize);
    Object.assign(VO, { ctx: c, inp, wet: conv, an });
    return c;
  }
  function voUnlock() { const c = voCtx(); if (c && c.state === 'suspended') c.resume().catch(() => {}); }
  /* тихий звук включения: две короткие ноты с эхом */
  function chime(at) {
    const c = VO.ctx; if (!c) return;
    [[740, 0, 0.05], [1110, 0.07, 0.04]].forEach(([f, dt, g]) => {
      const o = c.createOscillator(), e = c.createGain(); o.type = 'sine'; o.frequency.value = f;
      e.gain.setValueAtTime(0, at + dt); e.gain.linearRampToValueAtTime(g, at + dt + 0.012); e.gain.exponentialRampToValueAtTime(0.0001, at + dt + 0.32);
      o.connect(e); e.connect(VO.wet); e.connect(VO.an); o.start(at + dt); o.stop(at + dt + 0.35);
    });
  }
  const premiumOK = () => !!(ST.sound && A.voice && !document.hidden && navigator.onLine !== false && now() > VO.off && (ST.forcePremium || !navigator.webdriver));
  /* фраза → части по предложениям: первая короткая озвучивается быстро и звучит, пока готовятся остальные */
  function splitParts(t) {
    const ss = t.match(/[^.!?…]+[.!?…]+["»]?|[^.!?…]+$/g) || [t], out = [];
    for (const x of ss.map(z => z.trim()).filter(Boolean)) { if (out.length && (out[out.length - 1].length < 28 || out.length >= 4)) out[out.length - 1] += ' ' + x; else out.push(x); }
    return out;
  }
  async function voGet(text, ctx) {
    const k = text + '|' + (ctx.prev || '') + '|' + (ctx.next || '');
    if (VO.buf.has(k)) return { audio: VO.buf.get(k) };
    if (!ctx.prev && !ctx.next && VO.buf.has(text)) return { audio: VO.buf.get(text) };
    let r = await voFetch(text, ctx);
    if (!r || !r.audio) r = await voFetch(text, ctx);   /* сеть моргнула — вторая попытка */
    if (r && r.audio) { VO.buf.set(k, r.audio); if (VO.buf.size > 60) VO.buf.delete(VO.buf.keys().next().value); }
    return r;
  }
  async function premium(cur) {
    const c = voCtx(); if (!c) return false;
    if (c.state === 'suspended') { try { await c.resume(); } catch (e) {} if (c.state !== 'running') return false; }
    const parts = splitParts(spokenRu(cur.text));
    const reqs = parts.map((p, i) => voGet(p, parts.length > 1 ? { prev: parts[i - 1] || '', next: parts[i + 1] || '' } : {}));   /* все части сразу, параллельно */
    let at = 0, played = 0, lastSrc = null;
    for (let i = 0; i < parts.length; i++) {
      const r = await reqs[i];
      if (TTS.cur !== cur) return true;   /* пока ждали — речь сменилась: это не ошибка голоса */
      if (!r || !r.audio) {
        if (!played) { VO.off = now() + (r && r.error && r.error !== 'net' ? 600 : 20); TTS.lastErr = (r && r.error) || 'net'; return false; }   /* лимит или настройки — 10 минут голос телефона; сеть — 20 секунд */
        continue;
      }
      let audio; try { audio = await c.decodeAudioData(r.audio.slice(0)); } catch (e) { if (!played) { VO.off = now() + 600; TTS.lastErr = 'decode'; return false; } continue; }
      if (TTS.cur !== cur) return true;
      if (!played) { at = c.currentTime + 0.03; chime(at); at += 0.22; TTS.engine = 'premium'; if (cur.cap) cur.cap(); }
      const src = c.createBufferSource(); src.buffer = audio; src.connect(VO.inp);
      const st = Math.max(at, c.currentTime + 0.01);
      src.onended = () => { if (VO.src === src) VO.src = null; };
      src.start(st); VO.src = src; VO.srcs = (VO.srcs || []).concat(src); lastSrc = src;
      at = st + audio.duration + 0.06; played++;
      clearTimeout(TTS.guard); TTS.guard = setTimeout(() => finish(cur), (at - c.currentTime + (i === parts.length - 1 ? 1.5 : 12)) * 1000);
    }
    if (!played) return false;
    lastSrc.onended = () => { if (VO.src === lastSrc) VO.src = null; if (TTS.cur === cur) finish(cur); };   /* договорил последнюю часть */
    clearTimeout(TTS.guard); TTS.guard = setTimeout(() => finish(cur), (at - c.currentTime + 1.5) * 1000);
    return true;
  }
  /* ---------- текст для живого голоса: все числа — словами (ElevenLabs путает русские цифры) ----------
     «$950» → «девятьсот пятьдесят долларов», «−12,7%» → «минус двенадцать целых семь десятых процента»,
     «110 тысяч» → «сто десять тысяч», «0,0123 BTC» → «ноль целых двенадцать тысячных биткоина». Субтитры остаются цифрами. */
  const W1 = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const W10 = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const W100 = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  /* родительный падеж: «до семидесяти четырёх тысяч», «около двух процентов» */
  const GEN = { ноль: 'нуля', один: 'одного', одна: 'одной', два: 'двух', две: 'двух', три: 'трёх', четыре: 'четырёх', сорок: 'сорока', девяносто: 'девяноста', сто: 'ста',
    пятьдесят: 'пятидесяти', шестьдесят: 'шестидесяти', семьдесят: 'семидесяти', восемьдесят: 'восьмидесяти', двести: 'двухсот', триста: 'трёхсот', четыреста: 'четырёхсот',
    пятьсот: 'пятисот', шестьсот: 'шестисот', семьсот: 'семисот', восемьсот: 'восьмисот', девятьсот: 'девятисот', восемь: 'восьми' };
  const genW = w => GEN[w] || w.replace(/ь$/, 'и');
  const DAT = { ноль: 'нулю', один: 'одному', одна: 'одной', два: 'двум', две: 'двум', три: 'трём', четыре: 'четырём', двести: 'двумстам', триста: 'трёмстам', четыреста: 'четырёмстам',
    пятьсот: 'пятистам', шестьсот: 'шестистам', семьсот: 'семистам', восемьсот: 'восьмистам', девятьсот: 'девятистам' };
  const datW = w => DAT[w] || genW(w);   /* дательный: «к семидесяти шести тысячам» — у остальных числительных совпадает с родительным */
  const one = n => n % 10 === 1 && n % 100 !== 11;
  function tri(n, fem, gen) {
    const o = []; const h = Math.floor(n / 100), r = n % 100;
    if (h) o.push(W100[h]);
    if (r >= 20) { o.push(W10[Math.floor(r / 10)]); if (r % 10) o.push(W1[r % 10]); } else if (r || !h) o.push(W1[r]);
    if (fem) { const k = o.length - 1; if (o[k] === 'один') o[k] = 'одна'; else if (o[k] === 'два') o[k] = 'две'; }
    return (gen === 'd' ? o.map(datW) : gen ? o.map(genW) : o).join(' ');
  }
  const SCALE = { K: ['тысяча', 'тысячи', 'тысяч', 'тысячи', 'тысяч', true, 'тысяче', 'тысячам'], M: ['миллион', 'миллиона', 'миллионов', 'миллиона', 'миллионов', false, 'миллиону', 'миллионам'], B: ['миллиард', 'миллиарда', 'миллиардов', 'миллиарда', 'миллиардов', false, 'миллиарду', 'миллиардам'], T: ['триллион', 'триллиона', 'триллионов', 'триллиона', 'триллионов', false, 'триллиону', 'триллионам'] };
  const scaleW = (k, sc, gen) => gen === 'd' ? (one(k) ? sc[6] : sc[7]) : gen ? (one(k) ? sc[3] : sc[4]) : plural(k, sc[0], sc[1], sc[2]);
  function intW(n, fem, gen) {
    n = Math.floor(Math.abs(n)); if (!n) return gen === 'd' ? 'нулю' : gen ? 'нуля' : 'ноль';
    const parts = [];
    for (const [d, sc] of [[1e9, SCALE.B], [1e6, SCALE.M], [1e3, SCALE.K]]) { const k = Math.floor(n / d) % 1000; if (k) parts.push(tri(k, sc[5], gen) + ' ' + scaleW(k, sc, gen)); }
    const r = n % 1000; if (r) parts.push(tri(r, fem, gen));
    return parts.join(' ');
  }
  const FEM = /^(тысяч|гривн|ступен|монет|недел|минут|секунд|покупк|сделк|позици|цел|част|сотн)/i;
  /* число словами: целое или дробь («две целых три десятых»), в именительном или родительном падеже */
  function numW(intS, fracS, fem, gen) {
    const n = +intS;
    fracS = (fracS || '').slice(0, 3).replace(/0+$/, '');
    if (!fracS) return intW(n, fem, gen);
    const f = +fracS, den = [null, ['десятая', 'десятых', 'десятой'], ['сотая', 'сотых', 'сотой'], ['тысячная', 'тысячных', 'тысячной']][fracS.length];
    const cel = gen === 'd' ? (one(n) ? 'целой' : 'целым') : gen ? (one(n) ? 'целой' : 'целых') : plural(n, 'целая', 'целых', 'целых');
    return intW(n, true, gen) + ' ' + cel + ' ' + intW(f, true, gen) + ' ' + (one(f) ? (gen ? den[2] : den[0]) : gen === 'd' ? den[1].replace(/х$/, 'м') : den[1]);
  }
  const PREP_GEN = /(?:^|\s)(до|от|около|более|менее|свыше|после|из|без|для|против|кроме|у|ниже|выше|порядка|с|со|вместо|дороже|дешевле|больше|меньше)\s*$/i;
  const PREP_DAT = /(?:^|\s)(к|ко|благодаря|согласно|вопреки)\s*$/i;
  const UNITS = { '$': ['доллар', 'доллара', 'долларов', 'доллару', 'долларам'], '₴': ['гривна', 'гривны', 'гривен', 'гривне', 'гривнам'], '%': ['процент', 'процента', 'процентов', 'проценту', 'процентам'] };
  /* произношение: бренды, биржи и аббревиатуры — как их говорят по-русски («OKX» — «о-кей-икс», «ETF» — «и-ти-эф») */
  const SAY = [
    [/\bBTC\b/g, 'биткоина'], [/\bETH\b/g, 'эфира'], [/\bUSDT\b/g, 'тезер'], [/\bUSDC\b/g, 'ю-эс-ди-си'],
    [/\bOKX\b/g, 'о-кей-икс'], [/(^|[^А-ЯЁа-яёA-Za-z])(ОКХ|ОКX|OКХ)(?![А-ЯЁа-яёA-Za-z])/g, '$1о-кей-икс'], [/\bETFs?\b/g, 'и-ти-эф'], [/(^|[^А-ЯЁа-яё])ЕТФ(?![А-ЯЁа-яё])/g, '$1и-ти-эф'], [/\bSEC\b/g, 'эс-и-си'], [/\bNFT\b/g, 'эн-эф-ти'], [/\bDeFi\b/gi, 'дефай'], [/\bAI\b/g, 'эй-ай'],
    [/\bCEO\b/g, 'си-и-оу'], [/\bIPO\b/g, 'ай-пи-оу'], [/\bUSA\b/g, 'ю-эс-эй'], [/\bS&P\s?500\b/g, 'эс-энд-пи пятьсот'], [/\bFed\b/g, 'ФРС'], [/\bFOMC\b/g, 'эф-оу-эм-си'],
    [/\bBinance\b/gi, 'Бинанс'], [/\bCoinbase\b/gi, 'Койнбейс'], [/\bBybit\b/gi, 'Байбит'], [/\bKraken\b/gi, 'Кракен'], [/\bBlackRock\b/gi, 'Блэкрок'], [/\bFidelity\b/gi, 'Фиделити'],
    [/\bGrayscale\b/gi, 'Грейскейл'], [/\b(Micro)?Strategy\b/g, 'Майкростратеджи'], [/\bTether\b/gi, 'Тезер'], [/\bCircle\b/g, 'Сёркл'], [/\bRipple\b/gi, 'Рипл'], [/\bSolana\b/gi, 'Солана'],
    [/\bEthereum\b/gi, 'Эфириум'], [/\bBitcoin\b/gi, 'биткоин'], [/\bCointelegraph\b/gi, 'Коинтелеграф'], [/\bCoinDesk\b/gi, 'Коиндеск'], [/\bForkLog\b/gi, 'Форклог'], [/\bDecrypt\b/g, 'Декрипт'],
    [/\bIncrypted\b/gi, 'Инкриптед'], [/\bNasdaq\b/gi, 'Насдак'], [/\bTrump\b/g, 'Трамп'], [/\bPowell\b/g, 'Пауэлл'], [/\bSaylor\b/g, 'Сейлор'], [/\bMetaMask\b/gi, 'Метамаск'], [/\bLedger\b/g, 'Леджер'],
    [/\bTrezor\b/g, 'Трезор'], [/\bBNB\b/g, 'би-эн-би'], [/\bXRP\b/g, 'икс-ар-пи'], [/\bSOL\b/g, 'солана'], [/\bTON\b/g, 'тон'], [/\bDOGE\b/g, 'доги'], [/\bADA\b/g, 'кардано'], [/\bTRX\b/g, 'трон'],
    [/\bLTC\b/g, 'лайткоин'], [/\bLINK\b/g, 'чейнлинк'], [/\bAVAX\b/g, 'аваланч'], [/\bDCA\b/g, 'ди-си-эй'],
    [/(^|[^А-ЯЁа-яё])ФРС(?![А-ЯЁа-яё])/g, '$1эф-эр-эс'], [/(^|[^А-ЯЁа-яё])США(?![А-ЯЁа-яё])/g, '$1сэ-шэ-а'], [/(^|[^А-ЯЁа-яё])ЕС(?![А-ЯЁа-яё])/g, '$1е-эс'],
    [/(^|[^А-ЯЁа-яё])МВФ(?![А-ЯЁа-яё])/g, '$1эм-вэ-эф'], [/(^|[^А-ЯЁа-яё])НБУ(?![А-ЯЁа-яё])/g, '$1эн-бэ-у'], [/(^|[^А-ЯЁа-яё])ВВП(?![А-ЯЁа-яё])/g, '$1вэ-вэ-пэ'], [/(^|[^А-ЯЁа-яё])ЦБ(?![А-ЯЁа-яё])/g, '$1цэ-бэ']
  ];
  const EN = { A: 'эй', B: 'би', C: 'си', D: 'ди', E: 'и', F: 'эф', G: 'джи', H: 'эйч', I: 'ай', J: 'джей', K: 'кей', L: 'эл', M: 'эм', N: 'эн', O: 'оу', P: 'пи', Q: 'кью', R: 'ар', S: 'эс', T: 'ти', U: 'ю', V: 'ви', W: 'дабл-ю', X: 'икс', Y: 'уай', Z: 'зед' };
  function pronounce(s) {
    for (const [re, to] of SAY) s = s.replace(re, to);
    return s.replace(/\b[A-Z]{2,5}\b/g, w => w.split('').map(ch => EN[ch]).join('-'));   /* прочие латинские аббревиатуры — по буквам */
  }
  function spokenRu(t) {
    let s = pronounce(String(t || '')).replace(/[   ]/g, ' ').replace(/[«»]/g, '').replace(/\s*—\s*/g, ' — ');   /* тире оставляем: живой голос сам делает естественную паузу */
    s = s.replace(/(\d)\s(?=\d{3}(?!\d))/g, '$1');   /* «110 000» → «110000» */
    s = s.replace(/\bBTC\b/g, 'биткоина').replace(/\bETH\b/g, 'эфира').replace(/\bUSDT\b/g, 'тезер');
    s = s.replace(/×\s?(\d)/g, 'в $1').replace(/(\d)\s?×/g, '$1 раз');
    const RE = /(^|[\s(:])([−\-+]?)(\$)?(\d+)(?:[.,](\d+))?(?:\s?(тыс\.?|тысяч[аи]?|млн\.?|миллион(?:а|ов)?|млрд\.?|миллиард(?:а|ов)?|трлн\.?|триллион(?:а|ов)?)(?![А-Яа-яЁё]))?(\s?(%|₴|\$|долл\.|доллар(?:а|ов)?|грн\.?|гривн[аы]?|гривен)(?![А-Яа-яЁё]))?(?=(\s*)([А-Яа-яЁё]*))/g;
    s = s.replace(RE, (m, pre, sg, d1, ip, fp, mult, _u, u, _sp, next, off, all) => {
      const before = all.slice(0, off) + pre, gen = PREP_DAT.test(before) ? 'd' : PREP_GEN.test(before);
      let unit = u ? (/^(\$|долл)/.test(u) ? '$' : /^(₴|грн|грив)/.test(u) ? '₴' : '%') : (d1 ? '$' : '');
      const sc = mult ? (/^тыс/.test(mult) ? SCALE.K : /^(млн|миллион)/.test(mult) ? SCALE.M : /^(трлн|триллион)/.test(mult) ? SCALE.T : SCALE.B) : null;
      const n = +ip, frac = !!(fp && +fp.slice(0, 3));
      const fem = sc ? sc[5] : unit ? unit === '₴' : FEM.test(next || '');
      let w = numW(ip, fp, fem, gen);
      if (sc) w += ' ' + (frac ? (gen ? sc[3] : sc[1]) : scaleW(n, sc, gen));
      if (unit) { const U = UNITS[unit]; w += ' ' + (sc || (n >= 1000 && n % 1000 === 0) ? U[2] : frac ? U[1] : gen === 'd' ? (one(n) ? U[3] : U[4]) : gen ? (one(n) ? U[1] : U[2]) : plural(n, U[0], U[1], U[2])); }
      const sign = sg === '+' ? 'плюс ' : sg ? 'минус ' : '';
      const ate = /\.$/.test(mult && !u ? mult : u || ''), rest = all.slice(off + m.length);   /* «тыс.», «грн.» в конце предложения — точку возвращаем */
      return pre + sign + w + (ate && (!rest.trim() || /^\s+[А-ЯЁA-Z]/.test(rest)) ? '.' : '');
    });
    return s.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  }
  async function voFetch(text, ctx) { try { return await A.voice(text, ctx || {}); } catch (e) { return null; } }
  /* короткие фразы-«подхваты» заранее в памяти телефона — Орион отзывается сразу, пока думает над ответом */
  const FILL = { news: 'Секунду, смотрю новости.', think: 'Секунду.' };
  let preloaded = false;
  function preloadFill() {
    if (preloaded || !A.voice || !ST.sound || (navigator.webdriver && !ST.forcePremium)) return; preloaded = true;
    Object.values(FILL).forEach((t, i) => setTimeout(async () => { const k = spokenRu(t); if (VO.buf.has(k)) return; const r = await voFetch(k); if (r && r.audio) VO.buf.set(k, r.audio); }, 1500 + i * 700));
  }
  function voLevel() {
    if (!VO.src || !VO.an) return null;
    VO.an.getByteTimeDomainData(VO.data); let sum = 0;
    for (let i = 0; i < VO.data.length; i++) { const v = (VO.data[i] - 128) / 128; sum += v * v; }
    return clamp(Math.sqrt(sum / VO.data.length) * 5.5, 0, 1);
  }
  function talkLevel() {
    if (!TTS.cur) return 0;
    const lv = voLevel(); if (lv != null) return clamp(0.22 + lv * 0.85, 0, 1);
    const t = now(), k = Math.exp(-(t - TTS.beat) * 4.5);
    return clamp(0.32 + 0.55 * k + 0.12 * Math.sin(t * 11), 0, 1);
  }

  /* ---------- слова: числа, деньги, проценты ---------- */
  const plural = (n, a, b, c) => { n = Math.abs(Math.round(n)) % 100; const m = n % 10; return n > 10 && n < 20 ? c : m === 1 ? a : m >= 2 && m <= 4 ? b : c; };
  const nm = () => (ST.name ? ', ' + ST.name : '');
  const Nm = () => (ST.name ? ST.name + ', ' : '');
  const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
  function pctW(p) { const r = Math.round(Math.abs(p)); return r < 1 ? 'меньше процента' : r + ' ' + plural(r, 'процент', 'процента', 'процентов'); }
  const signW = p => (p >= 0 ? 'плюс' : 'минус');
  /* сумма словами в валюте приложения: «950 долларов», «110 тысяч долларов», «39 тысяч гривен» */
  function moneyW(usdV) {
    let s = ''; try { if (ST.money) s = ST.money(Math.abs(usdV), { d: 0, show: true }) || ''; } catch (e) {}
    const uah = /₴|грн/i.test(s), n = +(s.replace(/[^\d]/g, '')) || Math.round(Math.abs(usdV));
    const cur = k => (uah ? plural(k, 'гривна', 'гривны', 'гривен') : plural(k, 'доллар', 'доллара', 'долларов'));
    const gen = uah ? 'гривен' : 'долларов';
    if (n >= 1e6) { const m = Math.round(n / 1e5) / 10; return String(m).replace('.', ',') + ' ' + (m % 1 ? 'миллиона' : plural(m, 'миллион', 'миллиона', 'миллионов')) + ' ' + gen; }
    if (n >= 10000) { const k = Math.round(n / 1000); return k + ' ' + plural(k, 'тысяча', 'тысячи', 'тысяч') + ' ' + gen; }
    return n + ' ' + cur(n);
  }
  const ORD = ['', 'первой', 'второй', 'третьей', 'четвёртой', 'пятой', 'шестой', 'седьмой', 'восьмой', 'девятой', 'десятой'];
  const plain = h => String(h || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

  /* ---------- сводка: «Доброе утро, Андрей. Портфель — …» ---------- */
  function brief() {
    const S = ST.S, D = ST.D; if (!S || !D) return '';
    const h = new Date().getHours(), out = [];
    out.push((h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер') + nm() + '.');
    const lv = S.live || {}, btc = +(lv.prices && lv.prices.BTC) || +(D.prices && D.prices.BTC) || 0, ch = lv.change ? lv.change.BTC : null;
    if (D.total > 0 && !D.noPrice) {
      const inv = +D.invPriced || 0, gp = inv > 0 ? (D.total - inv) / inv * 100 : null;
      if (ST.hide) { if (gp != null) out.push('Суммы скрыты, поэтому только проценты: портфель ' + (gp >= 0 ? 'в плюсе' : 'в минусе') + ' на ' + pctW(gp) + '.'); }
      else out.push('Портфель — ' + moneyW(D.total) + (gp != null ? ', ' + signW(gp) + ' ' + pctW(gp) + ' к вложенному.' : '.'));
    } else if (!(S.tx || []).length) out.push('Портфель пока пуст. Начнём с первой покупки — кнопка «Купить».');
    if (btc > 0) out.push('Биткоин — ' + moneyW(btc) + (ch != null && isFinite(ch) ? (Math.abs(ch) < 0.5 ? ', за сутки почти без изменений.' : ', за сутки ' + signW(ch) + ' ' + pctW(ch) + '.') : '.'));
    const ath = +(S.cycle && S.cycle.ath) || 0;
    if (ST.go) out.push('Биткоин на ступени лестницы — по плану можно докупать. Решение за вами.');
    else if (ath > 0 && btc > 0) {
      const l = ((S.cycle && S.cycle.levels) || []).filter(x => x && x.status === 'pending' && x.drop > 0).sort((a, b) => a.n - b.n)[0];
      if (btc >= ath * 0.995) out.push('Это исторический максимум.');
      else if (l) { const tg = ath * (1 - l.drop / 100), dist = (1 - tg / btc) * 100; if (dist > 0.5) out.push('До ' + (ORD[l.n] || l.n + '-й') + ' ступени лестницы — ' + pctW(dist) + '.'); }
    }
    const dd = +(S.settings && S.settings.depositDay) || 0, td = new Date();
    if (dd && td.getDate() === dd && !(S.tx || []).some(t => t && t.type === 'deposit' && String(t.ts || '').slice(0, 10) === td.toISOString().slice(0, 10))) out.push('Сегодня день пополнения биржи.');
    if (ST.fresh > 0) out.push('Есть непрочитанный сигнал — он на главной.');
    try { const f = window.MLX && window.MLX.fng && window.MLX.fng(); if (f) out.push('Индекс страха и жадности — ' + f.v + ', ' + f.w + '.'); } catch (e) {}
    out.push(ch != null && Math.abs(ch) < 1 ? 'Рынок спокоен. Скучно — значит, всё по плану.' : pick(['На этом всё.', 'Если понадоблюсь — я рядом.', 'Остальное — штатно.']));
    return out.join(' ');
  }
  function tell(auto) {
    const t = brief(); if (!t) return;
    lsSet('ms-news', Date.now()); lsSet('ms-newsDay', dayKey());
    speak(t, { pri: auto ? 1 : 2 });
  }
  function newsDue() {
    if (!AUTO || isNight() || ST.hide || !ST.sound || !ST.S) return false;
    return lsGet('ms-newsDay', '') !== dayKey();   /* сам — один раз в день, после первого касания */
  }


  /* ---------- вопросы голосом: зажать сферу и спросить ---------- */
  const SRC = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  /* как люди называют монеты вслух — для распознавания (дальше ищем и сам тикер латиницей) */
  const ALIAS = {
    BTC: ['биткоин', 'биткойн', 'биток', 'битк', 'btc', 'бтс', 'бтц'], ETH: ['эфир', 'эфириум', 'этериум', 'ethereum', 'eth'], SOL: ['солан', 'sol', 'солы'],
    XRP: ['рипл', 'xrp', 'иксэрпи'], DOGE: ['доги', 'доге', 'догикоин', 'dogecoin', 'doge'], TON: ['тонкоин', 'toncoin'], ADA: ['кардано', 'ada'],
    BNB: ['бнб', 'bnb'], TRX: ['трон', 'tron', 'trx'], LINK: ['чейнлинк', 'link'], DOT: ['полкадот', 'polkadot'], AVAX: ['аваланч', 'avalanche', 'avax'],
    SUI: ['суи', 'sui'], NEAR: ['near'], LTC: ['лайткоин', 'litecoin', 'ltc'], PEPE: ['пепе', 'pepe'], SHIB: ['шиба', 'шиб', 'shib'], USDT: ['тезер', 'usdt']
  };
  const NAME_G = { BTC: 'биткоина', ETH: 'эфира', SOL: 'соланы', XRP: 'рипла', DOGE: 'доги', TON: 'тона', ADA: 'кардано' };
  const NAME_N = { BTC: 'Биткоин', ETH: 'Эфир', SOL: 'Солана', XRP: 'Рипл', DOGE: 'Доги', TON: 'Тон', ADA: 'Кардано' };
  const norm = q => String(q || '').toLowerCase().replace(/ё/g, 'е');
  function coinIn(q) {
    const w = norm(q).split(/[^a-zа-я0-9]+/).filter(Boolean), D = ST.D || {};
    const syms = Object.keys(ALIAS).concat((D.syms || []).filter(s => !ALIAS[s]));
    for (const s of syms) {
      const al = (ALIAS[s] || []).concat([s.toLowerCase()]);
      if (w.some(x => al.some(a => (a.length >= 4 ? x.startsWith(a) : x === a)))) return s;
    }
    return null;
  }
  /* число из фразы: «150», «110 000», «150 тысяч», «1,5 тысячи», «120к» */
  function numIn(q) {
    const m = norm(q).replace(/(\d)\s+(?=\d{3}\b)/g, '$1').match(/(\d+(?:[.,]\d+)?)\s*(тысяч\S*|тыс\S*|к\b|k\b|миллион\S*|млн)?/);
    if (!m) return null;
    let v = parseFloat(m[1].replace(',', '.')); if (!isFinite(v)) return null;
    if (m[2]) v *= /милл|млн/.test(m[2]) ? 1e6 : 1e3;
    return v;
  }
  const qtyW = v => (+v).toLocaleString('ru-RU', { maximumFractionDigits: v >= 100 ? 0 : v >= 1 ? 3 : 6 });
  function coinPrice(sym) { const S = ST.S || {}, D = ST.D || {}, lv = S.live || {}; return +(lv.prices && lv.prices[sym]) || +(D.prices && D.prices[sym]) || 0; }
  function priceW(v) { return v >= 10 ? moneyW(v) : (v >= 1 ? String(+v.toFixed(2)).replace('.', ',') : String(+v.toPrecision(3)).replace('.', ',')) + ' доллара'; }
  function reply(q) {
    const t = norm(q), S = ST.S || {}, D = ST.D || {}, M = window.MLX || {};
    const has = (...k) => k.some(x => t.indexOf(x) >= 0);
    if (!t.trim()) return 'Не расслышал. Зажмите меня и спросите ещё раз.';
    const sym = coinIn(t), num = numIn(t);
    /* оповещение: «сообщи, когда солана будет 150» */
    if (has('сообщи', 'скажи когда', 'скажи, когда', 'оповест', 'напомни', 'предупреди', 'дай знать') && (has('когда', 'если') || num)) {
      if (!sym) return 'Какая монета? Скажите, например: «сообщи, когда солана будет 150».';
      if (!(num > 0)) return 'Какую цену ждать? Скажите, например: «сообщи, когда ' + (NAME_N[sym] || sym).toLowerCase() + ' будет ' + Math.round((coinPrice(sym) || 100) * 1.1) + '».';
      const a = A.addAlert ? A.addAlert(sym, num) : null;
      if (!a) return 'Цена ' + sym + ' уже на этой отметке.';
      return 'Готово. Скажу, когда ' + (NAME_N[sym] ? NAME_N[sym].toLowerCase() : sym) + ' ' + (a.dir === 'up' ? 'поднимется' : 'опустится') + ' до ' + priceW(num) + '.';
    }
    if (has('недел')) {
      const w = M.week ? M.week(D) : null; if (!w) return 'Итог недели пока не готов.';
      const o = ['За неделю' + nm() + ':'];
      o.push(w.buys ? 'покупок — ' + w.buys + ', на ' + moneyW(w.spent) + '.' : 'покупок не было.');
      if (w.chPct != null && !ST.hide) o.push('Портфель без учёта новых денег — ' + signW(w.chPct) + ' ' + pctW(w.chPct) + '.');
      if (w.chBtc != null) o.push('Биткоин за неделю — ' + signW(w.chBtc) + ' ' + pctW(w.chBtc) + '.');
      const sk = M.streak ? M.streak() : null; if (sk && sk.n >= 2) o.push('Серия покупок — ' + sk.n + ' ' + plural(sk.n, 'месяц', 'месяца', 'месяцев') + ' подряд.');
      return o.join(' ');
    }
    if (has('сери', 'подряд', 'дисциплин')) {
      const sk = M.streak ? M.streak() : null; if (!sk || !sk.n) return 'Серии пока нет. Она начнётся с первой покупки в месяце.';
      return 'Серия — ' + sk.n + ' ' + plural(sk.n, 'месяц', 'месяца', 'месяцев') + ' подряд с покупками.' + (sk.thisMonth ? ' В этом месяце покупка уже есть.' : ' В этом месяце покупки ещё нет — серия продолжится с первой.');
    }
    if (sym && has('у меня', 'мои', 'мой', 'моих', 'моего', 'сколько у', 'есть ли')) {
      const h = D.h && D.h[sym], qn = h ? +h.qty || 0 : 0;
      if (!(qn > 0)) return (NAME_G[sym] ? cap1(NAME_G[sym]) : sym) + ' в портфеле нет.';
      const p = coinPrice(sym), v = qn * p;
      if (ST.hide) return 'У вас ' + qtyW(qn) + ' ' + (NAME_G[sym] || sym) + '. Суммы скрыты.';
      return 'У вас ' + qtyW(qn) + ' ' + (NAME_G[sym] || sym) + (p ? ' — это ' + moneyW(v) + '.' : '. Цены сейчас нет.');
    }
    if (sym && sym !== 'USDT') {
      const p = coinPrice(sym), ch = S.live && S.live.change ? S.live.change[sym] : null;
      if (!p) return 'Цены ' + sym + ' сейчас нет.';
      return (NAME_N[sym] || sym) + ' — ' + priceW(p) + (ch != null && isFinite(ch) ? (Math.abs(ch) < 0.5 ? ', за сутки почти без изменений.' : ', за сутки ' + signW(ch) + ' ' + pctW(ch) + '.') : '.');
    }
    if (has('лестниц', 'ступен', 'докуп', 'просадк')) {
      if (ST.go) return 'Биткоин на ступени лестницы — по плану можно докупать. Суммы по монетам — во вкладке «Стратегия». Решение за вами.';
      const ath = +(S.cycle && S.cycle.ath) || 0, btc = coinPrice('BTC');
      const l = ((S.cycle && S.cycle.levels) || []).filter(x => x && x.status === 'pending' && x.drop > 0).sort((a, b) => a.n - b.n)[0];
      if (!ath || !btc || !l) return 'Лестница пока не построена — она появится, когда загрузится максимум биткоина.';
      const tg = ath * (1 - l.drop / 100), dist = (1 - tg / btc) * 100;
      return 'До ' + (ORD[l.n] || l.n + '-й') + ' ступени — ' + pctW(Math.max(0, dist)) + ': биткоин должен опуститься до ' + moneyW(tg) + '.';
    }
    if (has('резерв')) return D.reserve > 0 ? (ST.hide ? 'Резерв есть, суммы скрыты.' : 'Резерв — ' + moneyW(D.reserve) + '. Он ждёт ступеней лестницы.') : 'Резерва пока нет.';
    if (has('план', 'бюджет', 'dca', 'дса', 'месяц')) {
      const mi = M.monthInfo ? M.monthInfo(D) : null; if (!mi) return 'План месяца пока не посчитан.';
      if (mi.hasDep) return mi.dca > 0.5 ? 'По плану этого месяца осталось купить на ' + moneyW(mi.dca) + '.' : 'План покупок этого месяца выполнен.';
      if (mi.budget > 0) return mi.bought >= mi.budget * 0.98 ? 'План месяца выполнен: куплено на ' + moneyW(mi.bought) + '.' : 'В этом месяце куплено на ' + moneyW(mi.bought) + ' из ' + moneyW(mi.budget) + '.';
      return 'Бюджет на месяц не задан — его можно указать в настройках.';
    }
    if (has('страх', 'жадн', 'настроени')) { const f = M.fng ? M.fng() : null; return f ? 'Индекс страха и жадности — ' + f.v + ' из 100: ' + f.w + '.' : 'Индекс страха и жадности сейчас не загружен.'; }
    if (has('портфел', 'баланс', 'всего', 'денег', 'сколько у меня', 'итог')) {
      if (!(D.total > 0)) return 'Портфель пока пуст.';
      const inv = +D.invPriced || 0, gp = inv > 0 ? (D.total - inv) / inv * 100 : null;
      if (ST.hide) return gp != null ? 'Суммы скрыты. Портфель ' + (gp >= 0 ? 'в плюсе' : 'в минусе') + ' на ' + pctW(gp) + '.' : 'Суммы скрыты.';
      return 'Портфель — ' + moneyW(D.total) + (gp != null ? ', ' + signW(gp) + ' ' + pctW(gp) + ' к вложенному.' : '.');
    }
    if (has('спасибо', 'благодар')) return pick(['Всегда к вашим услугам.', 'Обращайтесь' + nm() + '.']);
    if (has('кто ты', 'что ты умеешь', 'что умеешь', 'помощ', 'помоги')) return 'Я Орион. Могу рассказать сводку за день, итог недели, цену любой монеты и сколько её у вас, почему рынок растёт или падает по свежим новостям, что с лестницей и резервом, и поставить оповещение: «сообщи, когда солана будет 150».';
    if (has('сводк', 'главн', 'нового', 'новост', 'как дела', 'что там', 'доклад', 'привет')) return brief();
    return UNK + ' Спросите, например: «сколько у меня биткоина», «что с лестницей» или «как прошла неделя».';
  }
  /* ---------- «мозг»: вопросы, на которые нет точного ответа на телефоне, — серверной функции orion-ask (Claude + новости + цены) ----------
     Телефон отвечает сам на то, что знает точно: сколько монет, итог, лестница, резерв, план, неделя, серия, оповещения.
     Остальное — «мозгу». Ему уходит вопрос, начало разговора и портфель только долями в % (без сумм, имени и почты). */
  const UNK = 'Пока не понял вопрос.';
  function marketQ(t) {
    const has = (...k) => k.some(x => t.indexOf(x) >= 0);
    return has('почему', 'из-за чего', 'отчего', 'причин', 'новост', 'рынок', 'рынк', 'что происходит', 'что случилось', 'что с крипт', 'растёт', 'растет', 'рост', 'падает', 'падени', 'упал', 'вырос', 'обвал', 'памп', 'дамп', 'хайп', 'стоит ли', 'что думаешь', 'объясни', 'расскажи про', 'что такое', 'как работает', 'зачем', 'а если', 'а что');
  }
  /* портфель долями: монеты в %, итог к вложенному в %, резерв в %, следующая ступень, этап личного плана, индекс страха */
  function brainCtx() {
    const D = ST.D || {}, S = ST.S || {}, M = window.MLX || {}, c = {};
    try {
      const tot = +D.total || 0;
      if (tot > 0 && D.h) {
        const sh = {}; Object.keys(D.h).forEach(k => { const q = +(D.h[k] && D.h[k].qty) || 0, p = coinPrice(k); if (q > 0 && p > 0) { const v = Math.round(q * p / tot * 100); if (v >= 1) sh[k] = v; } });
        if (Object.keys(sh).length) c.shares = sh;
        const inv = +D.invPriced || 0; if (inv > 0) c.pnl = Math.round((tot - inv) / inv * 1000) / 10;
        if (D.reserve > 0) c.reserve = Math.round(D.reserve / (tot + D.reserve) * 100);
      }
      const ath = +(S.cycle && S.cycle.ath) || 0, btc = coinPrice('BTC');
      if (ath && btc) c.btcFromAth = Math.round((btc / ath - 1) * 1000) / 10;
      const l = ((S.cycle && S.cycle.levels) || []).filter(x => x && x.status === 'pending' && x.drop > 0).sort((a, b) => a.n - b.n)[0];
      if (l && ath && btc) c.nextStep = { n: l.n, dist: Math.max(0, Math.round((1 - ath * (1 - l.drop / 100) / btc) * 1000) / 10) };
      if (ST.go) c.onStep = true;
      const pl = M.planGet ? M.planGet() : null, R = pl && M.planResult ? M.planResult(pl) : null;
      if (R) { c.stage = R.stage + 1; c.cryptoCeil = R.ceil; }
      const f = M.fng ? M.fng() : null; if (f) c.fng = f.v;
    } catch (e) {}
    return c;
  }
  const ASK_ERR = { day_limit: 'На сегодня вопросы ко мне закончились. Завтра продолжим.', month_limit: 'Лимит вопросов на этот месяц исчерпан.' };
  async function answer(q, byVoice) {
    const t = norm(q), local = t.trim() ? reply(q) : reply('');
    const sure = local && local.indexOf(UNK) !== 0 && !/^Не расслышал/.test(local);
    const follow = ST.lastBrain && now() - ST.lastBrain < 120 && (/^\s*(а|и|ну|тогда|а\s+если)\b/.test(t) || t.trim().split(/\s+/).length <= 3) && !/(у меня|мои |мой |сколько у)/.test(t);   /* переспрос: «а эфир?», «а почему?» */
    const toBrain = A.ask && t.trim() && (marketQ(t) || !sure || follow);
    if (!toBrain) { remember(q, local); speak(local, { pri: 2, follow: byVoice }); return; }
    const sym = coinIn(t) || '';
    speak(sym || marketQ(t) ? FILL.news : FILL.think, { pri: 2 });
    const hist = (ST.hist || []).filter(x => now() - x.at < 900).slice(-6).map(x => ({ q: x.q, a: x.a }));
    let r = null; try { r = await A.ask(q, sym, { hist, ctx: brainCtx() }); } catch (e) { r = null; }
    ST.lastAsk = r;
    if (r && r.text) { ST.lastBrain = now(); remember(q, r.text); speak(r.text, { pri: 2, follow: byVoice }); return; }
    const msg = (r && ASK_ERR[r.error]) || (sure ? local : (sym && coinPrice(sym) ? reply(NAME_N[sym] || sym) + ' ' : '') + 'Сейчас не могу связаться с сервером — попробуйте чуть позже.');
    speak(msg, { pri: 2 });
  }
  function remember(q, a) { ST.hist = (ST.hist || []).filter(x => now() - x.at < 900).concat([{ q: String(q).slice(0, 200), a: String(a).slice(0, 400), at: now() }]).slice(-6); }
  function listen(lo) {
    lo = lo || {};
    stopVoice(); voUnlock(); preloadFill();
    if (!SRC) { speak('Голосовые вопросы на этом телефоне недоступны. Нажмите на меня — расскажу главное за сегодня.', { pri: 2 }); return; }
    if (ST.rec) { try { ST.rec.abort(); } catch (e) {} ST.rec = null; }
    let rec; try { rec = new SRC(); } catch (e) { speak('Микрофон сейчас недоступен.', { pri: 2 }); return; }
    rec.lang = 'ru-RU'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
    ST.rec = rec; let heard = '', done = false;
    if (ui.cap) { ui.capT.textContent = 'Слушаю…'; ui.cap.classList.add('on', 'talk', 'listen'); clearTimeout(ui.capOff); }
    pulse(1); buzz(12);
    let idle = 0;
    const quiet = () => { if (done) return; done = true; ST.rec = null; clearTimeout(idle); try { rec.abort(); } catch (e) {} if (ui.cap) ui.cap.classList.remove('listen', 'on', 'talk'); };   /* тишина — молча заканчиваем разговор */
    idle = setTimeout(() => { if (!heard) quiet(); }, lo.follow ? 2500 : 6000);   /* в разговоре 2,5 секунды тишины — Орион перестаёт слушать сам */
    const end = () => { if (done) return; clearTimeout(idle); done = true; ST.rec = null; if (ui.cap) ui.cap.classList.remove('listen'); try { rec.stop(); } catch (e) {} if (!heard && lo.follow) { if (ui.cap) ui.cap.classList.remove('on', 'talk'); return; } answer(heard, true); };
    rec.onresult = e => { heard = Array.from(e.results).map(r => r[0].transcript).join(' ').trim(); if (ui.capT && heard) ui.capT.textContent = '«' + heard + '»'; ST.lastHeard = heard; if (e.results[e.results.length - 1].isFinal) end(); else { clearTimeout(idle); idle = setTimeout(end, 1300); } };   /* договорили и замолчали — не ждём телефон, отвечаем через 1,3 секунды */
    rec.onerror = e => { if (done) return; clearTimeout(idle); done = true; ST.rec = null; if (ui.cap) ui.cap.classList.remove('listen');
      if (lo.follow && e.error !== 'not-allowed') { if (ui.cap) ui.cap.classList.remove('on', 'talk'); return; }   /* в разговоре тишина — просто заканчиваем */
      speak(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Нет доступа к микрофону. Разрешите его этому приложению в настройках телефона.' : e.error === 'network' ? 'Для распознавания речи нужен интернет.' : 'Не расслышал. Зажмите меня и спросите ещё раз.', { pri: 2 }); };
    rec.onend = () => { if (!done) end(); };
    try { rec.start(); } catch (e) { done = true; ST.rec = null; if (ui.cap) ui.cap.classList.remove('listen'); speak('Микрофон сейчас занят.', { pri: 2 }); }
  }

  /* ---------- нажатие на сферу ---------- */
  function tapped() {
    ST.lastInput = now(); pulse(0.8); buzz(8); voUnlock(); preloadFill();
    if (ST.rec) { try { ST.rec.abort(); } catch (e) {} ST.rec = null; if (ui.cap) ui.cap.classList.remove('listen', 'on'); return; }
    if (speaking()) { stopVoice(); return; }
    if (!ST.name && !ST.asked && A.askName) { ST.asked = true; lsSet('or-asked', 1); A.askName(); return; }
    tell(false);
  }
  function greet(name) {
    if (name != null) ST.name = String(name).trim().slice(0, 24);
    speak((ST.name ? 'Приятно познакомиться, ' + ST.name + '. ' : 'Хорошо. ') + 'Я Орион. Слежу за портфелем и рынком и скажу, когда будет важное. Нажмите на меня — расскажу главное за сегодня. А если зажать — можно спросить голосом.', { pri: 2 });
  }

  /* ---------- события ---------- */
  function trigger(name, data, force) {
    data = data || {};
    const D = ST.D || {}, S = ST.S || {};
    let t = '';
    if (name === 'deposit') { t = 'Пополнение записано' + nm() + '.'; buzz([10, 40, 10]); }
    else if (name === 'buy') t = ST.hide || !(D.total > 0) ? pick(['Покупка записана.', 'Покупка записана. План работает, когда его выполняют.']) : pick(['Покупка записана. Портфель — ' + moneyW(D.total) + '.', 'Записал. План работает, когда его выполняют.']);
    else if (name === 'sellProfit') t = 'Продажа записана — с прибылью. Зафиксировано, поздравляю' + nm() + '.';
    else if (name === 'sellLoss') t = 'Продажа записана. Убыток — тоже часть пути; главное, что по плану.';
    else if (name === 'airdrop') t = 'Монеты без затрат записаны. Приятный бонус.';
    else if (name === 'signal') {
      const a = (S.alerts || [])[0], x = a ? plain(a.text) : '';
      t = data.news && x ? Nm() + (Nm() ? 'н' : 'Н') + 'овый сигнал. ' + (x.length > 220 ? x.slice(0, 217) + '…' : x) : Nm() + (Nm() ? 'б' : 'Б') + 'иткоин на ступени лестницы — по плану можно докупать. Решение за вами.';
      buzz(20);
    }
    else if (name === 'ath') { t = data.port ? 'Портфель на собственном максимуме' + nm() + '. Отмечаю без фанфар.' : 'Новый исторический максимум биткоина' + (S.cycle && S.cycle.ath && !ST.hide ? ' — ' + moneyW(+S.cycle.ath) : '') + '. Лестница пересчитана. Эмоции оставим рынку.'; buzz([15, 50, 15]); }
    else if (name === 'milestone' && data.label) { const n = parseInt(data.label, 10) || 0; t = n >= 14 ? 'Все четырнадцать дней пройдены' + nm() + '. Дальше — по своему плану; я рядом.' : n + ' из 14 дней знакомства пройдены. Продолжаем.'; }
    else if (name === 'milestone') { t = ST.hide || !data.v ? 'Новый рубеж портфеля пройден' + nm() + '.' : 'Рубеж пройден: портфель больше ' + moneyW(data.v) + '.'; buzz([15, 50, 15]); }
    else if (name === 'coinMove') t = data.sym + ' за сутки ' + signW(data.ch) + ' ' + pctW(data.ch) + '. ' + (data.neg ? 'Решения — по плану, а не по эмоциям.' : 'Хороший день для этой монеты.');
    else if (name === 'screen') t = 'Свежий подбор альткоинов готов.';
    else if (name === 'priceAlert') { t = Nm() + (NAME_N[data.sym] || data.sym) + (data.dir === 'up' ? ' поднялся' : ' опустился') + ' до ' + priceW(+data.price) + ' — ваше оповещение сработало.'; t = cap1(t); buzz([20, 60, 20]); }
    else if (name === 'ach') t = pick(['Новое достижение' + nm() + ': ' + data.t + '.', 'Отмечаю достижение — «' + data.t + '». Так держать.']);
    else if (name === 'streak') t = 'Серия — ' + data.n + ' ' + plural(data.n, 'месяц', 'месяца', 'месяцев') + ' подряд с покупками' + nm() + '. Дисциплина — главный актив.';
    else if (name === 'd14') t = data && data.text ? String(data.text) : '';
    else return;
    if (t && (force || (AUTO && !isNight()))) speak(t, { pri: 1 });
    ST.lastEvent = now(); pulse(1);
  }
  /* смена настроения рынка — коротко, без болтовни о мелочах */
  function moodLine(m) {
    if (m === 'rocket') return 'Портфель за сутки ' + signW(ST.pct) + ' ' + pctW(ST.pct) + '. Красиво. План при этом не меняем.';
    if (m === 'crash') return 'Сильное снижение за сутки' + nm() + '. Для таких дней и нужна лестница.';
    if (m === 'hunter') return Nm() + (Nm() ? 'б' : 'Б') + 'иткоин на ступени лестницы — по плану можно докупать. Решение за вами.';
    if (m === 'offline') return 'Нет связи. Показываю последние известные цены.';
    return '';
  }
  function setSign() {}
  function buzz(p) { try { if (A.buzz) A.buzz(p); } catch (e) {} }
  function pulse(k) { ST.pulse = Math.max(ST.pulse, k || 1); ST.pulseT = now(); wake(); }

  /* ---------- цифры: перекатываются сразу ---------- */
  function number(p) {
    if (!p || !p.el || p.to == null) return;
    const el = p.el, cur = el._msTo != null ? el._msTo : el.textContent;
    if (cur === p.to) return;
    roll({ el, to: p.to, up: p.up !== false }, inited && !ST.hide && !ST.reduced && BL.ready && now() >= (BL.warm || 0));
  }

  /* ---------- настроение → цвет ---------- */
  const PAL = {
    calm: [[139, 125, 255], [86, 160, 255], [120, 230, 220]],
    pos: [[48, 209, 88], [120, 230, 170], [86, 200, 255]],
    warn: [[245, 181, 69], [255, 140, 90], [255, 220, 150]],
    neg: [[255, 91, 91], [255, 140, 110], [255, 196, 150]],
    off: [[150, 150, 162], [110, 110, 122], [190, 190, 202]]
  };
  const MOOD_PAL = { calm: 'calm', night: 'calm', sleep: 'calm', hide: 'calm', up: 'pos', rocket: 'pos', down: 'warn', hunter: 'warn', crash: 'neg', offline: 'off' };
  const cur = PAL.calm.map(c => c.slice());
  function resolveMood(t) {
    if (isNight() && t - Math.max(ST.lastInput, ST.lastEvent) > 60) return 'sleep';
    if (ST.offline && t - ST.offSince > 60) return 'offline';
    if (ST.go) return 'hunter';
    if (ST.hide) return 'hide';
    if (isNight()) return 'night';
    const p = ST.pct;
    if (p == null) return 'calm';
    if (p <= -7) return 'crash'; if (p <= -2) return 'down'; if (p >= 7) return 'rocket'; if (p >= 2) return 'up';
    return 'calm';
  }

  /* ---------- кадр ---------- */
  const rgb = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  function draw(t) {
    const w = W, cx = w / 2, cy = w / 2, L = ST.lvl, dim = ST.mood === 'sleep' ? 0.55 : ST.mood === 'offline' ? 0.75 : 1;
    const R = 29 * (1 + L * 0.1);
    g.clearRect(0, 0, w, w);
    const hr = Math.min(65, R * (1.75 + L * 0.5)), halo = g.createRadialGradient(cx, cy, R * 0.7, cx, cy, hr);
    halo.addColorStop(0, rgb(cur[0], (0.3 + L * 0.3) * dim)); halo.addColorStop(1, rgb(cur[0], 0)); g.fillStyle = halo; g.fillRect(0, 0, w, w);
    if (ST.pulse > 0.02) { const k = clamp((t - ST.pulseT) / 0.9, 0, 1); g.strokeStyle = rgb(cur[1], (1 - k) * 0.6 * ST.pulse); g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, R + k * 30, 0, TAU); g.stroke(); if (k >= 1) ST.pulse = 0; }
    /* речь: две тонкие дуги бегут вокруг сферы, как индикатор в шлеме */
    const sp = speaking() ? 1 : 0;
    if (sp || ST.arc > 0.02) {
      ST.arc = (ST.arc || 0) + ((sp ? 1 : 0) - (ST.arc || 0)) * 0.12;
      const a0 = t * 1.7, a1 = -t * 1.1;
      g.lineCap = 'round';
      g.strokeStyle = rgb(cur[1], 0.55 * ST.arc); g.lineWidth = 1.6; g.beginPath(); g.arc(cx, cy, R + 7 + L * 3, a0, a0 + 1.1 + L * 0.8); g.stroke();
      g.strokeStyle = rgb(cur[2], 0.4 * ST.arc); g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, R + 12 + L * 4, a1, a1 + 0.7 + L * 0.6); g.stroke();
    }
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip(); g.fillStyle = '#07070a'; g.fillRect(cx - R, cy - R, R * 2, R * 2); g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 5; k++) {
      const c = cur[k % 3], s = 0.5 + k * 0.17, ax = cx + Math.cos(t * s + k * 1.9) * R * (0.42 + L * 0.2), ay = cy + Math.sin(t * s * 1.3 + k * 2.4) * R * (0.42 + L * 0.2), rr = R * (0.75 + 0.25 * Math.sin(t * 0.8 + k) + L * 0.35);
      const b = g.createRadialGradient(ax, ay, 0, ax, ay, rr); b.addColorStop(0, rgb(c, 0.75 * dim)); b.addColorStop(1, rgb(c, 0)); g.fillStyle = b; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    }
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, R * (0.35 + L * 0.5)); core.addColorStop(0, 'rgba(255,255,255,' + (0.22 + L * 0.6) * dim + ')'); core.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = core; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.globalCompositeOperation = 'source-over';
    const edge = g.createRadialGradient(cx, cy, R * 0.72, cx, cy, R); edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,.55)'); g.fillStyle = edge; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    const hi = g.createRadialGradient(cx - R * 0.35, cy - R * 0.45, 0, cx - R * 0.35, cy - R * 0.45, R * 0.6); hi.addColorStop(0, 'rgba(255,255,255,.28)'); hi.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = hi; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    g.restore(); g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
  }
  function update(t) {
    const m = resolveMood(t);
    if (m !== ST.mood) {
      ST.mood = m; ST.moodSince = t;
      const line = moodLine(m);
      if (line && AUTO && t - ST.lastInput > 0.5 && BL.ready && !isNight()) setTimeout(() => { if (ST.mood === m && !speaking()) speak(line, { pri: 1 }); }, 1500);
    }
    if ((ST.go || ST.fresh > 0) && t > ST.nextSignal && m !== 'sleep' && BL.ready) { ST.nextSignal = t + 30; pulse(0.7); }
    ST.talk = talkLevel();
    const target = speaking() ? 0.25 + 0.75 * ST.talk : (m === 'sleep' ? 0.02 : 0.05 + 0.03 * Math.sin(t * 1.2));
    ST.lvl += (target - ST.lvl) * (speaking() ? 0.35 : 0.12);
    const P = PAL[MOOD_PAL[m] || 'calm'];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cur[i][j] += (P[i][j] - cur[i][j]) * 0.07;
    if (ui.cap) ui.cap.style.setProperty('--oc', rgb(cur[0], 1));
  }
  const visible = () => inView && !document.hidden && host && !host.hidden && host.offsetParent !== null;
  function frame(ms) {
    raf = 0;
    if (!visible()) return;
    const t = ms / 1000, busy = speaking() || ST.pulse > 0.02 || (ST.arc || 0) > 0.02 || t - ST.lastInput < 6;
    if (t - lastF >= (busy ? 1 / 40 : 1 / 20)) {
      lastF = t; update(now());
      draw(ST.reduced && !speaking() ? 0 : now() * (ST.mood === 'sleep' ? 0.4 : 1));
      if (!firstFrame) { firstFrame = true; host.classList.add('ms-live'); }
    }
    if (ST.reduced && !busy) return;   /* «уменьшить движение»: в покое — неподвижный кадр */
    raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf && inited) raf = requestAnimationFrame(frame); }
  function fit() { DPR = Math.min(window.devicePixelRatio || 1, 2); cv.width = cv.height = Math.round(W * DPR); g.setTransform(DPR, 0, 0, DPR, 0, 0); }

  function sync(info) {
    if (!info || !info.S || !info.D) return;
    const S = info.S, D = info.D, P = info.P || {};
    ST.hide = !!P.hide; ST.sound = P.msVoice !== false; ST.go = !!info.go; ST.fresh = info.fresh || 0; ST.money = info.money || ST.money;
    ST.name = String(P.name || '').trim().slice(0, 24);
    if (!ST.sound && TTS.ok && TTS.cur) try { speechSynthesis.cancel(); } catch (e) {}
    ST.S = S; ST.D = D;
    const off = !!info.offline; if (off && !ST.offline) ST.offSince = now(); ST.offline = off;
    ST.pct = info.pct == null || !isFinite(info.pct) ? null : info.pct;
    if (!S.ready) return;
    /* первые 2,5 с после загрузки только запоминаем состояние: данные приходят частями */
    if (!BL.ready) { baseline(S, D); BL.warm = now() + 2.5; wake(); return; }
    if (now() < BL.warm) { baseline(S, D); return; }
    detect(S, D);
    wake();
  }
  function userInput() {
    ST.lastInput = now(); wake();
    /* утренняя сводка — сама, раз в день, вскоре после первого касания (голос в телефоне включается только жестом) */
    if (BL.ready && !ST.autoT && now() - ST.t0 > 4 && newsDue()) ST.autoT = setTimeout(() => { ST.autoT = 0; if (newsDue() && !speaking() && visible()) tell(true); }, 1800);
  }

  function init(opts) {
    if (inited) return true;
    opts = opts || {}; host = opts.host; A = opts.app || {};
    if (!host) return false;
    if (!document.getElementById('ms-css')) { const st = document.createElement('style'); st.id = 'ms-css'; st.textContent = CSS; document.head.appendChild(st); }
    ST.reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    ST.asked = !!lsGet('or-asked', 0);
    host.querySelectorAll('.ms-cv,.ms-hit,.ms-sign,.ms-still').forEach(c => c.remove());
    cv = document.createElement('canvas'); cv.className = 'ms-cv'; cv.setAttribute('aria-hidden', 'true');
    g = cv.getContext('2d'); if (!g) return false;
    host.appendChild(cv); fit();
    ui.hit = document.createElement('button'); ui.hit.type = 'button'; ui.hit.className = 'ms-hit';
    ui.hit.setAttribute('aria-label', 'Орион, голосовой помощник: нажмите — сводка, зажмите — вопрос голосом'); host.appendChild(ui.hit);
    let lpT = 0, lp = false;
    ui.hit.addEventListener('pointerdown', () => { lp = false; clearTimeout(lpT); lpT = setTimeout(() => { lp = true; ST.lastInput = now(); listen(); }, 450); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => ui.hit.addEventListener(ev, () => clearTimeout(lpT)));
    ui.hit.addEventListener('contextmenu', e => e.preventDefault());
    ui.hit.addEventListener('click', () => { if (lp) { lp = false; return; } tapped(); });
    ui.cap = document.createElement('button'); ui.cap.type = 'button'; ui.cap.className = 'or-cap'; ui.cap.setAttribute('aria-live', 'polite');
    ui.cap.innerHTML = '<i aria-hidden="true"></i><b>Орион</b><span></span>'; ui.capT = ui.cap.querySelector('span');
    ui.cap.addEventListener('click', () => { stopVoice(); ui.cap.classList.remove('on'); });
    document.body.appendChild(ui.cap);
    window.addEventListener('resize', () => { fit(); wake(); });
    if (window.IntersectionObserver) new IntersectionObserver(es => { inView = es[0].isIntersecting; if (inView) wake(); }).observe(host);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopVoice(); else { ST.lastInput = now(); wake(); } });
    ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, voUnlock, { passive: true }));
    ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, e => { if (!host.contains(e.target) && !(ui.cap && ui.cap.contains(e.target))) userInput(); }, { passive: true }));
    setInterval(() => { if (!raf) wake(); }, 900);
    inited = true; wake();
    return true;
  }

  window.Mascot = {
    init, sync, number, greet,
    ask: q => answer(q), listen: () => listen(),
    event: (name, data) => trigger(name, data),
    debug: {
      state: () => ({ engine: TTS.engine || '', err: TTS.lastErr || '', mood: ST.mood, raf: !!raf, frame: firstFrame, voice: !!TTS.voice, tts: TTS.ok, talking: speaking(), lvl: +ST.lvl.toFixed(2), said: ST.lastSay || '', name: ST.name, cap: !!(ui.cap && ui.cap.classList.contains('on')), pal: cur[0].map(Math.round) }),
      hour: h => { ST.forceHour = h; },
      premium: on => { ST.forcePremium = !!on; VO.off = 0; },
      spoken: t => spokenRu(t),
      ask: q => answer(q), lastAsk: () => ST.lastAsk || null, ctx: () => brainCtx(), hist: () => ST.hist || [],
      mood: m => { if (ST.forceHour == null) ST.forceHour = 12; ST.pct = { calm: 0, up: 3, rocket: 9, down: -3, crash: -9 }[m]; ST.go = m === 'hunter'; if (m === 'offline') { ST.offline = true; ST.offSince = now() - 120; } else ST.offline = false; ST.lastInput = now(); wake(); },
      say: t => speak(t, { pri: 2 }),
      tap: () => tapped(),
      brief: () => brief(),
      reply: q => reply(q),
      event: (n, d) => trigger(n, d, true),
      due: () => newsDue()
    }
  };
})();
