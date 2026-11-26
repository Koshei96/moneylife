/* MoneyLife — «Фильтр докупа альткоина» (26.11.2026, решение владельца: этап 2 «Плана выхода», BACKLOG В2).
   Зачем: BTC и ETH докупаются на просадках по лестнице, а альткоин — только после проверки, чтобы не усреднять умирающий проект.
   5 проверок по реальным данным (каждая — с источником и временем; нет данных — «нет данных», а не «зелёный»):
     1) цена не выше средней цены покупки (наши записи);
     2) пара альткоин/BTC не обновляет минимумы три 30-дневных окна подряд (CoinGecko, история за 180 дней);
     3) выручка проекта: комиссии за 30 дней не ниже половины среднего месяца за год (DefiLlama, fees);
     4) разлоки — бесплатного проверенного источника нет: всегда «нет данных, проверьте вручную»;
     5) ликвидность: в топ-100 по капитализации и объём за сутки от $10 млн (CoinGecko).
   Итог: 0 провалов (и данных хотя бы по 3 проверкам) — полная сумма; 0 провалов, но данных меньше — половина;
   1–2 провала — половина; 3 и больше — без докупа.
   Стопы (сильнее итога, всегда «без докупа»): уже 2 докупа с резерва за цикл (с даты ATH биткоина),
   альткоин больше 10% крипто-портфеля, цена на −80% и ниже от средней цены покупки («заморозка»).
   Модуль только показывает рекомендацию: суммы лестницы и записи не меняет. */
