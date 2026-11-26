/* MoneyLife — «План выхода» (26.11.2026, решение владельца: «лесенка» фиксации прибыли по альткоинам).
   Метод владельца — пресет «Лесенка ×2 / ×4»: на росте ×2 от средней цены входа продать 50% монет, на ×4 — ещё 25%,
   остальные 25% держать. Выручка: 25% в BTC, 25% в ETH, 50% в резерв на докуп. Любой пользователь может выбрать
   этот пресет или настроить свой план (до 5 ступеней, свой раздел выручки).
   Приложение НИЧЕГО не продаёт (бирж нет, решение 18.11): только считает, напоминает и открывает форму продажи заполненной.
   Данные: один документ app/exitplan — { v, preset, steps:[{x,pct}], split:{BTC,ETH,RES}, coins:{SYM:{on,since,done:{n:ts}}} }.
   Ступень считается выполненной, когда записанные продажи монеты с момента включения плана (since) покрыли её долю.
   Суммы выручки считаются в целых центах; раздел — BTC и ETH вниз до цента, остаток — в резерв (сумма сходится до цента).
   Напоминания: пока приложение открыто — тост, Орион и уведомление; в фоне — через сигналы сервис-воркера (как оповещение о цене).
   Расчёты денег index.html не меняются — модуль только читает derive(). */
