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
.or-cap em{grid-column:2;display:flex;flex-wrap:wrap;gap:6px;font-style:normal}.or-cap em:empty{display:none}.or-cap em u{text-decoration:none;font-size:12.5px;font-weight:700;padding:3px 9px;border-radius:999px;background:color-mix(in srgb,var(--oc,#8b7dff) 16%,transparent);color:var(--fg,#fff)}.or-cap em u.up{color:#4fd18b}.or-cap em u.dn{color:#ff7a7a}
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
    let dep = false, buy = false, sell = false, air = false; const bought = {};
    for (const t of S.tx || []) {
      if (!t || !t.id || BL.tx.has(t.id)) continue;
      BL.tx.add(t.id);
      const ts = Date.parse(t.ts || ''); if (isFinite(ts) && Date.now() - ts > 3 * 864e5) continue;
      const ty = t.type;
      if (ty === 'deposit' || ty === 'reserve_in' || ty === 'income') dep = true;
      else if (ty === 'buy' || ty === 'dca' || ty === 'dip' || ty === 'start') { buy = true; const y = String(t.symbol || '').toUpperCase(); if (y) bought[y] = (bought[y] || 0) + (+t.usd || (+t.qty || 0) * coinPrice(y) || 0); }
      else if (ty === 'sell') sell = true;
      else if (ty === 'airdrop') air = true;
    }
    const dR = (D.realized || 0) - BL.real; BL.real = D.realized || 0;
    if (sell) ev.push([dR >= 0 ? 'sellProfit' : 'sellLoss']);
    if (air) ev.push(['airdrop']);
    if (dep) ev.push(['deposit']);
    if (buy) {
      /* покупка «по плану» записывается несколькими строками подряд — собираем их 1,2 с и говорим один раз */
      ST.buyAgg = ST.buyAgg || {}; Object.keys(bought).forEach(k => { ST.buyAgg[k] = (ST.buyAgg[k] || 0) + bought[k]; });
      clearTimeout(ST.buyT); ST.buyT = setTimeout(() => { const a = ST.buyAgg || {}; ST.buyAgg = null; trigger('buy', { items: Object.keys(a).map(k => ({ sym: k, usd: a[k] })) }); }, 1200);
    }
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
  /* украинский интерфейс (i18n.js): фразы Ориона переводятся на лету, живой голос и распознавание — на украинском */
  const UK = !!(window.mlLang && window.mlLang() === 'uk'), Lx = s => (UK && window.L ? window.L(s) : s), LOC = UK ? 'uk-UA' : 'ru-RU';
  function fmtMoney(v) { try { if (ST.money) return ST.money(v, { d: 0, show: true }); } catch (e) {} return '$' + Math.round(v).toLocaleString(LOC); }
  /* ---------- речь: голос телефона + субтитры ---------- */
  const TTS = { ok: !!(window.speechSynthesis && window.SpeechSynthesisUtterance), voice: null, cur: null, beat: 0, sim: 0, guard: 0, q: [] };
  function pickVoice() {
    if (!TTS.ok) return null;
    let vs = []; try { vs = speechSynthesis.getVoices() || []; } catch (e) {}
    const ru = vs.filter(v => (UK ? /^uk/i : /^ru/i).test(v.lang || ''));   /* украинский — только украинский голос телефона, иначе субтитры */
    if (!ru.length) return (TTS.voice = null);
    /* мужской голос, если в телефоне он есть, иначе голос Google, иначе любой русский */
    TTS.voice = ru.find(v => /(dmitr|pavel|yuri|maxim|male|муж)/i.test(v.name)) || ru.find(v => /google/i.test(v.name)) || ru.find(v => v.localService) || ru[0];
    return TTS.voice;
  }
  if (TTS.ok) { try { speechSynthesis.addEventListener('voiceschanged', pickVoice); } catch (e) {} pickVoice(); }
  const speaking = () => !!TTS.cur;
  /* №14 (18.11.2026): цифры из ответа — плашками под текстом, чтобы их было видно, а не только слышно */
  const FIG = /(плюс|минус|\+|−|-)?\s?\$?\d[\d\s\u00a0]*(?:[.,]\d+)?\s?(?:тысяч[аи]?\s(?:\d{1,3}\s)?|миллион(?:а|ов)?\s|млн\s|тыс\.\s)?(?:доллар(?:а|ов)?|гривн(?:я|и|ы)|гривен|процент(?:а|ов)?|%|\$|BTC|ETH)/gi;
  function figs(text) {
    const out = []; let m; FIG.lastIndex = 0;
    while ((m = FIG.exec(String(text || ''))) && out.length < 4) {
      const t = m[0].replace(/\s+/g, ' ').trim(); if (!/\d/.test(t) || t.length < 2 || out.some(x => x.t === t)) continue;
      out.push({ t, c: /^(плюс|\+)/i.test(t) ? 'up' : /^(минус|−|-)/i.test(t) ? 'dn' : '' });
    }
    return out.length >= 1 && out.length <= 4 ? out : [];
  }
  function capShow(text) {
    if (!ui.cap) return;
    ui.capT.textContent = text;
    if (ui.capN) { ui.capN.textContent = ''; figs(text).forEach(f => { const u = document.createElement('u'); u.textContent = f.t; if (f.c) u.className = f.c; ui.capN.appendChild(u); }); }
    ui.cap.classList.add('on', 'talk');
    ui.cap.setAttribute('aria-label', Lx('Орион') + ': ' + text + '. ' + Lx('Нажмите, чтобы остановить'));
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
    setTimeout(() => { if (TTS.cur) return; let x; while ((x = TTS.q.shift()) && now() - x.at > 40) {} if (x) speak(x.text, Object.assign({}, x.o, { queue: false })); }, TTS.q[0] && TTS.q[0].fast ? 90 : 700);   /* продолжение ответа — без паузы */
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
    if (UK && !o.raw) text = Lx(text);   /* ответ «мозга» уже по-украински — его не переводим */
    if (!text) return false;
    if (document.getElementById('mlIntro')) return false;   /* идёт обучающий ролик (intro.js) — Орион молчит, чтобы не перебить его голос */
    if (o.append && TTS.cur) { const it = { text, o: Object.assign({}, o, { append: false, queue: false }), at: now(), fast: true }, k = TTS.q.findIndex(x => !x.fast); if (k < 0) TTS.q.push(it); else TTS.q.splice(k, 0, it); return true; }   /* продолжение — после других продолжений, но раньше обычной очереди */   /* продолжение ответа «мозга» — сразу после текущей фразы */
    if (TTS.cur && (TTS.cur.pri || 0) > (o.pri || 0)) {   /* занят важным — скажет следом (не больше двух в очереди) */
      if (o.queue !== false && TTS.q.length < 2 && !TTS.q.some(x => x.text === text)) TTS.q.push({ text, o, at: now() });
      return false;
    }
    stopVoice();
    const cur = { text, pri: o.pri || 0, follow: !!o.follow, live: !!o.live }; TTS.cur = cur; ST.lastSay = text; ST.sayLog = (ST.sayLog || []).concat(text).slice(-6); ST.lastEvent = now(); TTS.beat = now();
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
      const u = new SpeechSynthesisUtterance(spoken(text).replace(/[«»]/g, '').replace(/—/g, ','));   /* голос телефона тоже получает подготовленный текст: числа, даты и тикеры словами (18.11.2026) */
      u.voice = v; u.lang = v.lang || LOC; u.rate = 1.0; u.pitch = 0.9; u.volume = 1;
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
    Object.assign(VO, { ctx: c, inp, wet: conv, an, low, pres, comp, dry, wg: wet });
    voFx();
    return c;
  }
  /* «шлем» (низ, присутствие, сжатие, эхо зала) — только по выключателю; без него голос звучит как на сайте ElevenLabs */
  function voFx() {
    if (!VO.ctx) return; const on = !!ST.fx;
    VO.low.gain.value = on ? 3.5 : 0; VO.pres.gain.value = on ? 2.5 : 0;
    VO.comp.threshold.value = on ? -22 : -6; VO.comp.ratio.value = on ? 3 : 1.5;
    VO.dry.gain.value = on ? 0.92 : 1; VO.wg.gain.value = on ? 0.17 : 0;
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
  /* фраза → части (18.11.2026). Обычно до 350 знаков — целиком одним запросом, чтобы интонация не «перезапускалась»; длиннее — две половины.
     live — ответ в разговоре: по предложениям (первое отдельно), чтобы первый звук пришёл быстро — Eleven v4 озвучивает фразу 3–5 с, длинную дольше */
  function splitParts(t, live) {
    t = String(t || '').trim();
    const ss = (t.match(/[^.!?…]+[.!?…]+["»]?|[^.!?…]+$/g) || [t]).map(z => z.trim()).filter(Boolean);
    if (live) { const out = []; for (const x of ss) { if (out.length > 1 && (out[out.length - 1].length < 40 || out.length >= 4)) out[out.length - 1] += ' ' + x; else out.push(x); } return out.length ? out : [t]; }
    if (t.length <= 350) return [t];
    let a = '', i = 0; while (i < ss.length - 1 && (a + ' ' + ss[i]).length <= t.length / 2 + 40) a = (a ? a + ' ' : '') + ss[i++];
    if (!a) a = ss[i++];
    const b = ss.slice(i).join(' ');
    return b ? [a, b] : [a];
  }
  const VO_PEND = new Map();   /* запросы голоса «в пути»: заранее заказанное продолжение ответа не заказывается второй раз */
  function voGet(text, ctx) {
    const k = text + '|' + (ctx.prev || '') + '|' + (ctx.next || '');
    if (VO.buf.has(k)) return Promise.resolve({ audio: VO.buf.get(k) });
    if (!ctx.prev && !ctx.next && VO.buf.has(text)) return Promise.resolve({ audio: VO.buf.get(text) });
    if (VO_PEND.has(k)) return VO_PEND.get(k);
    const p = (async () => {
      const t0 = now();
      let r = await voFetch(text, ctx);
      if ((!r || !r.audio) && now() - t0 < 3 && !/limit|quota|auth|not_configured/.test((r && r.error) || '')) r = await voFetch(text, ctx);   /* сеть моргнула сразу — вторая попытка; долгий отказ не повторяем (18.11.2026: два ожидания подряд давали 12 с тишины) */
      if (r && r.audio) { VO.buf.set(k, r.audio); if (VO.buf.size > 60) VO.buf.delete(VO.buf.keys().next().value); }
      return r;
    })();
    VO_PEND.set(k, p); p.finally(() => VO_PEND.delete(k));
    return p;
  }
  /* заранее заказать озвучку текста — тем же разбиением и с теми же соседями, что и premium() */
  function voPrefetch(text, live) {
    if (!premiumOK()) return;
    const parts = splitParts(stressRu(spoken(text)), live);
    parts.forEach((p, i) => voGet(p, parts.length > 1 ? { prev: parts[i - 1] || '', next: parts[i + 1] || '' } : {}));
  }
  async function premium(cur) {
    const c = voCtx(); if (!c) return false;
    if (c.state === 'suspended') { try { await c.resume(); } catch (e) {} if (c.state !== 'running') return false; }
    const parts = splitParts(stressRu(spoken(cur.text)), cur.live);
    const reqs = parts.map((p, i) => voGet(p, parts.length > 1 ? { prev: parts[i - 1] || '', next: parts[i + 1] || '' } : {}));   /* все части сразу, параллельно */
    let at = 0, played = 0, lastSrc = null;
    for (let i = 0; i < parts.length; i++) {
      const r = await reqs[i];
      if (TTS.cur !== cur) return true;   /* пока ждали — речь сменилась: это не ошибка голоса */
      if (!r || !r.audio) {
        if (!played) { const e = (r && r.error) || 'net', long = /^(day_limit|month_limit|not_configured|auth|quota)$/.test(e); VO.off = now() + (long ? 600 : 15); TTS.lastErr = e; return false; }   /* лимит, кончились символы или настройки — 10 минут голос телефона; занятость/сеть — 15 секунд */
        continue;
      }
      let audio; try { audio = await c.decodeAudioData(r.audio.slice(0)); } catch (e) { if (!played) { VO.off = now() + 600; TTS.lastErr = 'decode'; return false; } continue; }
      if (TTS.cur !== cur) return true;
      if (!played) { at = c.currentTime + 0.03; if (ST.fx) { chime(at); at += 0.22; } TTS.engine = 'premium'; if (cur.cap) cur.cap(); }
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
    for (const [d, sc] of [[1e9, SCALE.B], [1e6, SCALE.M], [1e3, SCALE.K]]) { const k = Math.floor(n / d) % 1000; if (k) parts.push((k === 1 && !parts.length ? '' : tri(k, sc[5], gen) + ' ') + scaleW(k, sc, gen)); }   /* «тысяча двести», а не «одна тысяча двести» */
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
  const UNITS = { '$': ['доллар', 'доллара', 'долларов', 'доллару', 'долларам'], '₴': ['гривна', 'гривны', 'гривен', 'гривне', 'гривнам'], '%': ['процент', 'процента', 'процентов', 'проценту', 'процентам'], '€': ['евро', 'евро', 'евро', 'евро', 'евро'], c: ['цент', 'цента', 'центов', 'центу', 'центам'] };
  /* произношение: бренды, биржи и аббревиатуры — как их говорят по-русски («OKX» — «о-кей-икс», «ETF» — «и-ти-эф»). Тикеры монет — ниже, в COIN (с падежом) */
  const SAY = [
    [/\bOKX\b/g, 'о-кей-икс'], [/(^|[^А-ЯЁа-яёA-Za-z])(ОКХ|ОКX|OКХ)(?![А-ЯЁа-яёA-Za-z])/g, '$1о-кей-икс'], [/\b[Ss]pot\s+ETFs?\b/g, 'спотовые и-ти-эф'], [/\bETFs?\b/g, 'и-ти-эф'], [/(^|[^А-ЯЁа-яё])ЕТФ(?![А-ЯЁа-яё])/g, '$1и-ти-эф'], [/\bSEC\b/g, 'эс-и-си'], [/\bNFTs?\b/g, 'эн-эф-ти'], [/\bDeFi\b/gi, 'дефай'], [/\bAI\b/g, 'эй-ай'],
    [/\bCEO\b/g, 'си-и-оу'], [/\bIPO\b/g, 'ай-пи-оу'], [/\bUSA\b/g, 'ю-эс-эй'], [/\bS&P\s?500\b/g, 'эс-энд-пи пятьсот'], [/\bFed\b/g, 'ФРС'], [/\bFOMC\b/g, 'эф-оу-эм-си'], [/\bAP[YR]\b/g, 'годовых'], [/\bATH\b/g, 'исторический максимум'],
    [/\bBinance\b/gi, 'Бинанс'], [/\bCoinbase\b/gi, 'Койнбейс'], [/\bBybit\b/gi, 'Байбит'], [/\bKraken\b/gi, 'Кракен'], [/\bBlackRock\b/gi, 'Блэкрок'], [/\bFidelity\b/gi, 'Фиделити'],
    [/\bGrayscale\b/gi, 'Грейскейл'], [/\b(Micro)?Strategy\b/g, 'Майкростратеджи'], [/\bTether\b/gi, 'Тезер'], [/\bCircle\b/g, 'Сёркл'], [/\bRipple\b/gi, 'Рипл'], [/\bSolana\b/gi, 'Солана'],
    [/\bEthereum\b/gi, 'Эфириум'], [/\bBitcoin\b/gi, 'биткоин'], [/\bCointelegraph\b/gi, 'Коинтелеграф'], [/\bCoinDesk\b/gi, 'Коиндеск'], [/\bForkLog\b/gi, 'Форклог'], [/\bDecrypt\b/g, 'Декрипт'],
    [/\bIncrypted\b/gi, 'Инкриптед'], [/\bNasdaq\b/gi, 'Насдак'], [/\bTrump\b/g, 'Трамп'], [/\bPowell\b/g, 'Пауэлл'], [/\bSaylor\b/g, 'Сейлор'], [/\bMetaMask\b/gi, 'Метамаск'], [/\bLedger\b/g, 'Леджер'],
    [/\bTrezor\b/g, 'Трезор'], [/\bDCA\b/g, 'ди-си-эй'], [/\b[Hh]alving\b/g, 'халвинг'], [/\b[Ss]taking\b/g, 'стейкинг'], [/\b[Aa]irdrop\b/g, 'аирдроп'],
    [/(^|[^А-ЯЁа-яё])ФРС(?![А-ЯЁа-яё])/g, '$1эф-эр-эс'], [/(^|[^А-ЯЁа-яё])США(?![А-ЯЁа-яё])/g, '$1сэ-шэ-а'], [/(^|[^А-ЯЁа-яё])ЕС(?![А-ЯЁа-яё])/g, '$1е-эс'],
    [/(^|[^А-ЯЁа-яё])МВФ(?![А-ЯЁа-яё])/g, '$1эм-вэ-эф'], [/(^|[^А-ЯЁа-яё])НБУ(?![А-ЯЁа-яё])/g, '$1эн-бэ-у'], [/(^|[^А-ЯЁа-яё])ВВП(?![А-ЯЁа-яё])/g, '$1вэ-вэ-пэ'], [/(^|[^А-ЯЁа-яё])ЦБ(?![А-ЯЁа-яё])/g, '$1цэ-бэ']
  ];
  const EN = { A: 'эй', B: 'би', C: 'си', D: 'ди', E: 'и', F: 'эф', G: 'джи', H: 'эйч', I: 'ай', J: 'джей', K: 'кей', L: 'эл', M: 'эм', N: 'эн', O: 'оу', P: 'пи', Q: 'кью', R: 'ар', S: 'эс', T: 'ти', U: 'ю', V: 'ви', W: 'дабл-ю', X: 'икс', Y: 'уай', Z: 'зед' };
  function pronounce(s) {
    for (const [re, to] of SAY) s = s.replace(re, to);
    return s.replace(/\b[A-Z]{2,5}\b/g, w => w.split('').map(ch => EN[ch]).join('-'));   /* прочие латинские аббревиатуры — по буквам */
  }
  /* монеты (18.11.2026): тикер → слово в нужном падеже. [именительный, родительный, мн. родительный]; одно слово — не склоняется.
     «BTC растёт» → «биткоин растёт», «цена BTC» → «цена биткоина», «2 BTC» → «два биткоина», «5 BTC» → «пять биткоинов» */
  const COIN = { BTC: ['биткоин', 'биткоина', 'биткоинов'], ETH: ['эфир', 'эфира', 'эфиров'], USDT: ['тезер', 'тезера', 'тезеров'], USDC: ['ю-эс-ди-си'],
    SOL: ['солана', 'соланы', 'соланы', 1], TON: ['тон', 'тона', 'тонов'], DOGE: ['доги'], ADA: ['кардано'], XRP: ['икс-ар-пи'], BNB: ['би-эн-би'], TRX: ['трон', 'трона', 'тронов'],
    LTC: ['лайткоин', 'лайткоина', 'лайткоинов'], LINK: ['чейнлинк', 'чейнлинка', 'чейнлинков'], AVAX: ['аваланч', 'аваланча', 'аваланчей'], DOT: ['полкадот', 'полкадота', 'полкадотов'],
    NEAR: ['нир'], SUI: ['суи'], PEPE: ['пепе'], SHIB: ['шиба-ину'], ONDO: ['ондо'], TAO: ['тао'], HYPE: ['хайп', 'хайпа', 'хайпов'], APT: ['аптос', 'аптоса', 'аптосов'],
    ARB: ['арбитрум', 'арбитрума', 'арбитрумов'], ENA: ['этена'], WLD: ['ворлдкоин', 'ворлдкоина', 'ворлдкоинов'], FET: ['фетч'], RENDER: ['рендер', 'рендера', 'рендеров'],
    POL: ['пол'], MNT: ['мэнтл'], UNI: ['юнисвоп', 'юнисвопа', 'юнисвопов'], AAVE: ['аве'], XLM: ['стеллар', 'стеллара', 'стелларов'], ATOM: ['атом', 'атома', 'атомов'],
    INJ: ['инджектив'], SEI: ['сэй'], JUP: ['юпитер', 'юпитера', 'юпитеров'], ZAMA: ['зама'], KAS: ['каспа', 'каспы', 'каспы', 1], XMR: ['монеро'], FIL: ['файлкоин', 'файлкоина', 'файлкоинов'],
    TIA: ['селестия', 'селестии', 'селестии', 1], BCH: ['биткоин-кэш'], ETC: ['эфириум-классик'], WIF: ['виф'], BONK: ['бонк', 'бонка', 'бонков'] };
  const COIN_GEN = /(?:^|[^А-Яа-яЁё])(цена|цены|цене|курс|курса|доля|доли|долю|стоимость|рост|роста|падение|падения|покупка|покупки|покупку|продажа|продажи|продажу|объём|объем|капитализация|капитализации|доминация|халвинг|дно|максимум|минимум|график|у|для|без|из|от|до|около|после|кроме|выше|ниже|вместо|против)\s*$/i;
  function coinsRu(s) {
    return s.replace(/(^|[^A-Za-z0-9])([A-Z]{2,6})(?![A-Za-z0-9])/g, (m, pre, tk, off, all) => {
      const c = COIN[tk]; if (!c) return m;
      if (c.length === 1) return pre + c[0];
      const before = all.slice(0, off) + pre, num = before.match(/(\d+)(?:[.,](\d+))?\s*$/);
      if (num) {   /* после числа: «2 BTC», «0,5 ETH», «около 3 BTC» */
        if (num[2] && +num[2]) return pre + c[1];
        const n = +num[1], bb = before.slice(0, before.length - num[0].length), g = PREP_GEN.test(bb);
        if (c[3]) return pre + (g ? (one(n) ? 'монеты ' : 'монет ') : plural(n, 'монета ', 'монеты ', 'монет ')) + c[1];   /* «5 SOL» → «пять монет соланы» */
        return pre + (g ? (one(n) ? c[1] : c[2]) : plural(n, c[0], c[1], c[2]));
      }
      return pre + (COIN_GEN.test(before) ? c[1] : c[0]);
    });
  }
  /* чистка текста перед голосом: разметка, эмодзи, ссылки, списки, скобки */
  function cleanSpeech(t) {
    let s = String(t || '').replace(/https?:\/\/\S+|www\.\S+/g, '').replace(/\*\*|__|`+/g, '').replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|[.,!?]|$)/g, '$1$2')
      .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍]/gu, '');
    s = s.split(/\n+/).map(l => l.replace(/^\s*(?:#+|[-•*]|\d+[.)])\s+/, '').trim()).filter(Boolean).map((l, i, a) => (a.length > 1 ? l.charAt(0).toUpperCase() + l.slice(1) : l) + (i < a.length - 1 && !/[.!?…:;,]$/.test(l) ? '.' : '')).join(' ');
    s = s.replace(/\s*\(([^()]{1,80})\)/g, ' — $1 —').replace(/—\s*([.,!?;:])/g, '$1').replace(/—\s*—/g, '—').replace(/\s*:\s*$/, '.');
    return s.replace(/\s+/g, ' ').trim();
  }
  /* порядковые числительные: «3-й ступени» → «третьей ступени», «в 2024 году» → «в две тысячи двадцать четвёртом году», «17 декабря» → «семнадцатого декабря» */
  const ORD1 = { ноль: 'нулевой', один: 'первый', одна: 'первый', два: 'второй', две: 'второй', три: 'третий', четыре: 'четвёртый', пять: 'пятый', шесть: 'шестой', семь: 'седьмой', восемь: 'восьмой', девять: 'девятый',
    сорок: 'сороковой', пятьдесят: 'пятидесятый', шестьдесят: 'шестидесятый', семьдесят: 'семидесятый', восемьдесят: 'восьмидесятый', девяносто: 'девяностый', сто: 'сотый', двести: 'двухсотый', триста: 'трёхсотый',
    четыреста: 'четырёхсотый', пятьсот: 'пятисотый', шестьсот: 'шестисотый', семьсот: 'семисотый', восемьсот: 'восьмисотый', девятьсот: 'девятисотый', тысяча: 'тысячный', миллион: 'миллионный' };
  const ORDE = { 'ый': { m: 'ый', mg: 'ого', md: 'ому', mp: 'ом', f: 'ая', fo: 'ой', fa: 'ую', n: 'ое', pl: 'ых' }, 'ой': { m: 'ой', mg: 'ого', md: 'ому', mp: 'ом', f: 'ая', fo: 'ой', fa: 'ую', n: 'ое', pl: 'ых' },
    'ий': { m: 'ий', mg: 'ьего', md: 'ьему', mp: 'ьем', f: 'ья', fo: 'ьей', fa: 'ью', n: 'ье', pl: 'ьих' } };
  function ordW(n, form) {
    n = Math.floor(Math.abs(n)); let pre = '', last;
    if (n >= 1000 && n % 1000 === 0 && n < 1e6) { const k = n / 1000; last = (k === 1 ? '' : tri(k, false, true).replace(/\s+/g, '')) + 'тысячный'; }
    else { const w = intW(n).split(' '); const l = w.pop(); pre = w.length ? w.join(' ') + ' ' : ''; last = ORD1[l] || l.replace(/ь$/, '') + 'ый'; }
    const end = last.slice(-2), E = ORDE[end] || ORDE['ый'], stem = end === 'ий' ? last.slice(0, -2) : last.slice(0, -2);
    return pre + stem + E[form || 'm'];
  }
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const FEM_O = /^(ступен|недел|част|позици|покупк|сделк|монет|строк|волн|попытк|минут|секунд|лини|цел|сери|стади|фаз|очеред|запис|ночь|ночи)/i;
  function datesRu(s) {
    /* время: «9:30» → «девять тридцать», «10:00» → «десять ноль-ноль» */
    s = s.replace(/(^|[^\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g, (m, pre, h, mm) => pre + intW(+h) + ' ' + (mm === '00' ? 'ноль-ноль' : mm[0] === '0' ? 'ноль ' + intW(+mm[1]) : intW(+mm)));
    /* дата цифрами: «15.12» / «15.12.2026» */
    s = s.replace(/(^|[^\d$€.,])(\d{1,2})\.(\d{2})(?:\.(\d{4}))?(?![\d%]|[.,]\d|\s?(?:%|\$|₴|€|долл|грн|гривн|евро|процент|тыс|млн|млрд|трлн|[KkMB]\b))/g, (m, pre, d, mo, y, off, all) => {
      if (+d < 1 || +d > 31 || +mo < 1 || +mo > 12) return m;
      const dat = PREP_DAT.test(all.slice(0, off) + pre);
      return pre + ordW(+d, dat ? 'md' : 'mg') + ' ' + MONTHS[+mo - 1] + (y ? ' ' + ordW(+y, 'mg') + ' года' : '');
    });
    /* «17 декабря», «с 1 января», «к 5 марта» */
    s = s.replace(new RegExp('(^|[^\\d.,])(\\d{1,2})\\s+(' + MONTHS.join('|') + ')(?![А-Яа-яЁё])', 'g'), (m, pre, d, mo, off, all) => {
      const before = all.slice(0, off) + pre;
      return pre + ordW(+d, PREP_DAT.test(before) ? 'md' : /(?:^|\s)на\s*$/i.test(before) ? 'n' : 'mg') + ' ' + mo;
    });
    /* год: «в 2024 году», «2025 года», «2024 г.» */
    s = s.replace(/(^|[^\d.,])(\d{4})\s?г\.(?=\s|$|[,;])/g, (m, pre, y, off, all) => pre + y + (/(?:^|\s)в\s*$/i.test(all.slice(0, off) + pre) ? ' году' : ' года'));
    s = s.replace(/(^|[^\d.,])(\d{3,4})\s+(году|года|год)(?![А-Яа-яЁё])/g, (m, pre, y, g, off, all) => pre + ordW(+y, g === 'году' ? (PREP_DAT.test(all.slice(0, off) + pre) ? 'md' : 'mp') : g === 'года' ? 'mg' : 'm') + ' ' + g);
    /* «3-й», «2-м», «5-го», «1-я» */
    s = s.replace(/(^|[^\d.,])(\d{1,4})\s?-\s?(ый|ий|ой|ая|ья|ое|ье|ого|его|ому|ему|ом|ем|ых|их|ую|ью|й|я|е|го|му|м|х|ю)(?![А-Яа-яЁё])(?=(\s*)([А-Яа-яЁё]*))/g, (m, pre, d, sf, _s, next) => {
      const fem = FEM_O.test(next || '');
      const form = /^(ая|ья|я)$/.test(sf) ? 'f' : /^(ое|ье|е)$/.test(sf) ? 'n' : /^(ого|его|го)$/.test(sf) ? 'mg' : /^(ому|ему|му)$/.test(sf) ? 'md' : /^(ом|ем|м)$/.test(sf) ? 'mp'
        : /^(ых|их|х)$/.test(sf) ? 'pl' : /^(ую|ью|ю)$/.test(sf) ? 'fa' : fem ? 'fo' : 'm';
      return pre + ordW(+d, form);
    });
    return s;
  }
  /* «5–10%» → «от 5 до 10%», «x3» → «в 3 раза», «3 ч» → «3 часа», «ещё», «всё упало» */
  function orW(pre, a, b, before, rest) {   /* «2–3 недели» → «две или три недели» (род и падеж — по слову после) */
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return pre + a + ' или ' + b;
    const fem = FEM.test((rest.match(/^\s+([А-Яа-яЁё]+)/) || [])[1] || ''), gen = PREP_DAT.test(before) ? 'd' : PREP_GEN.test(before);
    return pre + intW(+a, fem, gen) + ' или ' + intW(+b, fem, gen);
  }
  function phrasesRu(s) {
    s = s.replace(/(^|[^\d.,А-Яа-яЁёA-Za-z\-−+])(\d+(?:[.,]\d+)?)\s?[–—-]\s?(\d+(?:[.,]\d+)?)(?=\s?(?:%|₴|\$|€|тыс|млн|млрд)|\s+(?!год)[А-Яа-яЁё])/g, (m, pre, a, b, off, all) => (/(?:^|\s)от\s*$/i.test(all.slice(0, off) + pre) ? m : /^\s+(?!тыс|млн|млрд|трлн|доллар|гривен|гривн|евро|процент)[А-Яа-яЁё]/.test(all.slice(off + m.length)) ? orW(pre, a, b, all.slice(0, off) + pre, all.slice(off + m.length)) : pre + 'от ' + a + ' до ' + b));   /* «2–3 дня» → «два или три дня» */
    s = s.replace(/(^|[\s(])[xх×]\s?(\d+)(?![\d.,]\d)/g, (m, pre, n) => pre + 'в ' + n + ' ' + plural(+n, 'раз', 'раза', 'раз')).replace(/(^|[\s(])(\d+)\s?[xх×](?=[\s.,!?;:]|$)/g, (m, pre, n) => pre + 'в ' + n + ' ' + plural(+n, 'раз', 'раза', 'раз'));
    const AB = { 'ч': ['час', 'часа', 'часов'], 'мин': ['минута', 'минуты', 'минут'], 'сек': ['секунда', 'секунды', 'секунд'], 'дн': ['день', 'дня', 'дней'], 'мес': ['месяц', 'месяца', 'месяцев'], 'шт': ['штука', 'штуки', 'штук'] };
    s = s.replace(/(\d+)\s?(ч|мин|сек|дн|мес|шт)\.?(?![А-Яа-яЁё])/g, (m, n, a) => n + ' ' + plural(+n, ...AB[a]));
    s = s.replace(/(^|[^А-Яа-яЁё])([Ее])ще(?![А-Яа-яЁё])/g, (m, pre, e) => pre + (e === 'Е' ? 'Ещё' : 'ещё'))
      .replace(/(^|[^А-Яа-яЁё])([Вв])се(?=\s+(?:[а-яё]+ло|равно|ещё|в порядке|по плану|хорошо|спокойно|верно|правильно|просто|понятно|готово|штатно|идёт|идет|получилось|сделано|сказано)(?![А-Яа-яЁё]))/g, '$1$2сё')
      .replace(/(^|[^А-Яа-яЁё])(это|вот и|на этом|на сегодня) все(?=[.!?]|$)/gi, '$1$2 всё');
    return s;
  }
  /* очень маленькая цена в долларах: «$0.0000123» — это «доли цента», «$0,15» — «пятнадцать центов» */
  function centsW(fp, gen) {
    const v = +('0.' + fp);
    if (v < 0.001) return 'доли цента';
    if (v < 0.01) return 'меньше цента';
    const c = Math.round(v * 100), U = UNITS.c;
    return intW(c, false, gen) + ' ' + (gen === 'd' ? (one(c) ? U[3] : U[4]) : gen ? (one(c) ? U[1] : U[2]) : plural(c, U[0], U[1], U[2]));
  }
  function spokenRu(t) {
    let s = cleanSpeech(t);
    s = coinsRu(s);
    s = pronounce(s).replace(/[   ]/g, ' ').replace(/[«»"“”]/g, '').replace(/\s*—\s*/g, ' — ');   /* тире оставляем: живой голос сам делает естественную паузу */
    s = s.replace(/(\d)\s(?=\d{3}(?!\d))/g, '$1');   /* «110 000» → «110000» */
    s = s.replace(/(\d)[Kk](?![A-Za-zА-Яа-яЁё])/g, '$1 тыс').replace(/(\d)M(?![A-Za-zА-Яа-яЁё])/g, '$1 млн').replace(/(\d)B(?![A-Za-zА-Яа-яЁё])/g, '$1 млрд');   /* «$110K» */
    s = datesRu(s);
    s = phrasesRu(s);
    const RE = /(^|[\s(:])([−\-+]?)([$€])?(\d+)(?:[.,](\d+))?(?:\s?(тыс\.?|тысяч[аи]?|млн\.?|миллион(?:а|ов)?|млрд\.?|миллиард(?:а|ов)?|трлн\.?|триллион(?:а|ов)?)(?![А-Яа-яЁё]))?(\s?(%|₴|\$|€|долл\.|доллар(?:а|ов)?|грн\.?|гривн[аы]?|гривен|евро)(?![А-Яа-яЁё]))?(?=(\s*)([А-Яа-яЁё]*))/g;
    s = s.replace(RE, (m, pre, sg, d1, ip, fp, mult, _u, u, _sp, next, off, all) => {
      const before = all.slice(0, off) + pre, gen = PREP_DAT.test(before) ? 'd' : PREP_GEN.test(before);
      let unit = u ? (/^(\$|долл)/.test(u) ? '$' : /^(₴|грн|грив)/.test(u) ? '₴' : /^(€|евро)/.test(u) ? '€' : '%') : (d1 || '');
      const sc = mult ? (/^тыс/.test(mult) ? SCALE.K : /^(млн|миллион)/.test(mult) ? SCALE.M : /^(трлн|триллион)/.test(mult) ? SCALE.T : SCALE.B) : null;
      const n = +ip, frac = !!(fp && +fp.slice(0, 3)), sign = sg === '+' ? 'плюс ' : sg ? 'минус ' : '';
      const ate = /\.$/.test(mult && !u ? mult : u || ''), rest = all.slice(off + m.length);   /* «тыс.», «грн.» в конце предложения — точку возвращаем */
      const dot = ate && (!rest.trim() || /^\s+[А-ЯЁA-Z]/.test(rest)) ? '.' : '';
      const fem = sc ? sc[5] : unit ? unit === '₴' : FEM.test(next || '');
      if (unit === '$' && !sc && n === 0 && fp) return pre + sign + centsW(fp, gen) + dot;   /* центы и доли цента */
      const U = unit ? UNITS[unit] : null;
      if (fp && fp.replace(/0+$/, '') === '5') {   /* «3,5%» → «три с половиной процента», «0,5%» → «полпроцента» */
        if (!n && U && !sc) return pre + sign + (unit === '€' ? 'пол-евро' : 'пол' + U[1]) + dot;
        if (n) { let w = n === 1 ? (gen ? 'полутора' : fem ? 'полторы' : 'полтора') : intW(n, fem, gen) + ' с половиной'; if (sc) w += ' ' + (gen === 'd' ? sc[7] : gen ? sc[4] : sc[1]); if (U) w += ' ' + (sc ? U[2] : gen === 'd' ? U[4] : gen ? U[2] : U[1]); return pre + sign + w + dot; }
      }
      let w = numW(ip, fp, fem, gen);
      if (sc) w += ' ' + (frac ? (gen ? sc[3] : sc[1]) : scaleW(n, sc, gen));
      if (U) w += ' ' + (sc || (n >= 1000 && n % 1000 === 0) ? U[2] : frac ? U[1] : gen === 'd' ? (one(n) ? U[3] : U[4]) : gen ? (one(n) ? U[1] : U[2]) : plural(n, U[0], U[1], U[2]));
      return pre + sign + w + dot;
    });
    return s.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/^[—,.\s]+/, '').trim();
  }
  /* ---------- то же для украинского: числа словами по-украински, с падежами ----------
     «$950» → «дев'ятсот п'ятдесят доларів», «до 74 тисяч» → «до сімдесяти чотирьох тисяч», «2,5%» → «дві цілих п'ять десятих відсотка» */
  const U1 = ['нуль', 'один', 'два', 'три', 'чотири', "п'ять", 'шість', 'сім', 'вісім', "дев'ять", 'десять', 'одинадцять', 'дванадцять', 'тринадцять', 'чотирнадцять', "п'ятнадцять", 'шістнадцять', 'сімнадцять', 'вісімнадцять', "дев'ятнадцять"];
  const U10 = ['', '', 'двадцять', 'тридцять', 'сорок', "п'ятдесят", 'шістдесят', 'сімдесят', 'вісімдесят', "дев'яносто"];
  const U100 = ['', 'сто', 'двісті', 'триста', 'чотириста', "п'ятсот", 'шістсот', 'сімсот', 'вісімсот', "дев'ятсот"];
  const UGEN = { нуль: 'нуля', один: 'одного', одна: 'однієї', два: 'двох', дві: 'двох', три: 'трьох', чотири: 'чотирьох', "п'ять": "п'яти", шість: 'шести', сім: 'семи', вісім: 'восьми', "дев'ять": "дев'яти",
    сорок: 'сорока', "дев'яносто": "дев'яноста", сто: 'ста', двісті: 'двохсот', триста: 'трьохсот', чотириста: 'чотирьохсот', "п'ятсот": "п'ятисот", шістсот: 'шестисот', сімсот: 'семисот', вісімсот: 'восьмисот', "дев'ятсот": "дев'ятисот",
    "п'ятдесят": "п'ятдесяти", шістдесят: 'шістдесяти', сімдесят: 'сімдесяти', вісімдесят: 'вісімдесяти' };
  const ugenW = w => UGEN[w] || w.replace(/ть$/, 'ти');   /* «двадцять» → «двадцяти», «одинадцять» → «одинадцяти» */
  function triU(n, fem, gen) {
    const o = []; const h = Math.floor(n / 100), r = n % 100;
    if (h) o.push(U100[h]);
    if (r >= 20) { o.push(U10[Math.floor(r / 10)]); if (r % 10) o.push(U1[r % 10]); } else if (r || !h) o.push(U1[r]);
    if (fem) { const k = o.length - 1; if (o[k] === 'один') o[k] = 'одна'; else if (o[k] === 'два') o[k] = 'дві'; }
    return (gen ? o.map(ugenW) : o).join(' ');
  }
  const USCALE = { K: ['тисяча', 'тисячі', 'тисяч', 'тисячі', 'тисяч', true], M: ['мільйон', 'мільйони', 'мільйонів', 'мільйона', 'мільйонів', false], B: ['мільярд', 'мільярди', 'мільярдів', 'мільярда', 'мільярдів', false], T: ['трильйон', 'трильйони', 'трильйонів', 'трильйона', 'трильйонів', false] };
  const uscaleW = (k, sc, gen) => gen ? (one(k) ? sc[3] : sc[4]) : plural(k, sc[0], sc[1], sc[2]);
  function intU(n, fem, gen) {
    n = Math.floor(Math.abs(n)); if (!n) return gen ? 'нуля' : 'нуль';
    const parts = [];
    for (const [d, sc] of [[1e9, USCALE.B], [1e6, USCALE.M], [1e3, USCALE.K]]) { const k = Math.floor(n / d) % 1000; if (k) parts.push(triU(k, sc[5], gen) + ' ' + uscaleW(k, sc, gen)); }
    const r = n % 1000; if (r) parts.push(triU(r, fem, gen));
    return parts.join(' ');
  }
  const UFEM = /^(тисяч|гривн|гривен|сходин|монет|хвилин|секунд|годин|доб|покуп|угод|позиці|частк|сотн|ціл)/i;
  function numU(intS, fracS, fem, gen) {
    const n = +intS;
    fracS = (fracS || '').slice(0, 3).replace(/0+$/, '');
    if (!fracS) return intU(n, fem, gen);
    const f = +fracS, den = [null, ['десята', 'десятих', 'десятої'], ['сота', 'сотих', 'сотої'], ['тисячна', 'тисячних', 'тисячної']][fracS.length];
    const cel = gen ? (one(n) ? 'цілої' : 'цілих') : plural(n, 'ціла', 'цілих', 'цілих');
    return intU(n, true, gen) + ' ' + cel + ' ' + intU(f, true, gen) + ' ' + (one(f) ? (gen ? den[2] : den[0]) : den[1]);
  }
  const UPREP_GEN = /(?:^|\s)(до|від|близько|понад|більше|менше|після|з|із|зі|без|для|проти|крім|біля|нижче|вище|порядку|замість|дорожче|дешевше|навколо|майже до)\s*$/i;
  /* одиниці: [1, 2–4, 5+, родовий однини (для дробів и «до одного»)] */
  const UUNITS = { '$': ['долар', 'долари', 'доларів', 'долара'], '₴': ['гривня', 'гривні', 'гривень', 'гривні'], '%': ['відсоток', 'відсотки', 'відсотків', 'відсотка'] };
  const SAY_UK = [
    [/\bBTC\b/g, 'біткоїна'], [/\bETH\b/g, 'ефіру'], [/\bUSDT\b/g, 'тезер'], [/\bUSDC\b/g, 'ю-ес-ді-сі'],
    [/\bOKX\b/g, 'о-кей-ікс'], [/(^|[^А-ЯЁа-яёІіЇїЄєҐґA-Za-z])(ОКХ|ОКX|OКХ)(?![А-ЯЁа-яёІіЇїЄєҐґA-Za-z])/g, '$1о-кей-ікс'], [/\bETFs?\b/g, 'і-ті-еф'], [/\bSEC\b/g, 'ес-і-сі'], [/\bNFT\b/g, 'ен-еф-ті'], [/\bDeFi\b/gi, 'дефай'], [/\bAI\b/g, 'ей-ай'],
    [/\bCEO\b/g, 'сі-і-оу'], [/\bIPO\b/g, 'ай-пі-оу'], [/\bUSA\b/g, 'ю-ес-ей'], [/\bS&P\s?500\b/g, "ес-енд-пі п'ятсот"], [/\bFed\b/g, 'ФРС'], [/\bFOMC\b/g, 'еф-оу-ем-сі'],
    [/\bBinance\b/gi, 'Бінанс'], [/\bCoinbase\b/gi, 'Коїнбейс'], [/\bBybit\b/gi, 'Байбіт'], [/\bKraken\b/gi, 'Кракен'], [/\bBlackRock\b/gi, 'Блекрок'], [/\bFidelity\b/gi, 'Фіделіті'],
    [/\bGrayscale\b/gi, 'Грейскейл'], [/\b(Micro)?Strategy\b/g, 'Майкростратеджі'], [/\bTether\b/gi, 'Тезер'], [/\bCircle\b/g, 'Серкл'], [/\bRipple\b/gi, 'Ріпл'], [/\bSolana\b/gi, 'Солана'],
    [/\bEthereum\b/gi, 'Ефіріум'], [/\bBitcoin\b/gi, 'біткоїн'], [/\bCointelegraph\b/gi, 'Коїнтелеграф'], [/\bCoinDesk\b/gi, 'Коїндеск'], [/\bForkLog\b/gi, 'Форклог'], [/\bDecrypt\b/g, 'Декрипт'],
    [/\bIncrypted\b/gi, 'Інкриптед'], [/\bNasdaq\b/gi, 'Насдак'], [/\bTrump\b/g, 'Трамп'], [/\bPowell\b/g, 'Пауелл'], [/\bSaylor\b/g, 'Сейлор'], [/\bMetaMask\b/gi, 'Метамаск'], [/\bLedger\b/g, 'Леджер'],
    [/\bTrezor\b/g, 'Трезор'], [/\bBNB\b/g, 'бі-ен-бі'], [/\bXRP\b/g, 'ікс-ар-пі'], [/\bSOL\b/g, 'солана'], [/\bTON\b/g, 'тон'], [/\bDOGE\b/g, 'доге'], [/\bADA\b/g, 'кардано'], [/\bTRX\b/g, 'трон'],
    [/\bLTC\b/g, 'лайткоїн'], [/\bLINK\b/g, 'чейнлінк'], [/\bAVAX\b/g, 'аваланч'], [/\bDCA\b/g, 'ді-сі-ей'],
    [/(^|[^А-Яа-яІіЇїЄєҐґ])ФРС(?![А-Яа-яІіЇїЄєҐґ])/g, '$1еф-ер-ес'], [/(^|[^А-Яа-яІіЇїЄєҐґ])США(?![А-Яа-яІіЇїЄєҐґ])/g, '$1ес-ша-а'], [/(^|[^А-Яа-яІіЇїЄєҐґ])(ЄС|ЕС)(?![А-Яа-яІіЇїЄєҐґ])/g, '$1є-ес'],
    [/(^|[^А-Яа-яІіЇїЄєҐґ])МВФ(?![А-Яа-яІіЇїЄєҐґ])/g, '$1ем-ве-еф'], [/(^|[^А-Яа-яІіЇїЄєҐґ])НБУ(?![А-Яа-яІіЇїЄєҐґ])/g, '$1ен-бе-у'], [/(^|[^А-Яа-яІіЇїЄєҐґ])ВВП(?![А-Яа-яІіЇїЄєҐґ])/g, '$1ве-ве-пе']
  ];
  const EN_UK = { A: 'ей', B: 'бі', C: 'сі', D: 'ді', E: 'і', F: 'еф', G: 'джі', H: 'ейч', I: 'ай', J: 'джей', K: 'кей', L: 'ел', M: 'ем', N: 'ен', O: 'оу', P: 'пі', Q: "к'ю", R: 'ар', S: 'ес', T: 'ті', U: 'ю', V: 'ві', W: 'дабл-ю', X: 'ікс', Y: 'уай', Z: 'зед' };
  function spokenUk(t) {
    t = cleanSpeech(t);   /* разметка, эмодзи, ссылки, списки — как в русском */
    for (const [re, to] of SAY_UK) t = String(t || '').replace(re, to);
    let s = t.replace(/\b[A-Z]{2,5}\b/g, w => w.split('').map(ch => EN_UK[ch]).join('-'))
      .replace(/[   ]/g, ' ').replace(/[«»]/g, '').replace(/\s*—\s*/g, ' — ').replace(/(\d)\s(?=\d{3}(?!\d))/g, '$1')
      .replace(/×\s?(\d)/g, 'у $1').replace(/(\d)\s?×/g, '$1 разів');
    const UL = "А-Яа-яЁёІіЇїЄєҐґ'’";
    const RE = new RegExp('(^|[\\s(:])([−\\-+]?)(\\$)?(\\d+)(?:[.,](\\d+))?(?:\\s?(тис\\.?|тисяч[аі]?|млн\\.?|мільйон(?:а|и|ів)?|млрд\\.?|мільярд(?:а|и|ів)?|трлн\\.?|трильйон(?:а|и|ів)?)(?![' + UL + ']))?(\\s?(%|₴|\\$|дол\\.|долар(?:а|и|ів)?|грн\\.?|гривн[яі]|гривень|відсот(?:ок|ки|ків|ка))(?![' + UL + ']))?(?=(\\s*)([' + UL + ']*))', 'g');
    s = s.replace(RE, (m, pre, sg, d1, ip, fp, mult, _u, u, _sp, next, off, all) => {
      const gen = UPREP_GEN.test(all.slice(0, off) + pre);
      const unit = u ? (/^(\$|дол)/.test(u) ? '$' : /^(₴|грн|грив)/.test(u) ? '₴' : '%') : (d1 ? '$' : '');
      const sc = mult ? (/^тис/.test(mult) ? USCALE.K : /^(млн|мільйон)/.test(mult) ? USCALE.M : /^(трлн|трильйон)/.test(mult) ? USCALE.T : USCALE.B) : null;
      const n = +ip, frac = !!(fp && +fp.slice(0, 3));
      const fem = sc ? sc[5] : unit ? unit === '₴' : UFEM.test(next || '');
      let w = numU(ip, fp, fem, gen);
      if (sc) w += ' ' + (frac ? sc[3] : uscaleW(n, sc, gen));
      if (unit) { const U = UUNITS[unit]; w += ' ' + (sc || (n >= 1000 && n % 1000 === 0) ? U[2] : frac ? U[3] : gen ? (one(n) ? U[3] : U[2]) : plural(n, U[0], U[1], U[2])); }
      const sign = sg === '+' ? 'плюс ' : sg ? 'мінус ' : '';
      const ate = /\.$/.test(mult && !u ? mult : u || ''), rest = all.slice(off + m.length);
      return pre + sign + w + (ate && (!rest.trim() || /^\s+[А-ЯІЇЄҐA-Z]/.test(rest)) ? '.' : '');
    });
    return s.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  }
  const spoken = t => (UK ? spokenUk(t) : spokenRu(t));
  /* ударения для живого голоса (18.11.2026): Eleven v4 понимает знак ударения над гласной (проверка владельца: «ха́лвинг» — вариант 2).
     Только для живого голоса и только по-русски: голос телефона знак не понимает. Пополнять: [основа со знаком, основа без знака, окончания] */
  const STRESS_SRC = [
    ['ха́лвинг', 'халвинг', ['', 'а', 'у', 'ом', 'е', 'и', 'ов', 'ам', 'ами', 'ах']], ['сре́дств', 'средств', ['а', '', 'ам', 'ами', 'ах', 'о', 'е', 'у', 'ом']],
    ['догово́р', 'договор', ['', 'а', 'у', 'ом', 'е', 'ы', 'ов', 'ам', 'ами', 'ах']], ['кварта́л', 'квартал', ['', 'а', 'у', 'ом', 'е', 'ы', 'ов', 'ам', 'ами', 'ах']],
    ['волати́льност', 'волатильност', ['ь', 'и', 'ью']], ['волати́льн', 'волатильн', ['ый', 'ая', 'ое', 'ые', 'ого', 'ой', 'ых', 'ому', 'ым', 'ую']],
    ['ма́йнинг', 'майнинг', ['', 'а', 'у', 'ом', 'е']], ['то́кен', 'токен', ['', 'а', 'у', 'ом', 'е', 'ы', 'ов', 'ам', 'ами', 'ах']],
    ['блокче́йн', 'блокчейн', ['', 'а', 'у', 'ом', 'е', 'ы', 'ов']], ['сте́йкинг', 'стейкинг', ['', 'а', 'у', 'ом', 'е']],
    ['хо́лдер', 'холдер', ['', 'а', 'у', 'ом', 'е', 'ы', 'ов', 'ам', 'ами', 'ах']], ['тре́йдинг', 'трейдинг', ['', 'а', 'у', 'ом', 'е']],
    ['опто́в', 'оптов', ['ый', 'ая', 'ое', 'ые', 'ого', 'ой', 'ых', 'ому', 'ым', 'ую']], ['обеспе́чени', 'обеспечени', ['е', 'я', 'ю', 'ем', 'и']],
    ['экспе́рт', 'эксперт', ['', 'а', 'у', 'ом', 'е', 'ы', 'ов', 'ам', 'ами', 'ах']], ['ма́ркетинг', 'маркетинг', ['', 'а', 'у', 'ом', 'е']],
    ['ликви́дност', 'ликвидност', ['ь', 'и', 'ью']], ['дивиде́нд', 'дивиденд', ['', 'а', 'у', 'ом', 'е', 'ы', 'ов', 'ам', 'ами', 'ах']],
    ['дефо́лт', 'дефолт', ['', 'а', 'у', 'ом', 'е', 'ы', 'ов']], ['альтко́ин', 'альткоин', ['', 'а', 'у', 'ом', 'е', 'ы', 'ов', 'ам', 'ами', 'ах']],
    ['стейблко́ин', 'стейблкоин', ['', 'а', 'у', 'ом', 'е', 'ы', 'ов', 'ам', 'ами', 'ах']], ['мемко́ин', 'мемкоин', ['', 'а', 'у', 'ом', 'е', 'ы', 'ов', 'ам', 'ами', 'ах']],
    ['те́зер', 'тезер', ['', 'а', 'у', 'ом', 'е', 'ов']], ['карда́но', 'кардано', ['']], ['Сола́н', 'солан', ['а', 'ы', 'е', 'у', 'ой']],
    ['ипоте́к', 'ипотек', ['а', 'и', 'е', 'у', 'ой']], ['включи́', 'включи', ['т', 'шь', 'м', 'те']], ['включа́т', 'включат', ['']], ['звони́', 'звони', ['т', 'шь', 'м', 'те']],
    ['облегчи́', 'облегчи', ['т', 'шь', 'м', 'те']], ['углуби́', 'углуби', ['т', 'ть']]
  ];
  const STRESS = new Map();
  STRESS_SRC.forEach(([st, base, ends]) => ends.forEach(e => STRESS.set(base.toLowerCase() + e, st.toLowerCase() + e)));
  function stressRu(t) {
    if (UK) return t;
    return String(t).replace(/[А-Яа-яЁё]+/g, w => { const x = STRESS.get(w.toLowerCase()); return x ? (w[0] !== w[0].toLowerCase() ? x[0].toUpperCase() + x.slice(1) : x) : w; });
  }
  /* не больше двух запросов голоса одновременно: ElevenLabs отказывает, если их больше (12.11.2026 — из-за этого Орион переходил на голос телефона) */
  const VQ = { n: 0, q: [] };
  const vqTake = () => new Promise(res => { if (VQ.n < 2) { VQ.n++; res(); } else VQ.q.push(res); });
  const vqFree = () => { const nx = VQ.q.shift(); if (nx) nx(); else VQ.n--; };
  async function voFetch(text, ctx) { await vqTake(); try { return await A.voice(text, ctx || {}); } catch (e) { return null; } finally { vqFree(); } }
  /* короткие фразы-«подхваты» заранее в памяти телефона — Орион отзывается сразу, пока думает над ответом */
  const FILL = { news: 'Секунду, смотрю новости.', think: 'Секунду.' };
  let preloaded = false;
  function preloadFill() {
    if (preloaded || !A.voice || !ST.sound || (navigator.webdriver && !ST.forcePremium)) return; preloaded = true;
    Object.values(FILL).forEach((t, i) => setTimeout(async () => { const k = spoken(Lx(t)); if (VO.buf.has(k)) return; const r = await voFetch(k); if (r && r.audio) VO.buf.set(k, r.audio); }, 1500 + i * 700));
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
  function moneyW(usdV, exact) {   /* exact — цена монеты до доллара: «64 тысячи 149 долларов» (18.11.2026, владелец: «64 149, а Орион говорит 64 тыс.») */
    let s = ''; const rt = (() => { try { return +(ST.rate && ST.rate()) || 0; } catch (e) { return 0; } })();
    if (ST.curForce === 'UAH' && rt > 0) s = Math.round(Math.abs(usdV) * rt) + ' ₴';   /* переспрос «а в гривнах?» */
    else if (ST.curForce === 'USD') s = '$' + Math.round(Math.abs(usdV));
    else try { if (ST.money) s = ST.money(Math.abs(usdV), { d: 0, show: true }) || ''; } catch (e) {}
    const uah = /₴|грн/i.test(s), n = +(s.replace(/[^\d]/g, '')) || Math.round(Math.abs(usdV));
    const cur = k => (uah ? plural(k, 'гривна', 'гривны', 'гривен') : plural(k, 'доллар', 'доллара', 'долларов'));
    const gen = uah ? 'гривен' : 'долларов';
    if (n >= 1e6) { const m = Math.round(n / 1e5) / 10; return String(m).replace('.', ',') + ' ' + (m % 1 ? 'миллиона' : plural(m, 'миллион', 'миллиона', 'миллионов')) + ' ' + gen; }
    if (exact && n >= 1000 && n < 1e6) { const k = Math.floor(n / 1000), r = n % 1000; return k + ' ' + plural(k, 'тысяча', 'тысячи', 'тысяч') + (r ? ' ' + r + ' ' + cur(r) : ' ' + gen); }
    if (n >= 10000) { const k = Math.round(n / 1000); return k + ' ' + plural(k, 'тысяча', 'тысячи', 'тысяч') + ' ' + gen; }
    return n + ' ' + cur(n);
  }
  const ORD = ['', 'первой', 'второй', 'третьей', 'четвёртой', 'пятой', 'шестой', 'седьмой', 'восьмой', 'девятой', 'десятой'];
  const plain = h => String(h || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

  /* ---------- сводка: «Доброе утро, Андрей. Портфель — …» ---------- */
  /* антипаника (этап 5, 18.11.2026): биткоин за сутки −10% и больше — один раз в день спокойно: правило из книги и ваш план. Не совет купить или продать */
  const CALM_AT = -10;
  function calmDue() { const lv = (ST.S && ST.S.live) || {}, ch = lv.change ? +lv.change.BTC : NaN; return isFinite(ch) && ch <= CALM_AT && lsGet('or-calm', '') !== dayKey(); }
  function calmText() {
    const S = ST.S || {}, D = ST.D || {}, lv = S.live || {}, ch = +(lv.change && lv.change.BTC), btc = +(lv.prices && lv.prices.BTC) || +(D.prices && D.prices.BTC) || 0;
    const out = ['Спокойно' + nm() + '. Биткоин за сутки ' + signW(ch) + ' ' + pctW(ch) + '.'];
    out.push(pick(['Морган Хаузел в «Психологии денег» пишет: колебания — это плата за доходность, а не штраф.', 'Хаузел в «Психологии денег»: лучшая стратегия — та, которой вы держитесь и в плохие дни.', 'Хаузел в «Психологии денег»: главное в плане — что делать, если всё пошло не по плану. Этот план у вас уже есть.']));
    const ath = +(S.cycle && S.cycle.ath) || 0, l = ((S.cycle && S.cycle.levels) || []).filter(x => x && x.status === 'pending' && x.drop > 0).sort((a, b) => a.n - b.n)[0];
    if (ST.go) out.push('Биткоин на ступени лестницы — для таких дней она и рассчитана. Решение по плану за вами.');
    else if (l && ath > 0 && btc > 0) { const tg = ath * (1 - l.drop / 100), dist = (1 - tg / btc) * 100; if (dist > 0.5) out.push('Ваша лестница рассчитана заранее: до ' + (ORD[l.n] || l.n + '-й') + ' ступени ещё ' + pctW(dist) + '.'); }
    out.push('Резких решений сегодня не нужно.');
    return out.join(' ');
  }
  /* утро (первая сводка за день): что изменилось с прошлого раза, напоминания на сегодня, план месяца */
  const morningDue = () => lsGet('ms-newsDay', '') !== dayKey();
  function snapTake(D) {
    if (!D || !(D.total > 0) || D.noPrice) return;
    const sn = lsGet('or-snap', null), k = dayKey(), pnl = D.total - (+D.invPriced || 0);
    if (!sn || sn.day !== k) { if (sn && sn.day) ST.snapPrev = sn; const lv = (ST.S && ST.S.live) || {}; lsSet('or-snap', { day: k, at: Date.now(), total: D.total, pnl, btc: +(lv.prices && lv.prices.BTC) || +(D.prices && D.prices.BTC) || 0 }); }
    else if (!ST.snapPrev) ST.snapPrev = lsGet('or-snapPrev', null);
    if (ST.snapPrev) lsSet('or-snapPrev', ST.snapPrev);
  }
  function morningBits(D) {
    const out = [], M = window.MLX || {};
    const sp = ST.snapPrev;
    if (sp && sp.total > 0 && D.total > 0 && !D.noPrice) {
      const pnl = D.total - (+D.invPriced || 0), dl = pnl - (+sp.pnl || 0), pc = dl / sp.total * 100, yd = Date.now() - (+sp.at || 0) < 36 * 3600e3;
      const away = Math.floor((Date.now() - (+sp.at || 0)) / 864e5);   /* №7: перерыв 3+ дня — «что вы пропустили» */
      if (away >= 3) {
        const lv = (ST.S && ST.S.live) || {}, b = +(lv.prices && lv.prices.BTC) || +(D.prices && D.prices.BTC) || 0, bc = sp.btc > 0 && b > 0 ? (b / sp.btc - 1) * 100 : null;
        out.push('Вас не было ' + away + ' ' + plural(away, 'день', 'дня', 'дней') + '. За это время портфель ' + (Math.abs(pc) < 0.3 ? 'почти не изменился' : (dl > 0 ? 'вырос' : 'снизился') + ' на ' + (ST.hide ? pctW(Math.abs(pc)) : moneyW(Math.abs(dl)))) + (bc != null && Math.abs(bc) >= 1 ? ', биткоин — ' + signW(bc) + ' ' + pctW(bc) : '') + '.');
        const missed = TASK.rem.filter(x => x.done && x.when > (+sp.at || 0) && x.when < Date.now()).length;
        if (missed) out.push((missed > 1 ? 'Прошло напоминаний: ' + missed + ' — они в «Делах Ориона».' : 'Прошло одно напоминание — оно в «Делах Ориона».'));
      }
      else if (Math.abs(pc) >= 0.3) out.push((yd ? 'Со вчера' : 'С прошлого раза') + ' портфель ' + (dl > 0 ? 'вырос' : 'снизился') + ' на ' + (ST.hide ? pctW(Math.abs(pc)) : moneyW(Math.abs(dl))) + '.');
      else out.push((yd ? 'Со вчера' : 'С прошлого раза') + ' портфель почти не изменился.');
    }
    const td = new Date(), end = new Date(td.getFullYear(), td.getMonth(), td.getDate() + 1).getTime();
    const R = TASK.rem.filter(x => !x.done && x.when > Date.now() && x.when < end).sort((a, b) => a.when - b.when);
    if (R.length) out.push((R.length > 1 ? 'Сегодня напоминания: ' : 'Сегодня напоминание: ') + R.slice(0, 2).map(x => 'в ' + new Date(x.when).getHours() + ':' + pad2(new Date(x.when).getMinutes()) + ' — ' + x.t).join('; ') + '.');
    const mi = M.monthInfo ? M.monthInfo(D) : null, left = new Date(td.getFullYear(), td.getMonth() + 1, 0).getDate() - td.getDate();
    const lw = left <= 7 ? (left === 0 ? ' Сегодня последний день месяца.' : ' До конца месяца ' + left + ' ' + (left === 1 ? 'день' : left < 5 ? 'дня' : 'дней') + '.') : '';
    if (mi && mi.hasDep && mi.dca > 0.5) out.push('По плану месяца осталось купить на ' + (ST.hide ? 'сумму из плана' : moneyW(mi.dca)) + '.' + lw);
    else if (mi && !mi.hasDep && mi.budget > 0 && mi.bought < mi.budget * 0.98) out.push('План месяца выполнен на ' + Math.round(mi.bought / mi.budget * 100) + ' процентов.' + lw);
    const hl = ST.headline; if (hl && hl.day === dayKey() && hl.text) out.push(hl.text);   /* №11: одна свежая новость по вашим монетам — заголовок как есть, с источником */
    const ov = ceilDue(D); if (ov) out.push(ceilText(ov));
    const ls = lessonPick(D); if (ls) out.push(ls.say);
    return out;
  }
  /* №8: крипта выше потолка из личного плана — не чаще раза в неделю; без совета продать */
  const weekKey = () => { const d = new Date(), j = new Date(d.getFullYear(), 0, 1); return d.getFullYear() + '-w' + Math.ceil(((d - j) / 864e5 + j.getDay() + 1) / 7); };
  function ceilDue(D) { const M = window.MLX || {}; if (!M.cryptoOver || lsGet('or-ceil', '') === weekKey()) return null; return M.cryptoOver(D); }
  function ceilText(ov) { return 'Крипта сейчас — ' + ov.sh + ' ' + plural(ov.sh, 'процент', 'процента', 'процентов') + ' ваших накоплений при потолке ' + ov.ceil + ' из личного плана. Ребалансировка — это возврат к заданным долям, так её описывает Энтони Роббинс. Как вернуться к плану — решаете вы.'; }
  /* №9: урок к ситуации — раз в 3 дня, только не прочитанный; «открой урок» откроет его */
  const LES_FOR = [
    [(c) => c.ch != null && c.ch <= -5 || c.fear, 'emo', 'В такие дни помогает урок «Эмоции — главный враг».'],
    [(c) => c.ath || c.greed, 'timing', 'К такому рынку подходит урок «Не угадывай рынок».'],
    [(c) => c.over, 'alloc', 'По теме — урок «Главное решение — пропорции».']
  ];
  function lessonPick(D) {
    const M = window.MLX || {}; if (!M.lesson) return null;
    if (Date.now() - (+lsGet('or-lesAt', 0) || 0) < 3 * 864e5) return null;
    const S = ST.S || {}, lv = S.live || {}, ch = lv.change ? +lv.change.BTC : null, btc = +(lv.prices && lv.prices.BTC) || 0, ath = +(S.cycle && S.cycle.ath) || 0;
    let fv = null; try { const f = M.fng && M.fng(); if (f) fv = +f.v; } catch (e) {}
    const c = { ch: isFinite(ch) ? ch : null, fear: fv != null && fv <= 25, greed: fv != null && fv >= 75, ath: ath > 0 && btc >= ath * 0.995, over: !!(M.cryptoOver && M.cryptoOver(D)) };
    const hit = LES_FOR.find(([f, id]) => f(c) && !M.lesson.read(id)); if (!hit) return null;
    return { id: hit[1], say: hit[2] + ' Скажите «открой урок», и я открою.' };
  }
  function brief(o) {
    o = o || {};
    const S = ST.S, D = ST.D; if (!S || !D) return '';
    const morning = o.morning != null ? o.morning : morningDue(), calm = o.calm != null ? o.calm : calmDue();
    if (calm) { const c = calmText(); return morning ? c + ' ' + morningBits(D).join(' ') : c; }
    const h = new Date().getHours(), out = [];
    out.push((h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер') + nm() + '.');
    const lv = S.live || {}, btc = +(lv.prices && lv.prices.BTC) || +(D.prices && D.prices.BTC) || 0, ch = lv.change ? lv.change.BTC : null;
    const mb = morning ? morningBits(D) : [];
    if (mb.length && mb[0].indexOf('портфель') > 0) out.push(mb.shift());
    else if (D.total > 0 && !D.noPrice) {
      const inv = +D.invPriced || 0, gp = inv > 0 ? (D.total - inv) / inv * 100 : null;
      if (ST.hide) { if (gp != null) out.push('Суммы скрыты, поэтому только проценты: портфель ' + (gp >= 0 ? 'в плюсе' : 'в минусе') + ' на ' + pctW(gp) + '.'); }
      else out.push('Портфель — ' + moneyW(D.total) + (gp != null ? ', ' + signW(gp) + ' ' + pctW(gp) + ' к вложенному.' : '.'));
    } else if (!(S.tx || []).length) out.push('Портфель пока пуст. Начнём с первой покупки — кнопка «Купить».');
    if (btc > 0) out.push('Биткоин — ' + moneyW(btc, true) + (ch != null && isFinite(ch) ? (Math.abs(ch) < 0.5 ? ', за сутки почти без изменений.' : ', за сутки ' + signW(ch) + ' ' + pctW(ch) + '.') : '.'));
    const ath = +(S.cycle && S.cycle.ath) || 0;
    if (ST.go) out.push('Биткоин на ступени лестницы — по плану можно докупать. Решение за вами.');
    else if (ath > 0 && btc > 0) {
      const l = ((S.cycle && S.cycle.levels) || []).filter(x => x && x.status === 'pending' && x.drop > 0).sort((a, b) => a.n - b.n)[0];
      if (btc >= ath * 0.995) out.push('Это исторический максимум.');
      else if (l) { const tg = ath * (1 - l.drop / 100), dist = (1 - tg / btc) * 100; if (dist > 0.5) out.push('До ' + (ORD[l.n] || l.n + '-й') + ' ступени лестницы — ' + pctW(dist) + '.'); }
    }
    out.push(...mb);
    const dd = +(S.settings && S.settings.depositDay) || 0, td = new Date();
    if (dd && td.getDate() === dd && !(S.tx || []).some(t => t && t.type === 'deposit' && String(t.ts || '').slice(0, 10) === td.toISOString().slice(0, 10))) out.push('Сегодня день пополнения биржи.');
    if (ST.fresh > 0) out.push('Есть непрочитанный сигнал — он на главной.');
    let fv = null; try { const f = window.MLX && window.MLX.fng && window.MLX.fng(); if (f) { fv = +f.v; if (!mb.length && !morning) out.push('Индекс страха и жадности — ' + f.v + ', ' + f.w + '.'); } } catch (e) {}   /* утром — короче: индекс только словами ниже, если страх или жадность */
    /* «спокоен» — только когда и цена стоит, и настроение ровное. При страхе или жадности тихая цена — не спокойствие (17.11.2026, владелец: «страх 12, а потом — рынок спокоен» — нелогично) */
    const flat = ch != null && Math.abs(ch) < 1, fear = fv != null && isFinite(fv) && fv <= 25, greed = fv != null && isFinite(fv) && fv >= 75;
    out.push(fear ? (flat ? 'Цена за сутки почти не двигается, но настроение тревожное — на рынке сильный страх.' : 'На рынке сильный страх — в такие дни цена дёргается сильнее обычного.')
      : greed ? (flat ? 'Цена за сутки почти не двигается, но на рынке жадность — затишье бывает обманчивым.' : 'На рынке жадность — в такие дни легко поддаться азарту.')
      : flat ? 'Рынок спокоен. Скучно — значит, всё по плану.' : morning ? '' : pick(['На этом всё.', 'Если понадоблюсь — я рядом.', 'Остальное — штатно.']));
    return out.filter(Boolean).join(' ');
  }
  /* сводку озвучиваем заранее, в фоне: нажали на сферу — звук уже в памяти телефона и начинается сразу.
     Не чаще раза в 5 минут и только если текст изменился; под тестами и без живого голоса — нет */
  let preT = 0, preText = '', preAt = 0;
  function prefetchBrief(delay) {
    clearTimeout(preT);
    preT = setTimeout(() => {
      if (navigator.webdriver || !premiumOK() || !ST.S || !ST.D || ST.hide) return;
      const t = brief(); if (!t || (t === preText && now() - preAt < 1800) || now() - preAt < 300) return;
      preText = t; preAt = now();
      const parts = splitParts(stressRu(spoken(Lx(t))));
      parts.forEach((p, i) => voGet(p, parts.length > 1 ? { prev: parts[i - 1] || '', next: parts[i + 1] || '' } : {}));
    }, delay == null ? 4000 : delay);
  }
  function tell(auto) {
    const t = brief(); if (!t) return;
    if (calmDue()) lsSet('or-calm', dayKey());
    if (t.indexOf('ваших накоплений при потолке') >= 0) lsSet('or-ceil', weekKey());   /* сказали — следующая неделя */
    { const lp = lessonPick(ST.D); if (lp && t.indexOf(lp.say) >= 0) { ST.lessonOffer = { id: lp.id, at: now() }; lsSet('or-lesAt', Date.now()); } }
    lsSet('ms-news', Date.now()); lsSet('ms-newsDay', dayKey());
    speak(t, { pri: auto ? 1 : 2 });
    ST.lastLocal = { at: now(), q: '', sym: '', money: true, redo: () => brief() };   /* «а в гривнах?» после сводки */
    remember('Расскажи главное', t, true);
  }
  function weekDue() { const d = new Date(); return AUTO && !ST.hide && ST.sound && d.getDay() === 0 && d.getHours() >= 17 && !isNight() && !newsDue() && lsGet('or-week', '') !== weekKey() && !!(ST.S && (ST.S.tx || []).length); }
  function newsDue() {
    if (!AUTO || isNight() || ST.hide || !ST.sound || !ST.S) return false;
    return lsGet('ms-newsDay', '') !== dayKey();   /* сам — один раз в день, после первого касания */
  }


  /* ---------- вопросы голосом: нажать на сферу и спросить (18.11.2026, владелец: «зажимать неудобно — просто нажать и говорить») ---------- */
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
  /* украинский вопрос → русские основы слов, по которым Орион понимает вопрос на телефоне */
  const UKQ = [['скільки', 'сколько'], ['в мене', 'у меня'], ['у мене', 'у меня'], ['мене', 'меня'], ['моїх', 'моих'], ['мої', 'мои'], ['мій', 'мой'], ['мого', 'моего'], ['чи є', 'есть ли'],
    ['повідом', 'сообщи'], ['нагадай', 'напомни'], ['попередь', 'предупреди'], ['дай знати', 'дай знать'], ['сповіст', 'оповест'], ['коли', 'когда'], ['якщо', 'если'], ['буде', 'будет'],
    ['тижн', 'недел'], ['тиждень', 'неделя'], ['серія', 'серия'], ['серії', 'серии'], ['поспіль', 'подряд'], ['сходинк', 'ступен'], ['сходин', 'ступен'], ['сходами', 'лестницей'], ['сходах', 'лестнице'], ['сходів', 'лестницы'], ['сходи', 'лестница'], ['що з', 'что с'], ['що зі', 'что с'],
    ['просідан', 'просадк'], ['докупівл', 'докупк'], ['місяц', 'месяц'], ['місяць', 'месяц'], ['жадібн', 'жадн'], ['настр', 'настроени'], ['усього', 'всего'], ['всього', 'всего'], ['грошей', 'денег'],
    ['підсумок', 'итог'], ['підсумк', 'итог'], ['дякую', 'спасибо'], ['хто ти', 'кто ты'], ['що ти вмієш', 'что ты умеешь'], ['що вмієш', 'что умеешь'], ['допомож', 'помоги'], ['допомог', 'помощ'],
    ['зведення', 'сводка'], ['головне', 'главное'], ['новин', 'новост'], ['як справи', 'как дела'], ['що там', 'что там'], ['привіт', 'привет'], ['чому', 'почему'], ['через що', 'из-за чего'],
    ['ринок', 'рынок'], ['ринк', 'рынк'], ['що відбувається', 'что происходит'], ['що сталося', 'что случилось'], ['що з крипт', 'что с крипт'], ['зростає', 'растет'], ['росте', 'растет'], ['зростан', 'рост'], ['зріс', 'вырос'],
    ['виріс', 'вырос'], ['падає', 'падает'], ['падіння', 'падение'], ['впав', 'упал'], ['чи варто', 'стоит ли'], ['що думаєш', 'что думаешь'], ['поясни', 'объясни'], ['розкажи про', 'расскажи про'],
    ['що таке', 'что такое'], ['як працює', 'как работает'], ['навіщо', 'зачем'], ['а якщо', 'а если'], ['а що', 'а что'], ['тоді', 'тогда'], ['біткоїн', 'биткоин'], ['біткойн', 'биткойн'], ['біток', 'биток'],
    ['ефіріум', 'эфириум'], ['ефір', 'эфир'], ['ріпл', 'рипл'], ['тисяч', 'тысяч'], ['мільйон', 'миллион'], ['портфел', 'портфел'], ['ціна', 'цена'], ['ціни', 'цены']];
  const UKQ_RE = new RegExp(UKQ.slice().sort((a, b) => b[0].length - a[0].length).map(x => x[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g'), UKQ_M = new Map(UKQ);
  const norm = q => { let t = String(q || '').toLowerCase().replace(/ё/g, 'е').replace(/[’ʼ']/g, ''); if (UK) t = t.replace(UKQ_RE, m => UKQ_M.get(m)).replace(/[ії]/g, 'и').replace(/є/g, 'е').replace(/ґ/g, 'г'); return t; };
  function coinIn(q) {
    if (ST.symForce) return ST.symForce;   /* переспрос «то же для эфира» — монета подменяется */
    const w = norm(q).split(/[^a-zа-я0-9]+/).filter(Boolean), D = ST.D || {};
    const syms = Object.keys(ALIAS).concat((D.syms || []).filter(s => !ALIAS[s]));
    for (const s of syms) {
      const al = (ALIAS[s] || []).concat([s.toLowerCase()]);
      if (w.some(x => al.some(a => (a.length >= 4 ? x.startsWith(a) : x === a)))) return s;
    }
    return null;
  }
  /* число из фразы: «150», «110 000», «63.000», «150 тысяч», «63 тыс.», «1,5 тысячи», «120к», «шестьдесят три тысячи» (12.11.2026) */
  const NW = { ноль: 0, один: 1, одна: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13,
    четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70,
    восемьдесят: 80, девяносто: 90, сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900, полторы: 1.5, полтора: 1.5,
    /* украинские числительные после norm() (і→и, апостроф убран) */
    дви: 2, чотири: 4, шисть: 6, сим: 7, висим: 8, одинадцять: 11, дванадцять: 12, тринадцять: 13, чотирнадцять: 14, пятнадцять: 15, шистнадцять: 16, симнадцять: 17, висимнадцять: 18, девятнадцять: 19, двадцять: 20, тридцять: 30, пятдесят: 50, шистдесят: 60, симдесят: 70, висимдесят: 80, двисти: 200, чотириста: 400, пятсот: 500, шистсот: 600, симсот: 700, висимсот: 800, девятсот: 900 };
  function wordsToNum(t) {
    /* «шестьдесят три тысячи» → «63000»; цифры с словом («63 тысячи») не трогаем — их разберёт регулярка */
    return t.replace(/(^|[^а-яёa-z0-9])((?:(?:ноль|один|одна|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|одиннадцать|двенадцать|тринадцать|четырнадцать|пятнадцать|шестнадцать|семнадцать|восемнадцать|девятнадцать|двадцать|тридцать|сорок|пятьдесят|шестьдесят|семьдесят|восемьдесят|девяносто|сто|двести|триста|четыреста|пятьсот|шестьсот|семьсот|восемьсот|девятьсот|полторы|полтора|чотирнадцять|висимнадцять|девятнадцять|шистнадцять|одинадцять|дванадцять|тринадцять|пятнадцять|симнадцять|висимдесят|шистдесят|чотириста|двадцять|тридцять|пятдесят|симдесят|висимсот|девятсот|шистсот|чотири|двисти|пятсот|симсот|шисть|висим|дви|сим|тысяч[аиу]?|миллион(?:а|ов|и)?)(?:\s+|$))+)/g, (all, pre, m) => {
      let total = 0, cur = 0, any = false;
      for (const w of m.trim().split(/\s+/)) {
        if (/^тысяч/.test(w)) { total += (cur || 1) * 1e3; cur = 0; any = true; }
        else if (/^миллион/.test(w)) { total += (cur || 1) * 1e6; cur = 0; any = true; }
        else if (w in NW) { cur += NW[w]; any = true; }
      }
      return any ? pre + String(total + cur) + ' ' : all;
    });
  }
  function numIn(q, sym) {
    let t = wordsToNum(norm(q)).replace(/(\d)\s+(?=\d{3}(?!\d))/g, '$1');
    /* «63.000» / «63,000» — разделитель тысяч, если после точки ровно три цифры и целая часть не ноль */
    let alt = null;
    t = t.replace(/\b([1-9]\d{0,2})[.,](\d{3})(?![\d.,])/g, (m, a, b) => { alt = parseFloat(a + '.' + b); return a + b; });
    const m = t.match(/(\d+(?:[.,]\d+)?)\s*(тысяч[а-я]*|тыс\.?|к(?![а-яё])|k(?![a-z])|миллион[а-я]*|млн\.?|цент[а-я]*)?/);   /* «по 12 центов» — 0,12 доллара (BACKLOG №7) */
    if (!m) return null;
    let v = parseFloat(m[1].replace(',', '.')); if (!isFinite(v)) return null;
    if (m[2]) v = /цент/.test(m[2]) ? v / 100 : v * (/милл|млн/.test(m[2]) ? 1e6 : 1e3);
    /* сверка с ценой монеты: «биткоин будет 63» почти наверняка значит 63 тысячи; «1.250» у монеты по $1,2 — это 1,25 */
    const p = sym ? coinPrice(sym) : 0;
    if (p > 0) {
      const far = x => Math.abs(Math.log(x / p));
      const cands = [v]; if (!m[2]) { cands.push(v * 1e3); if (alt != null) cands.push(alt); }
      const best = cands.filter(x => x > 0).sort((a, b) => far(a) - far(b))[0];
      if (best !== v && far(v) > Math.log(20) && far(best) < Math.log(5)) v = best;
    }
    return v;
  }
  const qtyW = v => (+v).toLocaleString(LOC, { maximumFractionDigits: v >= 100 ? 0 : v >= 1 ? 3 : 6 });
  function coinPrice(sym) { const S = ST.S || {}, D = ST.D || {}, lv = S.live || {}; return +(lv.prices && lv.prices[sym]) || +(D.prices && D.prices[sym]) || 0; }
  function priceW(v) { return v >= 10 || (v >= 1 && +v.toFixed(2) % 1 === 0) ? moneyW(v, true) : (v >= 1 ? String(+v.toFixed(2)).replace('.', ',') : String(+v.toPrecision(3)).replace('.', ',')) + ' доллара'; }
  /* просьба поставить оповещение о цене — любыми словами: «сообщи», «напомни», «поставь уведомление», «оповещение», «сигнал» (12.11.2026) */
  function alertQ(t) { return /(сообщи|сповищ|нагадув|скажи,? когда|оповест|оповещ|уведом|напомни|напомин|предупреди|дай знать|сигнал|алерт|будильник)/.test(t); }
  function reply(q) {
    const t = norm(q), S = ST.S || {}, D = ST.D || {}, M = window.MLX || {};
    const has = (...k) => k.some(x => t.indexOf(x) >= 0);
    if (!t.trim()) return 'Не расслышал. Нажмите на меня и спросите ещё раз.';
    let sym = coinIn(t); const num = numIn(t, sym || (alertQ(t) ? 'BTC' : ''));
    /* оповещение: «сообщи, когда солана будет 150» */
    if (alertQ(t) && !remQ(t) && (has('когда', 'если') || num)) {
      /* монету не назвали («поставь уведомление на 74 тысячи») — берём ту, чья цена ближе всего к названной (обычно биткоин) */
      if (!sym && num > 0) { let best = '', d = 1e9; ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'TON', 'DOGE', 'ADA'].forEach(k => { const p = coinPrice(k); if (p > 0) { const x = Math.abs(Math.log(num / p)); if (x < d) { d = x; best = k; } } }); if (best && d < Math.log(3)) sym = best; }
      if (!sym) return 'Какая монета? Скажите, например: «сообщи, когда солана будет 150».';
      if (!(num > 0)) return 'Какую цену ждать? Скажите, например: «сообщи, когда ' + (NAME_N[sym] || sym).toLowerCase() + ' будет ' + Math.round((coinPrice(sym) || 100) * 1.1) + '».';
      const a = A.addAlert ? A.addAlert(sym, num) : null;
      if (!a) return 'Цена ' + sym + ' уже на этой отметке.';
      return 'Готово. Скажу, когда ' + (NAME_N[sym] ? NAME_N[sym].toLowerCase() : sym) + ' ' + (a.dir === 'up' ? 'поднимется' : 'опустится') + ' до отметки ' + priceW(num) + '.';
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
      const ch = S.live && S.live.change ? +S.live.change.BTC : NaN; if (isFinite(ch)) c.btc24 = Math.round(ch * 10) / 10;   /* для правила «без шуток, когда рынок падает» */
      if (pl && pl.a && Number.isInteger(pl.a.exp)) c.exp = pl.a.exp;   /* опыт из «Личного плана»: 0 — начинаю … 3 — больше 3 лет */
      { const d = new Date(), wd = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'][d.getDay()]; c.now = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ', ' + wd; }   /* местное время — для «напомни завтра в 9» */
      if (MEM.on && MEM.items.length) c.mem = MEM.items.slice(-12).map(x => String(x.t).slice(0, 100)); else if (!MEM.on) c.memOff = true;   /* долгая память — только строки без сумм */
    } catch (e) {}
    return c;
  }
  /* ---------- долгая память о человеке (18.11.2026, решение владельца: «и в телефоне, и резервная копия в аккаунте») ----------
     Цели, интересы, как с ним говорить, опыт — только с согласия («Запомнить?» → «да») или по прямой просьбе «запомни, что…».
     Никогда: суммы, долги, здоровье, пароли, ключи, адреса, документы. Хранится в телефоне (or-mem), копия — в аккаунте (app/orion-mem). */
  const MEM_BAD = /\d[\d\s.,]*\s*(\$|₴|€|грн|гривн|гривен|доллар|евро|usd|uah|тыс|млн|к\b)|\$\s*\d|долг|кредит|займ|ипотек|рассрочк|зарплат|доход|болез|болеет|диагноз|лекарств|здоров|беремен|пароль|парол|ключ|сид|seed|фраз[аы] восстановлен|карт[аыу]\s*\d|номер карт|адрес|паспорт|\d{6,}/i;
  const MEM = { items: lsGet('or-mem', []), on: lsGet('or-mem-on', true) !== false };
  if (!Array.isArray(MEM.items)) MEM.items = [];
  const memSafe = t => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length >= 3 && t.length <= 120 && !MEM_BAD.test(t); };
  function memPersist() { lsSet('or-mem', MEM.items); try { if (A.memSave) A.memSave(MEM.items); } catch (e) {} }
  function memAdd(t) {
    t = String(t || '').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
    if (!memSafe(t)) return false;
    const low = t.toLowerCase(); MEM.items = MEM.items.filter(x => x && String(x.t).toLowerCase() !== low);
    MEM.items.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t, at: Date.now() });
    if (MEM.items.length > 20) MEM.items = MEM.items.slice(-20);
    memPersist(); return true;
  }
  function memDel(id) { MEM.items = MEM.items.filter(x => x.id !== id); memPersist(); }
  function memClear() { MEM.items = []; memPersist(); }
  function memSetOn(on) { MEM.on = !!on; lsSet('or-mem-on', MEM.on); }
  /* копия из аккаунта: новый телефон — память возвращается; на старом — объединяем без повторов */
  async function memRestore() {
    if (ST.memSynced || !A.memLoad) return; ST.memTries = (ST.memTries || 0) + 1; if (ST.memTries > 6) { ST.memSynced = true; return; }
    let r = null; try { r = await A.memLoad(); } catch (e) { r = null; }
    if (r == null) return;   /* база ещё не готова — попробуем при следующей отрисовке */
    ST.memSynced = true;
    const seen = new Set(MEM.items.map(x => String(x.t).toLowerCase())); let add = 0;
    (Array.isArray(r) ? r : []).forEach(x => { if (x && x.t && memSafe(x.t) && !seen.has(String(x.t).toLowerCase())) { MEM.items.push({ id: x.id || Date.now().toString(36), t: String(x.t), at: +x.at || Date.now() }); add++; } });
    if (add) { MEM.items.sort((a, b) => a.at - b.at); MEM.items = MEM.items.slice(-20); lsSet('or-mem', MEM.items); }
    if (add || (MEM.items.length && !(Array.isArray(r) && r.length))) memPersist();
  }
  const YES = /^\s*(да|ага|угу|конечно|запомни|давай|можно|хорошо|ок|окей|так|верно|так точно|так, запамятай|так)(?=[\s,.!?]|$)/, NO = /^\s*(нет|не надо|не нужно|не запоминай|не стоит|ні|ни|не треба)(?=[\s,.!?]|$)/;
  /* команды памяти голосом: «запомни, что…», «что ты обо мне помнишь», «забудь всё», «забудь про…» */
  function memCmd(t, q) {
    if (/^(что|чего)\s+(ты\s+)?(обо мне|про меня)\s+(помнишь|знаешь)|^что ты помнишь/.test(t)) {
      if (!MEM.items.length) return 'Пока ничего. Скажите «запомни, что…» — и я запомню.';
      return 'Помню: ' + MEM.items.slice(-5).map(x => x.t).join('; ') + '.';
    }
    if (/^забудь\s+(все|всё)(?=[\s,.!?]|$)/.test(t)) { memClear(); return 'Готово, всё забыл.'; }
    const fm = t.match(/^забудь\s+(?:про|о|об|что)\s+(.+)$/);
    if (fm) { const w = fm[1].replace(/[.!?]+$/, '').trim(), x = MEM.items.find(i => String(i.t).toLowerCase().indexOf(w) >= 0) || MEM.items.find(i => w.split(/\s+/).some(k => k.length > 3 && String(i.t).toLowerCase().indexOf(k.slice(0, -1)) >= 0)); if (!x) return 'Такого я не помню.'; memDel(x.id); return 'Забыл.'; }
    const rm = String(q || '').match(/^\s*(?:орион,?\s*)?(?:запомни|запам['’ʼ]?ятай)[,:]?\s*(?:что|що)?\s*(.+)$/i);
    if (rm) {
      if (!MEM.on) return 'Память выключена в настройках — включите «Память Ориона», и я запомню.';
      const x = rm[1].replace(/[.!?]+$/, '').trim();
      return memAdd(x) ? 'Запомнил: ' + x + '.' : 'Это я не запоминаю: суммы, долги, здоровье и пароли пусть остаются только у вас.';
    }
    return '';
  }
  /* «мозг» предлагает запомнить последней строкой «ПАМЯТЬ: …» — вырезаем её из речи и спрашиваем согласие */
  const MEMO_RE = /\s*ПАМ(?:ЯТЬ|['’ʼ]?ЯТЬ):\s*([^\n]*)$/;
  function memoSplit(t) { const m = String(t || '').match(MEMO_RE); return m ? { text: String(t).slice(0, m.index).trim(), memo: m[1].replace(/[.!]+$/, '').trim() } : { text: String(t || '').trim(), memo: '' }; }
  /* ---------- голосовые действия (этап 4, 18.11.2026): переходы, заметки, напоминания, запись покупки, журнал ----------
     Деньги голосом не двигаются: запись покупки только открывает заполненную форму — сохраняет человек своей кнопкой.
     Заметки и напоминания — в телефоне, копия — в аккаунте (app/orion-notes, app/orion-rem). Журнал — в телефоне, 50 последних. */
  const TASK = { notes: lsGet('or-notes', []), rem: lsGet('or-rem', []), log: lsGet('or-log', []) };
  ['notes', 'rem', 'log'].forEach(k => { if (!Array.isArray(TASK[k])) TASK[k] = []; });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  function taskSave(k) {
    lsSet('or-' + k, TASK[k]);
    if (k !== 'log') try { if (A.docSave) A.docSave(k === 'notes' ? 'orion-notes' : 'orion-rem', TASK[k]); } catch (e) {}
    try { if (window.MLX && MLX.tasksRow) MLX.tasksRow(); } catch (e) {}
  }
  function logAct(t, how) { TASK.log.push({ at: Date.now(), t: String(t).slice(0, 160), how: how || 'голос' }); if (TASK.log.length > 50) TASK.log = TASK.log.slice(-50); taskSave('log'); }
  function noteAdd(t) { t = String(t || '').replace(/\s+/g, ' ').trim().replace(/^[,:—-]\s*/, ''); if (!t) return false; TASK.notes.push({ id: uid(), at: Date.now(), t: t.slice(0, 300) }); if (TASK.notes.length > 100) TASK.notes = TASK.notes.slice(-100); taskSave('notes'); return true; }
  function remAdd(t, when) { TASK.rem.push({ id: uid(), at: Date.now(), when, t: String(t).slice(0, 200), done: false }); TASK.rem = TASK.rem.filter(x => !x.done || Date.now() - x.when < 7 * 864e5).slice(-50); taskSave('rem'); }
  const pad2 = n => String(n).padStart(2, '0');
  const MON_G = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  function whenW(ms) {
    const d = new Date(ms), n = new Date(), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), dd = Math.round((day(d) - day(n)) / 864e5);
    const hm = d.getHours() + ':' + pad2(d.getMinutes());
    return (dd === 0 ? 'сегодня' : dd === 1 ? 'завтра' : dd === 2 ? 'послезавтра' : d.getDate() + ' ' + MON_G[d.getMonth()]) + ' в ' + hm;
  }
  /* напоминания: проверка раз в 20 секунд, пока приложение открыто; пропущенные — при следующем открытии */
  function remTick() {
    const due = TASK.rem.filter(x => !x.done && x.when <= Date.now());
    if (!due.length || document.getElementById('mlIntro')) return;
    due.forEach(x => { x.done = true; });
    taskSave('rem');
    const late = due.filter(x => Date.now() - x.when > 10 * 60e3);
    const txt = due.map(x => x.t).join('; ');
    speak((late.length === due.length ? (due.length > 1 ? 'Пропущенные напоминания: ' : 'Пропущенное напоминание: ') : 'Напоминание: ') + txt + '.', { pri: 3, raw: false });
    try { if (A.notify) A.notify('Напоминание MoneyLife', txt); } catch (e) {}
    logAct('Напомнил: ' + txt, 'авто');
  }
  /* копии из аккаунта: новый телефон — заметки и напоминания возвращаются */
  async function taskRestore() {
    if (ST.taskSynced || !A.docLoad) return; ST.taskTries = (ST.taskTries || 0) + 1; if (ST.taskTries > 6) { ST.taskSynced = true; return; }
    let a = null, b = null; try { [a, b] = await Promise.all([A.docLoad('orion-notes'), A.docLoad('orion-rem')]); } catch (e) { a = b = null; }
    if (a == null || b == null) return;
    ST.taskSynced = true;
    [['notes', a], ['rem', b]].forEach(([k, r]) => {
      const have = new Set(TASK[k].map(x => x.id)); let add = 0;
      (Array.isArray(r) ? r : []).forEach(x => { if (x && x.id && x.t && !have.has(x.id)) { TASK[k].push(x); add++; } });
      if (add) { TASK[k].sort((p, q) => p.at - q.at); lsSet('or-' + k, TASK[k]); }
      if (add || (TASK[k].length && !(Array.isArray(r) && r.length))) taskSave(k);
    });
  }
  /* исполнитель действий — общий для команд телефона и инструментов «мозга» */
  const NAV = [[/главн|домой|начал/, 'home'], [/монет|портфел|актив/, 'coins'], [/стратег|лестниц|ступен|резерв/, 'strategy'], [/истори|сделк|операци|покупки$|журнал сдел/, 'activity'],
    [/настройк/, 'settings'], [/личн\w* план|план\w* (пути|независим)|мой план/, 'plan'], [/знани|урок/, 'learn'], [/оповещ|алерт/, 'alerts'], [/памят|что ты помнишь/, 'memory'],
    [/замет|напомин|дела ориона|дела/, 'tasks'], [/покупк|купить|запис\w* покупк/, 'buy'], [/пополнен|депозит/, 'deposit']];
  function navTo(to) {
    if (!A.act) return '';
    const r = A.act('nav', { to }); if (!r || !r.ok) return '';
    logAct('Открыл: ' + r.label); return 'Открываю ' + r.label + '.';
  }
  function doAct(name, x) {
    x = x || {};
    if (name === 'navigate') { const say = navTo(String(x.screen || '')); return say || 'Этот экран я пока открыть не могу.'; }
    if (name === 'add_note') { const t = String(x.text || '').trim(); if (!t) return 'Что записать?'; noteAdd(t); logAct('Заметка: ' + t); return 'Записал.'; }
    if (name === 'add_reminder') {
      const t = String(x.text || '').trim(), w = Date.parse(String(x.when || '').replace(' ', 'T'));
      if (!t) return 'О чём напомнить?';
      if (!isFinite(w) || w < Date.now() + 30e3) return 'Не понял, когда напомнить. Скажите, например: «напомни завтра в девять проверить портфель».';
      if (w > Date.now() + 366 * 864e5) return 'Так далеко вперёд не напоминаю — не больше чем на год.';
      remAdd(t, w); logAct('Напоминание ' + whenW(w) + ': ' + t);
      let tip = ''; try { if (A.pushOn && !A.pushOn() && Date.now() - (ST.pushTip || 0) > 6 * 3600e3) { ST.pushTip = Date.now(); tip = ' Чтобы оно пришло и при закрытом приложении, включите в настройках «Сигналы на телефоне».'; } } catch (e) {}
      return 'Напомню ' + whenW(w) + ': ' + t + '.' + tip;
    }
    if (name === 'record_purchase') {
      const sym = String(x.sym || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
      const r = A.act ? A.act('buy', { sym, usd: +x.usd || 0, qty: +x.qty || 0, price: +x.price || 0 }) : null;
      if (!r || !r.ok) return 'Не получилось открыть запись покупки.';
      logAct('Открыл запись покупки' + (sym ? ' ' + sym : '') + (+x.usd ? ' на $' + (+x.usd) : '') + (+x.price ? ' по $' + (+x.price) : '') + ' — ждёт вашего «Сохранить»');
      return 'Открыл запись покупки' + (sym ? ' ' + sym : '') + '. Проверьте цифры и нажмите «Сохранить» — без вашего нажатия ничего не запишется.';
    }
    if (name === 'set_price_alert') {
      const sym = String(x.sym || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), price = +x.price;
      if (!sym || !(price > 0)) return 'Для оповещения нужна монета и цена.';
      let r = null; try { r = A.addAlert ? A.addAlert(sym, price) : null; } catch (e) { r = null; }
      if (!r) return 'Не получилось поставить оповещение.';
      logAct('Оповещение: ' + sym + ' — $' + price); return typeof r === 'string' ? r : 'Поставил оповещение: ' + sym + ', ' + priceW(price) + '.';   /* «0,12 доллара», а не «0 долларов» (BACKLOG №7) */
    }
    return '';
  }
  const REM_Q = /(напомни|напомин|нагадай|нагадаю)/, REM_T = /(завтра|сегодня|послезавтра|утром|вечером|дн[её]м|ночью|через|в\s+\d{1,2}(:\d\d)?(?![\d.,])|час|понедельн|вторник|сред[уау]|четверг|пятниц|суббот|воскресен|числа|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/, PRICE_T = /(будет|станет|достигнет|упад|вырастет|подним|опуст|дойд|цена|курс|по\s+\d|долл|\$)/;
  const remQ = t => REM_Q.test(t) && REM_T.test(t) && !PRICE_T.test(t);
  const buyQ = t => /(запиши|внеси|добавь|запиши мне|занеси)\s+(мою\s+|мне\s+)?(покупк|что (я )?купил|что (я )?докупил)|^(я\s+)?(купил|докупил|прикупил)\s/.test(t);   /* «запиши покупку…», «я купил…» — цифры разбирает «мозг», сохраняет человек */
  /* «…про налоги»: значимые слова после «про» и их основы (короткие — целиком, длинные — без окончания), чтобы «биржу» нашла «на бирже» (18.11.2026, BACKLOG №1) */
  const ABOUT_STOP = /^(и|в|во|на|с|со|по|для|что|это|эту|этот|эти|мою|мой|мои|мое|ту|тот|те|к|ко|о|об|за|из|у|от|до|не|же|ли|бы|а|но|или|где|как|мне|меня)$/, WSPLIT = /[^a-zа-яіїєґ0-9]+/;
  function aboutQ(t, q) {
    const m = t.match(/(?:^|\s)про\s+(.+)$/); if (!m) return null;
    const w = m[1].split(WSPLIT).filter(x => x && !ABOUT_STOP.test(x));
    const rq = String(q || '').match(/(?:^|\s)про\s+(.+)$/i), raw = ((rq && rq[1]) || m[1]).replace(/[\s.,!?…]+$/, '').trim();
    /* слово до 4 букв — целиком (только с окончанием до 2 букв: «долг» — «долги», но не «долларов»; «газ» — не «газета»); длиннее — без известного окончания («налоги» → «налог») */
    return { raw, stems: w.map(x => { if (x.length <= 4) return { s: x, short: true }; const e = ABOUT_END.find(e => x.length - e.length >= 3 && x.endsWith(e)) || ''; return { s: x.slice(0, x.length - e.length), short: false }; }) };
  }
  /* окончания существительных и прилагательных (длинные — первыми; і, ї, є — украинские); хвост слова заметки после основы — только такое окончание,
     «-ов/-ев» + окончание прилагательного («налоговую») или ничего: «почту» не находит «почтальон», «карты» — «картошку», «долги» — «долгосрочный» (ревью Глеба, PR №12) */
  const ABOUT_END = ['ами', 'ями', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ой', 'ей', 'ам', 'ям', 'ах', 'ях', 'ом', 'ем', 'ов', 'ев', 'ую', 'юю', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ий', 'ый', 'ых', 'их', 'ым', 'им', 'а', 'я', 'у', 'ю', 'ы', 'и', 'е', 'о', 'ь', 'і', 'ї', 'є'],
    ABOUT_TAIL = new RegExp('^(?:' + ABOUT_END.join('|') + '|(?:ов|ев)(?:ый|ий|ой|ая|ое|ые|ую|ого|ому|ым|ых|ыми|ом))?$'),
    ABOUT_NEVER = /^(почти|долго)$/;   /* наречия, совпадающие с формой слова («почти» — как «почта», «долго» — как «долг»): никогда не считаем совпадением */
  function aboutPick(list, ab) {   /* подходят все основы; из подходящих — самая свежая; нет подходящих — null */
    if (!ab.stems.length) return null;
    const hit = list.filter(x => { const w = norm(x.t).split(WSPLIT).filter(y => !ABOUT_NEVER.test(y)); return ab.stems.every(st => w.some(y => y.indexOf(st.s) === 0 && (st.short ? y.length - st.s.length <= 2 : ABOUT_TAIL.test(y.slice(st.s.length))))); });
    return hit.reduce((b, x) => (!b || (+x.at || 0) >= (+b.at || 0) ? x : b), null);   /* при равном времени — записанная позже */
  }
  /* команды телефона: без сервера и без затрат */
  function taskCmd(t, q) {
    if (/^(открой|покажи|давай|відкрий)\s+(этот\s+|мне\s+)?урок$|^давай урок$/.test(t.trim()) && ST.lessonOffer && now() - ST.lessonOffer.at < 1800 && window.MLX && MLX.lesson) {
      const id = ST.lessonOffer.id; MLX.lesson.open(id); logAct('Открыл урок: ' + MLX.lesson.title(id)); ST.lessonOffer = null; return 'Открываю урок «' + MLX.lesson.title(id) + '».';
    }
    const nv = t.match(/^(открой|покажи|перейди|зайди|отвори|відкрий|покажи мне)\s+(?:мне\s+)?(?:в\s+|на\s+)?(.+)$/);
    if (nv) { const tgt = NAV.find(([re]) => re.test(nv[2])); if (tgt) { const say = navTo(tgt[1]); if (say) return say; } }
    const nm = String(q || '').match(/^\s*(?:орион,?\s*)?(?:запиши|запиши-ка|сделай|добавь|запиши мне)?\s*(?:заметку|заметка|в заметки|нотатку)[,:]?\s*(?:что\s+)?(.+)$/i);
    if (nm && nm[1] && nm[1].trim().length > 1) { noteAdd(nm[1]); logAct('Заметка: ' + nm[1].trim()); return 'Записал.'; }
    if (/^(какие|прочитай|прочти|что)\s+(у меня\s+)?(в\s+)?заметк/.test(t) || /^мои заметки/.test(t)) {
      if (!TASK.notes.length) return 'Заметок пока нет. Скажите «запиши заметку…».';
      return 'Последние заметки: ' + TASK.notes.slice(-3).reverse().map(x => x.t).join('; ') + '.';
    }
    if (/^удали\s+(последнюю\s+)?заметку/.test(t)) {
      const ab = aboutQ(t, q);
      if (ab) {   /* «удали заметку про налоги» — снимаем самую свежую из тех, где есть эти слова; нет такой — ничего не трогаем */
        const x = aboutPick(TASK.notes, ab); if (!x) return 'Не нашёл заметку про ' + ab.raw + '.';
        TASK.notes = TASK.notes.filter(y => y !== x); taskSave('notes'); logAct('Удалил заметку: ' + x.t); return 'Удалил: ' + x.t + '.';
      }
      const x = TASK.notes.pop(); if (!x) return 'Заметок нет.'; taskSave('notes'); logAct('Удалил заметку: ' + x.t); return 'Удалил: ' + x.t + '.';
    }
    if (/^(какие|что)\s+(у меня\s+)?напоминани|^мои напоминани/.test(t)) {
      const L = TASK.rem.filter(x => !x.done).sort((a, b) => a.when - b.when);
      if (!L.length) return 'Напоминаний нет.';
      return L.slice(0, 3).map(x => whenW(x.when) + ' — ' + x.t).join('; ') + '.';
    }
    if (/^(отмени|удали|убери)\s+(все\s+)?напоминани/.test(t) && aboutQ(t, q)) {   /* «отмени напоминание про биржу» — только подходящее, самое свежее */
      const ab = aboutQ(t, q), x = aboutPick(TASK.rem.filter(y => !y.done), ab); if (!x) return 'Не нашёл напоминание про ' + ab.raw + '.';
      TASK.rem = TASK.rem.filter(y => y !== x); taskSave('rem'); logAct('Отменил напоминание: ' + x.t); return 'Отменил напоминание: ' + x.t + '.';
    }
    if (/^(отмени|удали|убери)\s+(все\s+)?напоминани/.test(t)) { const n = TASK.rem.filter(x => !x.done).length; TASK.rem = TASK.rem.filter(x => x.done); taskSave('rem'); logAct('Отменил напоминания: ' + n); return n ? 'Отменил.' : 'Напоминаний и так нет.'; }
    return '';
  }
  const ASK_ERR = { day_limit: 'На сегодня вопросы ко мне закончились. Завтра продолжим.', month_limit: 'Лимит вопросов на этот месяц исчерпан.' };
  async function answer(q, byVoice) {
    const t = norm(q), local = t.trim() ? reply(q) : reply('');
    const sure = local && local.indexOf(UNK) !== 0 && !/^Не расслышал/.test(local);
    const follow = ST.lastBrain && now() - ST.lastBrain < 120 && (/^\s*(а|и|ну|тогда|а\s+если)(?=[\s,?!.]|$)/.test(t) || t.trim().split(/\s+/).length <= 3) && !/(у меня|мои |мой |сколько у)/.test(t);   /* переспрос: «а эфир?», «а почему?» */
    const toBrain = A.ask && t.trim() && (remQ(t) || buyQ(t) || (!(alertQ(t) && sure) && (marketQ(t) || !sure || follow)));   /* «напомни завтра в 9…» — разбирает «мозг» (дата и время) */
    if (ST.pendingMemo && now() - ST.pendingMemo.at < 60) {   /* ответ на «Запомнить: …?» */
      const pm = ST.pendingMemo; ST.pendingMemo = null;
      if (YES.test(t)) { const okm = memAdd(pm.t); speak(okm ? 'Запомнил.' : 'Это я не запоминаю.', { pri: 2 }); return; }
      if (NO.test(t)) { speak('Хорошо, не запоминаю.', { pri: 2 }); return; }
    }
    const mc = memCmd(t, q);
    if (mc) { speak(mc, { pri: 2, follow: byVoice }); return; }
    const tc = taskCmd(t, q);
    if (tc) { speak(tc, { pri: 2, follow: byVoice && !/^Открываю/.test(tc) }); return; }
    const fu = localFollow(t);
    if (fu) { remember(q, fu, PRIV.test(fu)); speak(fu, { pri: 2, follow: byVoice }); return; }
    if (!toBrain) {
      remember(q, local, PRIV.test(local)); speak(local, { pri: 2, follow: byVoice });
      if (sure) ST.lastLocal = { at: now(), q, sym: coinIn(t) || '', money: /доллар|гривн|гривен|[$₴]/.test(local), redo: () => reply(q) };
      return;
    }
    ST.lastLocal = null;
    const sym = coinIn(t) || '';
    speak(sym || marketQ(t) ? FILL.news : FILL.think, { pri: 2 });
    const hist = (ST.hist || []).filter(x => now() - x.at < 900).slice(-6).map(x => ({ q: x.q, a: x.priv ? maskNums(x.a) : x.a }));
    /* поток (18.11.2026): как только готовы первые целые предложения (от ~60 знаков) — говорим их, остальное — следом без паузы */
    const gen = ST.askGen = (ST.askGen || 0) + 1, sq = t => String(t).replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim();
    let acc = '', first = '';
    const onPart = t => {
      acc += t; if (first || gen !== ST.askGen) return;
      const all = sq(acc).replace(/\s*ПАМ['’ʼ]?ЯТЬ:.*$/, ''), m = all.match(/^.*?[.!?…](?=\s)/g), cut = (() => { let c = ''; const re = /[^.!?…]+[.!?…]+(?=\s)/g; let x; while ((x = re.exec(all))) { c = all.slice(0, x.index + x[0].length); if (c.length >= 60) break; } return c.length >= 60 || (c && all.length > c.length + 80) ? c : ''; })();
      if (m && cut) { first = cut.trim(); ST.lastBrain = now(); speak(nameFill(first), { pri: 2, raw: true, live: true }); }
    };
    let r = null; try { r = await A.ask(q, sym, { hist, ctx: brainCtx(), lang: UK ? 'uk' : 'ru' }, onPart); } catch (e) { r = null; }
    ST.lastAsk = r;
    if (gen !== ST.askGen) return;   /* пока ждали — человек перебил или задал новый вопрос */
    if (r && r.act && r.act.name) {   /* «мозг» попросил действие — исполняет телефон и сам говорит, что вышло */
      const say = doAct(r.act.name, r.act.input);
      if (say) { remember(q, say); ST.lastBrain = now(); if (!first) speak(say, { pri: 2, follow: byVoice && !/^Открыл/.test(say) }); else speak(say, { pri: 2, append: true, follow: false }); return; }
    }
    if (r && r.text) {
      const ms = memoSplit(r.text); r.text = ms.text || r.text;
      ST.lastBrain = now(); remember(q, r.text);
      const full = sq(r.text);
      const memo = MEM.on && ms.memo && memSafe(ms.memo) && !MEM.items.some(x => String(x.t).toLowerCase() === ms.memo.toLowerCase()) ? ms.memo : '';
      if (memo) setTimeout(() => { if (gen !== ST.askGen) return; ST.pendingMemo = { t: memo, at: now() }; speak((UK ? 'Запам\u2019ятати: ' : 'Запомнить: ') + memo + '?', { pri: 2, raw: true, append: true, follow: true }); }, 0);
      if (first && full.indexOf(first) === 0) { const rest = full.slice(first.length).trim(); if (rest) { const rf = nameFill(rest); voPrefetch(rf, true); speak(rf, { pri: 2, follow: byVoice && !memo, raw: true, append: true, live: true }); } else if (byVoice && !memo && TTS.cur && TTS.cur.text === nameFill(first)) TTS.cur.follow = true; return; }
      if (!first) speak(nameFill(r.text), { pri: 2, follow: byVoice && !memo, raw: true, live: true });
      return;
    }
    if (first) return;   /* начало ответа уже прозвучало — обрыв связи не озвучиваем */
    if (buyQ(t) && !(r && ASK_ERR[r.error])) { speak(doAct('record_purchase', { sym: sym || '' }) + (sym ? '' : ' Монету и цифры впишите сами.'), { pri: 2 }); return; }   /* без связи — просто открываем форму покупки */
    if (remQ(t) && !(r && ASK_ERR[r.error])) { speak('Сейчас нет связи — не могу разобрать время напоминания. Попробуйте чуть позже.', { pri: 2 }); return; }
    const msg = (r && ASK_ERR[r.error]) || (sure ? local : (sym && coinPrice(sym) ? reply(NAME_N[sym] || sym) + ' ' : '') + 'Сейчас не могу связаться с сервером — попробуйте чуть позже.');
    speak(msg, { pri: 2 });
  }
  function remember(q, a, priv) { ST.hist = (ST.hist || []).filter(x => now() - x.at < 900).concat([{ q: String(q).slice(0, 200), a: String(a).slice(0, 400), at: now(), priv: !!priv }]).slice(-6); }
  /* ответы телефона про ваши деньги (портфель, монеты, резерв, план) уходят «мозгу» без чисел: суммы остаются на телефоне (18.11.2026) */
  const PRIV = /(У вас|Портфель|Резерв|куплено|покупок|по плану|План месяца|Серия|За неделю|Суммы скрыты)/i;
  const maskNums = a => String(a).replace(/\d[\d\s.,]*\d|\d/g, '…');
  /* имя: «мозг» пишет метку {ИМЯ}, само имя на сервер не уходит — подставляем здесь */
  function nameFill(t) {
    t = String(t || '');
    if (ST.name) return t.replace(/\{ИМЯ\}/g, ST.name);
    t = t.replace(/,\s*\{ИМЯ\}\s*(?=[,.!?—]|$)/g, '').replace(/\{ИМЯ\}\s*[,—]?\s*/g, '').replace(/\s+([,.!?])/g, '$1').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  /* переспрос к ответу телефона: «а в гривнах?», «сколько это в долларах», «а эфир?», «то же самое для соланы» */
  function localFollow(t) {
    const L = ST.lastLocal; if (!L || now() - L.at > 180) return '';
    const words = t.trim().split(/\s+/).length; if (words > 7 || /(купи|продай|сообщи|напомни|почему|новост)/.test(t)) return '';
    const cur = /(^|\s)в\s+(гривн|грн|гривен|гривень)/.test(t) ? 'UAH' : /(^|\s)в\s+(доллар|бакс|usd)/.test(t) ? 'USD' : /(^|\s)в\s+евро/.test(t) ? 'EUR' : '';
    if (cur) {
      if (!L.money) return '';
      if (cur === 'EUR') return 'В евро пока не считаю — могу в гривнах или в долларах.';
      if (cur === 'UAH' && !(() => { try { return +(ST.rate && ST.rate()) > 0; } catch (e) { return false; } })()) return 'Курс гривны ещё не загружен — спросите чуть позже.';
      ST.curForce = cur; try { return L.redo(); } finally { ST.curForce = ''; }
    }
    const sym = coinIn(t);
    if (sym && L.sym && sym !== L.sym && L.q && /^\s*(а|и|ну|давай|теперь|тоже|то же|так же)(?=[\s,?!.]|$)|то же самое|тоже самое|так же|для\s/.test(t)) {
      ST.symForce = sym; try { const r = reply(L.q); ST.lastLocal = { at: now(), q: L.q, sym, money: L.money, redo: () => { ST.symForce = sym; try { return reply(L.q); } finally { ST.symForce = ''; } } }; return r; } finally { ST.symForce = ''; }
    }
    return '';
  }
  function listen(lo) {
    lo = lo || {};
    stopVoice(); voUnlock(); preloadFill();
    /* lo.tap — нажали на сферу: тишина или нет микрофона — Орион рассказывает главное; lo.barge — перебили Ориона нажатием: тишина — просто замолкает */
    if (!SRC || (lo.tap && ST.micDenied)) { if (lo.tap) { tell(false); return; } speak('Голосовые вопросы на этом телефоне недоступны. Нажмите на меня — расскажу главное за сегодня.', { pri: 2 }); return; }
    if (ST.rec) { try { ST.rec.abort(); } catch (e) {} ST.rec = null; }
    let rec; try { rec = new SRC(); } catch (e) { speak('Микрофон сейчас недоступен.', { pri: 2 }); return; }
    rec.lang = LOC; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
    ST.rec = rec; let heard = '', done = false;
    if (ui.cap) { ui.capT.textContent = Lx(lo.tap ? 'Слушаю… Спросите или помолчите — расскажу главное.' : 'Слушаю…'); ui.cap.classList.add('on', 'talk', 'listen'); clearTimeout(ui.capOff); }
    pulse(1); buzz(12);
    let idle = 0;
    const quiet = () => { if (done) return; done = true; ST.rec = null; clearTimeout(idle); try { rec.abort(); } catch (e) {} if (ui.cap) ui.cap.classList.remove('listen', 'on', 'talk'); };   /* тишина — молча заканчиваем разговор */
    ST.recQuiet = quiet; ST.askGen = (ST.askGen || 0) + 1;   /* новый вопрос — прошлый ответ «мозга», если он ещё в пути, не озвучиваем */
    const hush = lo.follow || lo.barge;   /* в разговоре или после перебивания тишина — просто перестаём слушать */
    idle = setTimeout(() => { if (heard) return; quiet(); if (lo.tap) tell(false); }, lo.tap ? 3500 : hush ? 2500 : 6000);   /* нажали и молчат 3,5 с — сводка; в разговоре 2,5 с тишины — Орион перестаёт слушать сам */
    const end = () => { if (done) return; clearTimeout(idle); done = true; ST.rec = null; if (ui.cap) ui.cap.classList.remove('listen'); try { rec.stop(); } catch (e) {}
      if (!heard && (hush || lo.tap)) { if (ui.cap) ui.cap.classList.remove('on', 'talk'); if (lo.tap) tell(false); return; } answer(heard, true); };
    rec.onresult = e => { heard = Array.from(e.results).map(r => r[0].transcript).join(' ').trim(); if (ui.capT && heard) ui.capT.textContent = '«' + heard + '»'; ST.lastHeard = heard; if (e.results[e.results.length - 1].isFinal) end(); else { clearTimeout(idle); idle = setTimeout(end, 1300); } };   /* договорили и замолчали — не ждём телефон, отвечаем через 1,3 секунды */
    rec.onerror = e => { if (done) return; clearTimeout(idle); done = true; ST.rec = null; if (ui.cap) ui.cap.classList.remove('listen');
      const denied = e.error === 'not-allowed' || e.error === 'service-not-allowed';
      if (lo.tap && !heard) { if (denied) ST.micDenied = true; if (ui.cap) ui.cap.classList.remove('on', 'talk'); tell(false); return; }   /* нажатие без вопроса (или микрофон не разрешён) — сводка, как раньше */
      if (hush && !denied) { if (ui.cap) ui.cap.classList.remove('on', 'talk'); return; }   /* в разговоре тишина — просто заканчиваем */
      speak(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Нет доступа к микрофону. Разрешите его этому приложению в настройках телефона.' : e.error === 'network' ? 'Для распознавания речи нужен интернет.' : 'Не расслышал. Нажмите на меня и спросите ещё раз.', { pri: 2 }); };
    rec.onend = () => { if (!done) end(); };
    try { rec.start(); } catch (e) { done = true; ST.rec = null; if (ui.cap) ui.cap.classList.remove('listen'); speak('Микрофон сейчас занят.', { pri: 2 }); }
  }

  /* ---------- нажатие на сферу ---------- */
  function tapped() {
    ST.lastInput = now(); pulse(0.8); buzz(8); voUnlock(); preloadFill();
    if (ST.rec) { if (ST.recQuiet) ST.recQuiet(); else { try { ST.rec.abort(); } catch (e) {} ST.rec = null; } if (ui.cap) ui.cap.classList.remove('listen', 'on', 'talk'); return; }   /* слушал — нажатие отменяет, без сводки и без «не расслышал» */
    if (speaking()) { listen({ barge: true }); return; }   /* говорил — замолкает и сразу слушает (перебивание) */
    if (!ST.name && !ST.asked && A.askName) { ST.asked = true; lsSet('or-asked', 1); A.askName(); return; }
    listen({ tap: true });   /* нажали — слушает вопрос; промолчали — расскажет главное */
  }
  function greet(name) {
    if (name != null) ST.name = String(name).trim().slice(0, 24);
    speak((ST.name ? 'Приятно познакомиться, ' + ST.name + '. ' : 'Хорошо. ') + 'Я Орион. Слежу за портфелем и рынком и скажу, когда будет важное. Нажмите на меня и спросите голосом. А если промолчать — расскажу главное за сегодня.', { pri: 2 });
  }

  /* покупка (12.11.2026): что именно пополнено и на сколько, в конце — сколько теперь стоит портфель.
     «Биткоин пополнен на 5 долларов, эфир — на 3 доллара, солана — на 2 доллара. Портфель теперь стоит 960 долларов.» */
  const FEM_N = { SOL: 1 };
  function buyLine(items, D) {
    const its = items.filter(x => x && x.sym).sort((a, b) => (b.usd || 0) - (a.usd || 0)).slice(0, 5);
    if (!its.length) return '';
    const nameN = y => NAME_N[y] || ('монета ' + y), lower = y => NAME_N[y] ? NAME_N[y].toLowerCase() : y;
    let alt = ''; try { alt = String((window.altNow && window.altNow()) || '').toUpperCase(); } catch (e) {}
    const head = y => (y === alt && y !== 'BTC' && y !== 'ETH' && !NAME_N[y] ? 'Монета месяца ' + y : nameN(y));
    const fem = y => !!FEM_N[y] || (!NAME_N[y]);
    let t;
    if (ST.hide) t = head(its[0].sym) + (fem(its[0].sym) ? ' пополнена' : ' пополнен') + (its.length > 1 ? ', а также ' + its.slice(1).map(x => lower(x.sym)).join(', ') : '') + '.';
    else {
      const f = its[0];
      t = head(f.sym) + (fem(f.sym) ? ' пополнена' : ' пополнен') + (f.usd > 0 ? ' на ' + moneyW(f.usd) : '');
      its.slice(1).forEach(x => { t += ', ' + (x.sym === alt && !NAME_N[x.sym] ? 'монета месяца ' + x.sym : lower(x.sym)) + (x.usd > 0 ? ' — на ' + moneyW(x.usd) : ''); });
      t += '.';
      if (D && D.total > 0) t += ' Портфель теперь стоит ' + moneyW(D.total) + '.';
    }
    return t;
  }
  /* ---------- события ---------- */
  function trigger(name, data, force) {
    data = data || {};
    const D = ST.D || {}, S = ST.S || {};
    let t = '';
    if (name === 'deposit') { t = 'Пополнение записано' + nm() + '.'; buzz([10, 40, 10]); }
    else if (name === 'buy' && data.items && data.items.length) t = buyLine(data.items, D);
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
    else if (name === 'priceAlert') { t = Nm() + (NAME_N[data.sym] || data.sym) + (data.dir === 'up' ? ' поднялся' : ' опустился') + ' до ' + priceW(+data.price) + (data.late ? ', пока приложение было закрыто, — оповещение сработало.' : ' — ваше оповещение сработало.'); t = cap1(t); buzz([20, 60, 20]); }
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
    /* телефон может сбросить холст, пока приложение свёрнуто (Android) — тогда масштаб слетал и Орион рисовался вдвое меньше; восстанавливаем каждый кадр */
    const dp = Math.min(window.devicePixelRatio || 1, 2);
    if (dp !== DPR || cv.width !== Math.round(W * dp)) fit(); else g.setTransform(DPR, 0, 0, DPR, 0, 0);
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
    ST.hide = !!P.hide; ST.sound = P.msVoice !== false; if (ST.fx !== !!P.msFx) { ST.fx = !!P.msFx; voFx(); } ST.go = !!info.go; ST.fresh = info.fresh || 0; ST.money = info.money || ST.money; if (typeof info.rate === 'function') ST.rate = info.rate;
    ST.name = String(P.name || '').trim().slice(0, 24);
    snapTake(D);
    if (A.news && window.mlUser && (!ST.headline || ST.headline.day !== dayKey()) && !ST.newsAsk) {   /* №11: заголовки — с сервера, без «мозга» и без затрат */
      ST.newsAsk = 1; const syms = Object.keys(D.h || {}).filter(k => (D.h[k] && +D.h[k].usd > 0)).sort((a, b) => (+D.h[b].usd || 0) - (+D.h[a].usd || 0)).slice(0, 3);
      Promise.resolve(A.news(Array.from(new Set(syms.concat(['BTC']))))).then(r => { const it = r && r.items && r.items[0]; ST.headline = { day: dayKey(), text: it && it.title ? 'Из новостей, ' + it.src + ': «' + String(it.title).replace(/[«»"]/g, '').slice(0, 160) + '».' : '' }; }).catch(() => {}).finally(() => { ST.newsAsk = 0; });
    }
    prefetchBrief();
    if (!ST.sound && TTS.ok && TTS.cur) try { speechSynthesis.cancel(); } catch (e) {}
    /* антипаника вживую: падение дошло до −10%, пока приложение открыто и с ним уже говорили (звук разрешён жестом) */
    if (AUTO && ST.lastInput && !ST.hide && ST.sound && calmDue() && !morningDue() && !speaking() && visible() && !isNight()) { lsSet('or-calm', dayKey()); speak(calmText(), { pri: 2 }); }
    ST.S = S; ST.D = D;
    if (!ST.memSynced && window.mlUser) memRestore();
    if (!ST.taskSynced && window.mlUser) taskRestore();
    try { if (A.pushRefresh) A.pushRefresh(); } catch (e) {}
    if (!ST.remT) { ST.remT = setInterval(remTick, 20000); setTimeout(remTick, 4000); }
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
    /* №10: итог недели — сам, в воскресенье вечером, раз в неделю (если утренняя сводка уже была) */
    else if (BL.ready && !ST.autoT && now() - ST.t0 > 4 && weekDue()) ST.autoT = setTimeout(() => { ST.autoT = 0; if (weekDue() && !speaking() && visible()) { lsSet('or-week', weekKey()); const t = reply('итог недели'); if (t) { speak(t, { pri: 1 }); remember('Итог недели', t, true); } } }, 1800);
  }

  function init(opts) {
    if (inited) return true;
    opts = opts || {}; host = opts.host; A = opts.app || {};
    if (!host) return false;
    if (!document.getElementById('ms-css')) { const st = document.createElement('style'); st.id = 'ms-css'; st.textContent = CSS; document.head.appendChild(st); }
    ST.reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    /* звук на телефоне разрешается только после касания: включаем аудио при любом касании экрана, чтобы Орион мог сказать о записи, сделанной формой (12.11.2026) */
    ['pointerdown', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (A.voice && ST.sound) voUnlock(); }, { capture: true, passive: true }));
    ST.asked = !!lsGet('or-asked', 0);
    host.querySelectorAll('.ms-cv,.ms-hit,.ms-sign,.ms-still').forEach(c => c.remove());
    cv = document.createElement('canvas'); cv.className = 'ms-cv'; cv.setAttribute('aria-hidden', 'true');
    g = cv.getContext('2d'); if (!g) return false;
    host.appendChild(cv); fit();
    cv.addEventListener('contextrestored', () => { fit(); wake(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { fit(); wake(); } });
    ui.hit = document.createElement('button'); ui.hit.type = 'button'; ui.hit.className = 'ms-hit';
    ui.hit.setAttribute('aria-label', 'Орион, голосовой помощник: нажмите и спросите голосом, промолчите — расскажу главное'); host.appendChild(ui.hit);
    let lpT = 0, lp = false;
    ui.hit.addEventListener('pointerdown', () => { lp = false; clearTimeout(lpT); lpT = setTimeout(() => { lp = true; ST.lastInput = now(); listen(); }, 450); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => ui.hit.addEventListener(ev, () => clearTimeout(lpT)));
    ui.hit.addEventListener('contextmenu', e => e.preventDefault());
    ui.hit.addEventListener('click', () => { if (lp) { lp = false; return; } tapped(); });
    ui.cap = document.createElement('button'); ui.cap.type = 'button'; ui.cap.className = 'or-cap'; ui.cap.setAttribute('aria-live', 'polite'); ui.cap.setAttribute('translate', 'no');   /* субтитры переводит сам Орион (ответы «мозга» уже на нужном языке) */
    ui.cap.innerHTML = '<i aria-hidden="true"></i><b>' + Lx('Орион') + '</b><span></span><em aria-hidden="true"></em>'; ui.capT = ui.cap.querySelector('span'); ui.capN = ui.cap.querySelector('em');
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
    hush: () => { TTS.q = []; stopVoice(); },
    tasks: { notes: () => TASK.notes.slice(), rem: () => TASK.rem.slice(), log: () => TASK.log.slice(), delNote: id => { TASK.notes = TASK.notes.filter(x => x.id !== id); taskSave('notes'); }, delRem: id => { TASK.rem = TASK.rem.filter(x => x.id !== id); taskSave('rem'); }, when: ms => whenW(ms) },
    mem: { list: () => MEM.items.slice(), del: id => memDel(id), clear: () => memClear(), on: v => { if (v != null) memSetOn(v); return MEM.on; } },   /* замолчать сразу (перед обучающим роликом) */
    ask: q => answer(q), listen: () => listen(),
    event: (name, data) => trigger(name, data),
    debug: {
      state: () => ({ engine: TTS.engine || '', err: TTS.lastErr || '', mood: ST.mood, raf: !!raf, frame: firstFrame, voice: !!TTS.voice, tts: TTS.ok, talking: speaking(), lvl: +ST.lvl.toFixed(2), said: ST.lastSay || '', name: ST.name, cap: !!(ui.cap && ui.cap.classList.contains('on')), pal: cur[0].map(Math.round) }),
      hour: h => { ST.forceHour = h; },
      premium: on => { ST.forcePremium = !!on; VO.off = 0; },
      spoken: t => spokenRu(t),
      spokenUk: t => spokenUk(t),
      buyLine: items => buyLine(items, ST.D || {}),
      norm: q => norm(q),
      lx: t => Lx(t),
      ask: q => answer(q), lastAsk: () => ST.lastAsk || null, ctx: () => brainCtx(), hist: () => ST.hist || [],
      mood: m => { if (ST.forceHour == null) ST.forceHour = 12; ST.pct = { calm: 0, up: 3, rocket: 9, down: -3, crash: -9 }[m]; ST.go = m === 'hunter'; if (m === 'offline') { ST.offline = true; ST.offSince = now() - 120; } else ST.offline = false; ST.lastInput = now(); wake(); },
      say: t => speak(t, { pri: 2 }), sayLog: () => ST.sayLog || [], nameFill: t => nameFill(t), memo: t => memoSplit(t), memSafe: t => memSafe(t), act: (n, x) => doAct(n, x), calm: () => calmText(), priceW: v => priceW(v), figs: t => figs(t), weekDue: () => weekDue(), headline: v => { ST.headline = v; }, lessonPick: () => lessonPick(ST.D), ceilText: o => ceilText(o), lessonOffer: v => { ST.lessonOffer = v ? { id: v, at: now() } : null; }, calmDue: () => calmDue(), brief2: o => brief(o), snapPrev: v => { ST.snapPrev = v; }, remTick: () => remTick(), remDue: (t, ago) => remAdd(t, Date.now() - (ago || 1000)), remQ: t => remQ(t), split: (t, live) => splitParts(t, live), stress: t => stressRu(t),
      tap: () => tapped(),
      brief: () => brief(),
      reply: q => reply(q),
      event: (n, d) => trigger(n, d, true),
      due: () => newsDue()
    }
  };
})();
