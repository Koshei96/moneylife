/* MoneyLife — голосовой помощник «Аура» (10.11.2026, решение владельца: вместо 3D-человечка — современная живая сфера).
   Без three.js: один маленький canvas 2D рядом с суммой. Голос прежний — voice-slitok.js (фразы) и voice-slitok-n.js (числа, сводка).
   Приложение вызывает то же, что и раньше:
     Mascot.init({ host, app })     — один раз; host — слой поверх блока баланса (#mascot);
     Mascot.sync(info)              — при каждой отрисовке главной (info: S, D, P, pct, go, fresh, offline, money);
     Mascot.number({ el, to, up })  — сумма изменилась: цифры перекатываются, как на табло;
     Mascot.event(name, data)       — событие (рубеж 14 дней и т. п.).
   Нажатие на сферу — короткая сводка голосом (биткоин, портфель, сигнал); повторное — тишина.
   Цвет — настроение: спокойный, зелёный на прибыли, янтарный — «внимание», красноватый — сильное падение. */
(function () {
  'use strict';
  if (window.Mascot) return;
  const SELF = (document.currentScript && document.currentScript.src) || '';
  const VOICE_URL = /mascot\.js/.test(SELF) ? SELF.replace(/mascot\.js/, 'voice-slitok.js') : 'voice-slitok.js';
  const VOICE_N_URL = VOICE_URL.replace(/voice-slitok\.js/, 'voice-slitok-n.js');

  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
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
.ms-sign{position:absolute;right:52px;top:calc(50% + 42px);transform:translateX(50%);padding:3px 10px;border-radius:999px;background:var(--raise,#222227);color:var(--fg,#f5f5f7);font-weight:600;font-size:12px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .2s}
.ms-sign.on{opacity:1}
.ms-sign.neg{color:var(--neg,#ff5b5b)}
.ms-dg{position:relative;display:inline-block}
.ms-dg>i{display:inline-block;font-style:normal;animation:msDgIn .5s cubic-bezier(.2,.9,.3,1.25) both}
.ms-dg>b{position:absolute;left:0;top:0;font-weight:inherit;animation:msDgOut .45s ease-in both;pointer-events:none}
.ms-dg.d>i{animation-name:msDgInD}.ms-dg.d>b{animation-name:msDgOutD}
@keyframes msDgIn{from{transform:translateY(.62em);opacity:0}to{transform:none;opacity:1}}
@keyframes msDgOut{to{transform:translateY(-.62em);opacity:0}}
@keyframes msDgInD{from{transform:translateY(-.62em);opacity:0}to{transform:none;opacity:1}}
@keyframes msDgOutD{to{transform:translateY(.62em);opacity:0}}
@media (prefers-reduced-motion:reduce){.ms-sign{transition:none}.ms-dg>i,.ms-dg>b{animation:none}.ms-dg>b{display:none}}`;

  let host, A = {}, cv, g, raf = 0, inView = true, inited = false, firstFrame = false, lastF = 0, W = 132, DPR = 1;
  const ui = {};
  const ST = {
    mood: 'calm', moodSince: 0, pct: null, go: false, fresh: 0, offline: false, offSince: 0, hide: false, sound: true,
    lastInput: now(), lastEvent: now(), nextSignal: 0, lastAuto: -1e9, lastEv: -1e9, reduced: false, money: null,
    signText: '', signNeg: false, talk: 0, lvl: 0.05, pulse: 0, think: 0, S: null, D: null, userUntil: 0, lastSay: '', t0: now(), autoT: 0, signT: []
  };
  const BL = { ready: false, tx: new Set(), real: 0, alert: '', ath: 0, screen: '' };
  const PHRASES = /*PHRASES*/{"intro":["Привет! Я Слиток, робот-хранитель твоего биткоина. Нажми на меня!"],"tap":["Бип-буп!","Привет!","Щекотно!","Я на посту.","Слиток на связи!","Все системы в норме.","Всё под контролем.","Ой! Кто здесь?"],"tapNight":[{"t":"Тише… ночь.","w":1},{"t":"Я тут. Шепчу, чтобы никого не разбудить.","w":1}],"dizzy":["Ошибка! Голова кружится!","Перегрев! Перегрев!"],"dance":["Па-па-пам!","Танцевальный режим!"],"carry":["Эй! Куда несёшь?","Ух ты, я лечу!"],"drop":["Приземлился!","Мягкая посадка."],"deposit":["Пополнение принято!","Звенит приятно!","Ещё немного в копилку."],"buy":["Взяли. Теперь держим.","Покупка по плану — люблю.","Монета в копилке."],"sellProfit":["Прибыль в кармане!","Зафиксировали. Хорошая работа."],"sellLoss":["Бывает. Главное — остаться в игре.","Опыт — тоже капитал."],"airdrop":["Подарок с неба!","Бесплатно — моё любимое слово."],"signal":["Сигнал на покупку!","Уровень сработал — можно докупить."],"news":["Есть новый сигнал — загляни.","Пришёл сигнал, проверь."],"hunter":["Скидки! Лесенка сработала.","Распродажа, а не трагедия."],"ath":["Новый максимум биткоина!","Вот это высота!"],"athPort":["Портфель на максимуме!"],"milestone":["Новый рубеж взят!"],"coinUp":["Монета разогналась!"],"coinDown":["Монета просела."],"up":["Неплохо идём.","Рынок улыбается."],"rocket":["Ух, полетели!","Вот это день!"],"down":["Видали и хуже. Держим.","Терпение — моя суперсила."],"crash":["Спокойно. Паника — плохой советчик.","Шторм пройдёт. Держим курс."],"bored":["Скучновато…","Пересчитаю-ка блоки.",{"t":"21 миллион — и ни монетой больше.","s":"Двадцать один миллион — и ни монетой больше."}],"night":[{"t":"Ночь. Рынок не спит, а я посплю.","w":1}],"wake":["А? Я не сплю! Я на посту."],"hide":["Ничего не вижу!"],"offline":["Ищу сигнал…"],"screen":["Свежий подбор альткоинов готов!"],"wipe":["Протру цифры — пусть блестят.","Чистота — залог прибыли!"],"wipeDone":["Блестит!","Как новенькие."],"sit":["Посижу тут, посмотрю.","Отличный вид отсюда."],"zap":["Обновляю цифры!","Цена сменилась — переставлю."],"musicStart":["Включу любимый трек.","Немного музыки не помешает."],"musicTap":["Классный трек!","Слышишь? Бит качает!","Тут сейчас лучшая часть!"],"danceSolo":["Не могу устоять — танцую!","Это мой трек!"],"phoneStart":["Сыграю пару уровней.","Пять минут в телефоне — и обратно на пост."],"phoneWin":["Есть! Новый рекорд!","Уровень пройден!"],"phoneLose":["Эх, почти!","Опять этот босс…"],"phoneTap":["Секунду, тут босс!","Почти прошёл уровень!"],"bookStart":["Почитаю немного.","Так, где я остановился?"],"bookTap":["Интересная глава!","Дочитаю страницу — и поболтаем."],"bookHm":[{"t":"Хм, любопытно.","w":1},{"t":"Вот это поворот!","w":1}],"chartStart":["Посмотрю графики.","Что там на графиках?"],"chartUp":["Неделя в плюсе — тренд вверх.","Свечи зелёные. Нравится."],"chartDown":["Неделя в минусе. Смотрю уровни.","Красные свечи. Без паники — изучаю."],"chartFlat":["Боковик. Рынок думает.","На графике тишина."],"chartTap":["Смотри, вот тут интересно.","Рисую линию тренда."],"newsStart":["Что пишут в новостях?","Свежая газета!"]}/*/PHRASES*/;
  const MILES = [1000, 2000, 3000, 5000, 7000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 200000, 250000, 500000, 1000000];
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
        case 'page': noise(c, { t, d: 0.2, v: 0.05 * v, f: 3200, f2: 1700, q: 0.9 }); noise(c, { t: t + 0.05, d: 0.12, v: 0.025 * v, f: 900, q: 1.2 }); break;
        case 'paper': noise(c, { t, d: 0.34, v: 0.06 * v, f: 1500, f2: 3200, q: 0.7 }); noise(c, { t: t + 0.2, d: 0.3, v: 0.05 * v, f: 2700, f2: 1300, q: 0.8 }); break;
        case 'tick': tone(c, { type: 'triangle', f: 2600, t, d: 0.02, v: 0.014 * v, lp: 5000 }); break;
        case 'gameWin': [1047, 1319, 1568, 2093].forEach((f, i) => tone(c, { type: 'square', f, t: t + i * 0.07, d: 0.08, v: 0.011 * v, lp: 3200 })); break;
        case 'gameLose': tone(c, { type: 'square', f: 520, f2: 160, t, d: 0.42, v: 0.011 * v, lp: 2400 }); break;
        case 'holo': tone(c, { f: 320, f2: 1500, t, d: 0.4, v: 0.03 * v }); noise(c, { t, d: 0.45, v: 0.012 * v, f: 6500, q: 1.5, type: 'highpass' }); break;
        case 'holoOff': tone(c, { f: 1300, f2: 260, t, d: 0.3, v: 0.025 * v }); break;
        case 'click': tone(c, { type: 'triangle', f: 1900, t, d: 0.025, v: 0.03 * v, lp: 5000 }); break;
        case 'leakHat': noise(c, { t, d: 0.035, v: 0.006 * v, f: 8000, q: 0.8, type: 'highpass' }); break;
        case 'leakKick': tone(c, { f: 110, f2: 50, t, d: 0.09, v: 0.012 * v, lp: 400 }); break;
      }
    } catch (e) {}
  }
  /* голос: оглавление — маленький voice-slitok.js, сами MP3 — двоичный файл с хэшем в имени (кэшируется надолго);
     старый формат (base64 внутри скрипта) тоже понимаем */
  function rawFrom(v, url) {
    if (v.b64) { const bin = atob(v.b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); v.b64 = ''; return Promise.resolve(u); }
    if (v.bin) return fetch(url.replace(/[^/]*$/, '') + v.bin).then(r => { if (!r.ok) throw new Error('voice ' + r.status); return r.arrayBuffer(); }).then(b => new Uint8Array(b));
    return Promise.reject(new Error('нет голоса'));
  }
  function loadVoiceFile(url, key, onScript) {
    const v = window.MS_VOICE && window.MS_VOICE[key]; if (v) { onScript(v); return; }
    const s = document.createElement('script'); s.src = url; s.async = true;
    s.onload = () => onScript(window.MS_VOICE && window.MS_VOICE[key]); s.onerror = () => onScript(null);
    document.head.appendChild(s);
  }
  function loadPack() {
    if (AU.pack || AU.loading || AU.failed || !ST.sound) return;
    AU.loading = true;
    try {
      loadVoiceFile(VOICE_URL, 'slitok', v => {
        if (!v) { AU.loading = false; AU.failed = true; return; }
        rawFrom(v, VOICE_URL).then(u => {
          AU.raw = u; AU.pack = v; AU.loading = false;
          const w = AU.want; AU.want = null; if (w && now() - w.t < 4) voice(w.id, w.o);
        }).catch(() => { AU.loading = false; AU.failed = true; });
      });
    } catch (e) { AU.loading = false; AU.failed = true; }
  }
  function loadPackN() {
    if (AU.packN || AU.loadingN || AU.failedN || !ST.sound) return;
    AU.loadingN = true;
    try {
      loadVoiceFile(VOICE_N_URL, 'slitokN', v => {
        if (!v) { AU.loadingN = false; AU.failedN = true; return; }
        rawFrom(v, VOICE_N_URL).then(u => { AU.rawN = u; AU.packN = v; AU.loadingN = false; })
          .catch(() => { AU.loadingN = false; AU.failedN = true; });
      });
    } catch (e) { AU.loadingN = false; AU.failedN = true; }
  }
  const packOf = id => (AU.pack && AU.pack.idx[id] ? [AU.pack, AU.raw] : AU.packN && AU.packN.idx[id] ? [AU.packN, AU.rawN] : null);
  function vbuf(c, id) {
    let p = AU.cache.get(id); if (p) return p;
    const pk = packOf(id); if (!pk) return Promise.reject(new Error('нет фразы ' + id));
    const e = pk[0].idx[id], ab = pk[1].slice(e[0], e[0] + e[1]).buffer;
    p = new Promise((res, rej) => { try { const r = c.decodeAudioData(ab, res, rej); if (r && r.then) r.then(res, rej); } catch (x) { rej(x); } });
    AU.cache.set(id, p); p.catch(() => AU.cache.delete(id));
    if (AU.cache.size > 48) AU.cache.delete(AU.cache.keys().next().value);
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
  /* несколько кусочков подряд (новости: шаблон + число): gap < 0 — стык внутри фразы, > 0 — пауза между фразами */
  function seqDur(seq) { let d = 0; for (const x of seq) { const pk = packOf(x.id); if (pk) d += pk[0].idx[x.id][2] / 1000 + (x.gap || 0); } return Math.max(0, d); }
  function voiceSeq(seq, o) {
    o = o || {}; const c = au(); if (!c) return 0;
    const list = seq.filter(x => packOf(x.id)); if (!list.length) return 0;
    const dur = seqDur(list); ST.userUntil = now() + dur + 0.6; ST.lastSay = 'news:' + list.map(x => x.id).join(',');
    Promise.all(list.map(x => vbuf(c, x.id))).then(bufs => {
      if (!ST.sound || document.hidden) return;
      stopVoice();
      const g = c.createGain(); g.gain.value = o.vol || 1; g.connect(AU.vo);
      let t0 = c.currentTime + 0.05; const srcs = [];
      bufs.forEach((b, i) => { const s = c.createBufferSource(); s.buffer = b; s.connect(g); s.start(t0); srcs.push(s); t0 += b.duration + (list[i].gap || 0); });
      const h = { stop() { srcs.forEach(s => { try { s.stop(); } catch (e) {} }); } };
      AU.cur = h; srcs[srcs.length - 1].onended = () => { if (AU.cur === h) AU.cur = null; };
    }).catch(() => {});
    return dur;
  }
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
  const NEWS_COINS = ['BTC', 'ETH', 'XRP', 'SOL', 'NEAR', 'BNB', 'AVAX', 'TRX', 'OP', 'ATOM', 'POL', 'DOT', 'XLM', 'ADA', 'TON', 'SUI', 'LINK', 'DOGE', 'RENDER', 'ARB', 'ONDO', 'FET', 'HYPE', 'AAVE', 'LTC', 'ETC', 'MNT', 'QNT', 'ZEC', 'XMR', 'WBT', 'LEO', 'BCH', 'RAIN', 'UNI', 'CC', 'GRAM', 'HBAR', 'SHIB', 'TAO', 'ENA', 'CRO', 'OKB', 'M', 'PUMP', 'PEPE', 'ASTER', 'BTW', 'WLFI', 'WLD', 'SKY', 'MORPHO', 'ICP', 'HTX', 'BGB', 'VVV', 'JST', 'KCS', 'GT', 'KAS', 'ALGO', 'Q', 'JUP', 'PI', 'INJ', 'NEXO', 'FIL', 'LIT', 'AKE', 'DASH', 'CAKE', 'XDC', 'NIGHT', 'PEARL', 'ZRO', 'ETHFI', 'APT', 'PYTH', 'BDX', 'ZAMA']; /* монеты, чьи названия озвучены в voice-slitok-n.js */
  function pctIds(v) { v = clamp(Math.round(v), 1, 99); if (v <= 30) return ['n.p.' + v]; return ['n.t.' + Math.floor(v / 10), 'n.pu.' + (v % 10)]; }
  function kIds(K) { K = clamp(Math.round(K), 1, 999); const out = [], hu = Math.floor(K / 100), r = K % 100; if (hu) out.push('n.h.' + hu); if (r >= 20) out.push('n.t.' + Math.floor(r / 10), 'n.k.' + (r % 10)); else out.push('n.k.' + r); return out; }
  /* проценты на газете и в пузыре — целыми, как их произносит голос (pctIds округляет так же) */
  const pctTxt = v => Math.abs(v) < 0.5 ? '≈0%' : (v >= 0 ? '+' : '−') + clamp(Math.round(Math.abs(v)), 1, 99) + '%';
  function newsCompose() {
    const S = ST.S, D = ST.D; if (!S || !D) return null;
    const lv = S.live || {}, btc = +(lv.prices && lv.prices.BTC) || +(D.prices && D.prices.BTC) || 0;
    if (!(btc > 0)) return null;
    const ch = lv.change ? lv.change.BTC : null, it = [], hasCh = ch != null && isFinite(ch);
    const btcIt = hasCh ? (Math.abs(ch) < 0.5 ? ['n.btcFlat'] : [ch > 0 ? 'n.btcUp' : 'n.btcDown'].concat(pctIds(Math.max(1, Math.abs(ch))))) : null;
    it.push({ k: 'price', s: 1 + Math.random() * 0.5, ids: ['n.price'].concat(kIds(btc / 1000)) });
    const ath = +(S.cycle && S.cycle.ath) || 0;
    if (ath > 0) { const d = (1 - btc / ath) * 100; it.push(d <= 0.5 ? { k: 'ath', s: 6, ids: ['n.athNow'] } : { k: 'ath', s: (d < 10 ? 2.2 : 1) + Math.random() * 0.5, ids: ['n.athTo'].concat(pctIds(Math.max(1, d))) }); }
    const lvl = ((S.cycle && S.cycle.levels) || []).filter(l => l && l.status === 'pending' && l.drop > 0).sort((a, b) => a.n - b.n)[0];
    if (ath > 0 && lvl) { const tg = ath * (1 - lvl.drop / 100), dist = (1 - tg / btc) * 100; if (dist > 0.5) it.push({ k: 'lvl', s: (dist < 8 ? 3 : 0.9) + Math.random() * 0.5, ids: ['n.lvl'].concat(kIds(tg / 1000), ['n.lvlTo'], pctIds(Math.max(1, dist))) }); }
    if (!ST.hide && ST.pct != null && isFinite(ST.pct)) { const p = ST.pct; it.push({ k: 'port', s: 1.4 + Math.min(3, Math.abs(p) / 2) + Math.random() * 0.5, ids: Math.abs(p) < 0.5 ? ['n.portFlat'] : [p > 0 ? 'n.portUp' : 'n.portDown'].concat(pctIds(Math.max(1, Math.abs(p)))) }); }
    let best = null;
    if (!ST.hide) for (const s of D.syms || []) {
      if (s === 'BTC') continue;   /* любая монета портфеля: если названия нет в голосе — скажем «одна из твоих монет», а название покажем в пузыре */
      const c = lv.change && lv.change[s], v = (+(D.prices && D.prices[s]) || 0) * ((D.h && D.h[s] && D.h[s].qty) || 0);
      if (c == null || !isFinite(c) || v < 20 || Math.abs(c) < 3) continue;
      if (!best || Math.abs(c) > Math.abs(best.c)) best = { s, c };
    }
    if (best) {
      const up = best.c > 0, named = NEWS_COINS.indexOf(best.s) >= 0;
      it.push({ k: 'coin', s: 1.5 + Math.min(3, Math.abs(best.c) / 4) + Math.random() * 0.5,
        ids: (named ? ['n.c.' + best.s, up ? 'n.coinUp' : 'n.coinDown'] : [up ? 'n.anyUp' : 'n.anyDown']).concat(pctIds(Math.abs(best.c))),
        bub: { text: best.s + ' ' + pctTxt(best.c), neg: !up } });
    }
    it.push(ST.fresh > 0 || ST.go ? { k: 'sig', s: 4, ids: ['n.sig'] } : { k: 'sig', s: 0.6 + Math.random() * 0.4, ids: ['n.noSig'] });
    it.sort((a, b) => b.s - a.s);
    const sel = it.slice(0, btcIt ? 2 : 3), hr = new Date().getHours();
    const intro = hr >= 5 && hr < 12 && lsGet('ms-newsDay', '') !== dayKey() ? 'n.morning' : hr >= 18 ? 'n.evening' : 'n.intro.' + (Math.random() < 0.5 ? 0 : 1);
    const parts = [{ ids: [intro], gap: 0.3 }];
    if (btcIt) parts.push({ ids: btcIt, gap: 0.34 }); sel.forEach(x => parts.push({ ids: x.ids, gap: 0.34, bub: x.bub }));
    parts.push({ ids: ['n.outro.' + (Math.random() < 0.5 ? 0 : 1)], gap: 0 });
    const seq = []; parts.forEach(p => p.ids.forEach((id, i) => seq.push({ id, gap: i === p.ids.length - 1 ? p.gap : -0.07 })));
    let date = ''; try { date = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) {}
    const price = Math.round(btc).toLocaleString('ru-RU').replace(/ /g, ' ') + ' $';
    const head = hasCh ? 'БИТКОИН ' + pctTxt(ch) + ' ЗА СУТКИ' : 'БИТКОИН — ' + price;
    const sub = 'Цена ' + price + (ath > 0 ? (btc >= ath * 0.995 ? ' · исторический максимум!' : ' · до максимума ' + Math.round((1 - btc / ath) * 100) + '%') : '');
    return { seq, parts, bubs: sel.filter(x => x.bub).map(x => x.bub.text), paper: { head, sub, date, spark: lv.spark && lv.spark.BTC, up: !hasCh || ch >= 0 }, keys: [btcIt ? 'btc' : ''].concat(sel.map(x => x.k)) };
  }
  const canTalk = () => !!(ST.sound && AU.c && AU.c.state === 'running' && !isNight() && AU.pack && AU.packN && !document.hidden);
  function newsDue() {
    if (isNight() || ST.hide || !ST.sound || !ST.S || !(AU.c && AU.c.state === 'running')) return false;
    return Date.now() - (lsGet('ms-news', 0) || 0) > 3 * 3600e3;
  }
  /* выпуск из частей: часть без голоса пропускаем целиком; для пузыря считаем, когда звучит его часть */
  function newsSeq(items) {
    const seq = [], bubs = [];
    for (const p of items.parts || []) {
      if (p.ids.some(id => !packOf(id))) continue;
      const i0 = seq.length;
      p.ids.forEach((id, i) => seq.push({ id, gap: i === p.ids.length - 1 ? p.gap : -0.07 }));
      if (p.bub) bubs.push({ i0, i1: seq.length - 1, text: p.bub.text, neg: p.bub.neg });
    }
    let t = 0.05; const st = seq.map(x => { const s0 = t, pk = packOf(x.id); t += (pk ? pk[0].idx[x.id][2] / 1000 : 0) + (x.gap || 0); return s0; });
    return { seq, bubs: bubs.map(b => { const pk = packOf(seq[b.i1].id); return { from: st[b.i0], to: st[b.i1] + (pk ? pk[0].idx[seq[b.i1].id][2] / 1000 : 0.8) + 0.8, text: b.text, neg: b.neg }; }) };
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
  /* ---------- подпись под сферой (монета и процент во время сводки, рубеж) ---------- */
  function setSign(text, neg) { ST.signText = text; ST.signNeg = !!neg; if (ui.sign) { ui.sign.textContent = text; ui.sign.classList.toggle('neg', !!neg); } }
  function signOn(on) { if (ui.sign) ui.sign.classList.toggle('on', !!on && !!ST.signText && !ST.hide); }
  function flashSign(text, neg, sec) { setSign(text, neg); signOn(true); clearTimeout(ST.signOff); ST.signOff = setTimeout(() => signOn(false), (sec || 3) * 1000); }
  function buzz(p) { try { if (A.buzz) A.buzz(p); } catch (e) {} }
  function pulse(k) { ST.pulse = Math.max(ST.pulse, k || 1); ST.pulseT = now(); wake(); }

  /* ---------- цифры: перекатываются сразу ---------- */
  function number(p) {
    if (!p || !p.el || p.to == null) return;
    const el = p.el, cur = el._msTo != null ? el._msTo : el.textContent;
    if (cur === p.to) return;
    roll({ el, to: p.to, up: p.up !== false }, inited && !ST.hide && !ST.reduced && BL.ready && now() >= (BL.warm || 0));
  }

  /* ---------- сводка голосом ---------- */
  function startTell(items) {
    const ns = newsSeq(items), dur = voiceSeq(ns.seq); if (!dur) return false;
    ST.signT.forEach(clearTimeout); ST.signT = [];
    ns.bubs.forEach(b => {
      ST.signT.push(setTimeout(() => { if (AU.cur) { setSign(b.text, b.neg); signOn(true); } }, b.from * 1000));
      ST.signT.push(setTimeout(() => signOn(false), b.to * 1000));
    });
    lsSet('ms-news', Date.now()); lsSet('ms-newsDay', dayKey());
    ST.think = 0; ST.lastEvent = now(); wake();
    return true;
  }
  const CALM_TAP = [3, 5, 6];   /* «Я на посту», «Все системы в норме», «Всё под контролем» */
  function tell(auto) {
    const items = newsCompose();
    if (!items) { if (!auto) say('tap', { user: true, i: pick(CALM_TAP) }); return; }
    loadPack(); loadPackN();
    if (AU.packN && startTell(items)) return;
    if (AU.failedN) { if (!auto) say('tap', { user: true, i: pick(CALM_TAP) }); return; }
    const t0 = now(); ST.think = t0; wake();
    const iv = setInterval(() => {
      if (ST.think !== t0) { clearInterval(iv); return; }
      if (AU.packN) { clearInterval(iv); ST.think = 0; if (!document.hidden && ST.sound) { if (!startTell(items) && !auto) say('tap', { user: true, i: pick(CALM_TAP) }); } }
      else if (AU.failedN || now() - t0 > 6) { clearInterval(iv); ST.think = 0; if (!auto) say('tap', { user: true, i: pick(CALM_TAP) }); }
    }, 200);
  }
  function quiet() { ST.signT.forEach(clearTimeout); ST.signT = []; signOn(false); stopVoice(); ST.think = 0; }
  function tapped() {
    ST.lastInput = now(); pulse(0.6); buzz(8);
    if (AU.cur || ST.think) { quiet(); return; }
    if (!ST.sound) return;
    if (isNight()) { say('tapNight', U_); return; }
    tell(false);
  }

  /* ---------- события ---------- */
  function trigger(name, data) {
    if (name === 'deposit') { say('deposit', EV); buzz([10, 40, 10]); }
    else if (name === 'buy') say('buy', EV);
    else if (name === 'sellProfit') say('sellProfit', EV);
    else if (name === 'sellLoss') say('sellLoss', EV);
    else if (name === 'airdrop') { say('airdrop', EV); buzz([10, 40, 10]); }
    else if (name === 'signal') { say(data && data.news ? 'news' : 'signal', EV); buzz(20); }
    else if (name === 'ath') { say(data && data.port ? 'athPort' : 'ath', EV); buzz([15, 50, 15]); }
    else if (name === 'milestone') { if (data && data.label) flashSign(data.label, false, 4); say('milestone', EV); buzz([15, 50, 15]); }
    else if (name === 'coinMove') { flashSign(data.label, data.neg, 4); say(data.neg ? 'coinDown' : 'coinUp', EV); }
    else if (name === 'screen') say('screen', EV);
    else return;
    ST.lastEvent = now(); pulse(1);
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
    g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip(); g.fillStyle = '#07070a'; g.fillRect(cx - R, cy - R, R * 2, R * 2); g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 5; k++) {
      const c = cur[k % 3], sp = 0.5 + k * 0.17, ax = cx + Math.cos(t * sp + k * 1.9) * R * (0.42 + L * 0.2), ay = cy + Math.sin(t * sp * 1.3 + k * 2.4) * R * (0.42 + L * 0.2), rr = R * (0.75 + 0.25 * Math.sin(t * 0.8 + k) + L * 0.35);
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
      const grp = { up: 'up', rocket: 'rocket', down: 'down', crash: 'crash', hunter: 'hunter', offline: 'offline' }[m];
      if (grp && t - ST.lastInput > 0.5 && BL.ready) setTimeout(() => { if (ST.mood === m && say(grp)) pulse(0.8); }, 1200);
    }
    if ((ST.go || ST.fresh > 0) && t > ST.nextSignal && m !== 'sleep' && BL.ready) { ST.nextSignal = t + 30; pulse(0.7); if (ST.go) say('signal'); }
    ST.talk = talkLevel();
    const target = AU.cur ? 0.25 + 0.75 * ST.talk : ST.think ? 0.16 + 0.08 * Math.sin(t * 5) : (m === 'sleep' ? 0.02 : 0.05 + 0.03 * Math.sin(t * 1.2));
    ST.lvl += (target - ST.lvl) * (AU.cur ? 0.35 : 0.12);
    const P = PAL[MOOD_PAL[m] || 'calm'];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cur[i][j] += (P[i][j] - cur[i][j]) * 0.07;
  }
  const visible = () => inView && !document.hidden && host && !host.hidden && host.offsetParent !== null;
  function frame(ms) {
    raf = 0;
    if (!visible()) return;
    const t = ms / 1000, busy = AU.cur || ST.think || ST.pulse > 0.02 || t - ST.lastInput < 6;
    if (t - lastF >= (busy ? 1 / 40 : 1 / 20)) {
      lastF = t; update(now());
      draw(ST.reduced && !AU.cur ? 0 : now() * (ST.mood === 'sleep' ? 0.4 : 1));
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
    if (!ST.sound) quiet();
    if (ST.hide) signOn(false);
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
    /* свежая сводка раз в 3 часа — сама, вскоре после первого касания (звук на телефоне включается только жестом) */
    if (BL.ready && !ST.autoT && now() - ST.t0 > 4 && newsDue()) ST.autoT = setTimeout(() => { ST.autoT = 0; if (newsDue() && !AU.cur && !ST.think && visible()) tell(true); }, 1800);
  }

  function init(opts) {
    if (inited) return true;
    opts = opts || {}; host = opts.host; A = opts.app || {};
    if (!host) return false;
    if (!document.getElementById('ms-css')) { const st = document.createElement('style'); st.id = 'ms-css'; st.textContent = CSS; document.head.appendChild(st); }
    ST.reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    host.querySelectorAll('.ms-cv,.ms-hit,.ms-sign,.ms-still').forEach(c => c.remove());
    cv = document.createElement('canvas'); cv.className = 'ms-cv'; cv.setAttribute('aria-hidden', 'true');
    g = cv.getContext('2d'); if (!g) return false;
    host.appendChild(cv); fit();
    ui.sign = document.createElement('div'); ui.sign.className = 'ms-sign'; ui.sign.setAttribute('aria-hidden', 'true'); host.appendChild(ui.sign);
    ui.hit = document.createElement('button'); ui.hit.type = 'button'; ui.hit.className = 'ms-hit';
    ui.hit.setAttribute('aria-label', 'Голосовой помощник — нажмите, чтобы услышать главное'); host.appendChild(ui.hit);
    ui.hit.addEventListener('click', () => { unlock(); tapped(); });
    window.addEventListener('resize', () => { fit(); wake(); });
    if (window.IntersectionObserver) new IntersectionObserver(es => { inView = es[0].isIntersecting; if (inView) wake(); }).observe(host);
    document.addEventListener('visibilitychange', () => { if (document.hidden) quiet(); else { ST.lastInput = now(); wake(); } });
    ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, e => { unlock(); if (!host.contains(e.target)) userInput(); }, { passive: true }));
    setInterval(() => { if (!raf) wake(); }, 900);
    setTimeout(loadPack, 2500);
    inited = true; wake();
    return true;
  }

  window.Mascot = {
    init, sync, number,
    event: (name, data) => trigger(name, data),
    debug: {
      state: () => ({ mood: ST.mood, raf: !!raf, frame: firstFrame, voice: !!AU.pack, talking: !!AU.cur, think: !!ST.think, talk: +ST.talk.toFixed(2), lvl: +ST.lvl.toFixed(2), said: ST.lastSay || '', sign: ST.signText, pal: cur[0].map(Math.round) }),
      hour: h => { ST.forceHour = h; },
      mood: m => { if (ST.forceHour == null) ST.forceHour = 12; ST.pct = { calm: 0, up: 3, rocket: 9, down: -3, crash: -9 }[m]; ST.go = m === 'hunter'; if (m === 'offline') { ST.offline = true; ST.offSince = now() - 120; } else ST.offline = false; ST.lastInput = now(); wake(); },
      say: (grp, o) => say(grp, Object.assign({ user: true }, o || {})),
      tap: () => tapped(),
      news: () => { const x = newsCompose(); return x ? { ids: x.seq.map(q => q.id), keys: x.keys, bubs: x.bubs } : null; },
      due: () => newsDue(),
      packs: () => ({ main: !!AU.pack, news: !!AU.packN, failedN: !!AU.failedN }),
      loadNews: () => loadPackN(),
      au: () => ({ ctx: !!AU.c, state: AU.c && AU.c.state, pack: !!AU.pack, failed: AU.failed, cache: AU.cache.size, cur: !!AU.cur })
    }
  };
})();
