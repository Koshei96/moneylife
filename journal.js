/* MoneyLife — «Журнал сделок по плану» и месячный отчёт Ориона (26.11.2026, решение владельца: этап 3, BACKLOG В3).
   Хранение: коллекция jr — ОДНА запись на документ (jr/s-…, jr/d-…), плюс jr/meta-since (с какого момента журнал) и
   jr/told-ГГГГ-ММ (месячный итог сказан). Так два устройства не затирают друг друга: запись по id одинакова где угодно.
   Пишем только после того, как пришли данные с сервера (window.mlSynced из shim.js) — устаревшая копия ничего не стирает.
   Не записалось (нет сети) — запись ждёт в localStorage и уходит при следующем такте.
   Что записывается:
     • step — ступень «Плана выхода» достигнута (в том числе показанная фоном, когда приложение было закрыто);
     • dip  — докуп альткоина с резерва (tx типа dip): сумма, цена, итог «Фильтра докупа» НА МОМЕНТ ПОКУПКИ
       (без учёта самого докупа: позиция, доля и число докупов — до него; цена — цена покупки).
   Статусы пересчитываются:
     • ступень «по плану» — продано не меньше 80% НАКОПЛЕННОГО по плану количества (ступени одного плана считаются вместе:
       одна продажа не закрывает и ×2, и ×4) по цене ≥ 90% цели первой ступени, в окне от «сутки до первого сигнала»
       до 14 дней после этого; 14 дней прошло — «не сделано»; иначе «ждёт»;
     • докуп «против фильтра» — фильтр говорил «Без докупа»; удалённый докуп из журнала уходит (сверка с записями);
     • продажа «вне плана» — ниже 90% цели первой ступени по средней на момент продажи.
   Месяц — по местному времени телефона. Итог прошлого месяца Орион говорит один раз: сначала отметка told
   записывается на сервер, и только если записалась — речь и уведомление. */