(function () {
  'use strict';
  const F = (window.MLFilter = {});
  const el = id => document.getElementById(id);
  const NOT_ALT = new Set(['BTC', 'ETH', 'USDT', 'USDC', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'GUSD', 'PYUSD', 'USDS', 'OUSD', 'GHO', 'BUSD', 'USD1', 'WBTC', 'CBBTC', 'WETH', 'STETH', 'WSTETH']);
  const isAlt = s => !!s && !NOT_ALT.has(String(s).toUpperCase());
  const LIM = { rebuys: 2, weight: 10, freeze: 80, feesRatio: 0.5, rank: 100, vol: 10e6, windows: 3 };
  const TTL = 30 * 60000, FEES_TTL = 12 * 3600000;
  const LLAMA = 'https://api.llama.fi/summary/fees/';
  /* где у DefiLlama другое имя, чем id CoinGecko (остальные пробуем по id CoinGecko) */
  const LLAMA_SLUG = {};

  /* ---------------- тексты ---------------- */
  const TXT = {
    ru: {
      title: 'Докуп альткоина', sub: 'Фильтр против ловушки: 5 проверок перед докупом с резерва',
      full: 'Полная сумма', half: 'Половина суммы', none: 'Без докупа', wait: 'Проверяю…',
      fewData: 'данных мало — осторожно, половина', score: (p, k) => 'пройдено ' + p + ' из ' + k + ' с данными',
      price: 'Цена не выше вашей средней', priceOk: (p, a) => 'сейчас ' + p + ', ваша средняя ' + a, priceBad: (p, a) => 'сейчас ' + p + ' — дороже вашей средней ' + a, priceNa: 'нет средней цены покупки',
      btc: 'Сила относительно BTC', btcOk: 'пара к BTC не падает три месяца подряд', btcBad: 'пара к BTC обновляет минимумы три месяца подряд', btcNa: 'нет истории цены за 4 месяца',
      fees: 'Выручка проекта', feesOk: (r) => 'комиссии за 30 дней — ' + r + '% от среднего месяца за год', feesBad: (r) => 'комиссии за 30 дней — только ' + r + '% от среднего месяца за год', feesNa: 'DefiLlama не знает выручку этого проекта', feesOff: 'нет связи с DefiLlama — проверю позже', ok: 'пройдено', bad: 'не пройдено',
      unl: 'Разлоки монет', unlNa: 'бесплатного проверенного источника нет — проверьте вручную перед покупкой',
      liq: 'Ликвидность', liqOk: (r, v) => '#' + r + ' по капитализации, объём за сутки ' + v, liqBad: (r, v) => (r ? '#' + r : 'вне рейтинга') + ' по капитализации, объём за сутки ' + v + ' — нужно топ-100 и от $10 млн', liqNa: 'нет данных о рынке',
      stops: 'Стоп', stRebuy: n => 'уже ' + n + ' ' + (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'докупа' : 'докупов') + ' с резерва за цикл — больше не докупаем', stWeight: p => 'альткоин уже ' + p + '% крипто-портфеля — лимит 10%', stFreeze: 'цена на −80% и ниже от вашей средней — монета заморожена',
      src: (s, t) => s + ' · ' + t, srcOwn: 'ваши записи', na: 'нет данных', refresh: 'Обновить проверку',
      note: 'Это подсказка по вашим правилам, а не инвестиционный совет. Приложение ничего не покупает.',
      chip: (v, a) => 'фильтр: ' + v + (a ? ' · ' + a : ''), chipWait: 'фильтр: проверяю'
    },
    uk: {
      title: 'Докупівля альткоїна', sub: 'Фільтр проти пастки: 5 перевірок перед докупівлею з резерву',
      full: 'Повна сума', half: 'Половина суми', none: 'Без докупівлі', wait: 'Перевіряю…',
      fewData: 'даних мало — обережно, половина', score: (p, k) => 'пройдено ' + p + ' з ' + k + ' з даними',
      price: 'Ціна не вища за вашу середню', priceOk: (p, a) => 'зараз ' + p + ', ваша середня ' + a, priceBad: (p, a) => 'зараз ' + p + ' — дорожче за вашу середню ' + a, priceNa: 'немає середньої ціни купівлі',
      btc: 'Сила щодо BTC', btcOk: 'пара до BTC не падає три місяці поспіль', btcBad: 'пара до BTC оновлює мінімуми три місяці поспіль', btcNa: 'немає історії ціни за 4 місяці',
      fees: 'Виручка проєкту', feesOk: (r) => 'комісії за 30 днів — ' + r + '% від середнього місяця за рік', feesBad: (r) => 'комісії за 30 днів — лише ' + r + '% від середнього місяця за рік', feesNa: 'DefiLlama не знає виручку цього проєкту', feesOff: 'немає зв’язку з DefiLlama — перевірю пізніше', ok: 'пройдено', bad: 'не пройдено',
      unl: 'Розблокування монет', unlNa: 'безкоштовного перевіреного джерела немає — перевірте вручну перед купівлею',
      liq: 'Ліквідність', liqOk: (r, v) => '#' + r + ' за капіталізацією, обсяг за добу ' + v, liqBad: (r, v) => (r ? '#' + r : 'поза рейтингом') + ' за капіталізацією, обсяг за добу ' + v + ' — потрібно топ-100 і від $10 млн', liqNa: 'немає даних про ринок',
      stops: 'Стоп', stRebuy: n => 'уже ' + n + ' ' + (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'докупівлі' : 'докупівель') + ' з резерву за цикл — більше не докуповуємо', stWeight: p => 'альткоїн уже ' + p + '% крипто-портфеля — ліміт 10%', stFreeze: 'ціна на −80% і нижче від вашої середньої — монету заморожено',
      src: (s, t) => s + ' · ' + t, srcOwn: 'ваші записи', na: 'немає даних', refresh: 'Оновити перевірку',
      note: 'Це підказка за вашими правилами, а не інвестиційна порада. Застосунок нічого не купує.',
      chip: (v, a) => 'фільтр: ' + v + (a ? ' · ' + a : ''), chipWait: 'фільтр: перевіряю'
    }
  };
  const lang = () => (window.mlLang && window.mlLang() === 'uk' ? 'uk' : 'ru');
  const T = () => TXT[lang()];
  const loc = () => (lang() === 'uk' ? 'uk-UA' : 'ru-RU');
  /* крупные суммы коротко: $1,2 млрд, $35 млн */
  const bigUsd = v => { const f = (x, u) => '$' + x.toLocaleString(loc(), { maximumFractionDigits: x < 10 ? 1 : 0 }) + ' ' + u; return v >= 1e9 ? f(v / 1e9, 'млрд') : v >= 1e6 ? f(v / 1e6, 'млн') : usd(v); };
  const hm = ts => new Date(ts).toLocaleString(loc(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  /* ---------------- чистые расчёты (их проверяет tests/run_tests.py) ---------------- */
  /* история цены {prices, startTs, endTs} — точки равномерно по времени (так её отдаёт shim.js) → [[ts, цена]] */
  function points(pl) {
    const p = (pl && pl.prices) || [], n = p.length; if (n < 2) return [];
    const a = +pl.startTs, b = +pl.endTs, step = (b - a) / (n - 1);
    return p.map((v, i) => [a + step * i, +v]).filter(x => x[1] > 0 && isFinite(x[0]));
  }
  /* цена альткоина в BTC по дням: для каждой точки альткоина — ближайшая по времени точка BTC */
  function ratioSeries(alt, btc) {
    const A = points(alt), B = points(btc); if (A.length < 2 || B.length < 2) return [];
    const out = []; let j = 0;
    for (const [t, v] of A) {
      while (j < B.length - 1 && Math.abs(B[j + 1][0] - t) <= Math.abs(B[j][0] - t)) j++;
      if (Math.abs(B[j][0] - t) <= 2 * 86400000 && B[j][1] > 0) out.push([t, v / B[j][1]]);
    }
    return out;
  }
  /* минимумы четырёх 30-дневных окон до now (старое → новое); «падает», если каждый следующий минимум ниже прошлого
     три раза подряд. Истории меньше 115 дней — null (не знаем) */
  function btcTrend(series, now) {
    if (!series.length) return null;
    const D30 = 30 * 86400000, from = now - 4 * D30;
    if (series[0][0] > from + 5 * 86400000) return null;
    const lows = [];
    for (let w = 0; w < 4; w++) {
      const a = from + w * D30, b = a + D30; let m = Infinity;
      for (const [t, v] of series) if (t >= a && t < b && v < m) m = v;
      if (!isFinite(m)) return null;
      lows.push(m);
    }
    return { lows, falling: lows[1] < lows[0] && lows[2] < lows[1] && lows[3] < lows[2] };
  }
  /* выручка: комиссии за 30 дней против среднего месяца за год; null — не знаем */
  function feesRatio(total30d, total1y) {
    if (total30d == null || total1y == null) return null;
    const a = +total30d, y = +total1y;
    if (!(y > 0) || !isFinite(a) || a < 0) return null;
    return a / (y / 12);
  }
  /* итог: checks — [{st:'ok'|'bad'|'na'}], stops — список причин */
  function combine(checks, stops) {
    const known = checks.filter(c => c.st !== 'na').length, bad = checks.filter(c => c.st === 'bad').length, ok = known - bad;
    if (stops.length) return { v: 'none', ok, known, bad };
    if (bad >= 3) return { v: 'none', ok, known, bad };
    if (bad >= 1) return { v: 'half', ok, known, bad };
    return { v: known >= 3 ? 'full' : 'half', few: known < 3, ok, known, bad };
  }
  /* сумма докупа по итогу, в центах: половина — вниз до цента */
  function amountC(usd, v) { const c = Math.round(Math.round((+usd || 0) * 1e6) / 1e4); return v === 'full' ? c : v === 'half' ? Math.floor(c / 2) : 0; }
  F.math = { points, ratioSeries, btcTrend, feesRatio, combine, amountC, LIM };

  /* ---------------- данные ---------------- */
  const MEM = {}, BUSY = {};
  const idOf = sym => { try { return cgMap()[sym] || null; } catch (e) { return null; } };
  const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  async function fees(id) {
    const slug = LLAMA_SLUG[id] || id, key = 'ml-fees:' + slug, c = lsGet(key);
    if (c && Date.now() - c.at < FEES_TTL) return c;
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(LLAMA + encodeURIComponent(slug) + '?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true', { signal: ctl.signal });
      clearTimeout(tm);
      if (!r.ok && r.status !== 404) throw new Error('DefiLlama ' + r.status);   /* сбой (429, 5xx) не запоминаем на 12 часов */
      const j = r.ok ? await r.json() : null;
      const geckoOk = j && (!j.gecko_id || j.gecko_id === id);   /* защита от тёзки: проект с другим id CoinGecko не берём */
      const rec = { at: Date.now(), d30: j && geckoOk && j.total30d != null ? +j.total30d : null, d1y: j && geckoOk && j.total1y != null ? +j.total1y : null };
      lsSet(key, rec); return rec;
    } catch (e) { return c || { at: Date.now(), d30: null, d1y: null, failed: true }; }
  }
  /* CoinGecko без ключа может долго держать запрос в очереди (ограничение частоты) — не ждём дольше 15 секунд */
  const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  /* история за год — та же, что у графика в карточке монеты (кэш shim.js 6 ч); warm — только биржи, лимит CoinGecko не тратим */
  async function chartOf(id, warm) {
    try { const r = await within(mcp.callTool('CoinGecko', 'get-coin-market-chart', Object.assign({ id, days: '365' }, warm ? { warm: true } : {})), 15000); return { pl: r.payload, at: (r.cache && r.cache.storedAt) || Date.now() }; }
    catch (e) { return null; }
  }
  const SRC = { binance: 'Binance', gate: 'Gate.io', coingecko: 'CoinGecko' };
  /* рейтинг и объём меняются медленно: последний ответ CoinGecko храним сутки — если сейчас он ограничил запросы,
     показываем прошлый (со своим временем); с бирж рейтинга нет — такой ответ не годится */
  /* рейтинг и объём — из ответа живых цен (shim.js кладёт их в window.mlMkt), отдельного запроса к CoinGecko нет.
     Последний ответ храним сутки: если CoinGecko сейчас ограничил запросы и цены пришли с бирж, берём прошлый (со своим временем) */
  function marketOf(id) {
    const key = 'ml-mk:' + id, m = window.mlMkt && window.mlMkt[id];
    if (m && m.r > 0) { const rec = { c: { marketCapRank: m.r, totalVolume: m.v }, at: m.at || Date.now() }; lsSet(key, rec); return rec; }
    const old = lsGet(key); return old && Date.now() - old.at < 86400000 ? old : null;
  }
  async function load(sym, warm) {
    const id = idOf(sym); if (!id || typeof mcp === 'undefined' || !mcp) return { at: Date.now(), id };
    const [ch, bt, fe] = await Promise.all([chartOf(id, warm), chartOf('bitcoin', warm), fees(id)]);
    return { at: Date.now(), id, mk: marketOf(id), ch, bt, fe, warm: !!warm && !(ch && bt) };
  }
  function cycleStart() { const a = S.cycle && S.cycle.athDate; const t = Date.parse(a || ''); return isFinite(t) ? t : Date.now() - 365 * 86400000; }
  /* before — запись докупа: итог «на момент покупки» — позиция, доля и число докупов ДО неё, цена — цена покупки */
  function evaluate(sym, raw, D, before) {
    const hold = before ? replayUntil(String(before.ts)) : D.h;
    const t = T(), h = hold[sym] || { qty: 0, usd: 0, cq: 0 }, avg = h.cq > 1e-12 && h.usd > 0 ? h.usd / h.cq : 0;
    const bq = before ? +before.qty || 0 : 0, price = before ? (+before.price > 0 ? +before.price : (+before.usd > 0 && bq > 0 ? +before.usd / bq : 0)) : (+D.prices[sym] || 0);
    const checks = [];
    /* 1. цена */
    checks.push(!(avg > 0) || !(price > 0) ? { k: 'price', st: 'na', name: t.price, txt: avg > 0 ? t.na : t.priceNa, src: '' }
      : { k: 'price', st: price <= avg ? 'ok' : 'bad', name: t.price, txt: (price <= avg ? t.priceOk : t.priceBad)(usdp(price), usdp(avg)), src: t.srcOwn });
    /* 2. сила к BTC */
    const tr = raw && raw.ch && raw.bt ? btcTrend(ratioSeries(raw.ch.pl, raw.bt.pl), Math.min(+raw.ch.pl.endTs || Date.now(), +raw.bt.pl.endTs || Date.now())) : null;
    checks.push(tr ? { k: 'btc', st: tr.falling ? 'bad' : 'ok', name: t.btc, txt: tr.falling ? t.btcBad : t.btcOk, src: t.src(SRC[raw.ch.pl.src] || 'CoinGecko', hm(raw.ch.at)) } : { k: 'btc', st: 'na', name: t.btc, txt: t.btcNa, src: '' });
    /* 3. выручка */
    const fr = raw && raw.fe ? feesRatio(raw.fe.d30, raw.fe.d1y) : null;
    checks.push(fr == null ? { k: 'fees', st: 'na', name: t.fees, txt: raw && raw.fe && raw.fe.failed ? t.feesOff : t.feesNa, src: '' }
      : { k: 'fees', st: fr >= LIM.feesRatio ? 'ok' : 'bad', name: t.fees, txt: (fr >= LIM.feesRatio ? t.feesOk : t.feesBad)(Math.round(fr * 100)), src: t.src('DefiLlama', hm(raw.fe.at)) });
    /* 4. разлоки — честно «нет данных» */
    checks.push({ k: 'unl', st: 'na', name: t.unl, txt: t.unlNa, src: '' });
    /* 5. ликвидность */
    const mk = raw && raw.mk && raw.mk.c;
    if (mk && (mk.marketCapRank || mk.totalVolume != null)) {
      const r = +mk.marketCapRank || 0, v = +mk.totalVolume || 0, okL = r > 0 && r <= LIM.rank && v >= LIM.vol, vs = bigUsd(v);
      checks.push({ k: 'liq', st: okL ? 'ok' : 'bad', name: t.liq, txt: (okL ? t.liqOk : t.liqBad)(r, vs), src: t.src('CoinGecko', hm(raw.mk.at)) });
    } else checks.push({ k: 'liq', st: 'na', name: t.liq, txt: t.liqNa, src: '' });
    /* стопы */
    const stops = [], since = cycleStart();
    const until = before ? Date.parse(before.ts) : Infinity;
    const rebuys = (S.tx || []).filter(x => x && x !== before && x.type === 'dip' && String(x.symbol || '').toUpperCase() === sym && Date.parse(x.ts) >= since && Date.parse(x.ts) < until).length;
    if (rebuys >= LIM.rebuys) stops.push(t.stRebuy(rebuys));
    let tot = 0; for (const s of before ? Object.keys(hold) : (D.syms || [])) if (!NOT_ALT.has(s) || s === 'BTC' || s === 'ETH') tot += (+(hold[s] || {}).qty || 0) * (s === sym ? price : (+D.prices[s] || 0));
    const val = (+h.qty || 0) * price, w = tot > 0 ? val / tot * 100 : 0;
    if (w > LIM.weight) stops.push(t.stWeight(w.toLocaleString(loc(), { maximumFractionDigits: 1 })));
    if (avg > 0 && price > 0 && price <= avg * (1 - LIM.freeze / 100)) stops.push(t.stFreeze);
    return Object.assign({ sym, at: raw ? raw.at : Date.now(), checks, stops, rebuys, weight: w }, combine(checks, stops));
  }
  /* загрузить (не чаще раза в 30 минут на монету) и вернуть итог; cb — после загрузки */
  const CBS = {};
  function ensure(sym, cb, force, warm) {
    const m = MEM[sym];
    /* фоновая проверка из лестницы (только биржи) не заменяет полную: открыли карточку — догружаем без warm */
    if (!force && m && Date.now() - m.at < TTL && !(m.warm && !warm)) return m;
    (CBS[sym] = CBS[sym] || []).push(cb);
    if (BUSY[sym]) return m || null;
    BUSY[sym] = load(sym, warm).then(raw => { MEM[sym] = raw; }).catch(() => {}).then(() => { BUSY[sym] = null; const l = CBS[sym] || []; CBS[sym] = []; l.forEach(f => { try { f && f(); } catch (e) {} }); });
    return m || null;
  }
  F.state = function (sym, D) { const raw = MEM[sym]; return raw ? evaluate(sym, raw, D) : null; };
  /* для журнала (journal.js): итог фильтра на момент докупа tx; данные фильтра должны быть не старше 3 дней от покупки */
  F.stateBefore = function (sym, tx, D) { const raw = MEM[sym]; if (!raw || Math.abs(raw.at - Date.parse(tx.ts)) > 3 * 86400000) return null; return evaluate(sym, raw, D, tx); };
  F.load = function (sym, cb) { if (isAlt(sym)) ensure(sym, cb || null, false, false); };

  /* ---------------- вид в карточке монеты ---------------- */
  const ICON = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    bad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>',
    na: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M7 12h10"/></svg>'
  };
  const vName = v => T()[v];
  const vCls = v => (v === 'full' ? 'ok' : v === 'half' ? 'warn' : 'bad');
  function html(sym, D) {
    const t = T(), s = F.state(sym, D), S2 = esc(sym);
    if (!s) return `<div class="card fl-card"><div class="ex-h"><span class="label">${t.title}</span><span class="chip">${t.wait}</span></div><p class="hint">${t.sub}</p></div>`;
    const rows = s.checks.map(c => `<div class="fl-r ${c.st}"><span class="fl-ic" aria-hidden="true">${ICON[c.st]}</span><span class="col"><span class="nm">${esc(c.name)}<span class="fl-sr"> — ${c.st === 'ok' ? t.ok : c.st === 'bad' ? t.bad : t.na}</span></span><span class="sub">${esc(c.txt)}${c.src ? ' · ' + esc(c.src) : ''}</span></span></div>`).join('');
    const stops = s.stops.length ? `<div class="fl-stop" role="note"><b>${t.stops}:</b> ${s.stops.map(esc).join('; ')}</div>` : '';
    const scoreTxt = s.few ? t.fewData : t.score(s.ok, s.known);
    return `<div class="card fl-card"><div class="ex-h"><span class="label">${t.title}</span><span class="chip fl-v ${vCls(s.v)}">${vName(s.v)}</span></div>`
      + `<p class="hint">${t.sub} · ${scoreTxt}</p><div class="fl-list">${rows}</div>${stops}`
      + `<button type="button" class="btn sm ghost block" data-fl="refresh" data-sym="${S2}">${t.refresh}</button><p class="hint">${t.note}</p></div>`;
  }
  let lastSym = null;
  F.coin = function (sym, D) {
    const box = el('cvFlt'); if (!box) return; lastSym = sym;
    const h = D && D.h[sym];
    if (!isAlt(sym) || !h || !(h.qty > 1e-12)) { box.hidden = true; box.innerHTML = ''; return; }
    ensure(sym, () => { if (lastSym === sym && el('coinSheet') && el('coinSheet').classList.contains('open')) F.coin(sym, derive()); });
    box.setAttribute('aria-live', 'polite');
    const out = html(sym, D); if (box.dataset.h !== out) { box.innerHTML = out; box.dataset.h = out; } box.hidden = false;
  };
  /* строка альткоина в лестнице докупок: подпись итога и рекомендованная сумма; без данных — подгружаем один раз */
  let chipRe = null;
  F.chip = function (sym, usdAmt, D) {
    if (!isAlt(sym)) return '';
    const t = T();
    ensure(sym, () => { clearTimeout(chipRe); chipRe = setTimeout(() => { try { render(); } catch (e) {} }, 300); }, false, true);
    const s = F.state(sym, D || derive());
    if (!s) return `<span class="fl-chip">${t.chipWait}</span>`;
    const a = usdAmt > 0 && s.v === 'half' ? usd(amountC(usdAmt, 'half') / 100) : '';
    return `<span class="fl-chip ${vCls(s.v)}">${esc(t.chip(vName(s.v).toLowerCase(), a))}</span>`;
  };
  /* коротко для сигнала на главной: « · фильтр: половина» (или пусто, пока нет данных) */
  F.short = function (sym, usdAmt, D) { if (!isAlt(sym)) return ''; const s = F.state(sym, D || derive()); if (!s) return ''; const t = T(); return ' · ' + t.chip(vName(s.v).toLowerCase(), usdAmt > 0 && s.v === 'half' ? usd(amountC(usdAmt, 'half') / 100) : ''); };
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-fl="refresh"]'); if (!b) return;
    const sym = b.dataset.sym, id = idOf(sym); play('tick'); delete MEM[sym]; try { localStorage.removeItem('ml-fees:' + (LLAMA_SLUG[id] || id)); } catch (e) {}
    ensure(sym, () => { F.coin(sym, derive()); toast(lang() === 'uk' ? 'Перевірку оновлено' : 'Проверка обновлена'); }, true);
    F.coin(sym, derive());
  });

  const css = document.createElement('style'); css.id = 'fl-css';
  css.textContent = '.fl-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}#cvFlt{margin:2px 0 4px}.fl-card{display:flex;flex-direction:column;gap:10px}.fl-list{display:flex;flex-direction:column}'
    + '.fl-r{display:grid;grid-template-columns:24px minmax(0,1fr);gap:10px;align-items:start;padding:10px 0;border-top:1px solid var(--line);font-size:14px}'
    + '.fl-r .nm,.fl-r .sub{white-space:normal;overflow:visible;text-overflow:clip}.fl-r .nm{display:block;font-weight:650}.fl-r .sub{display:block;font-size:12px;color:var(--mute);margin-top:3px;line-height:1.45}'
    + '.fl-ic{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center}.fl-ic svg{width:13px;height:13px}'
    + '.fl-r.ok .fl-ic{background:var(--pos-soft);color:var(--pos)}.fl-r.bad .fl-ic{background:var(--neg-soft);color:var(--neg)}.fl-r.na .fl-ic{background:var(--raise);color:var(--mute)}'
    + '.chip.fl-v.ok{background:var(--pos-soft);color:var(--pos)}.chip.fl-v.warn{background:var(--warn-soft);color:var(--warn)}.chip.fl-v.bad{background:var(--neg-soft);color:var(--neg)}'
    + '.fl-stop{font-size:13px;line-height:1.45;padding:10px 12px;border-radius:12px;background:var(--neg-soft);color:var(--neg)}'
    + '.fl-chip{display:block;grid-column:1/-1;font-size:12px;font-weight:600;color:var(--mute);margin-top:2px}.fl-chip.ok{color:var(--pos)}.fl-chip.warn{color:var(--warn)}.fl-chip.bad{color:var(--neg)}';
  document.head.appendChild(css);
})();
