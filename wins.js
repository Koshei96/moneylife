/* MoneyLife — достижения и «Итог месяца» (12.11.2026).
   Достижения — за дисциплину и знания, не за угадывание рынка: регулярные покупки, резерв, лестница, спокойствие в просадку, уроки.
   «Итог месяца» — короткие слайды в духе «историй» и картинка, которой можно поделиться (только проценты и счётчики, без сумм).
   Всё считается на телефоне из уже загруженных записей; отметки хранятся только на телефоне (ml-win:<uid>), в базу не уходят. */
(function () {
  'use strict';
  const X = window.MLX || {};
  const $i = id => document.getElementById(id);
  const uidKey = () => (window.mlDemo ? 'demo' : (window.mlUser && window.mlUser.id) || 'local');
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const wKey = () => 'ml-win:' + uidKey();
  const wGet = () => { const o = lsGet(wKey(), {}); return o && typeof o === 'object' ? o : {}; };
  const wPatch = p => { const o = Object.assign(wGet(), p); lsSet(wKey(), o); return o; };
  const xGet = () => lsGet('ml-x:' + uidKey(), {}) || {};
  const BUY = ['start', 'buy', 'dca', 'dip'];
  const MON = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const MON_G = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MON_P = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
  const pl = (n, a, b, c) => { n = Math.abs(n) % 100; const m = n % 10; return n > 10 && n < 20 ? c : m === 1 ? a : m >= 2 && m <= 4 ? b : c; };
  const nf1 = v => (Math.round(v * 10) / 10).toLocaleString('ru-RU', { minimumFractionDigits: Math.abs(v) < 10 ? 1 : 0, maximumFractionDigits: 1 });

  /* ---------- значки: простые линии, без эмодзи ---------- */
  const P = {
    seed: '<path d="M12 21v-8"/><path d="M12 13c0-4 3-7 7-7 0 4-3 7-7 7z"/><path d="M12 15c0-3-2.5-5.5-6-5.5 0 3 2.5 5.5 6 5.5z"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M16 12.5h2"/><path d="M3 9h15a3 3 0 0 1 3 3"/>',
    cart: '<path d="M4 5h2l2 10h10l2-7H7"/><circle cx="10" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
    flame: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 .8 1.5 1.5 2 3 2-1-2-1-4 0-7z"/>',
    shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    ladder: '<path d="M7 3v18M17 3v18M7 7h10M7 12h10M7 17h10"/>',
    snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
    layers: '<path d="M12 3 3 8l9 5 9-5z"/><path d="m3 13 9 5 9-5"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M8 7h7"/>',
    crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>',
    up: '<path d="M4 17l6-6 4 4 6-7"/><path d="M15 8h5v5"/>'
  };
  const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k]}</svg>`;

  /* ---------- список достижений: за поведение, а не за удачу ---------- */
  const ACH = [
    { id: 'first', i: 'seed', c: '#34e0a1', t: 'Первый шаг', d: 'Первая запись в портфеле' },
    { id: 'dep', i: 'wallet', c: '#7ab8ff', t: 'Своя система', d: 'Первое пополнение — деньги разложены по правилам' },
    { id: 'buy10', i: 'cart', c: '#b79bff', t: 'Десять покупок', d: '10 покупок по плану' },
    { id: 'buy50', i: 'cart', c: '#ff6fd8', t: 'Пятьдесят покупок', d: '50 покупок — регулярность в привычке' },
    { id: 'str3', i: 'flame', c: '#ffb04d', t: 'Три месяца подряд', d: 'Покупки 3 месяца подряд' },
    { id: 'str6', i: 'flame', c: '#ff8a3d', t: 'Полгода дисциплины', d: 'Покупки 6 месяцев подряд' },
    { id: 'str12', i: 'crown', c: '#ffc24d', t: 'Год дисциплины', d: 'Покупки 12 месяцев подряд' },
    { id: 'reserve', i: 'shield', c: '#34e0a1', t: 'Запас на просадку', d: 'Отложен резерв под ступени лестницы' },
    { id: 'dip', i: 'ladder', c: '#7ab8ff', t: 'Купил на ступени', d: 'Покупка по лестнице, когда рынок упал' },
    { id: 'calm', i: 'snow', c: '#9fe6ff', t: 'Холодная голова', d: 'Биткоин на 20% ниже максимума, а продаж за месяц не было' },
    { id: 'divers', i: 'layers', c: '#b79bff', t: 'Не всё в одну корзину', d: 'В портфеле 3 монеты или больше' },
    { id: 'plan', i: 'star', c: '#ffc24d', t: 'Свой план', d: 'Собран личный план по 14 книгам' },
    { id: 'learn5', i: 'book', c: '#7ab8ff', t: 'Ученик', d: 'Прочитано 5 уроков в «Знаниях»' },
    { id: 'learnAll', i: 'book', c: '#ff6fd8', t: 'Знаток', d: 'Прочитаны все уроки' },
    { id: 'alert', i: 'bell', c: '#b79bff', t: 'На страже', d: 'Поставлено оповещение о цене' },
    { id: 'year', i: 'cal', c: '#34e0a1', t: 'Год в пути', d: 'Первая запись — больше года назад' },
    { id: 'green', i: 'up', c: '#34e0a1', t: 'Плюс десять', d: 'Портфель на 10% выше вложенного' }
  ];
  function facts() {
    const D = typeof derive === 'function' ? derive() : {}, tx = (S && S.tx) || [], x = xGet();
    if (D.noPrice && (D.syms || []).length) return null;   /* цены ещё не пришли — не решаем, иначе «Плюс десять» отметится позже как новое */
    const buys = tx.filter(t => t && BUY.includes(t.type)), st = X.streak ? X.streak() : { n: 0 };
    const read = x.read && typeof x.read === 'object' ? Object.keys(x.read).length : 0, total = X.lessonsCount || 18;
    const ath = +(S.cycle && S.cycle.ath) || 0, btc = +(D.prices && D.prices.BTC) || 0;
    const since = Date.now() - 30 * 864e5, sold30 = tx.some(t => t && t.type === 'sell' && Date.parse(t.ts) > since);
    const first = tx.map(t => Date.parse(t && t.ts)).filter(isFinite).sort((a, b) => a - b)[0];
    const holds = (D.syms || []).filter(s => s !== 'USDT' && D.h && D.h[s] && D.h[s].qty > 0);
    return {
      first: tx.length > 0, dep: tx.some(t => t && t.type === 'deposit'), buy10: buys.length >= 10, buy50: buys.length >= 50,
      str3: st.n >= 3, str6: st.n >= 6, str12: st.n >= 12, reserve: +D.reserve > 0, dip: tx.some(t => t && t.type === 'dip'),
      calm: ath > 0 && btc > 0 && btc <= ath * 0.8 && holds.length > 0 && !sold30, divers: holds.length >= 3,
      plan: !!(X.planGet && X.planGet()), learn5: read >= 5, learnAll: read >= total, alert: !!(x.alerts && x.alerts.length) || !!wGet().alertEver,
      year: first > 0 && Date.now() - first > 365 * 864e5, green: +D.invPriced > 0 && !D.noPrice && D.total / D.invPriced >= 1.1
    };
  }
  /* новые достижения: праздник один раз; при первой проверке уже заслуженные отмечаются тихо, без салюта задним числом */
  function check() {
    if (!S || !S.ready) return;
    let f; try { f = facts(); } catch (e) { return; }
    if (!f) { renderCard(); return; }
    const w = wGet(), got = Object.assign({}, w.got || {}), first = !w.got, now = new Date().toISOString().slice(0, 10), fresh = [];
    if (f.alert && !w.alertEver) w.alertEver = 1;
    ACH.forEach(a => { if (f[a.id] && !got[a.id]) { got[a.id] = first ? 'early' : now; if (!first) fresh.push(a); } });   /* «early» — было заслужено до появления достижений */
    wPatch({ got, alertEver: w.alertEver || 0 });
    renderCard();
    if (fresh.length) celebrate(fresh);
  }
  function celebrate(list) {
    const a = list[0];
    try { toast('Достижение: ' + a.t + (list.length > 1 ? ' и ещё ' + (list.length - 1) : ''), { label: 'Смотреть', fn: openAch }); } catch (e) {}
    try { play('done'); buzz([10, 40, 14]); } catch (e) {}
    try { if (X.sparks) X.sparks($i('winCard') || $i('toast'), 18); } catch (e) {}
    try { if (window.Mascot) window.Mascot.event('ach', { t: a.t }); } catch (e) {}
  }
  X.achCheck = check;

  /* ---------- карточка в «Стратегии» и шторка со всеми значками ---------- */
  function renderCard() {
    let box = $i('winCard');
    if (!box) { const learn = $i('xLearn'); if (!learn || !learn.parentNode) return; box = document.createElement('div'); box.id = 'winCard'; learn.parentNode.insertBefore(box, learn); }
    const got = wGet().got || {}, n = ACH.filter(a => got[a.id]).length;
    const top = ACH.filter(a => got[a.id]).slice(-5).reverse();
    const h = `<div class="sec-h"><span class="label">Достижения</span><span class="small mute">${n} из ${ACH.length}</span></div>
      <button type="button" class="card win-card" data-win="open" aria-label="Достижения: ${n} из ${ACH.length}">
        <span class="win-row">${top.length ? top.map(a => `<span class="win-b on" style="--c:${a.c}">${svg(a.i)}</span>`).join('') : `<span class="win-b">${svg('seed')}</span>`}</span>
        <span class="win-bar"><i style="--p:${(n / ACH.length).toFixed(3)}"></i></span>
        <span class="win-sub">${n ? 'Следующее: ' + ((ACH.find(a => !got[a.id]) || {}).t || 'все собраны') : 'Первое достижение — за первую запись'}</span>
      </button>`;
    if (box._h !== h) { box.innerHTML = h; box._h = h; }
    box.hidden = !S.ready;
  }
  function openAch() {
    const got = wGet().got || {}, n = ACH.filter(a => got[a.id]).length;
    const html = `<p class="mute small" style="margin:0 0 14px">За регулярность, спокойствие и знания — не за угадывание рынка. ${n} из ${ACH.length}.</p>
      <div class="win-grid">${ACH.map((a, i) => { const d = got[a.id]; return `<div class="win-cell${d ? ' on' : ''}" style="--c:${a.c};--i:${i}"><span class="win-b${d ? ' on' : ''}">${svg(a.i)}</span><b>${a.t}</b><small>${d ? (d === 'early' ? 'получено' : 'получено ' + +d.slice(8, 10) + ' ' + MON_G[+d.slice(5, 7) - 1]) : a.d}</small></div>`; }).join('')}</div>`;
    if (X.open) X.open('ach', 'Достижения', html, `<button type="button" class="btn block" data-win="month">Итог месяца</button>`);
  }
  X.openAch = openAch;

  /* ---------- итог месяца ---------- */
  function ymOf(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  /* в первые 5 дней месяца — итог прошлого месяца, дальше — текущий «на сегодня» */
  function pickYm() { const d = new Date(); if (d.getDate() <= 5) { d.setDate(1); d.setMonth(d.getMonth() - 1); return { ym: ymOf(d), done: true }; } return { ym: ymOf(d), done: false }; }
  function month(ym) {
    const D = derive(), tx = (S.tx || []).filter(t => t && String(t.ts || '').slice(0, 7) === ym);
    const buys = tx.filter(t => BUY.includes(t.type)), spent = buys.reduce((a, t) => a + (+t.usd || 0), 0), sold = tx.filter(t => t.type === 'sell').reduce((a, t) => a + (+t.usd || 0), 0);
    const coins = [...new Set(buys.map(t => String(t.symbol || '').toUpperCase()).filter(Boolean))];
    const y = +ym.slice(0, 4), m = +ym.slice(5, 7), start = ym + '-01', endD = new Date(y, m, 0), end = endD.toISOString().slice(0, 10), isNow = ym === ymOf(new Date());
    const hist = (S.history || []).filter(h => h && +h.value > 0 && typeof h.date === 'string').sort((a, b) => (a.date < b.date ? -1 : 1));
    const s0 = hist.filter(h => h.date < start).pop() || hist.find(h => h.date.slice(0, 7) === ym);
    const s1v = isNow ? (D.noPrice ? null : D.total) : ((hist.filter(h => h.date <= end).pop() || {}).value);
    const ch = s0 && s1v > 0 && +s0.value > 0 && s0.date.slice(0, 7) <= ym ? ((+s1v - spent + sold) / +s0.value - 1) * 100 : null;
    const got = wGet().got || {}, ach = ACH.filter(a => (got[a.id] || '').slice(0, 7) === ym);
    const st = X.streak ? X.streak() : { n: 0 };
    return { ym, mi: m - 1, buys: buys.length, spent, coins, ch: ch != null && isFinite(ch) ? ch : null, ach, streak: st.n, dips: tx.filter(t => t.type === 'dip').length };
  }
  function orionLine(r) {
    if (!r.buys) return 'Месяц без покупок — тоже решение, если так было по плану. Главное — не бросать систему.';
    if (r.dips) return 'Вы покупали на ступенях лестницы, когда рынок падал. Так и работает план: решения приняты заранее, без паники.';
    if (r.streak >= 6) return 'Полгода и больше подряд с покупками. Регулярность — то, что отличает план от надежды.';
    if (r.ch != null && r.ch < -5) return 'Рынок был против, а вы продолжили по плану. Именно в такие месяцы и решается результат.';
    return 'Ещё один месяц по плану. Сложный процент любит терпеливых.';
  }

  /* ---------- «истории»: полноэкранные слайды с анимацией ---------- */
  let story = null;
  function openStory(ymArg) {
    if (!S.ready) return;
    const pk = ymArg ? { ym: ymArg, done: ymArg !== ymOf(new Date()) } : pickYm(), r = month(pk.ym), hide = typeof P !== 'undefined' && P.hide;
    const mn = MON[r.mi], title = pk.done ? 'Итог: ' + mn : mn.charAt(0).toUpperCase() + mn.slice(1) + ' — пока';
    const chTxt = r.ch == null ? '—' : (r.ch >= 0 ? '+' : '−') + nf1(Math.abs(r.ch)) + '%';
    const slides = [
      `<div class="st-s st-intro"><span class="st-k">MoneyLife</span><h2>${title}</h2><p>Как прошёл ${pk.done ? '' : 'этот '}месяц — коротко, в процентах и шагах.</p><span class="st-tap">нажмите, чтобы листать</span></div>`,
      `<div class="st-s"><span class="st-k">Покупки</span><b class="st-big" data-n="${r.buys}">${r.buys}</b><p>${pl(r.buys, 'покупка', 'покупки', 'покупок')} в ${MON_P[r.mi]}${!hide && r.spent > 0 ? ' — на ' + money(r.spent, { d: 0, show: true }) : ''}</p>${r.coins.length ? `<div class="st-coins">${r.coins.slice(0, 6).map((s, i) => `<span style="--i:${i}">${badge(s)}</span>`).join('')}</div>` : ''}</div>`,
      `<div class="st-s"><span class="st-k">Портфель за месяц</span><b class="st-big ${r.ch == null ? 'st-na' : r.ch >= 0 ? 'pos' : 'neg'}">${r.ch == null ? 'скоро' : chTxt}</b><p>${r.ch == null ? 'Пока мало истории, чтобы посчитать.' : 'Без учёта новых денег — только движение цен.'}</p></div>`,
      `<div class="st-s"><span class="st-k">Серия</span><b class="st-big" data-n="${r.streak}">${r.streak}</b><p>${pl(r.streak, 'месяц', 'месяца', 'месяцев')} подряд с покупками</p><div class="st-flames">${Array.from({ length: Math.min(12, Math.max(1, r.streak)) }, (_, i) => `<i style="--i:${i}" class="${i < r.streak ? 'on' : ''}">${svg('flame')}</i>`).join('')}</div></div>`,
      `<div class="st-s"><span class="st-k">Достижения месяца</span>${r.ach.length ? `<div class="st-ach">${r.ach.map((a, i) => `<span class="win-b on" style="--c:${a.c};--i:${i}">${svg(a.i)}</span><small style="--i:${i}">${a.t}</small>`).join('')}</div>` : '<b class="st-big">0</b><p>В этом месяце новых нет — следующее уже близко.</p>'}</div>`,
      `<div class="st-s st-end"><span class="st-k">Орион</span><p class="st-q">«${orionLine(r)}»</p><div class="st-btns"><button type="button" class="btn" data-win="mshare">Поделиться</button><button type="button" class="btn ghost" data-win="sclose">Закрыть</button></div><small class="st-note">На картинке только проценты и счётчики — без сумм.</small></div>`
    ];
    closeStory(true);
    const o = document.createElement('div'); o.className = 'story'; o.id = 'mlStory'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-label', title);
    o.innerHTML = `<div class="st-bg" aria-hidden="true"></div><div class="st-bars">${slides.map(() => '<i><b></b></i>').join('')}</div><button type="button" class="st-x" data-win="sclose" aria-label="Закрыть">×</button><div class="st-in"></div>`;
    document.body.appendChild(o); document.body.classList.add('lock');
    story = { o, slides, i: -1, r, title, chTxt, t: 0 };
    requestAnimationFrame(() => o.classList.add('open'));
    go(0); try { play('open'); } catch (e) {}
    o.addEventListener('click', e => { if (e.target.closest('[data-win],button')) return; const left = e.clientX < innerWidth * 0.3; go(story.i + (left ? -1 : 1)); });
  }
  function go(i) {
    if (!story) return;
    if (i >= story.slides.length) { closeStory(); return; }
    i = Math.max(0, i); const fw = i >= story.i; story.i = i;
    const inn = story.o.querySelector('.st-in'); inn.innerHTML = story.slides[i]; inn.firstChild.classList.add(fw ? 'fw' : 'bw');
    story.o.querySelectorAll('.st-bars i').forEach((b, k) => { b.className = k < i || (k === i && i === story.slides.length - 1) ? 'done' : k === i ? 'run' : ''; });
    story.o.style.setProperty('--hue', String([0, 24, 48, -24, 12, -40][i % 6]));   /* фон плавно меняет оттенок в пределах фирменных фиолетово-розовых */
    inn.querySelectorAll('.st-big[data-n]').forEach(b => { const to = +b.dataset.n; if (reduced || !(to > 1)) return; const t0 = performance.now(); const f = n => { const k = Math.min(1, (n - t0) / 700); b.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    if (i === 4 && story.r.ach.length) { try { play('done'); X.sparks && X.sparks(inn.querySelector('.st-ach'), 16); } catch (e) {} } else if (i > 0) { try { play('tab', { dir: fw ? 1 : -1 }); } catch (e) {} }
    clearTimeout(story.t); if (i < story.slides.length - 1) story.t = setTimeout(() => go(story.i + 1), reduced ? 9000 : 6000);
  }
  function closeStory(silent) {
    const o = $i('mlStory'); if (!o) return; if (story) clearTimeout(story.t); story = null;
    o.classList.remove('open'); document.body.classList.remove('lock'); setTimeout(() => o.remove(), 260); if (!silent) try { play('close'); } catch (e) {}
  }
  /* картинка 1080×1920 для «историй» в соцсетях: только проценты и счётчики */
  function storyCanvas(r, title, chTxt) {
    const c = document.createElement('canvas'); c.width = 1080; c.height = 1920; const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 1080, 1920); bg.addColorStop(0, '#1d0e4a'); bg.addColorStop(.55, '#0b0620'); bg.addColorStop(1, '#2a0d3a'); g.fillStyle = bg; g.fillRect(0, 0, 1080, 1920);
    const glow = (x, y, rad, col) => { const rg = g.createRadialGradient(x, y, 0, x, y, rad); rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = rg; g.fillRect(0, 0, 1080, 1920); };
    glow(860, 260, 620, 'rgba(255,79,216,.28)'); glow(160, 1500, 700, 'rgba(122,60,240,.35)');
    g.fillStyle = '#fff'; g.font = '700 54px system-ui,-apple-system,Segoe UI,Roboto,sans-serif'; g.fillText('MoneyLife', 90, 170);
    g.fillStyle = '#cfbaff'; g.font = '500 40px system-ui,sans-serif'; g.fillText(title, 90, 240);
    const row = (y, k, v, col) => { g.fillStyle = '#b8a8e8'; g.font = '500 40px system-ui,sans-serif'; g.fillText(k, 90, y); g.fillStyle = col || '#fff'; g.font = '800 150px system-ui,sans-serif'; g.fillText(v, 84, y + 160); };
    row(470, 'Портфель за месяц', chTxt, r.ch == null ? '#fff' : r.ch >= 0 ? '#34e0a1' : '#ff5f6d');
    row(830, 'Покупок по плану', String(r.buys));
    row(1190, 'Серия, месяцев подряд', String(r.streak), '#ffc24d');
    g.fillStyle = '#b8a8e8'; g.font = '500 40px system-ui,sans-serif'; g.fillText('Достижений в этом месяце: ' + r.ach.length, 90, 1560);
    g.fillStyle = '#ffffffb0'; g.font = 'italic 500 38px system-ui,sans-serif'; wrap(g, '«' + orionLine(r) + '»', 90, 1660, 900, 52);
    g.fillStyle = '#ffffff70'; g.font = '500 30px system-ui,sans-serif'; g.fillText('Дисциплина важнее прогноза · не инвестиционный совет', 90, 1860);
    return c;
  }
  function wrap(g, t, x, y, w, lh) { let line = ''; for (const word of t.split(' ')) { const test = line ? line + ' ' + word : word; if (g.measureText(test).width > w && line) { g.fillText(line, x, y); line = word; y += lh; } else line = test; } if (line) g.fillText(line, x, y); }
  async function shareMonth() {
    if (!story) return; const { r, title, chTxt } = story;
    try {
      const c = storyCanvas(r, title, chTxt), blob = await new Promise(res => c.toBlob(res, 'image/png'));
      const file = new File([blob], 'moneylife-' + r.ym + '.png', { type: 'image/png' }), text = title + ' в MoneyLife: ' + r.buys + ' ' + pl(r.buys, 'покупка', 'покупки', 'покупок') + ' по плану, серия ' + r.streak + ' ' + pl(r.streak, 'месяц', 'месяца', 'месяцев') + '.';
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], text }); } catch (e) {} return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      toast('Картинка сохранена');
    } catch (e) { toast('Не получилось сделать картинку'); }
  }
  X.openStory = openStory; X.monthRecap = month; X.storyCanvas = storyCanvas;

  /* приглашение на главной: «Итог октября готов» — первые 5 дней месяца, пока не посмотрели */
  function renderInvite() {
    const pk = pickYm(); let box = $i('winInvite');
    const show = S.ready && pk.done && (S.tx || []).some(t => String(t.ts || '').slice(0, 7) <= pk.ym) && wGet().seenYm !== pk.ym;
    if (!box) { const anchor = $i('xPlan'); if (!anchor || !anchor.parentNode) return; box = document.createElement('div'); box.id = 'winInvite'; anchor.parentNode.insertBefore(box, anchor); }
    const h = show ? `<button type="button" class="card win-inv" data-win="month"><span class="win-inv-g" aria-hidden="true"></span><span class="col"><b>Итог: ${MON[+pk.ym.slice(5, 7) - 1]}</b><small>Покупки, серия, достижения — за минуту</small></span><span class="chev">›</span></button>` : '';
    if (box._h !== h) { box.innerHTML = h; box._h = h; } box.hidden = !show;
  }

  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('[data-win]'); if (!b) return;
    const k = b.dataset.win;
    if (k === 'open') { buzz(6); openAch(); }
    else if (k === 'month') { buzz(6); try { closeSheets(); } catch (er) {} const pk = pickYm(); if (pk.done) wPatch({ seenYm: pk.ym }); renderInvite(); setTimeout(() => openStory(), 120); }
    else if (k === 'sclose') closeStory();
    else if (k === 'mshare') shareMonth();
  });
  document.addEventListener('keydown', e => { if (story && e.key === 'Escape') closeStory(); if (story && e.key === 'ArrowRight') go(story.i + 1); if (story && e.key === 'ArrowLeft') go(story.i - 1); });

  /* подключаемся к общей отрисовке приложения */
  const r0 = X.render;
  X.render = function (D) { if (r0) r0.apply(this, arguments); try { check(); renderInvite(); } catch (e) { console.error(e); } };
  try { check(); renderInvite(); } catch (e) {}
})();