(function () {
  'use strict';
  const J = (window.MLJournal = {});
  const el = id => document.getElementById(id);
  const COL = 'jr', WAIT = 14 * 86400000, EARLY = 86400000, SHOW = 400;
  const NOT_ALT = new Set(['BTC', 'ETH', 'USDT', 'USDC', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'GUSD', 'PYUSD', 'USDS', 'OUSD', 'GHO', 'BUSD', 'USD1', 'WBTC', 'CBBTC', 'WETH', 'STETH', 'WSTETH']);
  const bootAt = Date.now();

  /* ---------------- тексты ---------------- */
  const TXT = {
    ru: {
      title: 'Журнал сделок', repTitle: 'Дисциплина плана', all: 'Последние записи по монете',
      step: (s, x) => s + ': ступень ×' + x, dip: s => s + ': докуп с резерва',
      stepSub: (t, p, at, q) => 'цель ' + t + ' · цена ' + p + ' · ' + at + ' · по плану продать ' + q,
      dipSub: (u, p, at) => 'на ' + u + ' по ' + p + ' · ' + at,
      ok: 'по плану', miss: 'не сделано', wait: 'ждёт', dev: 'против фильтра', na: 'нет проверки', info: 'вне плана',
      okStep: (q, p) => 'продано ' + q + ' по ' + p, missStep: '14 дней прошло — продажи по плану нет', waitStep: d => 'осталось ' + d + ' дн. на продажу по плану',
      vFull: 'фильтр: полная сумма', vHalf: 'фильтр: половина суммы', vNone: 'фильтр: без докупа', vNa: 'фильтр не успел проверить',
      off: (s, q, p) => s + ': продажа ' + q + ' по ' + p, offSub: 'ниже 90% цели первой ступени — ступень не закрыта',
      sum: (a, b, w, c, d, x) => 'Ступеней: ' + a + ', по плану: ' + b + (x ? ', не сделано: ' + x : '') + (w ? ', ждут: ' + w : '') + ' · докупов альткоинов: ' + c + ', против фильтра: ' + d,
      say: (m, s) => 'Итог ' + m + ' по вашему плану. '
        + (s.steps ? 'Ступеней выхода: ' + s.steps + ', по плану сделано ' + s.ok + (s.miss ? ', не сделано ' + s.miss : '') + (s.wait ? ', ещё ждут продажи ' + s.wait : '') + '. ' : '')
        + (s.dips ? 'Докупов альткоинов: ' + s.dips + (s.dev ? ', против фильтра ' + s.dev : ', все по фильтру') + '. ' : '')
        + (!s.miss && !s.dev && !s.wait ? 'Всё по правилам — отличная дисциплина.' : 'Детали — в отчёте за месяц.'),
      nTitle: m => 'Итог ' + m + ' по плану', nBody: 'Сколько ступеней и докупов сделано по правилам — в отчёте за месяц.'
    },
    uk: {
      title: 'Журнал угод', repTitle: 'Дисципліна плану', all: 'Останні записи по монеті',
      step: (s, x) => s + ': сходинка ×' + x, dip: s => s + ': докупівля з резерву',
      stepSub: (t, p, at, q) => 'ціль ' + t + ' · ціна ' + p + ' · ' + at + ' · за планом продати ' + q,
      dipSub: (u, p, at) => 'на ' + u + ' по ' + p + ' · ' + at,
      ok: 'за планом', miss: 'не зроблено', wait: 'чекає', dev: 'проти фільтра', na: 'немає перевірки', info: 'поза планом',
      okStep: (q, p) => 'продано ' + q + ' по ' + p, missStep: '14 днів минуло — продажу за планом немає', waitStep: d => 'залишилось ' + d + ' дн. на продаж за планом',
      vFull: 'фільтр: повна сума', vHalf: 'фільтр: половина суми', vNone: 'фільтр: без докупівлі', vNa: 'фільтр не встиг перевірити',
      off: (s, q, p) => s + ': продаж ' + q + ' по ' + p, offSub: 'нижче 90% цілі першої сходинки — сходинку не закрито',
      sum: (a, b, w, c, d, x) => 'Сходинок: ' + a + ', за планом: ' + b + (x ? ', не зроблено: ' + x : '') + (w ? ', чекають: ' + w : '') + ' · докупівель альткоїнів: ' + c + ', проти фільтра: ' + d,
      say: (m, s) => 'Підсумок ' + m + ' за вашим планом. '
        + (s.steps ? 'Сходинок виходу: ' + s.steps + ', за планом зроблено ' + s.ok + (s.miss ? ', не зроблено ' + s.miss : '') + (s.wait ? ', ще чекають продажу ' + s.wait : '') + '. ' : '')
        + (s.dips ? 'Докупівель альткоїнів: ' + s.dips + (s.dev ? ', проти фільтра ' + s.dev : ', усі за фільтром') + '. ' : '')
        + (!s.miss && !s.dev && !s.wait ? 'Усе за правилами — чудова дисципліна.' : 'Деталі — у звіті за місяць.'),
      nTitle: m => 'Підсумок ' + m + ' за планом', nBody: 'Скільки сходинок і докупівель зроблено за правилами — у звіті за місяць.'
    }
  };
  const lang = () => (window.mlLang && window.mlLang() === 'uk' ? 'uk' : 'ru');
  const T = () => TXT[lang()];
  const loc = () => (lang() === 'uk' ? 'uk-UA' : 'ru-RU');
  const dt = ts => new Date(ts).toLocaleString(loc(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const MON = { ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'], uk: ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'] };
  const monGen = ym => MON[lang()][+ym.slice(5, 7) - 1] || ym;

  /* ---------------- чистые расчёты (их проверяет tests/run_tests.py) ---------------- */
  const txPrice = t => { const q = +t.qty || 0; return +t.price > 0 ? +t.price : (+t.usd > 0 && q > 0 ? +t.usd / q : 0); };
  /* месяц записи — по местному времени телефона, как «Отчёт» */
  function ymLocal(iso) { const d = new Date(iso); if (isNaN(d)) return ''; return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function prevYm(now) { const d = new Date(now); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  /* статус записи; all — все записи журнала (для ступеней одного плана), now — сейчас (мс) */
  function statusOf(it, txs, now, all) {
    if (it.kind === 'step') {
      const at = Date.parse(it.at); if (!isFinite(at) || !(+it.qty > 0)) return { st: 'na' };
      const sib = (all || [it]).filter(x => x.kind === 'step' && x.sym === it.sym && x.since === it.since && +x.n <= +it.n && isFinite(Date.parse(x.at)));
      if (!sib.includes(it)) sib.push(it);
      const need = sib.reduce((a, x) => a + (+x.qty || 0), 0), minT = Math.min(...sib.map(x => +x.target || Infinity));
      const from = Math.min(...sib.map(x => Date.parse(x.at))) - EARLY, to = at + WAIT; let q = 0, usd = 0;
      for (const t of txs || []) {
        if (!t || t.type !== 'sell' || String(t.symbol || '').toUpperCase() !== it.sym) continue;
        const ts = Date.parse(t.ts); if (!(ts >= from && ts <= to)) continue;
        const p = txPrice(t); if (p > 0 && p >= minT * 0.9) { q += +t.qty || 0; usd += p * (+t.qty || 0); }
      }
      if (q > 0 && q >= need * 0.8 - 1e-12) return { st: 'ok', q, p: usd / q };
      if (now > to) return { st: 'miss', q, p: q ? usd / q : 0 };
      return { st: 'wait', q, days: Math.max(1, Math.ceil((to - now) / 86400000)) };
    }
    if (it.kind === 'dip') return { st: it.verdict === 'none' ? 'dev' : it.verdict ? 'ok' : 'na' };
    return { st: 'info' };
  }
  function offSells(txs, sym, since, minPrice) {
    const out = [], s0 = String(since || '');
    for (const t of txs || []) {
      if (!t || t.type !== 'sell' || String(t.symbol || '').toUpperCase() !== sym || String(t.ts || '') < s0) continue;
      const p = txPrice(t), mp = typeof minPrice === 'function' ? minPrice(t) : minPrice; if (p > 0 && p < mp * 0.9) out.push({ kind: 'off', sym, at: t.ts, qty: +t.qty || 0, price: p, id: 'o-' + (t.id || t.ts) });
    }
    return out;
  }
  /* живые записи: докуп, которого больше нет в записях (удалили), не считается */
  function alive(items, txs) { const ids = new Set((txs || []).map(t => t && t.id).filter(Boolean)); return (items || []).filter(it => it.kind !== 'dip' || !it.txId || ids.has(it.txId)); }
  function monthSum(items, txs, ym, now) {
    const all = alive(items, txs), inM = all.filter(it => ymLocal(it.at) === ym);
    const steps = inM.filter(it => it.kind === 'step'), dips = inM.filter(it => it.kind === 'dip');
    const st = steps.map(it => statusOf(it, txs, now, all).st), dv = dips.map(it => statusOf(it, txs, now, all).st);
    return { steps: steps.length, ok: st.filter(s => s === 'ok').length, miss: st.filter(s => s === 'miss').length, wait: st.filter(s => s === 'wait').length,
      dips: dips.length, dev: dv.filter(s => s === 'dev').length, items: inM, all };
  }
  J.math = { statusOf, offSells, monthSum, prevYm, ymLocal, alive, WAIT };

  /* ---------------- данные ---------------- */
  let ITEMS = new Map(), META = { since: null, told: {} }, subbed = false, got = false;
  const synced = () => !!window.mlSynced;
  const uidKey = () => (window.mlDemo ? 'demo' : (window.mlUser && window.mlUser.id) || 'local');
  const qKey = () => 'ml-jrq:' + uidKey();
  const qGet = () => { try { return JSON.parse(localStorage.getItem(qKey()) || '{}') || {}; } catch (e) { return {}; } };
  const qSet = o => { try { if (Object.keys(o).length) localStorage.setItem(qKey(), JSON.stringify(o)); else localStorage.removeItem(qKey()); } catch (e) {} };
  function sub() {
    if (subbed || typeof db === 'undefined' || !db) return;
    subbed = true;
    try {
      db.collection(COL).onSnapshot(s => {
        const m = new Map(); let since = null; const told = {};
        for (const d of s.docs) { const v = d.data() || {}; if (d.id === 'meta-since') since = v.since || null; else if (d.id.startsWith('told-')) told[d.id.slice(5)] = v.at; else if (v.kind) m.set(d.id, Object.assign({ id: d.id }, v)); }
        ITEMS = m; META = { since, told }; got = true; rerender();
      }, () => {});
    } catch (e) { subbed = false; }
  }
  /* запись одного документа; не вышло — в очередь localStorage (кроме служебных отметок: их повторяем на следующем такте) */
  async function put(id, data, noQueue) {
    if (!synced() || typeof db === 'undefined' || !db) { if (!noQueue) { const q = qGet(); q[id] = data; qSet(q); } return false; }
    try { const ref = db.doc(COL + '/' + id); await (ref.create ? ref.create(data) : ref.set(data)); const q = qGet(); if (q[id]) { delete q[id]; qSet(q); } return true; }   /* «создать, если нет»: чужую запись не перезаписываем */
    catch (e) { if (!noQueue) { const q = qGet(); q[id] = data; qSet(q); } return false; }
  }
  let flushing = false;
  async function flushQueue() {
    if (flushing || !synced()) return; const q = qGet(), ids = Object.keys(q); if (!ids.length) return;
    flushing = true; try { for (const id of ids) { if (ITEMS.has(id)) { const o = qGet(); delete o[id]; qSet(o); continue; } await put(id, q[id]); } } finally { flushing = false; }   /* одна неудачная запись не держит остальные */
  }
  const isAlt = s => !!s && !NOT_ALT.has(String(s).toUpperCase());
  const pend = new Set();
  /* уже ждёт в очереди (нет сети) — не переписываем: время сигнала и итог фильтра остаются первыми */
  const known = id => ITEMS.has(id) || pend.has(id) || !!qGet()[id];
  function add(it) { if (known(it.id)) return; pend.add(it.id); put(it.id, it).finally(() => pend.delete(it.id)); }

  /* ступень плана выхода достигнута — exit.js вызывает на каждом такте для всех достигнутых ступеней (в том числе
     показанных фоном); повтор отсекает id */
  J.step = function (sym, s, since) {
    sub(); if (!got || !synced()) return;
    const id = 's-' + sym + '-' + (Date.parse(since) || 0).toString(36) + '-' + s.n; if (known(id)) return;
    const L = typeof S !== 'undefined' && S.live ? S.live : {};
    add({ id, kind: 'step', sym, since: String(since), n: s.n, x: s.x, target: +(+s.target).toPrecision(8), price: +(+((L.prices && L.prices[sym]) || 0)).toPrecision(8),
      priceAt: L.at ? new Date(L.at).toISOString() : new Date().toISOString(), qty: +(+s.qty).toPrecision(8), at: new Date().toISOString() });
  };
  /* новые докупы альткоинов с резерва — с итогом фильтра на момент покупки */
  function scanDips(D) {
    if (!META.since) return;
    const now = Date.now();
    for (const t of S.tx || []) {
      if (!t || t.type !== 'dip' || !t.id) continue;
      const sym = String(t.symbol || '').toUpperCase(); if (!isAlt(sym) || String(t.ts || '') < META.since) continue;
      const id = 'd-' + t.id; if (known(id)) continue;
      let v = null, vAt = null;
      if (now - Date.parse(t.ts) < 3 * 86400000 && window.MLFilter && MLFilter.stateBefore) {
        const fs = MLFilter.stateBefore(sym, t, D);
        if (!fs) { MLFilter.load && MLFilter.load(sym, () => { tickAt = 0; try { J.tick(derive()); } catch (e) {} }); continue; }   /* данных фильтра ещё нет — подгружаем и записываем сразу после загрузки */
        v = fs.v; vAt = new Date(fs.at).toISOString();
      }
      add({ id, kind: 'dip', sym, txId: t.id, usd: +t.usd || 0, price: txPrice(t), verdict: v, verdictAt: vAt, at: String(t.ts) });
    }
  }
  let talking = false;
  function monthTalk() {
    if (!META.since || talking) return;
    const now = Date.now(), ym = prevYm(now); if (META.told[ym] != null) return;
    const quiet = () => { talking = true; put('told-' + ym, { at: -1 }, true).then(ok => { talking = false; if (ok) META.told[ym] = -1; }); };
    if (ymLocal(META.since) > ym) { quiet(); return; }   /* журнал моложе того месяца — говорить не о чем */
    const m = monthSum(Array.from(ITEMS.values()), S.tx, ym, now);
    if (!m.steps && !m.dips) { quiet(); return; }
    if (!window.Mascot && now - bootAt < 60000) return;   /* Орион ещё грузится — подождём до минуты */
    const hr = new Date(now).getHours(); if (hr < 7 || hr >= 23) return;   /* ночью молчим, как сам Орион (23:00–7:00) — итог дождётся утра */
    talking = true;
    put('told-' + ym, { at: now }, true).then(ok => {
      talking = false; if (!ok) return;   /* отметка не записалась (нет сети) — молчим, скажем на следующем такте */
      META.told[ym] = now; const t = T(), mg = monGen(ym);
      try { if (window.Mascot && Mascot.event) Mascot.event('planMonth', { text: t.say(mg, m) }); } catch (e) {}
      try { if (window.MLX && MLX.notify) MLX.notify(t.nTitle(mg), t.nBody, 'jr:' + ym); } catch (e) {}
    });
  }
  let tickAt = 0, txSig = -1;
  J.tick = function (D) {
    sub(); if (typeof S === 'undefined' || !S.ready || !got || !synced()) return;
    if (!META.since) {   /* журнал начинается сейчас: прошлые докупы не переоцениваем */
      if (!pend.has('meta-since')) { const since = new Date().toISOString(); pend.add('meta-since'); put('meta-since', { since }, true).then(ok => { pend.delete('meta-since'); if (ok && !META.since) META.since = since; }); }
      return;
    }
    const sig = (S.tx || []).length;   /* новая запись (например, докуп) — проверяем сразу, без ожидания такта */
    if (Date.now() - tickAt < 20000 && sig === txSig) return; tickAt = Date.now(); txSig = sig;
    flushQueue();
    try { scanDips(D); } catch (e) {}
    try { monthTalk(); } catch (e) {}
  };

  /* ---------------- вид ---------------- */
  const ICON = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    miss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>',
    dev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 6v8M12 18h.01"/></svg>',
    wait: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M12 8.5V12l2.5 1.5"/></svg>',
    na: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M7 12h10"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 11v6M12 7.5h.01"/></svg>'
  };
  function row(it, now, all) {
    const t = T(), s = statusOf(it, S.tx, now, all), sym = esc(it.sym);
    let head, sub;
    if (it.kind === 'step') {
      head = t.step(sym, (+it.x).toLocaleString(loc(), { maximumFractionDigits: 2 }));
      sub = t.stepSub(usdp(it.target), it.price > 0 ? usdp(it.price) : '—', dt(it.priceAt || it.at), qtyS(it.qty) + ' ' + sym)
        + (s.st === 'ok' ? '<br>' + t.okStep(qtyS(s.q) + ' ' + sym, usdp(s.p)) : s.st === 'miss' ? '<br>' + t.missStep : s.st === 'wait' ? '<br>' + t.waitStep(s.days) : '');
    } else if (it.kind === 'dip') {
      head = t.dip(sym);
      sub = t.dipSub(money(it.usd), it.price > 0 ? usdp(it.price) : '—', dt(it.at)) + '<br>' + (it.verdict === 'full' ? t.vFull : it.verdict === 'half' ? t.vHalf : it.verdict === 'none' ? t.vNone : t.vNa);
    } else { head = t.off(sym, qtyS(it.qty), usdp(it.price)); sub = t.offSub + ' · ' + dt(it.at); }
    return `<div class="jr-r ${s.st}"><span class="jr-ic" aria-hidden="true">${ICON[s.st] || ICON.na}</span><span class="col"><span class="nm">${head}</span><span class="sub">${sub}</span></span><span class="jr-st">${t[s.st]}</span></div>`;
  }
  function coinItems(sym, all, D) {
    const items = all.filter(it => it.sym === sym);
    try {   /* продажи вне плана — из записей, если план выхода по монете включён */
      const ex = window.MLExit && MLExit.planOf && MLExit.planOf(sym, D);
      if (ex && ex.avg > 0) items.push(...offSells(S.tx, sym, ex.since, MLExit.minAt ? MLExit.minAt(sym, ex.avg, ex.x1) : ex.avg * ex.x1));
    } catch (e) {}
    return items.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 10);
  }
  let lastSym = null;
  J.coin = function (sym, D) {
    sub(); const box = el('cvJrn'); if (!box) return; lastSym = sym;
    const all = alive(Array.from(ITEMS.values()), S.tx), items = isAlt(sym) ? coinItems(sym, all, D) : [];
    if (!items.length) { box.hidden = true; box.innerHTML = ''; delete box.dataset.h; return; }
    const t = T(), now = Date.now();
    const out = `<div class="card jr-card"><div class="ex-h"><span class="label">${t.title}</span></div><p class="hint">${t.all}</p><div class="jr-list">${items.map(it => row(it, now, all)).join('')}</div></div>`;
    if (box.dataset.h !== out) { box.innerHTML = out; box.dataset.h = out; } box.hidden = false;
  };
  /* раздел в «Отчёте» за месяц (y, m — как в renderReport) */
  J.report = function (y, m) {
    sub(); const box = el('repJrn'); if (!box) return;
    const ym = y + '-' + String(m + 1).padStart(2, '0'), now = Date.now(), t = T();
    const s = monthSum(Array.from(ITEMS.values()), S.tx, ym, now);
    if (!s.items.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    const list = s.items.slice().sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, SHOW);
    box.innerHTML = `<div class="sec-h"><span class="label">${t.repTitle}</span></div><div class="card jr-card"><p class="jr-sum">${t.sum(s.steps, s.ok, s.wait, s.dips, s.dev, s.miss)}</p><div class="jr-list">${list.map(it => row(it, now, s.all)).join('')}</div></div>`;
  };
  function rerender() {
    try { if (lastSym && el('coinSheet') && el('coinSheet').classList.contains('open')) J.coin(lastSym, derive()); } catch (e) {}
    try { if (el('repJrn') && typeof rep !== 'undefined' && rep) J.report(rep[0], rep[1]); } catch (e) {}
  }

  const css = document.createElement('style'); css.id = 'jr-css';
  css.textContent = '#cvJrn{margin:2px 0 4px}#repJrn{display:flex;flex-direction:column;gap:8px}.jr-card{display:flex;flex-direction:column;gap:10px}.jr-list{display:flex;flex-direction:column}'
    + '.jr-sum{margin:0;font-size:14px;line-height:1.5;font-variant-numeric:tabular-nums}'
    + '.jr-r{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:10px;align-items:start;padding:10px 0;border-top:1px solid var(--line);font-size:14px}'
    + '.jr-r .nm,.jr-r .sub{white-space:normal;overflow:visible;text-overflow:clip}.jr-r .nm{display:block;font-weight:650}.jr-r .sub{display:block;font-size:12px;color:var(--mute);margin-top:3px;line-height:1.45;font-variant-numeric:tabular-nums}'
    + '.jr-ic{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--raise);color:var(--mute)}.jr-ic svg{width:13px;height:13px}'
    + '.jr-st{font-size:12px;font-weight:650;color:var(--mute);white-space:nowrap;padding-top:2px}'
    + '.jr-r.ok .jr-ic{background:var(--pos-soft);color:var(--pos)}.jr-r.ok .jr-st{color:var(--pos)}'
    + '.jr-r.miss .jr-ic,.jr-r.dev .jr-ic{background:var(--neg-soft);color:var(--neg)}.jr-r.miss .jr-st,.jr-r.dev .jr-st{color:var(--neg)}'
    + '.jr-r.wait .jr-ic{background:var(--warn-soft);color:var(--warn)}';
  document.head.appendChild(css);
})();
