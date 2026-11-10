/* MoneyLife 3.0 — новые разделы поверх основного приложения (index.html):
   «Сегодня» (шкала лестницы, план месяца, настроение рынка, напоминания), «Из чего итог», «Личный план» по 14 книгам
   с числом свободы, «Знания», карточка «Поделиться», сигналы на телефоне, искры-праздник.
   Правила: расчёты денег и формат записей не меняются — здесь только показ того, что уже посчитано в index.html.
   Личные ответы анкеты и отметки хранятся только на телефоне (localStorage), в базу не уходят.
   Всё подписано «не инвестиционный совет»: приложение пересказывает идеи книг и считает по правилам человека. */
(function () {
  'use strict';
  const X = (window.MLX = {});
  const el = id => document.getElementById(id);
  const uidKey = () => (window.mlDemo ? 'demo' : (window.mlUser && window.mlUser.id) || 'local');
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  /* мелкие отметки на телефоне: что уже показано, когда сохраняли копию, настроение рынка */
  const xKey = () => 'ml-x:' + uidKey();
  const xGet = () => { const o = lsGet(xKey(), {}); return o && typeof o === 'object' ? o : {}; };
  const xPatch = p => { const o = Object.assign(xGet(), p); lsSet(xKey(), o); return o; };
  const today = () => isoDay(new Date());
  const daysSince = iso => { const t = Date.parse(iso); return isFinite(t) ? Math.floor((Date.now() - t) / 864e5) : null; };
  const chev = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  const tick = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const DISCLAIMER = 'Это пересказ идей из книг и расчёт по твоим ответам, а не инвестиционный совет. Решения принимаешь ты.';

  /* ================= общая шторка ================= */
  let sheetKind = null, sheetBack = null;
  function xOpen(kind, title, html, foot, back) {
    sheetKind = kind; sheetBack = back || null;
    el('xTitle').textContent = title; el('xBody').innerHTML = html;
    el('xFoot').hidden = !foot; el('xFootIn').innerHTML = foot || ''; el('xBack').hidden = !back;
    if (!el('xSheet').classList.contains('open')) openSheet('xSheet');
    const b = el('xSheet').querySelector('.sh-body'); if (b) b.scrollTop = 0;
  }
  el('xBack').addEventListener('click', () => { play('tick'); if (sheetBack) sheetBack(); });

  /* ================= искры: короткий праздник важного шага ================= */
  X.sparks = function (from, n) {
    if (reduced || document.documentElement.classList.contains('lite')) return;
    const r = (from && from.getBoundingClientRect) ? from.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 3, width: 0, height: 0 };
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, cols = ['#ffc24d', '#ff9a3d', '#b76bff', '#ff6fd8', '#ffffff'];
    for (let i = 0; i < (n || 14); i++) {
      const d = document.createElement('i'); d.className = 'spark-p'; d.style.background = cols[i % cols.length]; document.body.appendChild(d);
      if (!d.animate) { d.remove(); continue; }
      const a = Math.PI * 2 * i / (n || 14) + Math.random() * .5, dist = 60 + Math.random() * 70, dx = Math.cos(a) * dist, dy = Math.sin(a) * dist - 30;
      d.animate([{ transform: `translate(${cx}px,${cy}px) scale(.4) rotate(0deg)`, opacity: 1 }, { transform: `translate(${cx + dx}px,${cy + dy}px) scale(1) rotate(${160 + i * 20}deg)`, opacity: 1, offset: .6 }, { transform: `translate(${cx + dx * 1.15}px,${cy + dy + 46}px) scale(.5) rotate(${260 + i * 20}deg)`, opacity: 0 }],
        { duration: 760 + Math.random() * 260, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).onfinish = () => d.remove();
    }
  };

  /* ================= настроение рынка (индекс страха и жадности, alternative.me) ================= */
  const FNG_URL = 'https://api.alternative.me/fng/?limit=1';
  const fngWord = v => v < 25 ? 'сильный страх' : v < 47 ? 'страх' : v < 55 ? 'нейтрально' : v < 76 ? 'жадность' : 'сильная жадность';
  let fngBusy = false;
  function fngLoad() {
    const f = xGet().fng; if (fngBusy || (f && Date.now() - f.at < 6 * 3600e3) || navigator.onLine === false) return;
    fngBusy = true;
    fetch(FNG_URL).then(r => r.json()).then(j => { const v = +(j && j.data && j.data[0] && j.data[0].value); if (v >= 0 && v <= 100) { xPatch({ fng: { v: Math.round(v), at: Date.now() } }); try { render(); } catch (e) {} } })
      .catch(() => { xPatch({ fng: Object.assign({}, f || {}, { at: Date.now() - 5 * 3600e3 }) }); })   /* не вышло — повтор через час */
      .finally(() => { fngBusy = false; });
  }
  const fngNow = () => { const f = xGet().fng; return f && f.v != null && Date.now() - f.at < 36 * 3600e3 ? f : null; };

  /* ================= цель BTC сверху (необязательное поле настроек exitBtc) ================= */
  const goalBtc = () => { const g = +((S.settings || {}).exitBtc); return g > 0 ? g : 0; };

  /* ================= шкала лестницы: твои правила на одной линии ================= */
  function scaleHtml(D) {
    const btc = +D.prices.BTC || 0, ath = +(S.cycle && S.cycle.ath) || 0, levels = (S.cycle && S.cycle.levels) || [], goal = goalBtc();
    if (!ath || (!ladderOn() && !goal)) return '';
    const lad = ladderOn() && levels.length > 0;
    const lo = lad ? ath * .22 : Math.min(btc || ath, ath) * .6, hi = Math.max(ath, goal, btc) * 1.05;
    const pos = p => Math.max(0, Math.min(100, (p - lo) / (hi - lo) * 100));
    let mk = '';
    if (lad) for (const l of levels) { const st = lvState(l, btc, D); mk += `<i class="xs-mk ${st}" style="left:${pos(lvPrice(l)).toFixed(1)}%"><b>−${l.drop}</b></i>`; }
    mk += `<i class="xs-mk ath" style="left:${pos(ath).toFixed(1)}%"><b>макс</b></i>`;
    if (goal) mk += `<i class="xs-mk goal${btc >= goal ? ' hit' : ''}" style="left:${pos(goal).toFixed(1)}%"><b>цель</b></i>`;
    const dd = btc ? (btc / ath - 1) * 100 : null;
    let capL = btc ? `BTC ${money(btc, { d: 0, show: true })} · ${pct(dd)} от максимума` : 'нет цены BTC — шкала обновится, когда цены придут', capR = '';
    if (btc) {
      const next = lad ? levels.find(l => ['wait', 'near'].includes(lvState(l, btc, D))) : null, act = lad ? levels.find(l => ['go', 'hold'].includes(lvState(l, btc, D))) : null;
      if (goal && btc >= goal) capR = 'цель достигнута';
      else if (act) capR = `ступень ${act.n} открыта`;
      else if (next) capR = `до ступени ${next.n}: ${pct((lvPrice(next) / btc - 1) * 100)}`;
      else if (goal) capR = `до цели: ${pct((goal / btc - 1) * 100)}`;
    }
    return `<button type="button" class="xs${btc ? '' : ' off'}" data-x="scale" aria-label="Шкала стратегии. ${esc(capL)}${capR ? '. ' + esc(capR) : ''}. Открыть «Стратегию»">
      <span class="xs-track">${btc ? `<i class="xs-fill" style="width:${pos(btc).toFixed(1)}%"></i>` : ''}${mk}${btc ? `<i class="xs-cur" style="left:${pos(btc).toFixed(1)}%"></i>` : ''}</span>
      <span class="xs-cap"><span>${capL}</span>${capR ? `<b>${capR}</b>` : ''}</span></button>`;
  }

  /* ================= «Сегодня»: что важно сейчас по твоим правилам ================= */
  function monthBought() { const s0 = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(); return S.tx.filter(t => String(t.ts) >= s0 && ['buy', 'dca'].includes(t.type)).reduce((a, t) => a + (+t.usd || 0), 0); }
  function todayLines(D) {
    const L = [], x = xGet(), add = (tone, html, act) => L.push({ tone, html, act });
    const goal = goalBtc(), btc = +D.prices.BTC || 0;
    if (goal && btc >= goal) add('gold', `BTC выше твоей цели <b>${usd(goal, 0)}</b>. Что делать дальше — по твоему плану.`, ['Цель', 'goal']);
    /* план месяца */
    if (D.hasDep) { if (D.dcaBudget > .5) add('acc', `По плану осталось купить на <b>${usd(D.dcaBudget)}</b>.`, ['Купить', 'dca']); else if (monthBought() > 0) add('pos', 'План покупок этого месяца выполнен.'); }
    else { const bud = budgetUsd() * depShare(), got = monthBought(); if (bud > 0) { if (got >= bud * .98) add('pos', `План месяца выполнен: куплено на <b>${usd(got, 0)}</b>.`); else add('acc', `План месяца: куплено на <b>${usd(got, 0)}</b> из ${usd(bud, 0)}.`, ['Купить', 'buy']); } }
    /* день пополнения */
    const dd = +S.settings.depositDay || 0; if (dd && new Date().getDate() === dd && !S.tx.some(t => t.type === 'deposit' && String(t.ts).slice(0, 10) === today())) add('info', 'Сегодня твой день пополнения биржи.', ['Пополнить', 'deposit']);
    /* резерв выше потолка */
    const capP = +S.settings.capPct || 20, cap = D.total * capP / 100; if (ladderOn() && cap > 0 && D.reserve > cap * 1.02) add('warn', `Резерв выше потолка на <b>${money(D.reserve - cap, { d: 0 })}</b> — как поступить, решаешь ты.`, ['Правила', 'rules']);
    /* личный план: доля крипты и следующий шаг */
    const pl = planGet();
    if (pl) { const R = planResult(pl), sh = cryptoShare(pl, D);
      if (sh != null && sh > R.ceil + .5) add('warn', `Крипта — <b>${nf(sh, 0)}%</b> твоих накоплений при потолке ${R.ceil}%.`, ['План', 'plan']);
      else { const st = R.steps.find(s => !(pl.steps || {})[s.id]); if (st) add('acc', `Шаг плана: ${esc(st.short || st.t)}.`, ['План', 'plan']); } }
    /* настроение рынка */
    const f = fngNow(); if (f) add(f.v < 47 ? 'neg' : f.v < 55 ? 'mute' : 'pos', `Настроение рынка: <b>${f.v}</b> из 100 — ${fngWord(f.v)}.`, ['Что это', 'fng']);
    /* копия записей */
    const bd = daysSince(x.backupAt), first = S.tx.length ? daysSince(S.tx.slice().sort(byTs)[0].ts) : null;
    if (S.tx.length >= 5 && !window.mlDemo && ((bd == null && first != null && first >= 14) || (bd != null && bd >= 30))) add('mute', bd == null ? 'Копия записей ещё не сохранялась.' : `Копия записей не сохранялась ${pl2(bd)}.`, ['Сохранить', 'backup']);
    return L.slice(0, 4);
  }
  const pl2 = n => n + ' ' + plural(n, 'день', 'дня', 'дней');
  function renderToday(D) {
    const box = el('xToday'); if (!box) return;
    if (!S.ready || el('ob') && !el('ob').hidden) { box.hidden = true; return; }
    const sc = scaleHtml(D), L = todayLines(D);
    if (!sc && !L.length) { box.hidden = true; box._h = ''; return; }
    const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const h = `<div class="card xt" role="region" aria-label="Сегодня"><div class="sec-h"><span class="label">Сегодня</span><span class="small mute">${date}</span></div>${sc}${L.length ? '<ul class="xt-l">' + L.map(l => `<li class="${l.tone}"><i aria-hidden="true"></i><span>${l.html}</span>${l.act ? `<button type="button" class="more" data-x="${l.act[1]}">${l.act[0]}</button>` : ''}</li>`).join('') + '</ul>' : ''}</div>`;
    if (box._h !== h) { box.innerHTML = h; box._h = h; } box.hidden = false;
  }

  /* ================= «Из чего итог» ================= */
  function srcLine() {
    const L = S.live;
    if (navigator.onLine === false) return 'Нет сети — показаны последние известные цены' + (L.at ? ' на ' + tHM(L.at) : '');
    if (L.status === 'ok') return 'Цены: CoinGecko и биржи · обновлено в ' + tHM(L.at);
    if (L.status === 'stale') return 'Цены с задержкой · последнее обновление в ' + tHM(L.at);
    if (S.market && S.market.updatedAt) return 'Цены на ' + dShort(S.market.updatedAt) + ', ' + tHM(S.market.updatedAt);
    return 'Свежих цен пока нет';
  }
  function openTotal() {
    const D = derive(), priced = D.syms.filter(s => +D.prices[s] > 0), np = D.syms.filter(s => !(+D.prices[s] > 0)), gain = D.total - D.invPriced, r = rate();
    const rows = D.syms.map(s => { const c = D.h[s], p = +D.prices[s] || 0, v = c.qty * p;
      return `<div class="xr">${badge(s)}<span class="xr-n"><b>${esc(s)}</b><small>${qtyS(c.qty)} × ${p ? money(p, { price: true, show: true }) : '—'}</small></span><span class="xr-v">${p ? `<b>${money(v)}</b><small>${D.total ? nf(v / D.total * 100, 1) + '%' : ''}</small>` : '<b class="warnc">нет цены</b><small>в итог не входит</small>'}</span></div>`; }).join('');
    const kv = (k, v, cl) => `<div><span>${k}</span><span class="${cl || ''}">${v}</span></div>`;
    let h = `<div class="xtot"><span class="small mute">Стоимость монет</span><b>${D.noPrice ? '—' : money(D.total)}</b><span class="small mute">${esc(srcLine())}</span></div>`;
    if (!D.syms.length) h += '<div class="empty">Монет пока нет. Запиши первую покупку — итог сложится из количества и цены каждой монеты.</div>';
    else h += `<div><div class="sec-h"><span class="label">Монеты</span><span class="small mute">посчитано ${priced.length} из ${D.syms.length}</span></div><div class="list xr-list">${rows}</div>${np.length ? `<p class="npnote" style="margin-top:10px"><b>${esc(np.slice(0, 6).join(', '))}</b> — нет цены: биржи не ответили. Количество сохранено, в итог не ${np.length > 1 ? 'входят' : 'входит'}.</p>` : ''}</div>`;
    h += `<div><div class="sec-h"><span class="label">Как посчитано</span></div><div class="card"><div class="kv">${kv('Вложено в монеты', money(D.inv))}${D.invPriced > 0 && D.total > 0 ? kv(gain >= 0 ? 'Прибыль сейчас' : 'Результат сейчас', money(gain, { sign: true }) + ' · ' + pct(gain / D.invPriced * 100), gain >= 0 ? 'pos' : 'neg') : ''}${Math.abs(D.realized) >= .01 ? kv('Зафиксировано продажами', money(D.realized, { sign: true }), D.realized >= 0 ? 'pos' : 'neg') : ''}${ladderOn() || D.reserve ? kv('Резерв USDT — отдельно', money(D.reserve)) + kv('Монеты и резерв вместе', D.noPrice ? '—' : money(D.total + D.reserve)) : ''}${r && D.total ? kv('В гривнах', (P.hide ? '••••' : uah(D.total * r)) + ' · курс ' + nf(r, 2)) : ''}</div></div>
      <p class="hint">Итог = количество каждой монеты × её цена сейчас. Резерв в долларах в итог не входит — он ждёт докупок. Прибыль считается против того, что ты вписал в «потратил».</p></div>`;
    const foot = D.syms.length ? '<div class="btnrow"><button type="button" class="btn ghost" data-x="refresh">Обновить цены</button><button type="button" class="btn" data-x="share">Поделиться</button></div>' : '';
    xOpen('total', 'Из чего итог', h, foot);
  }

  /* ================= карточка «Поделиться»: результат в процентах, без сумм ================= */
  function shareCanvas(D) {
    const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#2a1563'); bg.addColorStop(.5, '#130a30'); bg.addColorStop(1, '#07040f'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const glow = (x, y, r, col) => { const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(0, 0, W, H); };
    glow(900, 120, 620, 'rgba(154,107,255,.42)'); glow(140, 1250, 640, 'rgba(255,79,216,.22)');
    /* знак */
    const mark = (x, y, s) => { g.save(); g.translate(x, y); g.scale(s, s); g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 52;
      const lg = g.createLinearGradient(48, 0, 404, 0); lg.addColorStop(0, '#b79bff'); lg.addColorStop(.45, '#ffffff'); lg.addColorStop(1, '#ffd9f6'); g.strokeStyle = lg;
      g.beginPath(); g.moveTo(74, 332); g.lineTo(134, 332); g.lineTo(196, 180); g.lineTo(256, 304); g.lineTo(316, 180); g.lineTo(378, 332); g.stroke();
      const cg = g.createRadialGradient(428, 320, 2, 438, 332, 36); cg.addColorStop(0, '#fff3c4'); cg.addColorStop(.45, '#ffc24d'); cg.addColorStop(1, '#ff8a2a'); g.fillStyle = cg; g.beginPath(); g.arc(438, 332, 33, 0, 7); g.fill(); g.restore(); };
    mark(60, 10, .34);
    const font = (w, s) => `${w} ${s}px Onest, system-ui, sans-serif`;
    g.fillStyle = '#f5f1ff'; g.font = font(800, 54); g.textBaseline = 'alphabetic'; g.fillText('MoneyLife', 250, 142);
    const gain = D.total - D.invPriced, has = D.invPriced > 0 && D.total > 0, p = has ? gain / D.invPriced * 100 : null;
    g.fillStyle = '#cfbaff'; g.font = font(600, 44); g.fillText(has ? 'Мой результат в крипте' : 'Мой портфель', 84, 400);
    g.fillStyle = has ? (gain >= 0 ? '#34e0a1' : '#ff7a86') : '#f5f1ff'; g.font = font(800, 230);
    g.fillText(has ? pct(p) : pl(D.syms.length, 'монета', 'монеты', 'монет'), 76, 640);
    /* доли */
    const v = s => (D.h[s] ? D.h[s].qty : 0) * (+D.prices[s] || 0), b = v('BTC'), e = v('ETH'), a = Math.max(0, D.total - b - e), parts = [['BTC', b, '#a64dff'], ['ETH', e, '#ff52d9'], ['Альткоины', a, '#cfbaff']].filter(x => x[1] > 0);
    if (D.total > 0 && parts.length) { let x = 84; const bw = W - 168, y = 760;
      for (const q of parts) { const w = bw * q[1] / D.total; g.fillStyle = q[2]; rr(g, x, y, Math.max(8, w - 8), 28, 14); g.fill(); x += w; }
      g.font = font(600, 40); let tx = 84; for (const q of parts) { g.fillStyle = q[2]; g.beginPath(); g.arc(tx + 12, 852, 12, 0, 7); g.fill(); g.fillStyle = '#f5f1ff'; const t = q[0] + ' ' + nf(q[1] / D.total * 100, 0) + '%'; g.fillText(t, tx + 36, 866); tx += g.measureText(t).width + 84; } }
    const first = S.tx.length ? daysSince(S.tx.slice().sort(byTs)[0].ts) : null;
    g.fillStyle = '#a99dcc'; g.font = font(500, 40);
    g.fillText([pl(D.syms.length, 'монета', 'монеты', 'монет'), first != null && first > 0 ? 'веду учёт ' + pl2(first) : '', 'покупаю по плану'].filter(Boolean).join(' · '), 84, 980);
    g.fillStyle = '#f5f1ff'; g.font = font(700, 44); g.fillText('Дневник и план крипто-накоплений', 84, 1170);
    g.fillStyle = '#ffc24d'; g.font = font(600, 40); g.fillText('koshei96.github.io/moneylife', 84, 1236);
    g.fillStyle = '#6d6396'; g.font = font(500, 30); g.fillText('Не инвестиционный совет. Суммы скрыты.', 84, 1296);
    return c;
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  X.shareCanvas = shareCanvas;
  async function share() {
    try {
      const c = shareCanvas(derive()), blob = await new Promise(res => c.toBlob(res, 'image/png'));
      if (!blob) throw new Error('no blob');
      const file = new File([blob], 'moneylife.png', { type: 'image/png' }), text = 'Веду крипто-накопления по плану в MoneyLife', url = 'https://koshei96.github.io/moneylife/';
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], text, url }); } catch (e) {} return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'moneylife.png'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      toast('Картинка сохранена — отправь её другу');
    } catch (e) { toast('Не получилось сделать картинку'); }
  }

  /* ================= личный план по 14 книгам ================= */
  const Q = [
    { k: 'inc', t: 'Какой у тебя доход?', o: ['Нестабильный — бывает, что ноль', 'Плавающий — то больше, то меньше', 'Стабильный — зарплата или постоянные заказы'] },
    { k: 'cus', t: 'На сколько месяцев обязательных расходов хватит запаса?', h: 'Запас — деньги, которые можно взять в любой день: наличные, карта, вклад.', o: ['Запаса нет', 'Меньше месяца', '1–3 месяца', '3–6 месяцев', 'Больше 6 месяцев'] },
    { k: 'debt', t: 'Есть ли долги?', o: ['Нет', 'Рассрочка без процентов или долг близким', 'Кредит под проценты, плачу по графику', 'Кредитка, микрозаймы или просрочки'] },
    { k: 'save', t: 'Сколько дохода получается откладывать?', o: ['Пока ничего', 'До 10%', '10–20%', 'Больше 20%'] },
    { k: 'hor', t: 'Когда могут понадобиться деньги, которые идут в крипту?', o: ['В ближайший год', 'Через 1–3 года', 'Через 3–5 лет', 'Не раньше чем через 5 лет'] },
    { k: 'drop', t: 'Портфель упал на 50% за месяц. Что сделаешь?', o: ['Продам, чтобы не потерять остальное', 'Ничего, но буду сильно переживать', 'Спокойно продолжу по плану', 'Докуплю — для этого у меня резерв'] },
    { k: 'exp', t: 'Какой у тебя опыт с криптой?', o: ['Только начинаю', 'Меньше года', '1–3 года, видел сильное падение', 'Больше 3 лет'] },
    { k: 'dep', t: 'Зависит ли кто-то от твоего дохода?', h: 'Дети, родители, партнёр без своего дохода.', o: ['Да', 'Нет'] }
  ];
  const STAGES = [['Стабилизация', 'начать откладывать с каждого дохода'], ['Мини-подушка и долги', 'запас на 2 месяца и выход из дорогих долгов'], ['Полная подушка', 'запас на 6 месяцев обязательных расходов'], ['Инвестиции', 'регулярные вложения по своим пропорциям'], ['К свободе', 'капитал растёт к твоему числу свободы']];
  const PROFILES = { calm: ['Осторожный', 'Тебе важнее сохранить, чем заработать. Простые правила и маленькая доля риска.'], bal: ['Взвешенный', 'Готов к просадкам, если есть план и запас. Риск — в разумной доле.'], bold: ['Уверенный', 'Есть опыт, срок и нервы. Даже так книги держат рискованное в узких рамках.'] };
  const PRESETS = { calm: { name: 'Простой', split: { BTC: 70, ETH: 30, ALT: 0 }, ladder: false, dca: 100, altCap: 0, why: 'Одна сумма каждый месяц, без альткоинов и резерва — меньше решений, меньше ошибок.' },
    bal: { name: 'Взвешенный', split: { BTC: 60, ETH: 30, ALT: 10 }, ladder: true, dca: 50, altCap: 10, why: 'Половина — покупки по плану, половина — резерв для докупок на падении. Альткоинов немного.' },
    bold: { name: 'Как у автора', split: { BTC: 50, ETH: 30, ALT: 20 }, ladder: true, dca: 50, altCap: 20, why: 'Покупки по плану, резерв и лестница докупок, пятая часть — альткоин месяца.' } };
  /* шаги этапов: id, текст, коротко (для «Сегодня»), источник в книгах, урок */
  const STEPS = [
    [{ id: 'b1', t: 'Откладывай 10% каждого дохода — сразу, до любых трат', short: 'отложи 10% с ближайшего дохода', src: 'Клейсон, гл. 3; Шефер, гл. 8', les: 'pay' },
      { id: 'b2', t: 'Запиши расходы за месяц и раздели на необходимые и желания', short: 'запиши расходы за месяц', src: 'Клейсон, гл. 3; Шефер, гл. 6, 12', les: 'spend' },
      { id: 'b3', t: 'В крипту — только сумму, которую не жалко потерять, пока нет запаса', short: 'держи крипту символической', src: 'Грэхем, гл. 1; Богл, гл. 18', les: 'spec' }],
    [{ id: 'm1', t: 'Собери запас на 2 месяца обязательных расходов', short: 'собери запас на 2 месяца', src: 'Роббинс, 3.1', les: 'cushion' },
      { id: 'm2', t: 'Гаси самый дорогой долг первым и не бери новых', short: 'гаси самый дорогой долг', src: 'Шефер, гл. 6; Клейсон, гл. 8–9', les: 'debt', if: a => a.debt >= 2 },
      { id: 'm3', t: 'Не вкладывай заёмные деньги — ни в крипту, ни во что-либо ещё', short: 'не вкладывай заёмное', src: 'Грэхем, гл. 3; Талеб, гл. 5', les: 'debt' }],
    [{ id: 'c1', t: 'Доведи запас до 6 месяцев обязательных расходов', short: 'доведи запас до 6 месяцев', src: 'Бернстайн, гл. 3; Мэлкил, гл. 12', les: 'cushion' },
      { id: 'c2', t: 'Закрой кредит под проценты раньше, чем увеличивать вложения', short: 'закрой кредит под проценты', src: 'Шефер, гл. 6', les: 'debtsave', if: a => a.debt >= 2 },
      { id: 'c3', t: 'Деньги, нужные в ближайшие 5 лет, держи вне рискованных активов', short: 'отдели деньги на ближайшие 5 лет', src: 'Бернстайн, гл. 3; Мэлкил, гл. 12, 14', les: 'horizon' }],
    [{ id: 'i1', t: 'Покупай регулярно на равную сумму — не угадывай момент', short: 'покупай по плану каждый месяц', src: 'Богл, гл. 3, 8; Мэлкил, гл. 7', les: 'timing' },
      { id: 'i2', t: 'Держи крипту в пределах своего потолка от всех накоплений', short: 'проверь долю крипты в накоплениях', src: 'Грэхем, гл. 1; Бернстайн, гл. 4', les: 'spec' },
      { id: 'i3', t: 'Возвращай пропорции к плану не чаще раза в год', short: 'сверь пропорции с планом', src: 'Грэхем, гл. 4; Мэлкил, гл. 14', les: 'alloc' },
      { id: 'i4', t: 'Смотри на портфель реже — раз в неделю достаточно', short: 'проверяй портфель реже', src: 'Талеб, гл. 3; Хаузел, гл. 6', les: 'emo' }],
    [{ id: 'f1', t: 'Посчитай своё число свободы и сверяйся с ним раз в квартал', short: 'посчитай число свободы', src: 'Мэлкил, гл. 14; Бернстайн, гл. 6', les: 'free' },
      { id: 'f2', t: 'Половину каждой прибавки дохода отправляй в капитал', short: 'половину прибавки — в капитал', src: 'Шефер, гл. 7–8', les: 'earn' },
      { id: 'f3', t: 'Держи крипту в пределах своего потолка от всех накоплений', short: 'проверь долю крипты в накоплениях', src: 'Грэхем, гл. 1; Бернстайн, гл. 4', les: 'spec' },
      { id: 'f4', t: 'Не делай ставок, где проигрыш выбивает из игры', short: 'проверь запас прочности', src: 'Талеб, гл. 1, 7; Хаузел, гл. 13', les: 'survive' }]
  ];
  const planKey = () => 'ml-plan:' + uidKey();
  function planGet() { const p = lsGet(planKey(), null); if (!p || p.v !== 1 || !p.a) return null; for (const q of Q) { const v = p.a[q.k]; if (!(Number.isInteger(v) && v >= 0 && v < q.o.length)) return null; } return p; }
  const planSave = p => lsSet(planKey(), p);
  X.planGet = planGet;
  /* чистая функция: ответы → этап, профиль, потолок крипты, набор правил, шаги */
  function planResult(p) {
    const a = p.a;
    const stage = a.save === 0 ? 0 : (a.cus <= 1 || a.debt === 3) ? 1 : (a.cus === 2 || a.debt === 2) ? 2 : (a.cus === 4 && a.save >= 2 && a.debt === 0) ? 4 : 3;
    const score = a.hor + a.drop + a.exp + a.inc + (a.dep === 1 ? 1 : 0);
    let prof = score <= 4 ? 'calm' : score <= 8 ? 'bal' : 'bold'; if (a.drop === 0 || a.hor === 0) prof = 'calm';
    const ceil = a.hor === 0 ? 0 : stage <= 1 ? 1 : stage === 2 ? (prof === 'calm' ? 3 : 5) : (prof === 'calm' ? 5 : 10);
    const ceilWhy = a.hor === 0 ? 'Эти деньги понадобятся в течение года — для крипты срок слишком короткий.' : stage <= 1 ? 'Сначала запас и дорогие долги. Пока — только символическая сумма.' : stage === 2 ? 'Подушка ещё не полная, поэтому доля риска ниже обычной.' : prof === 'calm' ? 'Нижняя граница из книг: рискованное — не больше 5% капитала.' : 'Верхняя граница из книг: рискованное — не больше 10% капитала. Всё, что выше, — твой осознанный риск.';
    const steps = STEPS[stage].filter(s => !s.if || s.if(a));
    return { stage, score, prof, ceil, ceilWhy, preset: PRESETS[prof], steps };
  }
  X.planResult = planResult;
  /* доля крипты (монеты + резерв на бирже) во всех накоплениях — если человек вписал их сумму */
  function cryptoShare(p, D) { const all = +(p.fi && p.fi.sav) || 0; if (!(all > 0) || D.noPrice) return null; const c = D.total + Math.max(0, D.reserve); return c > 0 ? Math.min(100, c / all * 100) : 0; }

  let quiz = null;
  function openPlan() { const p = planGet(); if (p) showPlan(p); else startQuiz(); }
  X.openPlan = openPlan;
  function startQuiz(prev) { quiz = { i: 0, a: Object.assign({}, prev && prev.a), prev: prev || null }; drawQuiz(); }
  function drawQuiz() {
    const q = Q[quiz.i], n = Q.length, cur = quiz.a[q.k];
    const h = `<div class="xq-prog" aria-hidden="true">${Q.map((_, i) => `<i class="${i < quiz.i ? 'on' : i === quiz.i ? 'cur' : ''}"></i>`).join('')}</div>
      <p class="small mute">Вопрос ${quiz.i + 1} из ${n}</p><h4 class="xq-t">${esc(q.t)}</h4>${q.h ? `<p class="hint">${esc(q.h)}</p>` : ''}
      <div class="xq-o" role="radiogroup" aria-label="${esc(q.t)}">${q.o.map((o, i) => `<button type="button" class="xq-b" role="radio" aria-checked="${cur === i}" data-qa="${i}">${esc(o)}</button>`).join('')}</div>
      <p class="hint">Ответы остаются на этом телефоне и никуда не отправляются.</p>`;
    xOpen('quiz', 'Личный план', h, null, quiz.i > 0 ? () => { quiz.i--; drawQuiz(); } : (quiz.prev ? () => showPlan(quiz.prev) : null));
  }
  function answer(i) {
    quiz.a[Q[quiz.i].k] = i; play('tick'); buzz(8);
    if (quiz.i < Q.length - 1) { quiz.i++; drawQuiz(); return; }
    const p = { v: 1, at: new Date().toISOString(), a: quiz.a, steps: {}, fi: (quiz.prev && quiz.prev.fi) || {} };
    /* отметки шагов сохраняем, если этап тот же */
    if (quiz.prev && planResult(quiz.prev).stage === planResult(p).stage) p.steps = quiz.prev.steps || {};
    planSave(p); quiz = null; showPlan(p, true); try { render(); } catch (e) {}
  }
  function showPlan(p, fresh) {
    const R = planResult(p), D = derive(), sp = split(), pr = R.preset, sameRules = sp.BTC === pr.split.BTC && sp.ETH === pr.split.ETH && sp.ALT === pr.split.ALT && ladderOn() === pr.ladder;
    const done = R.steps.filter(s => (p.steps || {})[s.id]).length, sh = cryptoShare(p, D), age = daysSince(p.at);
    const stg = STAGES.map((s, i) => `<li class="${i < R.stage ? 'done' : i === R.stage ? 'cur' : ''}"><i>${i < R.stage ? tick : i + 1}</i><span><b>${s[0]}</b>${i === R.stage ? `<small>${s[1]}</small>` : ''}</span></li>`).join('');
    let h = `<div class="xp-hero"><span class="chip acc">Этап ${R.stage + 1} из ${STAGES.length}</span><h4>${STAGES[R.stage][0]}</h4><p>${cap(STAGES[R.stage][1])}. Профиль: <b>${PROFILES[R.prof][0].toLowerCase()}</b>.</p></div>
      <ol class="xp-path">${stg}</ol>
      <div><div class="sec-h"><span class="label">Твои шаги сейчас</span><span class="small mute">${done} из ${R.steps.length}</span></div><div class="list xp-steps">${R.steps.map(s => `<div class="xp-step${(p.steps || {})[s.id] ? ' on' : ''}"><button type="button" class="xp-ck" role="checkbox" aria-checked="${!!(p.steps || {})[s.id]}" aria-label="${esc(s.t)}" data-step="${s.id}">${tick}</button><span class="xp-st"><b>${esc(s.t)}</b><small>${esc(s.src)}</small></span><button type="button" class="more" data-les="${s.les}">Почему</button></div>`).join('')}</div></div>
      <div><div class="sec-h"><span class="label">Потолок крипты</span><span class="small mute">от всех накоплений</span></div><div class="card xp-ceil"><b>${R.ceil === 0 ? '0%' : R.ceil === 1 ? 'до 1%' : 'до ' + R.ceil + '%'}</b><p>${R.ceilWhy}</p>${sh != null ? `<div class="xp-share${sh > R.ceil + .5 ? ' over' : ''}"><span>Сейчас у тебя</span><b>${nf(sh, 0)}%</b><i><i style="width:${Math.min(100, sh / Math.max(R.ceil, sh, 1) * 100)}%"></i><em style="left:${Math.min(100, R.ceil / Math.max(R.ceil, sh, 1) * 100)}%"></em></i></div>` : '<p class="hint">Впиши сумму всех накоплений в «Число свободы» ниже — покажу, какую долю занимает крипта.</p>'}<p class="hint">Источник: Грэхем, гл. 1; Богл, гл. 18; Бернстайн, гл. 4 — «спекуляции отдельно и мало».</p></div></div>
      <div><div class="sec-h"><span class="label">Правила под твой профиль</span></div><div class="card xp-rules"><b>${pr.name}</b><span class="sp">BTC ${pr.split.BTC}% · ETH ${pr.split.ETH}%${pr.split.ALT ? ' · альткоины ' + pr.split.ALT + '%' : ''} · ${pr.ladder ? 'резерв и лестница докупок' : 'без резерва и лестницы'}</span><p>${pr.why}</p>${sameRules ? '<span class="chip pos">у тебя уже так</span>' : `<button type="button" class="btn sm soft" data-x="apply">Поставить эти правила</button><p class="hint">Сейчас у тебя: BTC ${sp.BTC}% · ETH ${sp.ETH}% · альткоины ${sp.ALT}% · лестница ${ladderOn() ? 'включена' : 'выключена'}. Записи не изменятся — только правила.</p>`}</div></div>
      ${fiHtml(p, D)}
      <div class="list"><button type="button" class="row r3" data-x="learn">${icoBadge('news', 'var(--lav)')}<span class="col"><span class="nm">Знания</span><span class="sub">${LESSONS.length} коротких уроков из 14 книг</span></span><span class="chev">›</span></button></div>
      <p class="hint">${age != null && age >= 90 ? 'Ответам больше трёх месяцев — жизнь меняется, пройди анкету заново. ' : ''}${DISCLAIMER}</p>`;
    xOpen('plan', 'Личный план', h, '<div class="btnrow"><button type="button" class="btn ghost" data-x="requiz">Пройти заново</button><button type="button" class="btn" data-close>Готово</button></div>');
    if (fresh) setTimeout(() => { X.sparks(el('xSheet').querySelector('.xp-hero'), 16); play('coins'); }, 420);
  }
  async function applyPreset() {
    const p = planGet(); if (!p) return; const pr = planResult(p).preset;
    if (!db) { toast('Нет подключения к данным'); return; }
    try { await db.doc('app/settings').update({ split: pr.split, depositSplit: { dca: pr.dca }, altCapPct: pr.altCap, ladder: pr.ladder });
      if (pr.ladder && !(S.cycle && S.cycle.levels && S.cycle.levels.length)) await cycleCreate();
      play('cash'); toast('Правила «' + pr.name + '» поставлены'); showPlan(planGet()); }
    catch (e) { toast(failMsg(e, 'Не сохранилось')); }
  }
  function toggleStep(id, btn) { const p = planGet(); if (!p) return; p.steps = p.steps || {}; const on = !p.steps[id]; if (on) p.steps[id] = today(); else delete p.steps[id]; planSave(p); play(on ? 'coin' : 'tick'); buzz(10);
    const R = planResult(p), all = R.steps.every(s => p.steps[s.id]); showPlanKeepScroll(p); if (on) X.sparks(btn, all ? 18 : 8); try { render(); } catch (e) {} }
  function showPlanKeepScroll(p) { const b = el('xSheet').querySelector('.sh-body'), y = b ? b.scrollTop : 0; showPlan(p); if (b) b.scrollTop = y; }

  /* ---------- число свободы: годовые расходы × множитель (спор С3 свода: ×25 / ×33 / ×50) ---------- */
  const FI_SC = [['Осторожный', 50, 2], ['Базовый', 33, 4], ['Оптимистичный', 25, 6]];   /* название, множитель расходов, доходность сверх инфляции % (допущение) */
  /* месяцев до цели: взносы в конце месяца, рост r в год сверх инфляции; null — недостижимо за 100 лет */
  function fiMonths(target, have, perMonth, rYear) { if (have >= target) return 0; const r = Math.pow(1 + rYear / 100, 1 / 12) - 1; let v = have, m = 0; if (!(perMonth > 0) && !(r > 0 && have > 0)) return null; while (v < target && m < 1200) { v = v * (1 + r) + perMonth; m++; } return m >= 1200 ? null : m; }
  X.fiMonths = fiMonths;
  const yrs = m => m == null ? 'больше 100 лет' : m === 0 ? 'уже есть' : m < 12 ? pl(m, 'месяц', 'месяца', 'месяцев') : (() => { const y = Math.round(m / 12 * 10) / 10; return nf(y, y % 1 ? 1 : 0) + ' ' + plural(Math.floor(y), 'год', 'года', 'лет'); })();
  function fiHtml(p, D) {
    const f = p.fi || {}, cur = P.cur === 'UAH' && rate() > 0 ? '₴' : '$', exp = +f.exp || 0, sav = +f.sav || 0, add = +f.add || 0;
    const fm = v => (cur === '₴' ? '' : '$') + nf(v, 0) + (cur === '₴' ? ' ₴' : '');
    let out = '<p class="hint">Впиши расходы в месяц — посчитаю, сколько капитала нужно, чтобы жить на доход от него.</p>';
    if (exp > 0) { out = '<div class="xf-t">' + FI_SC.map(([nm, mult, r]) => { const target = exp * 12 * mult, m = fiMonths(target, sav, add, r), prog = target ? Math.min(100, sav / target * 100) : 0;
      return `<div class="xf-r"><span><b>${nm}</b><small>расходы за год × ${mult} · рост ${r}% сверх инфляции</small></span><span class="rt"><b>${fm(target)}</b><small>${sav > 0 || add > 0 ? yrs(m) + ' · пройдено ' + nf(prog, prog < 10 ? 1 : 0) + '%' : 'впиши накопления и взнос'}</small></span><i><i style="width:${prog}%"></i></i></div>`; }).join('') + '</div>'
      + '<p class="hint">Формула: число свободы = расходы в месяц × 12 × множитель. Срок — по взносу в месяц и росту капитала сверх инфляции; рост — допущение, а не прогноз. Множители: Мэлкил ×25–28,6, Бернстайн ×33–50 (свод, спор «сколько капитала для свободы»). Правило выведено на данных США — для Украины с её инфляцией и валютными рисками осторожный вариант надёжнее.</p>'; }
    return `<div><div class="sec-h"><span class="label">Число свободы</span><span class="small mute">в ${cur === '₴' ? 'гривнах' : 'долларах'}</span></div><div class="card xf"><div class="f3"><label class="field"><span>Расходы в месяц</span><input type="number" inputmode="decimal" min="0" step="any" id="fiExp" value="${exp || ''}"></label><label class="field"><span>Уже накоплено</span><input type="number" inputmode="decimal" min="0" step="any" id="fiSav" value="${sav || ''}"></label><label class="field"><span>Взнос в месяц</span><input type="number" inputmode="decimal" min="0" step="any" id="fiAdd" value="${add || ''}"></label></div><div id="fiOut">${out}</div></div></div>`;
  }
  let fiT = 0;
  function fiInput() { clearTimeout(fiT); fiT = setTimeout(() => { const p = planGet(); if (!p) return; p.fi = { exp: +el('fiExp').value || 0, sav: +el('fiSav').value || 0, add: +el('fiAdd').value || 0 }; planSave(p);
    const tmp = document.createElement('div'); tmp.innerHTML = fiHtml(p, derive()); const o = tmp.querySelector('#fiOut'); if (o && el('fiOut')) el('fiOut').innerHTML = o.innerHTML; try { renderToday(derive()); renderPlanCards(); } catch (e) {} }, 350); }

  /* ================= знания: 18 коротких уроков по своду из 14 книг ================= */
  const LESSONS = [
    ['pay', 'Фундамент', 'Сначала заплати себе', 'Откладывай фиксированную долю каждого дохода до любых трат — лучше автоматически. Минимум 10%, цель 15–20%. Получил прибавку — половину отправляй туда же.', 'Клейсон, гл. 3; Шефер, гл. 8; Роббинс, 1.3; Хаузел, гл. 10', 'Впиши сумму «в месяц» в «Настройках» — план покупок посчитается от неё.'],
    ['spend', 'Фундамент', 'Живи по плану расходов', 'Раздели траты на необходимые и желания. «Необходимые» расходы растут вслед за доходом, если их не держать в рамках.', 'Клейсон, гл. 3; Шефер, гл. 6, 12; Роббинс, 3.3', ''],
    ['cushion', 'Фундамент', 'Подушка — до инвестиций', 'Сначала запас на 3–12 месяцев обязательных расходов в доступном и надёжном месте. С подушкой не придётся трогать вложения, когда деньги понадобились срочно.', 'Бернстайн, гл. 3; Мэлкил, гл. 12; Роббинс, 3.1; Хаузел, гл. 13', 'Резерв USDT в приложении — не подушка: он для докупок, а лежит на бирже.'],
    ['debt', 'Фундамент', 'Долг под проценты — враг', 'Потребительский долг съедает будущий доход. Вкладывать заёмные деньги нельзя: кредитное плечо превращает падение рынка в разорение.', 'Клейсон, гл. 8–9; Шефер, гл. 6; Грэхем, гл. 3; Талеб, гл. 5', ''],
    ['debtsave', 'Фундамент', 'Гасить долги или копить?', 'Клейсон делит доход так: 10% себе, 70% на жизнь, 20% на долги. Шефер — половину свободных денег на долги, половину в накопления. Вывод свода: сначала маленький резерв, потом приоритет самому дорогому долгу.', 'Клейсон, гл. 8–9; Шефер, гл. 6', ''],
    ['horizon', 'Вложения', 'Срок решает', 'Деньги, которые понадобятся в ближайшие 5 лет, авторы не держат в акциях: акции — для денег на 10 лет и дольше. Для крипты, которая падает сильнее, это правило тем более верно.', 'Бернстайн, гл. 3; Линч, гл. 4; Мэлкил, гл. 12, 14', ''],
    ['alloc', 'Вложения', 'Главное решение — пропорции', 'Сколько держать в надёжном и сколько в рискованном, важнее выбора отдельных бумаг и монет. Пропорцию выбирают по сроку и терпимости к риску, а возвращают к ней не чаще раза в год.', 'Грэхем, гл. 4; Бернстайн, гл. 3; Мэлкил, гл. 14', 'Блок «Распределение» на главной показывает твой план и как сейчас.'],
    ['timing', 'Вложения', 'Не угадывай рынок', 'Из 355 фондов рынок стабильно обыгрывали только 3. Равные регулярные взносы снимают вопрос «когда входить».', 'Богл, гл. 3, 8, 12; Мэлкил, гл. 7; Бернстайн, гл. 2', '«Купить» → «По плану» раскладывает одну и ту же сумму по твоим долям.'],
    ['costs', 'Вложения', 'Комиссии — то, что ты контролируешь', 'Затраты 2,5% в год за 30 лет съедают около половины капитала. Доходность никто не обещает, а комиссии известны заранее.', 'Богл, гл. 11; Роббинс, 2.2; Бернстайн, гл. 5', 'В «потратил» вписывай сумму вместе с комиссией биржи — средняя цена будет честной.'],
    ['spec', 'Вложения', 'Спекуляции — отдельно и мало', 'Рискованные ставки держат отдельно от основных накоплений: не больше 5–10% капитала и только то, что не жалко потерять.', 'Грэхем, гл. 1; Богл, гл. 18; Бернстайн, гл. 4; Роббинс, 4.3', '«Личный план» считает твой потолок и сравнивает с ним портфель.'],
    ['btc', 'Вложения', 'Биткоин: что говорят книги', 'Аммус: обычные деньги обесцениваются, биткоин — лучшее средство накопления. Поппер: обвалы на 50% за сутки и потери на биржах — часть его истории. Мэлкил называл рост 2017 года пузырём. Вывод свода: только в рамках рискованной доли 5–10%, монеты — на своём кошельке.', 'Аммус; Поппер, гл. 18, 21; Мэлкил', ''],
    ['divers', 'Вложения', 'Концентрация или диверсификация', 'Фишер и Линч держали немного бумаг, которые знали очень хорошо. Богл, Мэлкил, Бернстайн и Талеб — за весь рынок и разные страны: целые рынки, как Россия 1914 года, обнулялись.', 'Фишер; Линч; Богл; Талеб', ''],
    ['survive', 'Голова', 'Сначала выжить', 'Не делай ставок, где проигрыш выбивает из игры. Запас прочности важнее лишней доходности.', 'Талеб, гл. 1, 7; Хаузел, гл. 5, 13; Грэхем, гл. 20', 'Потолок резерва и ключ 2 лестницы — твой запас прочности в правилах.'],
    ['emo', 'Голова', 'Эмоции — главный враг', 'Кто смотрит на портфель каждый день, видит минус почти в половине дней. Кто раз в год — только в 7% лет. Чем реже проверяешь, тем легче держать план.', 'Талеб, гл. 3; Грэхем, гл. 8; Хаузел, гл. 6; Богл, гл. 5', 'Кнопка с глазом вверху прячет суммы.'],
    ['fraud', 'Голова', 'Высокий доход без риска — обман', 'Среди 10 000 случайных управляющих через 5 лет найдутся 313 «безупречных» — просто по удаче. Гарантированная высокая доходность — признак обмана.', 'Талеб, гл. 9; Клейсон, гл. 5; Бернстайн, гл. 2, 7; Мэлкил, гл. 10', ''],
    ['time', 'Голова', 'Время — главный множитель', 'Доллар, не отложенный в 25 лет, в 35 заменяют два, в 45 — четыре.', 'Хаузел, гл. 4; Бернстайн, гл. 6; Шефер, гл. 9', ''],
    ['earn', 'Цель', 'Расти в доходе', 'Способность зарабатывать — отдельный актив: ценность для рынка, обучение, продажи. Половину каждой прибавки — в капитал.', 'Шефер, гл. 7–8; Кийосаки, гл. 6, 8; Клейсон, гл. 3', ''],
    ['free', 'Цель', 'Сколько нужно для свободы', 'Авторы расходятся: Роббинс берёт годовые расходы × 20, Мэлкил — × 25–28,6, Бернстайн считает надёжным × 33–50. Чем осторожнее расчёт, тем больше множитель.', 'Роббинс, 3.1; Мэлкил, гл. 14; Бернстайн, гл. 6; Шефер, гл. 12', '«Личный план» → «Число свободы» считает три варианта.']
  ].map(a => ({ id: a[0], g: a[1], t: a[2], x: a[3], src: a[4], app: a[5] }));
  X.LESSONS = LESSONS;
  const readGet = () => { const r = xGet().read; return r && typeof r === 'object' ? r : {}; };
  function openLearn(fromPlan) {
    const rd = readGet(), groups = [...new Set(LESSONS.map(l => l.g))], n = LESSONS.filter(l => rd[l.id]).length;
    const h = `<p class="hint">Главные мысли из 14 книг о деньгах — по минуте на каждую. Прочитано ${n} из ${LESSONS.length}.</p>` + groups.map(g => `<div><div class="sec-h"><span class="label">${g}</span></div><div class="list">${LESSONS.filter(l => l.g === g).map(l => `<button type="button" class="row r3" data-les="${l.id}"><span class="xl-ck${rd[l.id] ? ' on' : ''}" aria-hidden="true">${rd[l.id] ? tick : ''}</span><span class="col"><span class="nm">${esc(l.t)}</span><span class="sub">${esc(l.src.split(';')[0])}</span></span><span class="chev">›</span></button>`).join('')}</div></div>`).join('') + `<p class="hint">${DISCLAIMER}</p>`;
    learnFromPlan = fromPlan != null ? !!fromPlan : learnFromPlan;
    xOpen('learn', 'Знания', h, null, learnFromPlan && planGet() ? () => showPlan(planGet()) : null);
  }
  let learnFromPlan = false, lesBack = null;
  function openLesson(id, back) {
    const l = LESSONS.find(x => x.id === id); if (!l) return; lesBack = back || lesBack || (() => openLearn());
    const rd = readGet(); if (!rd[id]) { rd[id] = today(); xPatch({ read: rd }); }
    const i = LESSONS.indexOf(l), nx = LESSONS[(i + 1) % LESSONS.length];
    const h = `<div class="xl"><span class="chip acc">${l.g}</span><h4>${esc(l.t)}</h4><p>${esc(l.x)}</p><p class="xl-src"><b>Источник:</b> ${esc(l.src)}</p>${l.app ? `<div class="xl-app"><b>В MoneyLife</b><span>${esc(l.app)}</span></div>` : ''}</div><p class="hint">${DISCLAIMER}</p>`;
    xOpen('lesson', 'Урок ' + (i + 1) + ' из ' + LESSONS.length, h, `<div class="btnrow"><button type="button" class="btn ghost" data-x="learnlist">Все уроки</button><button type="button" class="btn" data-les="${nx.id}">Дальше</button></div>`, lesBack);
  }
  X.openLearn = openLearn;

  /* ================= карточки плана на главной и в «Стратегии» ================= */
  function planCardHtml(compact) {
    const p = planGet();
    if (!p) return compact ? `<button type="button" class="card xpc xpc-row" data-x="plan"><span class="xpc-i" aria-hidden="true">${I.star}</span><span class="col"><b>Личный план</b><small>8 вопросов — этап, потолок крипты и шаги по 14 книгам</small></span><span class="chev">›</span></button>`
      : `<div class="card xpc xpc-inv"><span class="xpc-i" aria-hidden="true">${I.star}</span><div class="xpc-tx"><b>Собери личный план</b><p>8 вопросов, одна минута. Приложение подскажет твой этап, потолок крипты и следующие шаги — по 14 книгам о деньгах.</p></div><div class="btnrow"><button type="button" class="btn sm" data-x="plan">Собрать план</button><button type="button" class="btn sm ghost" data-x="planlater">Позже</button></div></div>`;
    const R = planResult(p), done = R.steps.filter(s => (p.steps || {})[s.id]).length, nextS = R.steps.find(s => !(p.steps || {})[s.id]);
    return `<button type="button" class="card xpc xpc-row" data-x="plan" aria-label="Личный план: этап ${R.stage + 1} из ${STAGES.length}, ${STAGES[R.stage][0]}"><span class="xpc-ring" style="--p:${R.steps.length ? done / R.steps.length : 0}" aria-hidden="true"><b>${R.stage + 1}</b></span><span class="col"><b>${STAGES[R.stage][0]} <span class="mute">· этап ${R.stage + 1} из ${STAGES.length}</span></b><small>${nextS ? 'Дальше: ' + esc(nextS.short) : 'Все шаги этапа отмечены — обнови ответы, когда что-то изменится'}</small></span><span class="chev">›</span></button>`;
  }
  function renderPlanCards() {
    const home = el('xPlan'), path = el('xPath'), learn = el('xLearn'), x = xGet(), ok = S.ready && (!el('ob') || el('ob').hidden);
    if (home) { const p = planGet(), hideInv = !p && x.planLater && Date.now() - x.planLater < 7 * 864e5, h = ok && !hideInv ? planCardHtml(false) : ''; if (home._h !== h) { home.innerHTML = h; home._h = h; } home.hidden = !h; }
    if (path) { const h = ok ? planCardHtml(true) : ''; if (path._h !== h) { path.innerHTML = h; path._h = h; } path.hidden = !h; }
    if (learn) { const n = LESSONS.filter(l => readGet()[l.id]).length, h = ok ? `<div class="list"><button type="button" class="row r3" data-x="learn0">${icoBadge('news', 'var(--lav)')}<span class="col"><span class="nm">Знания</span><span class="sub">${LESSONS.length} уроков из 14 книг · прочитано ${n}</span></span><span class="chev">›</span></button></div>` : ''; if (learn._h !== h) { learn.innerHTML = h; learn._h = h; } learn.hidden = !h; }
  }

  /* ================= объяснения: настроение рынка, цель ================= */
  function openFng() { const f = fngNow(); if (!f) return;
    xOpen('fng', 'Настроение рынка', `<div class="xg"><div class="xg-bar"><i style="left:${f.v}%"></i></div><div class="xg-s"><span>страх</span><span>жадность</span></div><b>${f.v} из 100 — ${fngWord(f.v)}</b></div>
      <p>Индекс страха и жадности собирает в одно число колебания цены, объём торгов, интерес в поиске и соцсетях. Ближе к 0 — рынок боится, ближе к 100 — жадничает.</p>
      <div class="xl-app"><b>Как к этому относиться</b><span>Это не сигнал покупать или продавать. Твой план не меняется от настроения толпы — для этого он и нужен.</span></div>
      <p class="xl-src"><b>Из книг:</b> «Эмоции — главный враг» — Грэхем, гл. 8; Талеб, гл. 3; Хаузел, гл. 6.</p>
      <p class="hint">Источник числа: alternative.me, обновляется раз в сутки.</p>`, '<button type="button" class="btn block ghost" data-les="emo">Урок «Эмоции — главный враг»</button>'); lesBack = () => openFng(); }
  function openGoal() { const g = goalBtc(), btc = +derive().prices.BTC || 0;
    xOpen('goal', 'Цель BTC', `<p>Цена биткоина, при которой ты хочешь получить напоминание. Приложение ничего не продаёт и не советует — оно только сообщит, что цена дошла до твоей отметки.</p>
      <label class="field"><span>Цель, $ за 1 BTC</span><input type="number" inputmode="decimal" min="0" step="any" id="goalIn" placeholder="например, 150000" value="${g || ''}"></label>
      <p class="hint" id="goalHint">${btc ? 'Сейчас BTC ' + money(btc, { d: 0, show: true }) + (g ? ' · до цели ' + pct((g / btc - 1) * 100) : '') + '.' : ''} Отметка появится на шкале «Сегодня». Чтобы убрать цель, оставь поле пустым.</p><p class="err" id="goalErr" role="alert"></p>`,
      '<button type="button" class="btn block" data-x="goalsave">Сохранить</button>'); }
  async function saveGoal() { const v = el('goalIn').value.trim(), n = +v;
    if (v !== '' && !(n > 0)) { el('goalErr').textContent = 'Впиши цену больше нуля или оставь поле пустым.'; return; }
    if (!db) { el('goalErr').textContent = 'Нет подключения к данным.'; return; }
    try { await db.doc('app/settings').update({ exitBtc: v === '' ? null : n }); play('cash'); closeSheets(); toast(v === '' ? 'Цель убрана' : 'Цель ' + usd(n, 0) + ' сохранена'); } catch (e) { el('goalErr').textContent = failMsg(e, 'Не сохранилось'); } }

  /* ================= сигналы на телефоне =================
     Пока приложение открыто — проверка при каждом обновлении цен. В фоне — периодическая проверка сервис-воркером
     (Chrome на Android, установленное приложение; частоту выбирает телефон). В фоне проверяется только ключ 1 и цель. */
  const notifOn = () => !!xGet().notif && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  X.notifOn = notifOn;
  function cfgForSw(D) {
    const ath = +(S.cycle && S.cycle.ath) || 0, btc = +D.prices.BTC || 0, lv = ladderOn() ? ((S.cycle && S.cycle.levels) || []).filter(l => !['done', 'skipped'].includes(l.status)).map(l => ({ n: l.n, drop: l.drop, price: Math.round(lvPrice(l)) })) : [];
    return { v: 1, on: notifOn(), ath, athDate: (S.cycle && S.cycle.athDate) || '', levels: lv, goal: goalBtc(), seen: xGet().seen || {}, btc, at: Date.now() };
  }
  let cfgLast = '';
  function cfgPush(D) { if (!('caches' in window)) return; const c = cfgForSw(D), s = JSON.stringify(Object.assign({}, c, { at: 0, btc: 0 })); if (s === cfgLast) return; cfgLast = s;
    caches.open('ml-cfg').then(ch => ch.put('cfg.json', new Response(JSON.stringify(c), { headers: { 'content-type': 'application/json' } }))).catch(() => {}); }
  async function notify(title, body, tag) {
    if (!notifOn()) return;
    try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); const opt = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url: './' } };
      if (reg && reg.showNotification) await reg.showNotification(title, opt); else new Notification(title, opt); } catch (e) {}
  }
  /* чистая функция (та же логика — в sw.js): какие события новые. seen — уже показанные ключи */
  function sigEvents(cfg, btc, states) { const ev = []; if (!(btc > 0)) return ev;
    for (const l of cfg.levels || []) { const st = states ? states[l.n] : (btc <= l.price ? 'hold' : ''); if (st !== 'go' && st !== 'hold') continue; const k = 'lv:' + (cfg.athDate || cfg.ath) + ':' + l.n + ':' + (st === 'go' ? 'go' : 'k1'); if (cfg.seen[k]) continue;
      ev.push({ k, title: st === 'go' ? 'Можно докупить · ступень ' + l.n : 'Ступень ' + l.n + ' открыта', body: st === 'go' ? 'BTC на −' + l.drop + '% от максимума, оба ключа сошлись. Открой MoneyLife — суммы по монетам там.' : 'BTC дошёл до −' + l.drop + '% от максимума ($' + l.price.toLocaleString('ru-RU') + '). Ключ 2 проверит приложение.' }); }
    if (cfg.goal > 0 && btc >= cfg.goal) { const k = 'goal:' + cfg.goal; if (!cfg.seen[k]) ev.push({ k, title: 'BTC дошёл до твоей цели', body: 'Цена выше $' + Math.round(cfg.goal).toLocaleString('ru-RU') + '. Что делать дальше — по твоему плану.' }); }
    return ev; }
  X.sigEvents = sigEvents;
  let sigT = 0;
  function sigCheck(D) { if (!S.ready || S.live.status !== 'ok' || Date.now() - sigT < 20000) return; sigT = Date.now();
    const btc = +D.prices.BTC || 0, cfg = cfgForSw(D), states = {}; for (const l of (S.cycle && S.cycle.levels) || []) states[l.n] = lvState(l, btc, D);
    const ev = sigEvents(cfg, btc, states); if (!ev.length) { cfgPush(D); return; }
    const seen = Object.assign({}, cfg.seen); for (const e of ev) { seen[e.k] = Date.now(); notify(e.title, e.body, e.k); }
    const keys = Object.keys(seen).sort((a, b) => seen[b] - seen[a]).slice(0, 40), keep = {}; for (const k of keys) keep[k] = seen[k]; xPatch({ seen: keep }); cfgPush(D); }
  async function notifToggle() {
    const sw = el('swNotif'); if (!sw) return; const was = !!xGet().notif;
    if (was) { xPatch({ notif: false }); swSet('swNotif', false); play('tick'); cfgLast = ''; cfgPush(derive()); return; }
    if (typeof Notification === 'undefined') { toast('Этот браузер не умеет показывать уведомления'); return; }
    let perm = Notification.permission; if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch (e) { perm = 'denied'; } }
    if (perm !== 'granted') { toast('Уведомления запрещены в настройках телефона для этого приложения'); return; }
    xPatch({ notif: true }); swSet('swNotif', true); play('cash'); cfgLast = ''; cfgPush(derive());
    try { const reg = await navigator.serviceWorker.ready; if (reg.periodicSync) await reg.periodicSync.register('ml-check', { minInterval: 6 * 3600e3 }); } catch (e) {}
    toast('Сигналы включены: ступени лестницы и цель BTC');
  }

  /* ================= события ================= */
  const ACT = {
    scale: () => show('strategy'), plan: () => openPlan(), planlater: () => { xPatch({ planLater: Date.now() }); play('tick'); renderPlanCards(); toast('Личный план — во вкладке «Стратегия»'); },
    requiz: () => startQuiz(planGet()), apply: () => applyPreset(), learn: () => openLearn(true), learn0: () => openLearn(false), learnlist: () => openLearn(),
    fng: () => openFng(), goal: () => openGoal(), goalsave: () => saveGoal(), share: () => share(), refresh: () => { el('refreshBtn').click(); },
    backup: () => exportData(), rules: () => { closeSheets(); openSettings(false); setTimeout(() => { const r = el('rules'); if (r && r.scrollIntoView) r.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' }); }, 380); },
    buy: () => openAct('buy'), dca: () => { openAct('buy'); setBuyMode('dca'); }, deposit: () => openAct('deposit')
  };
  document.addEventListener('click', e => {
    const t = e.target; if (!t || !t.closest) return;
    const qa = t.closest('[data-qa]'); if (qa && quiz) { answer(+qa.dataset.qa); return; }
    const st = t.closest('[data-step]'); if (st) { toggleStep(st.dataset.step, st); return; }
    const ls = t.closest('[data-les]'); if (ls) { play('tick'); const from = sheetKind; openLesson(ls.dataset.les, from === 'plan' ? () => showPlan(planGet()) : from === 'learn' ? () => openLearn() : null); return; }
    const x = t.closest('[data-x]'); if (x && ACT[x.dataset.x]) { ACT[x.dataset.x](); return; }
  });
  document.addEventListener('input', e => { if (e.target && /^fi(Exp|Sav|Add)$/.test(e.target.id)) fiInput(); });
  el('hInfo').addEventListener('click', openTotal);
  /* копия сохранена — запоминаем день (напоминание в «Сегодня») */
  ['expBtn', 'delExp'].forEach(id => { const b = el(id); if (b) b.addEventListener('click', () => { xPatch({ backupAt: new Date().toISOString() }); setTimeout(() => { try { renderToday(derive()); } catch (e) {} }, 50); }); });
  const swN = el('swNotif'); if (swN) swN.addEventListener('click', notifToggle);
  const gB = el('goalBtn'); if (gB) gB.addEventListener('click', () => { closeSheets(); setTimeout(openGoal, 260); });

  /* ================= отрисовка ================= */
  let firstReveal = false;
  X.render = function (D) {
    renderToday(D); renderPlanCards();
    const sw = el('swNotif'); if (sw) swSet('swNotif', notifOn());
    const gb = el('goalVal'); if (gb) gb.textContent = goalBtc() ? usd(goalBtc(), 0) : 'не задана';
    if (window.mlDemo) { const d = el('delBtn'); if (d) d.hidden = true; }
    if (S.ready) { fngLoad(); sigCheck(D);
      if (!firstReveal) { firstReveal = true; if (!reduced) { const v = document.querySelector('.view:not([hidden])'); if (v) { v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); } } } }
    if (sheetKind === 'total' && el('xSheet').classList.contains('open')) { /* цены обновились — пересобрать итог, не сбивая прокрутку */ const b = el('xSheet').querySelector('.sh-body'), y = b ? b.scrollTop : 0; openTotal(); if (b) b.scrollTop = y; }
  };
  X.tab = function () {};
  try { render(); } catch (e) { console.error(e); }
})();