(function () {
  'use strict';
  const E = (window.MLExit = {});
  const el = id => document.getElementById(id);
  const DOC = 'app/exitplan';
  const PRESET = { steps: [{ x: 2, pct: 50 }, { x: 4, pct: 25 }], split: { BTC: 25, ETH: 25, RES: 50 } };
  const MAX_STEPS = 5;
  /* план выхода — для альткоинов: BTC и ETH — сама «база», стейблкоины не растут */
  const NOT_ALT = new Set(['BTC', 'ETH', 'USDT', 'USDC', 'DAI', 'USDE', 'FDUSD', 'TUSD', 'GUSD', 'PYUSD', 'USDS', 'OUSD', 'GHO']);

  /* ---------------- тексты RU / UK ---------------- */
  const TXT = {
    ru: {
      title: 'План выхода', preset: 'Лесенка ×2 / ×4', custom: 'Свой план',
      presetAbout: 'Метод автора MoneyLife: на росте ×2 от средней цены покупки продать 50% монет, на ×4 — ещё 25%, остальные 25% держать. Выручка: 25% в BTC, 25% в ETH, 50% в резерв на докуп.',
      offLead: 'Заранее решите, при каком росте фиксировать прибыль. Приложение напомнит, когда цена дойдёт до ступени, и посчитает, куда пойдут деньги.',
      now: 'Сейчас выбран', enable: s => 'Включить для ' + s, noAvg: 'Нет средней цены покупки — план считается от неё. Запишите покупку с суммой, и план заработает.',
      growth: 'Рост от средней цены', toNext: (x, p, t) => 'До ×' + x + ' ещё ' + p + ' · цель ' + t, allDone: 'Все ступени выполнены — дальше держите остаток по плану.',
      sell: (q, s) => 'продать ' + q + ' ' + s, sold: (q, s) => 'продано ≈' + q + ' ' + s, hold: (q, s, p) => 'Держать ' + q + ' ' + s + ' (' + p + '%)',
      reached: 'цель достигнута', split: (b, e, r) => 'BTC ' + b + ' · ETH ' + e + ' · резерв ' + r,
      record: (q, s) => 'Записать продажу ' + q + ' ' + s, setup: 'Настроить план', off: 'Выключить',
      note: 'Приложение ничего не продаёт — только напоминает и считает. Это ваш план, а не инвестиционный совет.',
      noPrice: 'нет цены', perAll: 'План один для всех альткоинов, включается отдельно для каждой монеты.',
      stepN: n => 'Ступень ' + n, xLbl: 'Рост, ×', pctLbl: 'Продать, %', addStep: 'Добавить ступень', del: 'Убрать ступень',
      keep: p => 'Остаётся держать: ' + p + '%', whereTo: 'Куда идёт выручка, %', res: 'Резерв', save: 'Сохранить',
      eSteps: 'Нужна хотя бы одна ступень', eX: 'Рост — число больше 1 и не больше 1000, каждая ступень выше прошлой',
      ePct: 'Доля продажи — целое число от 1 до 100', eSum: 'Вместе ступени продают больше 100% монет', eSplit: 'Раздел выручки — целые числа, вместе ровно 100',
      saved: 'План выхода сохранён', onT: s => 'План выхода для ' + s + ' включён', offT: s => 'План выхода для ' + s + ' выключен', noDb: 'Нет подключения к данным', fail: 'Не сохранилось',
      nTitle: (s, x) => s + ': ступень ×' + x + ' плана выхода', nBody: (p, t) => 'Цена ' + p + ' — выше цели ' + t + '. Сколько продать и куда пойдёт выручка — в карточке монеты.',
      toast: (s, x) => s + ' дошёл до ×' + x + ' — пора по плану выхода',
      say: (s, x, q) => s + ' вырос в ' + x + ' ' + razRu(x) + ' от вашей средней цены. По плану выхода — продать ' + (q ? q + ' ' + s : 'часть монет') + '; куда пойдёт выручка, показал в карточке монеты.'
    },
    uk: {
      title: 'План виходу', preset: 'Драбинка ×2 / ×4', custom: 'Свій план',
      presetAbout: 'Метод автора MoneyLife: на зростанні ×2 від середньої ціни купівлі продати 50% монет, на ×4 — ще 25%, решту 25% тримати. Виручка: 25% у BTC, 25% в ETH, 50% у резерв на докупівлю.',
      offLead: 'Заздалегідь вирішіть, на якому зростанні фіксувати прибуток. Застосунок нагадає, коли ціна дійде до сходинки, і порахує, куди підуть гроші.',
      now: 'Зараз вибрано', enable: s => 'Увімкнути для ' + s, noAvg: 'Немає середньої ціни купівлі — план рахується від неї. Запишіть купівлю із сумою, і план запрацює.',
      growth: 'Зростання від середньої ціни', toNext: (x, p, t) => 'До ×' + x + ' ще ' + p + ' · ціль ' + t, allDone: 'Усі сходинки виконано — далі тримайте залишок за планом.',
      sell: (q, s) => 'продати ' + q + ' ' + s, sold: (q, s) => 'продано ≈' + q + ' ' + s, hold: (q, s, p) => 'Тримати ' + q + ' ' + s + ' (' + p + '%)',
      reached: 'ціль досягнуто', split: (b, e, r) => 'BTC ' + b + ' · ETH ' + e + ' · резерв ' + r,
      record: (q, s) => 'Записати продаж ' + q + ' ' + s, setup: 'Налаштувати план', off: 'Вимкнути',
      note: 'Застосунок нічого не продає — лише нагадує й рахує. Це ваш план, а не інвестиційна порада.',
      noPrice: 'немає ціни', perAll: 'План один для всіх альткоїнів, вмикається окремо для кожної монети.',
      stepN: n => 'Сходинка ' + n, xLbl: 'Зростання, ×', pctLbl: 'Продати, %', addStep: 'Додати сходинку', del: 'Прибрати сходинку',
      keep: p => 'Залишається тримати: ' + p + '%', whereTo: 'Куди йде виручка, %', res: 'Резерв', save: 'Зберегти',
      eSteps: 'Потрібна хоча б одна сходинка', eX: 'Зростання — число більше 1 і не більше 1000, кожна сходинка вища за попередню',
      ePct: 'Частка продажу — ціле число від 1 до 100', eSum: 'Разом сходинки продають більше 100% монет', eSplit: 'Розподіл виручки — цілі числа, разом рівно 100',
      saved: 'План виходу збережено', onT: s => 'План виходу для ' + s + ' увімкнено', offT: s => 'План виходу для ' + s + ' вимкнено', noDb: 'Немає підключення до даних', fail: 'Не збереглося',
      nTitle: (s, x) => s + ': сходинка ×' + x + ' плану виходу', nBody: (p, t) => 'Ціна ' + p + ' — вище цілі ' + t + '. Скільки продати і куди піде виручка — у картці монети.',
      toast: (s, x) => s + ' дійшов до ×' + x + ' — час за планом виходу',
      say: (s, x, q) => s + ' виріс у ' + x + ' ' + razUk(x) + ' від вашої середньої ціни. За планом виходу — продати ' + (q ? q + ' ' + s : 'частину монет') + '; куди піде виручка, показав у картці монети.'
    }
  };
  function razRu(x) { if (x % 1) return 'раза'; const n = Math.abs(x) % 100, m = n % 10; return (m >= 2 && m <= 4 && (n < 12 || n > 14)) ? 'раза' : 'раз'; }
  function razUk(x) { if (x % 1) return 'раза'; const n = Math.abs(x) % 100, m = n % 10; return (m >= 2 && m <= 4 && (n < 12 || n > 14)) ? 'рази' : 'разів'; }
  const lang = () => (window.mlLang && window.mlLang() === 'uk' ? 'uk' : 'ru');
  const T = () => TXT[lang()];
  const loc = () => (lang() === 'uk' ? 'uk-UA' : 'ru-RU');
  const xFmt = x => (+x).toLocaleString(loc(), { maximumFractionDigits: 2 });

  /* ---------------- чистые расчёты (их проверяет tests/run_tests.py) ---------------- */
  /* доллары → целые центы; через 1e6 убираем хвосты дробной арифметики (11 × 4,4 = 48,400000000000006 → 4840) */
  const cents = usd => Math.round(Math.round((+usd || 0) * 1e6) / 1e4);
  /* раздел выручки в центах: BTC и ETH — вниз до цента, остаток — в резерв; сумма частей = выручке */
  function splitCents(c, sp) {
    c = Math.max(0, Math.round(+c || 0));
    const b = Math.floor(c * sp.BTC / 100), e = Math.floor(c * sp.ETH / 100);
    return { BTC: b, ETH: e, RES: c - b - e };
  }
  /* ошибки плана: '' — всё в порядке, иначе ключ текста */
  function checkSteps(steps) {
    if (!Array.isArray(steps) || !steps.length) return 'eSteps';
    if (steps.length > MAX_STEPS) return 'eSteps';
    let prev = 1, sum = 0;
    for (const s of steps) {
      const x = +s.x, p = +s.pct;
      if (!isFinite(x) || x <= prev || x > 1000) return 'eX';
      if (!Number.isInteger(p) || p < 1 || p > 100) return 'ePct';
      prev = x; sum += p;
    }
    return sum > 100 ? 'eSum' : '';
  }
  function checkSplit(sp) {
    if (!sp) return 'eSplit';
    const v = [sp.BTC, sp.ETH, sp.RES].map(Number);
    if (v.some(n => !Number.isInteger(n) || n < 0 || n > 100)) return 'eSplit';
    return v[0] + v[1] + v[2] === 100 ? '' : 'eSplit';
  }
  function normPlan(p) {
    p = p && typeof p === 'object' ? p : {};
    const custom = p.preset === 'custom';
    const steps = custom && !checkSteps(p.steps) ? p.steps.map(s => ({ x: +s.x, pct: +s.pct })) : PRESET.steps.map(s => Object.assign({}, s));
    const split = custom && !checkSplit(p.split) ? { BTC: +p.split.BTC, ETH: +p.split.ETH, RES: +p.split.RES } : Object.assign({}, PRESET.split);
    const coins = {};
    for (const [k, v] of Object.entries(p.coins && typeof p.coins === 'object' ? p.coins : {})) if (v && v.on && v.since) coins[String(k).toUpperCase()] = { on: true, since: String(v.since), done: v.done && typeof v.done === 'object' ? Object.assign({}, v.done) : {} };
    return { v: 1, preset: custom ? 'custom' : 'ladder24', steps, split, coins };
  }
  /* состояние лесенки монеты.
     qty — монет сейчас, sold — продано с момента включения плана, avg — средняя цена покупки, price — цена сейчас,
     done — ступени, которые уже отмечены выполненными ({n: ts}).
     База лесенки = монеты сейчас + проданные с включения плана: докупки после включения увеличивают базу. */
  function ladder(o) {
    const qty = Math.max(0, +o.qty || 0), sold = Math.max(0, +o.sold || 0), base = qty + sold, avg = +o.avg || 0, price = +o.price || 0;
    const steps = o.steps || PRESET.steps, sp = o.split || PRESET.split, done = o.done || {};
    const out = []; let cum = 0, prevCum = 0;
    steps.forEach((s, i) => {
      cum += s.pct; const cumQty = base * cum / 100, n = i + 1;
      const isDone = !!done[n] || (base > 0 && sold >= cumQty * 0.98 - 1e-12);   /* 2% — на округление количества в записи продажи */
      const target = avg * s.x;
      const left = isDone ? 0 : Math.max(0, cumQty - Math.max(sold, prevCum));
      const soldHere = Math.max(0, Math.min(sold, cumQty) - Math.min(sold, prevCum));   /* сколько из записанных продаж пришлось на эту ступень */
      const reached = !isDone && avg > 0 && price > 0 && price >= target;
      const at = reached ? price : target, usdC = isDone ? 0 : cents(left * at);
      out.push({ n, x: s.x, pct: s.pct, target, qty: isDone ? (soldHere > 0 ? soldHere : base * s.pct / 100) : left, done: isDone, reached, usdC, parts: splitCents(usdC, sp) });
      prevCum = cumQty;
    });
    const holdPct = Math.max(0, 100 - cum);
    return { base, avg, price, steps: out, holdPct, holdQty: base * holdPct / 100, next: out.find(s => !s.done) || null };
  }
  /* продажи «по плану»: с момента включения и по цене не ниже 90% цели первой ступени.
     Вынужденная продажа ниже цели (нужны были деньги) ступень не закрывает — она просто уменьшает остаток. */
  function planSold(txs, sym, since, minPrice) {
    let q = 0; const s0 = String(since || '');
    for (const t of txs || []) {
      if (!t || t.type !== 'sell' || String(t.symbol || '').toUpperCase() !== sym || String(t.ts || '') < s0) continue;
      const n = +t.qty || 0, pr = +t.price || (+t.usd > 0 && n > 0 ? +t.usd / n : 0);
      if (n > 0 && pr > 0 && pr >= minPrice * 0.9) q += n;
    }
    return q;
  }
  E.math = { cents, splitCents, checkSteps, checkSplit, normPlan, ladder, planSold, PRESET };

  /* ---------------- данные ---------------- */
  let PL = null, raw = null, subbed = false, saving = false, tickAt = 0, doneRetry = 0;
  function sub() {
    if (subbed || typeof db === 'undefined' || !db) return;
    subbed = true;
    try { db.doc(DOC).onSnapshot(s => { raw = s.exists ? s.data() : null; PL = normPlan(raw); rerender(); tickAt = 0; try { E.tick(derive()); } catch (e) {} }, () => {}); } catch (e) { subbed = false; }
  }
  const plan = () => PL || normPlan(raw);
  async function save(p, okMsg, quiet) {
    if (typeof db === 'undefined' || !db) { if (!quiet) toast(T().noDb); return false; }
    try { saving = true; await db.doc(DOC).set(Object.assign({}, p, { v: 1, at: Date.now() })); if (okMsg) toast(okMsg); return true; }
    catch (e) { if (!quiet) toast(typeof failMsg === 'function' ? failMsg(e, T().fail) : T().fail); return false; }
    finally { saving = false; }
  }
  const isAlt = sym => !!sym && !NOT_ALT.has(String(sym).toUpperCase());
  function coinCalc(sym, D) {
    const p = plan(), c = p.coins[sym]; if (!c) return null;
    const h = D.h[sym] || { qty: 0, usd: 0, cq: 0 }, avg = h.cq > 1e-12 && h.usd > 0 ? h.usd / h.cq : 0;
    return ladder({ qty: h.qty, sold: avg > 0 ? planSold(S.tx, sym, c.since, avg * p.steps[0].x) : 0, avg, price: +D.prices[sym] || 0, steps: p.steps, split: p.split, done: c.done });
  }
  /* выполненные по записанным продажам ступени — запоминаем, чтобы докупка после ×2 не «открывала» ступень заново */
  function persistDone(sym, st) {
    const p = plan(), c = p.coins[sym]; if (!c || saving || window.mlDemo || Date.now() < doneRetry) return;
    const add = st.steps.filter(s => s.done && !c.done[s.n]); if (!add.length) return;
    const coins = JSON.parse(JSON.stringify(p.coins)); add.forEach(s => { coins[sym].done[s.n] = Date.now(); });
    /* тихо: это служебная отметка; не вышло (нет связи) — повтор не раньше чем через 10 минут, без тостов */
    save(Object.assign({}, p, { coins }), '', true).then(ok => { if (!ok) doneRetry = Date.now() + 600000; });
  }

  /* ---------------- вид в карточке монеты ---------------- */
  const tick = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const usdC = c => money(c / 100);
  const presetName = p => (p.preset === 'custom' ? T().custom : T().preset);
  function planLine(p) { const t = T(); return p.steps.map(s => '×' + xFmt(s.x) + ' → ' + s.pct + '%').join(' · ') + ' · ' + t.keep(Math.max(0, 100 - p.steps.reduce((a, s) => a + s.pct, 0))).toLowerCase(); }
  function coinHtml(sym, D) {
    const t = T(), p = plan(), c = p.coins[sym], S2 = esc(sym);
    if (!c) {
      const h = D.h[sym] || {}, avg = h.cq > 1e-12 && h.usd > 0;
      return `<div class="card ex-card ex-off"><div class="ex-h"><span class="label">${t.title}</span></div><p class="hint">${t.offLead}</p>`
        + `<p class="ex-cur"><span>${t.now}:</span> ${esc(presetName(p))} — ${esc(planLine(p))}</p>`
        + (avg ? `<button type="button" class="btn soft block" data-ex="on" data-sym="${S2}">${t.enable(S2)}</button>` : `<p class="hint">${t.noAvg}</p>`)
        + `<button type="button" class="btn sm ghost block" data-ex="cfg">${t.setup}</button></div>`;
    }
    const st = coinCalc(sym, D); if (!st) return '';
    if (!(st.avg > 0)) return `<div class="card ex-card"><div class="ex-h"><span class="label">${t.title}</span><span class="chip">${esc(presetName(p))}</span></div><p class="hint">${t.noAvg}</p>`
      + `<div class="btnrow"><button type="button" class="btn sm ghost" data-ex="cfg">${t.setup}</button><button type="button" class="btn sm ghost" data-ex="off" data-sym="${S2}">${t.off}</button></div></div>`;
    const mult = st.price > 0 ? st.price / st.avg : null, nx = st.next;
    const prog = nx && mult != null ? Math.max(0, Math.min(1, (st.price - st.avg) / (nx.target - st.avg))) : nx ? 0 : 1;
    const multTxt = mult == null ? t.noPrice : '×' + mult.toLocaleString(loc(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const hintTxt = !nx ? t.allDone : nx.reached ? '' : mult == null ? '' : t.toNext(xFmt(nx.x), pct((nx.target / st.price - 1) * 100, 0), money(nx.target, { price: true }));
    const rows = st.steps.map(s => {
      const cls = s.done ? 'done' : s.reached ? 'go' : 'wait', q = qtyS(s.qty) + ' ' + S2;
      const head = '×' + xFmt(s.x) + ' · ' + money(s.target, { price: true }) + (s.reached ? ' · ' + t.reached : '');
      const sub = (s.done ? t.sold(q, '') : t.sell(q, '')).trim() + (s.done ? '' : '<br>' + t.split(usdC(s.parts.BTC), usdC(s.parts.ETH), usdC(s.parts.RES)));
      return `<div class="ex-st ${cls}"><span class="ex-ic" aria-hidden="true">${s.done ? tick : s.n}</span><span class="col"><span class="nm">${head}</span>${sub ? `<span class="sub">${sub}</span>` : ''}</span><span class="r">${s.done ? '' : '≈' + usdC(s.usdC)}</span></div>`;
    }).join('');
    const hold = st.holdPct > 0 ? `<div class="ex-st hold"><span class="ex-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span><span class="col"><span class="nm">${t.hold(qtyS(st.holdQty), S2, st.holdPct)}</span></span><span class="r"></span></div>` : '';
    const go = st.steps.find(s => s.reached), goQ = st.steps.filter(s => s.reached).reduce((a, s) => a + s.qty, 0);   /* перескочили несколько ступеней — продажа сразу за все */
    const rec = go ? `<button type="button" class="btn block" data-ex="sell" data-sym="${S2}" data-q="${+goQ.toPrecision(8)}">${t.record(qtyS(goQ), S2)}</button>` : '';
    return `<div class="card ex-card${go ? ' ex-go' : ''}"><div class="ex-h"><span class="label">${t.title}</span><span class="chip">${esc(presetName(p))}</span></div>`
      + `<div class="ex-now"><span>${t.growth}</span><b class="${mult != null && mult >= 1 ? 'pos' : mult != null ? 'neg' : ''}">${multTxt}</b></div>`
      + `<div class="ex-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(prog * 100)}" aria-valuetext="${esc(hintTxt || multTxt)}" aria-label="${esc(t.growth)}"><i style="transform:scaleX(${prog.toFixed(3)})"></i></div>`
      + (hintTxt ? `<p class="hint">${hintTxt}</p>` : '')
      + `<div class="ex-steps">${rows}${hold}</div>${rec}`
      + `<div class="btnrow"><button type="button" class="btn sm ghost" data-ex="cfg">${t.setup}</button><button type="button" class="btn sm ghost" data-ex="off" data-sym="${S2}">${t.off}</button></div>`
      + `<p class="hint">${t.note}</p></div>`;
  }
  let lastSym = null;
  E.coin = function (sym, D) {
    sub(); const box = el('cvExit'); if (!box) return; lastSym = sym;
    const h = D && D.h[sym];
    if (!isAlt(sym) || !h || !(h.qty > 1e-12)) { box.hidden = true; box.innerHTML = ''; return; }
    const html = coinHtml(sym, D); if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; } box.hidden = !html;
  };
  function rerender() { try { if (lastSym && el('coinSheet') && el('coinSheet').classList.contains('open')) E.coin(lastSym, derive()); } catch (e) {} }

  /* ---------------- настройка плана ---------------- */
  let ED = null, cfgOpen = false;
  function cfgStart() { const p = plan(); ED = { preset: p.preset, steps: p.steps.map(s => Object.assign({}, s)), split: Object.assign({}, p.split) }; cfgOpen = true; cfgDraw(); }
  const num = v => { const s = String(v == null ? '' : v).replace(',', '.').replace(/\s/g, ''); return s === '' ? NaN : +s; };
  function cfgRead() {
    if (!ED || ED.preset !== 'custom') return;
    const b = el('xBody'); if (!b) return;
    b.querySelectorAll('[data-exs]').forEach(r => { const i = +r.dataset.exs, s = ED.steps[i]; if (!s) return; s.x = num(r.querySelector('[data-k="x"]').value); s.pct = num(r.querySelector('[data-k="pct"]').value); });
    ['BTC', 'ETH', 'RES'].forEach(k => { const f = b.querySelector('[data-sp="' + k + '"]'); if (f) ED.split[k] = num(f.value); });
  }
  function cfgDraw() {
    if (!ED || !window.MLX || !MLX.open) return;
    const t = T(), cu = ED.preset === 'custom', vv = v => (isFinite(v) ? String(v).replace('.', ',') : '');
    const keep = Math.max(0, 100 - ED.steps.reduce((a, s) => a + (isFinite(s.pct) ? s.pct : 0), 0));
    let html = `<div class="seg" role="group" aria-label="${esc(t.title)}"><button type="button" data-ex="mode" data-m="ladder24" aria-pressed="${!cu}">${t.preset}</button><button type="button" data-ex="mode" data-m="custom" aria-pressed="${cu}">${t.custom}</button></div>`;
    if (!cu) html += `<p class="ex-about">${t.presetAbout}</p>`;
    else {
      html += '<div class="ex-ed">' + ED.steps.map((s, i) => `<div class="ex-row" data-exs="${i}"><span class="ex-n">${t.stepN(i + 1)}</span><label class="field"><span>${t.xLbl}</span><input type="text" inputmode="decimal" autocomplete="off" data-k="x" aria-label="${esc(t.stepN(i + 1) + ': ' + t.xLbl)}" value="${vv(s.x)}"></label><label class="field"><span>${t.pctLbl}</span><input type="text" inputmode="numeric" autocomplete="off" data-k="pct" aria-label="${esc(t.stepN(i + 1) + ': ' + t.pctLbl)}" value="${vv(s.pct)}"></label>${ED.steps.length > 1 ? `<button type="button" class="ib" data-ex="del" data-i="${i}" aria-label="${esc(t.del + ' ' + (i + 1))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>` : '<span></span>'}</div>`).join('') + '</div>'
        + (ED.steps.length < MAX_STEPS ? `<button type="button" class="btn sm ghost block" data-ex="add">${t.addStep}</button>` : '')
        + `<p class="hint" id="exKeep">${t.keep(keep)}</p>`
        + `<span class="label">${t.whereTo}</span><div class="ex-sp">${[['BTC', 'BTC'], ['ETH', 'ETH'], ['RES', t.res]].map(([k, l]) => `<label class="field"><span>${l}</span><input type="text" inputmode="numeric" autocomplete="off" data-sp="${k}" value="${vv(ED.split[k])}"></label>`).join('')}</div>`;
    }
    html += `<p class="hint">${t.perAll}</p><p class="hint">${t.note}</p><p class="err" id="exErr" role="alert"></p>`;
    MLX.open('exit', t.title, html, `<button type="button" class="btn block" data-ex="save">${t.save}</button>`);
  }
  async function cfgSave() {
    cfgRead(); const t = T(), e = el('exErr');
    const steps = ED.preset === 'custom' ? ED.steps : PRESET.steps, split = ED.preset === 'custom' ? ED.split : PRESET.split;
    const bad = ED.preset === 'custom' ? (checkSteps(steps) || checkSplit(split)) : '';
    if (bad) { if (e) e.textContent = t[bad]; return; }
    const p = plan(), next = Object.assign({}, p, { preset: ED.preset, steps: steps.map(s => ({ x: +s.x, pct: +s.pct })), split: { BTC: +split.BTC, ETH: +split.ETH, RES: +split.RES } });
    if (await save(next, t.saved)) { cfgOpen = false; ED = null; play('cash'); closeSheets(); }
  }

  /* ---------------- напоминания ---------------- */
  const uidKey = () => (window.mlDemo ? 'demo' : (window.mlUser && window.mlUser.id) || 'local');
  const xKey = () => 'ml-x:' + uidKey();
  function seenGet() { try { const o = JSON.parse(localStorage.getItem(xKey()) || 'null'); return (o && o.seen) || {}; } catch (e) { return {}; } }
  function seenAdd(k) { try { const o = JSON.parse(localStorage.getItem(xKey()) || 'null') || {}; o.seen = Object.assign({}, o.seen || {}, { [k]: Date.now() }); localStorage.setItem(xKey(), JSON.stringify(o)); } catch (e) {} }
  /* ключ ступени — тот же вид, что у оповещений о цене (al:<id>), чтобы фоновая проверка sw.js не повторила показанное */
  const stepId = (sym, since, n) => 'ex-' + sym + '-' + (Date.parse(since) || 0).toString(36) + '-' + n;
  /* для фоновой проверки сервис-воркера: ближайшая невыполненная ступень каждой монеты как оповещение «вверх» */
  E.swAlerts = function () {
    try {
      if (!PL || !S.ready) return [];
      const D = derive(), seen = seenGet(), out = [];
      for (const sym of Object.keys(PL.coins)) { const st = coinCalc(sym, D); if (!st || !(st.avg > 0)) continue;
        const s = st.steps.find(x => !x.done && !seen['al:' + stepId(sym, PL.coins[sym].since, x.n)]); if (!s) continue;   /* ×2 уже показана — в фоне ждём ×4 */
        out.push({ id: stepId(sym, PL.coins[sym].since, s.n), sym, price: +s.target.toPrecision(6), dir: 'up' }); }
      return out.slice(0, 10);
    } catch (e) { return []; }
  };
  E.tick = function (D) {
    sub(); if (!PL || !S.ready || !S.live || S.live.status !== 'ok' || Date.now() - tickAt < 15000) return; tickAt = Date.now();
    const seen = seenGet(), t = T();
    for (const sym of Object.keys(PL.coins)) {
      const st = coinCalc(sym, D); if (!st || !(st.avg > 0)) continue;
      persistDone(sym, st);
      const s = st.steps.filter(x => x.reached).pop(); if (!s) continue;   /* цена перескочила несколько ступеней — говорим о самой высокой */
      const id = stepId(sym, PL.coins[sym].since, s.n); if (seen['al:' + id]) continue;
      st.steps.filter(x => x.reached).forEach(x => seenAdd('al:' + stepId(sym, PL.coins[sym].since, x.n)));
      const left = st.steps.filter(x => x.reached).reduce((a, x) => a + x.qty, 0), q = qtyS(left);
      const msg = t.toast(sym, xFmt(s.x)); setTimeout(() => { try { toast(msg); } catch (e) {} }, 1200);   /* после тоста о сохранении, а не вместо него */
      try { if (window.Mascot && Mascot.event) Mascot.event('exitStep', { text: t.say(sym, xFmt(s.x), P.hide ? '' : q) }); } catch (e) {}
      try { if (window.MLX && MLX.notify) MLX.notify(t.nTitle(sym, xFmt(s.x)), t.nBody(money(st.price, { price: true, show: true }), money(s.target, { price: true, show: true })), 'al:' + id); } catch (e) {}   /* на экране блокировки — без количества, как у сигналов лестницы */
    }
  };

  /* ---------------- события ---------------- */
  document.addEventListener('click', async e => {
    const b = e.target.closest && e.target.closest('[data-ex]'); if (!b) return;
    const k = b.dataset.ex, sym = b.dataset.sym, t = T();
    if (k === 'cfg') { play('tick'); cfgStart(); return; }
    if (k === 'mode') { cfgRead(); ED.preset = b.dataset.m === 'custom' ? 'custom' : 'ladder24'; play('tick'); cfgDraw(); return; }
    if (k === 'add') { cfgRead(); const l = ED.steps[ED.steps.length - 1] || { x: 1, pct: 0 }; ED.steps.push({ x: (isFinite(l.x) ? l.x : 1) * 2, pct: 10 }); play('tick'); cfgDraw(); return; }
    if (k === 'del') { cfgRead(); ED.steps.splice(+b.dataset.i, 1); play('tick'); cfgDraw(); return; }
    if (k === 'save') { cfgSave(); return; }
    if (k === 'on' && sym) { const p = plan(), coins = Object.assign({}, p.coins, { [sym]: { on: true, since: new Date().toISOString(), done: {} } });
      if (await save(Object.assign({}, p, { coins }), t.onT(sym))) { play('cash'); E.coin(sym, derive()); } return; }
    if (k === 'off' && sym) { const p = plan(), coins = Object.assign({}, p.coins); delete coins[sym];
      if (await save(Object.assign({}, p, { coins }), t.offT(sym))) { play('tick'); E.coin(sym, derive()); } return; }
    if (k === 'sell' && sym) { play('tick'); openAct('sell', { sym, qty: +b.dataset.q || '' }); }
  });
  document.addEventListener('input', e => { if (cfgOpen && e.target && e.target.closest && e.target.closest('.ex-ed,.ex-sp')) { const er = el('exErr'); if (er) er.textContent = ''; cfgRead(); const k = el('exKeep'); if (k && ED) k.textContent = T().keep(Math.max(0, 100 - ED.steps.reduce((a, s) => a + (isFinite(s.pct) ? s.pct : 0), 0))); } });
  /* шторку закрыли — редактор забыт (без сохранения ничего не меняется) */
  document.addEventListener('click', e => { if (cfgOpen && e.target.closest && e.target.closest('#xSheet [data-close]')) { cfgOpen = false; ED = null; } }, true);

  /* ---------------- вид ---------------- */
  const css = document.createElement('style'); css.id = 'ex-css';
  css.textContent = '#cvExit{margin:2px 0 4px}.ex-card{display:flex;flex-direction:column;gap:10px}.ex-h{display:flex;align-items:center;justify-content:space-between;gap:8px}'
    + '.ex-cur{font-size:13px;margin:0;line-height:1.45}.ex-cur span{color:var(--mute)}.ex-about{font-size:14px;line-height:1.5;margin:12px 0 0}'
    + '.ex-now{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:14px}.ex-now span{color:var(--mute)}.ex-now b{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}'
    + '.ex-now b.pos{color:var(--pos)}.ex-now b.neg{color:var(--neg)}'
    + '.ex-bar{height:6px;border-radius:3px;background:var(--raise);overflow:hidden}.ex-bar i{display:block;height:100%;background:var(--accent);transform-origin:0 50%;transition:transform .5s var(--ease,ease)}'
    + '.ex-steps{display:flex;flex-direction:column}.ex-st{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:10px;align-items:start;padding:10px 0;border-top:1px solid var(--line);font-size:14px}'
    + '.ex-st .nm,.ex-st .sub{white-space:normal;overflow:visible;text-overflow:clip}.ex-st .nm{display:block;font-weight:650;font-variant-numeric:tabular-nums}.ex-st .sub{display:block;font-size:12px;color:var(--mute);margin-top:3px;font-variant-numeric:tabular-nums}'
    + '.ex-st .r{font-size:13px;color:var(--mute);font-variant-numeric:tabular-nums;white-space:nowrap}.ex-st.go .r{color:var(--pos)}.ex-st.done .nm{color:var(--mute)}'
    + '.ex-ic{width:24px;height:24px;border-radius:50%;border:1.5px solid var(--line2);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--mute)}.ex-ic svg{width:13px;height:13px}'
    + '.ex-st.done .ex-ic{background:var(--pos-soft);border-color:transparent;color:var(--pos)}.ex-st.go .ex-ic{border-color:var(--pos);color:var(--pos)}.ex-st.hold .ex-ic{border-color:transparent;background:var(--raise);color:var(--fg)}'
    + '.ex-ed{display:flex;flex-direction:column;gap:10px;margin-top:12px}.ex-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 48px;gap:8px;align-items:end}'
    + '.ex-row .ex-n{grid-column:1/-1;font-size:12px;font-weight:700;color:var(--mute);margin-bottom:-4px}.ex-row .ib{width:48px;height:48px}'
    + '.ex-sp{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:6px}#xBody .label{display:block;margin-top:6px}'
    + '@media (prefers-reduced-motion:reduce){.ex-bar i{transition:none}}';
  document.head.appendChild(css);
})();
