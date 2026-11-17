/* MoneyLife — видео-инструкция «Как устроен MoneyLife» (17.11.2026, просьба владельца).
   Живой ролик внутри приложения, не видеофайл: 13 сцен, около 2,5–3 минут. Каждая сцена — нарисованный силуэт
   настоящего экрана (цифры примерные, данных человека здесь нет), подсветка нужного места, субтитры и голос телефона
   (speechSynthesis, ru-RU или uk-UA). Нет голоса или звук выключен — сцена идёт по таймеру, только субтитры.
   Где живёт: «Знания» (первая строка), «Настройки» → «План и сигналы», и один раз после входа — предложение посмотреть.
   Выбор хранится на телефоне: ml-tour:<uid> = {offer: 'watch'|'later', at, seen?}. В базу ничего не уходит. Расчёты не трогает.
   Стиль «Графит»: переменные темы приложения, один акцент, без градиентов и свечений. «Уменьшить движение» — только смена кадров. */
(function () {
  'use strict';
  const L = s => (window.L ? window.L(s) : s);
  const UK = !!(window.mlLang && window.mlLang() === 'uk');
  const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const test = !!navigator.webdriver;
  const $ = id => document.getElementById(id);
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const uidKey = () => (window.mlDemo ? 'demo' : (window.mlUser && window.mlUser.id) || 'local');
  const KEY = () => 'ml-tour:' + uidKey();
  const tGet = () => { const o = lsGet(KEY(), null); return o && typeof o === 'object' ? o : null; };
  const tPatch = p => lsSet(KEY(), Object.assign(tGet() || {}, p));
  const SND = 'ml-tour-snd';
  let SPEED = 1;   /* для автотестов: mlTour.debug.speed(0.05) */

  /* ---------- значки ---------- */
  const sv = (d, w) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 2.2}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
  const IC = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.5 5h3v14h-3zM13.5 5h3v14h-3z" fill="currentColor"/></svg>',
    prev: sv('<path d="M15 5l-7 7 7 7"/>', 2.4), next: sv('<path d="M9 5l7 7-7 7"/>', 2.4), x: sv('<path d="M6 6l12 12M18 6 6 18"/>', 2.4),
    snd: sv('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>', 2),
    mute: sv('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>', 2),
    again: sv('<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/>', 2),
    plus: sv('<path d="M12 5v14M5 12h14"/>'), up: sv('<path d="M12 19V5M6 11l6-6 6 6"/>'), down: sv('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 20h16"/>'),
    dots: sv('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
    ok: sv('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.6), lock: sv('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', 2),
    key: sv('<circle cx="8" cy="14" r="4"/><path d="M11 11l8-8M16 6l2 2"/>', 2), user: sv('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', 2),
    cal: sv('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>', 2), chart: sv('<path d="M4 19h16"/><path d="M6 15l4-4 3 3 5-6"/>', 2),
    stair: sv('<path d="M4 19h4v-4h4v-4h4V7h4"/>', 2), sun: sv('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>', 2),
    book: sv('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>', 2),
    star: sv('<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>', 2), flag: sv('<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>', 2),
    bell: sv('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>', 2), dl: sv('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>', 2),
    list: sv('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', 2), home: sv('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/>', 2),
    coins: sv('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>', 2),
    strat: sv('<path d="M4 5l6 6 4-3 6 8"/><path d="M15 16h5v-5"/>', 2)
  };
  const PLAY_BADGE = IC.play;

  /* ---------- куски макетов (силуэты экранов приложения; цифры — примерные) ---------- */
  const A = (i, extra) => ` a" style="--i:${i}${extra ? ';' + extra : ''}"`;   /* появление по очереди */
  const top = () => `<div class="tm-top"><b class="tm-wm">Money<span>Life</span></b><i class="tm-ib"></i><i class="tm-ib"></i><i class="tm-ib"></i></div>`;
  const tabs = act => `<div class="tm-tabs">${[['home', 'Главная', IC.home], ['coins', 'Монеты', IC.coins], ['strategy', 'Стратегия', IC.strat], ['activity', 'Активность', IC.list]]
    .map(([k, t, i]) => `<span class="tm-tab${k === act ? ' on' : ''}"${k === act ? ' data-f="tab"' : ''}>${i}<small>${L(t)}</small></span>`).join('')}</div>`;
  const hero = orb => `<div class="tm-hero${A(1)} data-f="hero"><div class="tm-l">${L('Стоимость портфеля')}</div><div class="tm-bal">$12 480</div>
    <div class="tm-sub"><span class="tm-pos">+$1 920 · +18,2%</span> ${L('прибыль сейчас')}</div><span class="tm-chip tm-pos">${L('24ч +$140 · +1,1%')}</span>
    ${orb !== false ? '<span class="tm-orb" data-f="orb"><i></i></span>' : ''}</div>`;
  const qa = () => `<div class="tm-qa${A(2)} data-f="qa">${[['buy', 'Купить', IC.plus], ['sell', 'Продать', IC.up], ['dep', 'Пополнить', IC.down], ['more', 'Ещё', IC.dots]]
    .map(([k, t, i]) => `<span class="tm-q" data-f="${k}"><i>${i}</i>${L(t)}</span>`).join('')}</div>`;
  const tiles = () => `<div class="tm-tiles${A(3)} data-f="tiles">${[['Вложено', '$10 560'], ['Резерв USDT', '$1 200'], ['BTC сейчас', '$96 400'], ['DCA в месяц', '$300']]
    .map(([k, v]) => `<span class="tm-tile"><small>${L(k)}</small><b>${v}</b></span>`).join('')}</div>`;
  const alloc = () => `<div class="tm-card tm-alloc${A(4)} data-f="alloc"><div class="tm-h">${L('Распределение')}<small>${L('цель')} 50 / 30 / 20</small></div>
    <div class="tm-abar"><i style="--w:50%;--c:#f7931a"></i><i style="--w:30%;--c:#8c8cf0"></i><i style="--w:20%;--c:#33c3a5"></i></div></div>`;
  const field = (k, v, f, cur) => `<span class="tm-fld"${f ? ` data-f="${f}"` : ''}><small>${L(k)}</small><b${cur ? ' class="tm-cur"' : ''}>${v}</b></span>`;
  const seg = (a, b, on) => `<span class="tm-seg"><i${on === 0 ? ' class="on"' : ''}>${L(a)}</i><i${on === 1 ? ' class="on"' : ''}>${L(b)}</i></span>`;
  const sheet = (title, body, f) => `<div class="tm-sheet"${f ? ` data-f="${f}"` : ''}><span class="tm-grab"></span><div class="tm-sh-h"><b>${L(title)}</b><i class="tm-ib"></i></div>${body}</div>`;
  const pc = v => v[0] === '−' ? 'tm-neg' : v[0] === '+' ? 'tm-pos' : 'tm-mut';
  const coin = (s, c, q, px, ch, v, pf, f) => `<div class="tm-coin"${f ? ` data-f="${f}"` : ''}><span class="tm-cb" style="--c:${c}">${s.slice(0, 1)}</span><span class="tm-cc"><b>${s}</b><small>${q}</small></span>
    <span class="tm-cr"><b>${px}</b><small class="${pc(ch)}">${ch}</small></span><span class="tm-cr"><b>${v}</b><small class="${pc(pf)}">${pf}</small></span></div>`;
  const row = (ico, t, s, f, i, right) => `<div class="tm-row${A(i)}${f ? ` data-f="${f}"` : ''}><span class="tm-ri">${ico}</span><span class="tm-rc"><b>${L(t)}</b>${s ? `<small>${L(s)}</small>` : ''}</span>${right == null ? '<span class="tm-chev">›</span>' : right}</div>`;
  const sw = on => `<span class="tm-sw${on ? ' on' : ''}"><i></i></span>`;

  /* ---------- сценарий: 13 сцен ----------
     s — субтитры и голос; st — шаги подсветки: f — что подсветить, at — доля длины сцены, cls — класс экрана (шторка выезжает и т. п.), tap — касание */
  const SC = [
    { t: 'Что такое MoneyLife', s: 'MoneyLife — личный учёт вашего криптопортфеля и помощник в дисциплине долгих вложений. Деньги приложение не хранит и ключи бирж не просит: вы записываете покупки, а оно считает итог и прибыль.',
      st: [{ f: 'brand' }, { f: 'facts', at: 0.45 }],
      v: () => `<div class="tm-intro"><div class="tm-brand${A(1)} data-f="brand"><b class="tm-wm big">Money<span>Life</span></b><p>${L('Учёт криптопортфеля и дисциплина долгих вложений')}</p></div>
        <div class="tm-list${A(2)} data-f="facts">${row(IC.lock, 'Деньги не хранит', 'Только ваши записи и расчёт', '', 3, '')}${row(IC.key, 'Ключи бирж не нужны', 'Покупки вы записываете сами', '', 4, '')}${row(IC.user, 'Решения — ваши', 'Приложение считает, а не советует', '', 5, '')}</div></div>` },
    { t: 'Кому полезно', s: 'Оно для тех, кто регулярно откладывает часть дохода в крипту. Это называется DCA — покупка на одну и ту же сумму каждый месяц. Вы видите настоящую прибыль, а не на глаз, и докупаете при падениях спокойно, по плану.',
      st: [{ f: 'w1' }, { f: 'dca', at: 0.22 }, { f: 'w2', at: 0.55 }, { f: 'w3', at: 0.78 }],
      v: () => `<div class="tm-pad"><div class="tm-h${A(0)}>${L('Кому полезно')}</div>
        <div class="tm-dca${A(1)} data-f="dca"><div class="tm-bars">${['$300', '$300', '$300', '$300', '$300', '$300'].map((x, i) => `<i style="--i:${i}"><b></b></i>`).join('')}</div>
          <svg class="tm-line" viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 22 L40 34 L80 18 L120 44 L160 30 L200 12 L240 20" pathLength="1"/></svg>
          <small>${L('Одна и та же сумма каждый месяц — при любой цене')}</small></div>
        <div class="tm-list">${row(IC.cal, 'Откладываете регулярно', 'Часть дохода — в крипту, по плану (DCA)', 'w1', 2, '')}${row(IC.chart, 'Хотите видеть настоящую прибыль', 'По вашим покупкам, а не на глаз', 'w2', 3, '')}${row(IC.stair, 'Докупаете при падениях спокойно', 'По заранее заданным ступеням, без паники', 'w3', 4, '')}</div></div>` },
    { t: 'Главная', s: 'На главной — стоимость портфеля, прибыль и изменение за сутки. Ниже плитки: сколько вложено, резерв в долларах, цена биткоина и бюджет DCA на месяц.',
      st: [{ f: 'hero' }, { f: 'tiles', at: 0.42 }],
      v: () => `${top()}${hero()}${qa()}${tiles()}${alloc()}${tabs('home')}` },
    { t: 'Орион', s: 'Сфера рядом с суммой — Орион, голосовой помощник. Нажмите на неё, и он расскажет сводку за день. Зажмите — и спросите голосом, например: «сколько у меня биткоина». Советов он не даёт.',
      st: [{ f: 'orb', tap: true }, { f: 'cap', at: 0.3, cls: 'cap' }, { f: 'ask', at: 0.6, cls: 'cap ask' }],
      v: () => `${top()}${hero()}${qa()}${tiles()}
        <div class="tm-cap"><div class="tm-ci" data-f="cap"><i></i><b>${L('Орион')}</b><span>${L('Портфель за сутки +1,1%. До первой ступени лестницы ещё 9%.')}</span></div></div>
        <div class="tm-cap tm-ask"><div class="tm-ci" data-f="ask"><span class="tm-mic">${sv('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', 2)}</span><span>${L('«Сколько у меня биткоина?»')}</span></div></div>${tabs('home')}` },
    { t: 'Записать покупку', s: 'Купили монету — нажмите «Купить». «По плану» раскладывает общую сумму по вашим долям, «Одна монета» — для отдельной покупки. Впишите сумму и количество; дробь можно писать через запятую.',
      st: [{ f: 'buy', tap: true }, { f: 'mode', at: 0.2, cls: 'up' }, { f: 'fields', at: 0.62, cls: 'up' }],
      v: () => `${top()}${hero()}${qa()}${tiles()}${tabs('home')}
        ${sheet('Купить', `<div data-f="mode">${seg('По плану', 'Одна монета', 1)}</div>
          <div class="tm-f2" data-f="fields">${field('Монета', 'BTC')}${field('Потратил, $', '100')}${field('Цена покупки, $', '96 150')}${field('Получил монет', '0,00104', '', true)}</div>
          <span class="tm-slide"><i>${IC.next}</i><b>${L('Купить')}</b></span>`)}` },
    { t: 'Пополнение биржи', s: 'Перевели деньги на биржу — нажмите «Пополнить». Сумма делится сама: часть идёт в бюджет DCA, остальное — в резерв USDT на случай падения. Пропорцию вы задаёте в настройках.',
      st: [{ f: 'dep', tap: true }, { f: 'depf', at: 0.24, cls: 'up' }, { f: 'split', at: 0.5, cls: 'up sp' }],
      v: () => `${top()}${hero()}${qa()}${tiles()}${tabs('home')}
        ${sheet('Пополнить биржу', `<div class="tm-f2" data-f="depf">${field('Пополнил на, грн', '10 000')}${field('Пришло, USDT', '240')}</div>
          <div class="tm-split" data-f="split"><div class="tm-sbar"><i style="--w:70%"></i><i style="--w:30%"></i></div>
            <div class="tm-sl"><span><b>${L('В бюджет DCA')}</b><small>70% · $168</small></span><span><b>${L('В резерв USDT')}</b><small>30% · $72</small></span></div></div>
          <span class="tm-btn">${L('Сохранить')}</span>`)}` },
    { t: 'Монеты', s: 'Во вкладке «Монеты» — список ваших монет: сколько у вас, цена сейчас, стоимость и прибыль или убыток. Нажмите на монету, потом на её карточку — на обороте средняя цена покупки, сколько вложено и сколько стоит сейчас.',
      st: [{ f: 'tab' }, { f: 'list', at: 0.12 }, { f: 'c1', at: 0.42, tap: true }, { f: 'card', at: 0.55, cls: 'up', tap: true }, { f: 'back', at: 0.68, cls: 'up flip' }],
      v: () => `${top()}<div class="tm-pad"><div class="tm-search${A(0)}>${L('Поиск монеты')}</div>
        <div class="tm-cl${A(1)} data-f="list"><div class="tm-ch"><span>${L('Актив')}</span><span>${L('Цена')}</span><span>${L('Стоимость')}</span></div>
        ${coin('BTC', '#f7931a', '0,0821', '$96 400', '+1,6%', '$7 915', '+$1 505', 'c1')}${coin('ETH', '#8c8cf0', '0,8', '$3 350', '+0,9%', '$2 680', '+$460')}
        ${coin('SOL', '#33c3a5', '4,6', '$148,90', '−1,3%', '$685', '−$45')}${coin('USDT', '#26a17b', '1 200', '$1,00', '0,0%', '$1 200', '$0')}</div>
        <p class="tm-note${A(2)}>${L('Итого')} $12 480</p></div>${tabs('coins')}
        ${sheet('BTC', `<div class="tm-flip" data-f="card"><div class="tm-front"><small>${L('Цена сейчас')}</small><b class="tm-big">$96 400</b><small class="tm-pos">+1,6% ${L('за сутки')}</small>
            <svg class="tm-spark" viewBox="0 0 240 50" preserveAspectRatio="none" aria-hidden="true"><path d="M0 38 L30 30 L60 34 L90 22 L120 26 L150 14 L180 20 L210 10 L240 12"/><path class="avg" d="M0 32 H240"/></svg></div>
          <div class="tm-back" data-f="back"><span><small>${L('Средняя цена покупки')}</small><b>$78 080</b></span><span><small>${L('Вложено')}</small><b>$6 410</b></span><span><small>${L('Стоит сейчас')}</small><b>$7 915</b></span><span><small>${L('Прибыль')}</small><b class="tm-pos">+$1 505 · +23,5%</b></span></div></div>
          <p class="tm-note">${L('Нажми на карточку — на обороте твои цифры по монете')}</p>`)}` },
    { t: 'Стратегия', s: 'Во вкладке «Стратегия» — лестница докупок: когда биткоин падает от максимума на 30, 40, 50 процентов и ниже, открывается следующая ступень. Ваши доли BTC, ETH и альткоинов видны в «Распределении» на главной, а меняются в настройках.',
      st: [{ f: 'gauge' }, { f: 'gauge', at: 0.1, cls: 'go' }, { f: 'steps', at: 0.4, cls: 'go' }, { f: 'plan', at: 0.68, cls: 'go' }],
      v: () => `${top()}<div class="tm-pad"><div class="tm-card${A(1)} data-f="gauge"><div class="tm-h">${L('Лестница докупок')}<small>${L('макс')} $126 000</small></div>
          <div class="tm-gauge"><div class="tm-gt"><i class="tm-gm"></i></div><div class="tm-gs">${[30, 40, 50, 60, 70].map((d, i) => `<span style="--x:${(d / 75 * 100).toFixed(1)}%"><i></i><small>−${d}%</small></span>`).join('')}</div></div>
          <p class="tm-note">${L('BTC сейчас −24% от максимума')}</p></div>
        <div class="tm-h${A(2)}>${L('Ступени лестницы')}</div>
        <div class="tm-list" data-f="steps">${row('<b class="tm-n">1</b>', L('Ступень') + ' 1 · −30%', '$88 200 · 10% ' + L('резерва'), '', 3, '')}${row('<b class="tm-n">2</b>', L('Ступень') + ' 2 · −40%', '$75 600 · 15% ' + L('резерва'), '', 4, '')}</div>
        <div class="tm-card${A(5)} data-f="plan"><div class="tm-h">${L('План альткоинов')}<small>2026</small></div><div class="tm-mos">
          <span class="tm-mo"><small>${L('окт')}</small><b>SOL</b><small class="tm-pos">✓ $50</small></span><span class="tm-mo cur"><small>${L('ноя')}</small><b>SOL</b><small>${L('в этом месяце')}</small></span><span class="tm-mo"><small>${L('дек')}</small><b>—</b><small>&nbsp;</small></span></div></div></div>${tabs('strategy')}` },
    { t: 'Резерв и докупка', s: 'На каждой ступени в дело идёт часть резерва. Нужны два ключа: биткоин дошёл до ступени, и цена монеты ниже средней цены ваших покупок за последние 60 дней — по умолчанию на 5%. Тогда на главной появится «Можно докупить» с суммами.',
      st: [{ f: 'steps' }, { f: 'keys', at: 0.3, cls: 'k' }, { f: 'sig', at: 0.7, cls: 'k sig' }],
      v: () => `${top()}<div class="tm-pad"><div class="tm-h${A(0)}>${L('Ступени лестницы')}</div>
        <div class="tm-list" data-f="steps">${[[1, 30, '$88 200', 10], [2, 40, '$75 600', 15], [3, 50, '$63 000', 20]].map(([n, d, p, r], i) => row(`<b class="tm-n">${n}</b>`, L('Ступень') + ' ' + n + ' · −' + d + '%', p + ' · ' + r + '% ' + L('резерва'), '', i + 1, '')).join('')}</div>
        <div class="tm-keys"><div class="tm-kin" data-f="keys"><span>${IC.ok}<b>${L('Ключ 1')}</b><small>${L('BTC на ступени')}</small></span><span>${IC.ok}<b>${L('Ключ 2')}</b><small>${L('на 5% ниже средней за 60 дней')}</small></span></div></div>
        <div class="tm-sig"><div class="tm-si" data-f="sig"><b>${L('Можно докупить')}</b><small>BTC $120 · ETH $60 · ${L('по вашим правилам')}</small></div></div></div>${tabs('strategy')}` },
    { t: 'Активность', s: 'Во вкладке «Активность» — история всех записей и отчёт за месяц. Ошиблись — нажмите на запись: дату, сумму и заметку можно поправить или удалить, итоги пересчитаются.',
      st: [{ f: 'tab' }, { f: 'r1', at: 0.4, tap: true }, { f: 'edit', at: 0.55, cls: 'up' }],
      v: () => `${top()}<div class="tm-pad"><div class="tm-seg2${A(0)}>${seg('История', 'Отчёт за месяц', 0)}</div>
        <div class="tm-list">${row(IC.plus, 'Покупка по плану', '12 нояб · BTC, ETH, SOL', 'r1', 1, '<b class="tm-amt">$300</b>')}${row(IC.down, 'Пополнение', '10 нояб · 10 000 грн', '', 2, '<b class="tm-amt">$240</b>')}${row(IC.plus, 'Покупка BTC', '28 окт · 0,00104 BTC', '', 3, '<b class="tm-amt">$100</b>')}${row(IC.stair, 'Докупка', '21 окт · ступень 1', '', 4, '<b class="tm-amt">$120</b>')}</div></div>${tabs('activity')}
        ${sheet('Запись', `<div class="tm-f2">${field('Дата', '12.11.2026')}${field('Сумма, $', '300', '', true)}</div>${field('Заметка', L('зарплата, ноябрь'))}
          <div class="tm-btns"><span class="tm-btn ghost">${L('Удалить')}</span><span class="tm-btn">${L('Сохранить')}</span></div>`, 'edit')}` },
    { t: 'Ещё в приложении', s: '«Сегодня» на главной показывает, что важно сейчас. «Личный план» — восемь вопросов и шаги по четырнадцати книгам о деньгах. «Знания» — короткие уроки. Достижения отмечают дисциплину, а не угаданный рынок.',
      st: [{ f: 'm1' }, { f: 'm2', at: 0.24 }, { f: 'm3', at: 0.52 }, { f: 'm4', at: 0.72 }],
      v: () => `${top()}<div class="tm-pad"><div class="tm-h${A(0)}>${L('Ещё в приложении')}</div><div class="tm-list">
        ${row(IC.sun, 'Сегодня', 'Что важно сейчас по вашим правилам', 'm1', 1)}${row(IC.star, 'Личный план', '8 вопросов — этап и шаги по 14 книгам', 'm2', 2)}
        ${row(IC.book, 'Знания', 'Короткие уроки о деньгах', 'm3', 3)}${row(IC.flag, 'Достижения', 'За дисциплину, а не за угадывание рынка', 'm4', 4)}</div></div>${tabs('home')}` },
    { t: 'Настройки', s: 'В настройках — сигналы на телефоне о ступенях лестницы и цели BTC, тёмная или светлая тема, украинский язык и валюта. Свои данные можно скачать файлом в любой момент.',
      st: [{ f: 'n1' }, { f: 'n2', at: 0.36 }, { f: 'n3', at: 0.48 }, { f: 'n5', at: 0.58 }, { f: 'n4', at: 0.74 }],
      v: () => `<div class="tm-pad"><div class="tm-sh-h tm-big${A(0)}><b>${L('Настройки')}</b><i class="tm-ib"></i></div><div class="tm-list">
        ${row(IC.bell, 'Сигналы на телефоне', 'Ступени лестницы и цель BTC', 'n1', 1, sw(false))}${row(IC.sun, 'Тема', 'Тёмная или светлая', 'n2', 2, sw(false))}
        <div class="tm-row a" style="--i:3" data-f="n3" translate="no"><span class="tm-ri">${sv('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>', 2)}</span><span class="tm-rc"><b>Мова / Язык</b><small>Українська · Русский</small></span><span class="tm-seg sm"><i class="on">UA</i><i>RU</i></span></div>
        ${row(sv('<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>', 2), 'Валюта', 'Суммы в долларах или гривне', 'n5', 4, '<span class="tm-seg sm"><i class="on">$</i><i>₴</i></span>')}
        ${row(IC.dl, 'Скачать мои данные', 'Все записи одним файлом', 'n4', 5)}</div></div>` },
    { t: 'Важно', s: 'MoneyLife — дневник и калькулятор вашей стратегии, а не инвестиционный совет. Решения о покупке и продаже принимаете вы. Эта инструкция всегда лежит во «Знаниях».',
      st: [{ f: 'nc' }, { f: 'where', at: 0.62 }],
      v: () => `<div class="tm-intro"><div class="tm-card tm-nc${A(1)} data-f="nc"><span class="tm-ri">${IC.user}</span><b>${L('Не инвестиционный совет')}</b><p>${L('Дневник и калькулятор вашей стратегии. Решения о покупке и продаже — ваши.')}</p></div>
        <div class="tm-list${A(2)} data-f="where">${row(`<span class="tm-pl">${IC.play}</span>`, 'Видео-инструкция · 2 мин', 'Всегда во «Знаниях» и в настройках', '', 3)}</div></div>` }
  ];

  /* ---------- голос телефона ---------- */
  const synth = () => (window.speechSynthesis && window.SpeechSynthesisUtterance ? window.speechSynthesis : null);
  let VOICE = null;
  function pickVoice() {
    const s = synth(); if (!s) return (VOICE = null);
    let vs = []; try { vs = s.getVoices() || []; } catch (e) {}
    const my = vs.filter(v => (UK ? /^uk/i : /^ru/i).test(v.lang || ''));   /* по-украински — только украинский голос, иначе субтитры */
    VOICE = my.find(v => /google/i.test(v.name)) || my.find(v => v.localService) || my[0] || null;
    return VOICE;
  }
  try { const s = synth(); if (s) { s.addEventListener('voiceschanged', pickVoice); pickVoice(); } } catch (e) {}
  const SAY = UK ? [[/\bDCA\b/g, 'ді-сі-ей'], [/\bUSDT\b/g, 'ю-ес-ді-ті'], [/\bBTC\b/g, 'біткоїна'], [/\bETH\b/g, 'ефіру'], [/\bMoneyLife\b/g, 'Мані Лайф']]
    : [[/\bDCA\b/g, 'ди-си-эй'], [/\bUSDT\b/g, 'ю-эс-ди-ти'], [/\bBTC\b/g, 'биткоина'], [/\bETH\b/g, 'эфира'], [/\bMoneyLife\b/g, 'Мани Лайф']];
  const sayText = t => { let s = t; for (const [re, to] of SAY) s = s.replace(re, to); return s.replace(/[«»]/g, '').replace(/\s—\s/g, ', ').replace(/\s+/g, ' ').trim(); };
  const est = t => Math.min(22, Math.max(5, t.length / 15.5 + 1)) * 1000 * SPEED;   /* без голоса — столько, сколько читать субтитры */

  /* ---------- плеер ---------- */
  let P = null;
  function open(from) {
    if (P) return;
    try { if (typeof closeSheets === 'function') closeSheets(); } catch (e) {}
    tPatch({ seen: Date.now(), offer: (tGet() || {}).offer || 'watch' });
    const sound = lsGet(SND, true) !== false;
    const o = document.createElement('div');
    o.id = 'tour'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-labelledby', 'trTitle');
    if (reduced) o.classList.add('tr-still');
    o.innerHTML = `<div class="tr-top"><div class="tr-prog" role="progressbar" aria-label="${L('Сцены')}" aria-valuemin="1" aria-valuemax="${SC.length}">${SC.map((x, i) => `<i data-i="${i}"><b></b></i>`).join('')}</div>
        <button type="button" class="tr-b tr-x" data-tr="close" aria-label="${L('Закрыть видео-инструкцию')}">${IC.x}</button></div>
      <div class="tr-k"><span id="trNum"></span><h2 id="trTitle"></h2></div>
      <div class="tr-stage" id="trStage"><div class="tr-fit" id="trFit"></div></div>
      <p class="tr-sub" id="trSub" aria-live="polite"></p>
      <p class="tr-nov" id="trNoV" hidden>${L('Голоса на этом телефоне нет — идут субтитры')}</p>
      <div class="tr-end" id="trEnd" hidden><button type="button" class="btn ghost" data-tr="again" aria-label="${L('Посмотреть ещё раз')}">${IC.again}<span>${L('Ещё раз')}</span></button><button type="button" class="btn" data-tr="close">${L('Начать')}</button></div>
      <div class="tr-ctl"><button type="button" class="tr-b" data-tr="snd" id="trSnd"></button><button type="button" class="tr-b" data-tr="prev" aria-label="${L('Предыдущая сцена')}">${IC.prev}</button>
        <button type="button" class="tr-b tr-main" data-tr="play" id="trPlay"></button><button type="button" class="tr-b" data-tr="next" aria-label="${L('Следующая сцена')}">${IC.next}</button><span class="tr-b tr-sp" aria-hidden="true"></span></div>`;
    document.body.appendChild(o); document.body.classList.add('tr-lock');
    P = { el: o, i: 0, playing: true, sound, tok: 0, tm: [], t0: 0, dur: 1, fill: 0, from: from || '', back: document.activeElement, iv: 0 };
    window.mlTourOn = true;   /* Орион молчит, пока идёт инструкция (mascot.js) */
    o.addEventListener('click', onClick);
    o.addEventListener('keydown', onKey);
    swipe(o.querySelector('#trStage'));
    window.addEventListener('resize', fit);
    try { if (window.ResizeObserver) { P.ro = new ResizeObserver(() => fit()); P.ro.observe($('trStage')); } } catch (e) {}
    P.iv = setInterval(tickProg, 200);
    try { const c = document.querySelector('.or-cap.on'); if (c) c.click(); } catch (e) {}   /* Орион договаривал — остановить (и живой голос) */
    try { const s = synth(); if (s) s.cancel(); } catch (e) {}
    go(0);
    requestAnimationFrame(() => { o.classList.add('in'); const b = $('trPlay'); if (b) try { b.focus({ preventScroll: true }); } catch (e) {} });
  }
  function close() {
    if (!P) return;
    const p = P; stopRun(); clearInterval(p.iv); P = null; window.mlTourOn = false;
    window.removeEventListener('resize', fit); try { if (p.ro) p.ro.disconnect(); } catch (e) {}
    tPatch({ last: Date.now() });
    p.el.classList.remove('in'); document.body.classList.remove('tr-lock');
    setTimeout(() => p.el.remove(), reduced ? 0 : 220);
    if (p.back && p.back.focus && document.contains(p.back)) try { p.back.focus({ preventScroll: true }); } catch (e) {}
  }
  function stopRun() {
    if (!P) return;
    P.tok++; P.tm.forEach(clearTimeout); P.tm = [];
    try { const s = synth(); if (s && (s.speaking || s.pending)) s.cancel(); } catch (e) {}
  }
  function fit() {
    if (!P) return;
    const st = $('trStage'), f = $('trFit'); if (!st || !f) return;
    const w = st.clientWidth, h = st.clientHeight, k = Math.max(0.5, Math.min(w / 320, h / 568, 1.2));
    f.style.setProperty('--k', k.toFixed(3)); f.style.width = Math.round(320 * k) + 'px'; f.style.height = Math.round(568 * k) + 'px';
  }
  function focusOn(scr, key, tap) {
    const tg = key ? scr.querySelector(`[data-f="${key}"]`) : null;
    scr.querySelectorAll('[data-f]').forEach(e => {
      e.classList.toggle('on', e === tg);
      e.classList.toggle('dim', !!tg && !(e === tg || e.contains(tg) || tg.contains(e)));
    });
    scr.classList.toggle('has-f', !!tg);
    const old = scr.querySelector('.tm-tap'); if (old) old.remove();
    if (tg && tap) { const d = document.createElement('i'); d.className = 'tm-tap'; tg.appendChild(d); }
  }
  function step(scr, s) {
    if (!scr || !scr.isConnected) return;
    if (s.cls != null) { scr.className = 'tr-scr' + (s.cls ? ' ' + s.cls.split(' ').map(c => 'is-' + c).join(' ') : ''); }
    focusOn(scr, s.f, s.tap);
  }
  function go(i, keepPlay) {
    if (!P) return;
    i = Math.max(0, Math.min(SC.length - 1, i)); stopRun();
    const sc = SC[i], fitEl = $('trFit'), last = i === SC.length - 1;
    P.i = i; P.fill = 0; P.t0 = Date.now(); P.dur = est(L(sc.s));
    const old = fitEl.querySelector('.tr-scr');
    const scr = document.createElement('div'); scr.className = 'tr-scr'; scr.setAttribute('aria-hidden', 'true');
    scr.innerHTML = sc.v();
    if (old && !reduced) { old.classList.add('out'); setTimeout(() => old.remove(), 260); } else if (old) old.remove();
    fitEl.appendChild(scr); fit();
    step(scr, sc.st[0]);
    $('trNum').textContent = (i + 1) + ' / ' + SC.length;
    $('trTitle').textContent = L(sc.t);
    $('trSub').textContent = L(sc.s);
    $('trEnd').hidden = !last; fit();
    const pr = P.el.querySelector('.tr-prog'); pr.setAttribute('aria-valuenow', String(i + 1)); pr.setAttribute('aria-valuetext', (i + 1) + ' / ' + SC.length + ' · ' + L(sc.t));
    P.el.querySelectorAll('.tr-prog i').forEach((e, k) => { e.classList.toggle('done', k < i); e.classList.toggle('cur', k === i); e.querySelector('b').style.width = k < i ? '100%' : '0%'; });
    if (keepPlay !== undefined) P.playing = keepPlay;
    ui();
    if (P.playing) run(); else P.fill = 0;
  }
  function run() {
    if (!P) return;
    stopRun();
    const i = P.i, sc = SC[i], tok = P.tok, text = L(sc.s), dur = est(text), scr = $('trFit').querySelector('.tr-scr:not(.out)');
    P.t0 = Date.now(); P.dur = dur; P.fill = 0;
    sc.st.forEach((s, k) => { if (k > 0) P.tm.push(setTimeout(() => { if (P && tok === P.tok) step(scr, s); }, (s.at || 0) * dur)); });
    let fired = false;
    const done = () => {
      if (fired || !P || tok !== P.tok) return; fired = true; P.fill = 1;
      if (i < SC.length - 1) P.tm.push(setTimeout(() => { if (P && tok === P.tok) go(i + 1); }, 700 * SPEED));
      else { P.playing = false; ui(); }
    };
    const s = synth(), v = P.sound && s ? (VOICE || pickVoice()) : null;
    $('trNoV').hidden = !(P.sound && !v);
    if (!v) { P.tm.push(setTimeout(done, dur)); return; }
    try {
      const u = new SpeechSynthesisUtterance(sayText(text));
      u.voice = v; u.lang = v.lang || (UK ? 'uk-UA' : 'ru-RU'); u.rate = 1; u.pitch = 1; u.volume = 1;
      u.onend = () => done();
      u.onerror = e => { if (!P || tok !== P.tok || (e && (e.error === 'interrupted' || e.error === 'canceled'))) return; P.tm.push(setTimeout(done, Math.max(0, dur - (Date.now() - P.t0)))); };
      if (s.speaking || s.pending) s.cancel();
      s.speak(u);
      /* голос не заговорил за 2,5 с (нет разрешения, не загружен) — дальше по таймеру; и в любом случае сцена не зависнет */
      P.tm.push(setTimeout(() => { if (P && tok === P.tok && !fired && !s.speaking) P.tm.push(setTimeout(done, Math.max(0, dur - 2500))); }, 2500));
      P.tm.push(setTimeout(done, dur * 2.2 + 4000));
    } catch (e) { P.tm.push(setTimeout(done, dur)); }
  }
  function tickProg() {
    if (!P) return;
    const cur = P.el.querySelector('.tr-prog i.cur b'); if (!cur) return;
    const f = P.fill ? 1 : P.playing ? Math.min(0.97, (Date.now() - P.t0) / P.dur) : parseFloat(cur.style.width) / 100 || 0;
    cur.style.width = (f * 100).toFixed(1) + '%';
  }
  function ui() {
    if (!P) return;
    const pb = $('trPlay'), sb = $('trSnd'), last = P.i === SC.length - 1;
    const replay = last && !P.playing && P.fill;
    pb.innerHTML = P.playing ? IC.pause : replay ? IC.again : IC.play;
    pb.setAttribute('aria-label', L(P.playing ? 'Пауза' : replay ? 'Посмотреть ещё раз' : 'Продолжить'));
    sb.innerHTML = P.sound ? IC.snd : IC.mute;
    sb.setAttribute('aria-label', L(P.sound ? 'Выключить голос' : 'Включить голос')); sb.setAttribute('aria-pressed', String(!P.sound));
    P.el.querySelector('[data-tr="prev"]').disabled = P.i === 0;
    P.el.querySelector('[data-tr="next"]').disabled = last;
    P.el.classList.toggle('paused', !P.playing);
  }
  function toggle() {
    if (!P) return;
    const last = P.i === SC.length - 1;
    if (!P.playing && last && P.fill) { go(0, true); return; }
    P.playing = !P.playing;
    if (P.playing) run(); else { stopRun(); }
    ui();
  }
  function onClick(e) {
    const b = e.target.closest('[data-tr]'); if (!b || !P) return;
    const a = b.dataset.tr;
    try { if (typeof play === 'function') play('tick'); } catch (x) {}
    if (a === 'close') close();
    else if (a === 'play') toggle();
    else if (a === 'next') go(P.i + 1);
    else if (a === 'prev') go(P.i - 1);
    else if (a === 'again') go(0, true);
    else if (a === 'snd') { P.sound = !P.sound; lsSet(SND, P.sound); if (P.playing) run(); else stopRun(); ui(); $('trNoV').hidden = true; }
  }
  function onKey(e) {
    if (!P) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') go(P.i + 1);
    else if (e.key === 'ArrowLeft') go(P.i - 1);
    else if (e.key === 'Tab') {   /* фокус не уходит из инструкции */
      const f = [...P.el.querySelectorAll('button:not([disabled])')].filter(x => x.offsetParent !== null); if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  }
  function swipe(el) {
    let x0 = null, y0 = 0;
    el.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; });
    el.addEventListener('pointerup', e => { if (x0 == null || !P) return; const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(P.i + (dx < 0 ? 1 : -1)); });
    el.addEventListener('pointercancel', () => { x0 = null; });
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && P && P.playing) { P.playing = false; stopRun(); ui(); } });

  /* ---------- где живёт: строки во «Знаниях» и в настройках, предложение после входа ---------- */
  document.addEventListener('click', e => {
    const t = e.target && e.target.closest ? e.target : null; if (!t) return;
    const b = t.closest('[data-tour]'); if (b && !b.closest('#tour')) { e.preventDefault(); if (b.dataset.tour === 'offer') tPatch({ offer: 'watch', at: Date.now() }); open(b.dataset.tour); return; }
    const l = t.closest('[data-tour-later]'); if (l) { tPatch({ offer: 'later', at: Date.now() }); try { closeSheets(); } catch (x) {} setTimeout(() => { try { toast(L('Видео-инструкция — во «Знаниях» и в настройках')); } catch (x) {} }, 360); }
  });

  /* предложение — один раз: после знакомства (или сразу после входа, если оно пройдено), когда ничего другого на экране нет.
     Карточка «Поставь на главный экран» видна — откладываем до следующего запуска (не больше двух раз). В автотестах выключено, если нет ml-tour-real. */
  let offT = 0, calm = 0, gaveUp = false;
  const realOn = () => { try { return !test || !!localStorage.getItem('ml-tour-real'); } catch (e) { return !test; } };
  function canOffer() {
    if (P || gaveUp || !realOn()) return false;
    if (typeof S === 'undefined' || !S.ready) return false;
    if (!window.mlUser && !window.mlDemo) return false;
    if (document.getElementById('mlAuth')) return false;
    const ob = $('ob'); if (ob && !ob.hidden) return false;
    try { if (typeof obNeed === 'function' && obNeed()) return false; } catch (e) {}
    if (tGet() && tGet().offer) return false;
    if (document.querySelector('.sheet.open')) return false;
    const ts = $('toast'); if (ts && ts.classList.contains('show')) return false;
    const cap = document.querySelector('.or-cap.on'); if (cap) return false;
    return true;
  }
  function offer() {
    const inst = $('inst'), x = tGet() || {};
    if (inst && !inst.hidden && inst.innerHTML && (x.defer || 0) < 2) { tPatch({ defer: (x.defer || 0) + 1 }); gaveUp = true; return; }
    if (!(window.MLX && MLX.open)) { gaveUp = true; return; }
    tPatch({ offer: 'shown', at: Date.now() });
    MLX.open('tour', L('Видео-инструкция'), `<div class="tr-off"><span class="tr-off-i" aria-hidden="true">${PLAY_BADGE}</span><b>${L('Посмотреть, как устроен MoneyLife')}</b>
      <small>${L('2 мин · с голосом и субтитрами')}</small><p>${L('Коротко покажем экраны: где итог и прибыль, как записать покупку и пополнение, как работает лестница докупок. Можно смотреть и без звука.')}</p></div>`,
      `<div class="btnrow"><button type="button" class="btn ghost" data-tour-later>${L('Позже')}</button><button type="button" class="btn" data-tour="offer">${L('Смотреть')}</button></div>`);
  }
  function poll() {
    offT = 0;
    if (gaveUp || (tGet() && tGet().offer)) return;
    if (canOffer()) { calm++; if (calm >= 3) { offer(); return; } } else calm = 0;
    if (performance.now() < 240000) offT = setTimeout(poll, 1000); else gaveUp = true;
  }
  offT = setTimeout(poll, 1500);

  /* ---------- оформление ---------- */
  const CSS = `
body.tr-lock{overflow:hidden}
#tour{position:fixed;inset:0;z-index:120;background:var(--bg);color:var(--fg);display:flex;flex-direction:column;font-family:var(--ui);
  padding:calc(env(safe-area-inset-top,0px) + 10px) 16px calc(env(safe-area-inset-bottom,0px) + 12px);opacity:0;transition:opacity .22s ease}
#tour.in{opacity:1}
#tour.tr-still,#tour.tr-still *{transition:none!important;animation:none!important}
.tr-top{display:flex;align-items:center;gap:10px}
.tr-prog{flex:1;display:flex;gap:4px}
.tr-prog i{flex:1;height:3px;border-radius:2px;background:color-mix(in srgb,var(--fg) 14%,transparent);overflow:hidden}
.tr-prog i b{display:block;height:100%;width:0;background:var(--fg);transition:width .2s linear}
.tr-b{width:48px;height:48px;min-width:48px;border-radius:50%;border:0;background:var(--surface);color:var(--fg);display:grid;place-items:center;cursor:pointer;padding:0}
[data-theme="light"] .tr-b{background:#e9e9ee}
.tr-b svg{width:22px;height:22px}
.tr-b:disabled{opacity:.35;cursor:default}
.tr-b:focus-visible,.tr-end .btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tr-sp{visibility:hidden}
.tr-k{display:flex;align-items:baseline;gap:10px;margin:10px 2px 0}
.tr-k span{font-size:13px;color:var(--mute);font-variant-numeric:tabular-nums;font-weight:500}
.tr-k h2{margin:0;font-size:20px;font-weight:650;letter-spacing:-.02em}
.tr-stage{flex:1;min-height:0;display:grid;place-items:center;margin:10px 0 10px;touch-action:pan-y;overflow:hidden}
.tr-fit{position:relative}
.tr-sub{margin:0 2px;min-height:calc(5 * 1.42em);font-size:16px;line-height:1.42;color:var(--fg);letter-spacing:-.005em}
.tr-nov{margin:4px 2px 0;font-size:12.5px;color:var(--mute)}
.tr-end{display:flex;gap:10px;margin-top:10px}
.tr-end .btn{flex:1;min-height:52px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 10px;white-space:nowrap}
.tr-end .btn svg{width:18px;height:18px}
.tr-ctl{display:flex;align-items:center;justify-content:space-between;margin-top:12px}
.tr-main{width:60px;height:60px;background:var(--btn-bg)!important;color:var(--btn-fg)}
.tr-main svg{width:26px;height:26px}
/* экран-макет: рисуется в размере 320×568 и масштабируется под телефон */
.tr-scr{position:absolute;left:0;top:0;width:320px;height:568px;transform:scale(var(--k,1));transform-origin:0 0;overflow:hidden;border-radius:30px;
  background:var(--bg2);border:1px solid var(--line2);font-size:12px;line-height:1.35;--tc:color-mix(in srgb,var(--fg) 6%,var(--bg2));--tc2:color-mix(in srgb,var(--fg) 11%,var(--bg2));
  transition:opacity .26s ease;animation:trFade .3s ease both}
.tr-scr.out{opacity:0;pointer-events:none}
@keyframes trFade{from{opacity:0}to{opacity:1}}
.tr-scr .a{animation:trIn .5s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--i,0) * 70ms + 80ms)}
@keyframes trIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
:where(.tr-scr [data-f]){position:relative;transition:opacity .35s ease,box-shadow .35s ease;border-radius:14px}
.tr-scr [data-f].dim{opacity:.32}
.tr-scr [data-f].on{box-shadow:0 0 0 2px var(--accent),0 0 0 6px var(--accent-soft)}
.tr-scr .tm-tab[data-f].on{box-shadow:none}
.tr-scr .tm-tab[data-f].on::after{content:"";position:absolute;inset:-4px -8px;border-radius:12px;box-shadow:0 0 0 2px var(--accent)}
.tm-tap{position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:color-mix(in srgb,var(--fg) 22%,transparent);
  border:2px solid color-mix(in srgb,var(--fg) 55%,transparent);pointer-events:none;animation:trTap 1.4s ease-out .2s 2 both}
@keyframes trTap{0%{transform:scale(.4);opacity:0}25%{transform:scale(1);opacity:1}70%{transform:scale(.85);opacity:.9}100%{transform:scale(1.5);opacity:0}}
.tr-still .tm-tap{opacity:1}
.tm-top{display:flex;align-items:center;gap:6px;padding:16px 16px 4px}
.tm-wm{font-family:"Sora",var(--ui);font-weight:800;font-size:15px;letter-spacing:-.035em;margin-right:auto}
.tm-wm span{color:var(--mute);font-weight:500}
.tm-wm.big{font-size:34px;display:block}
.tm-ib{width:26px;height:26px;border-radius:50%;background:var(--tc2);display:inline-block}
.tm-hero{margin:8px 12px 0;padding:6px 6px 10px}
.tm-l{color:var(--mute);font-size:11.5px;font-weight:500}
.tm-bal{font-size:34px;font-weight:700;letter-spacing:-.04em;line-height:1.05;margin-top:2px}
.tm-sub{margin-top:6px;color:var(--mute)}
.tm-pos{color:var(--pos)}.tm-neg{color:var(--neg)}
.tm-chip{display:inline-block;margin-top:8px;padding:3px 8px;border-radius:999px;background:var(--tc);font-weight:600;font-size:11px}
.tm-orb{position:absolute;right:8px;top:6px;width:58px;height:58px;border-radius:50%;display:grid;place-items:center}
.tm-orb i{width:44px;height:44px;border-radius:50%;background:color-mix(in srgb,var(--accent) 78%,var(--bg2));box-shadow:0 0 0 7px color-mix(in srgb,var(--accent) 14%,transparent);animation:trBreath 3.2s ease-in-out infinite}
@keyframes trBreath{50%{transform:scale(.93)}}
.tm-qa{display:flex;justify-content:space-around;margin:4px 12px 0;padding:6px 0}
.tm-q{display:flex;flex-direction:column;align-items:center;gap:5px;font-size:10.5px;font-weight:500;padding:4px;border-radius:12px}
.tm-q i{width:38px;height:38px;border-radius:50%;background:var(--tc2);display:grid;place-items:center}
.tm-q i svg{width:17px;height:17px}
.tm-q:first-child i{background:var(--btn-bg);color:var(--btn-fg)}
.tm-tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 12px 0}
.tm-tile{background:var(--tc);border-radius:14px;padding:10px 11px;display:flex;flex-direction:column;gap:3px}
.tm-tile small{color:var(--mute);font-size:10.5px}.tm-tile b{font-size:15px;letter-spacing:-.02em}
.tm-tabs{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:space-around;padding:9px 6px 14px;background:var(--bg2);border-top:1px solid var(--line)}
.tm-tab{display:flex;flex-direction:column;align-items:center;gap:3px;color:var(--dim);font-size:10px;position:relative}
.tm-tab svg{width:18px;height:18px}.tm-tab.on{color:var(--fg);font-weight:600}
.tm-sheet{position:absolute;left:0;right:0;bottom:0;background:var(--bg2);border-radius:22px 22px 0 0;padding:8px 14px 18px;display:flex;flex-direction:column;gap:9px;
  box-shadow:0 -1px 0 var(--line2);transform:translateY(105%);transition:transform .55s cubic-bezier(.2,.8,.2,1)!important;z-index:3}
.tr-scr.is-up .tm-sheet{transform:none}
.tr-scr.is-up::before{content:"";position:absolute;inset:0;background:color-mix(in srgb,#000 35%,transparent);z-index:2;animation:trFade .4s ease both}
.tm-grab{width:34px;height:4px;border-radius:2px;background:var(--line2);align-self:center}
.tm-sh-h{display:flex;align-items:center;justify-content:space-between}
.tm-sh-h b{font-size:15px;font-weight:650}
.tm-sh-h.tm-big{padding:18px 4px 6px}.tm-sh-h.tm-big b{font-size:19px}
.tm-seg{display:flex;background:var(--tc);border-radius:11px;padding:3px}
.tm-seg i{flex:1;text-align:center;font-style:normal;padding:7px 4px;border-radius:9px;font-weight:600;font-size:11px;color:var(--mute)}
.tm-seg i.on{background:var(--btn-bg);color:var(--btn-fg)}
.tm-seg.sm{width:78px;flex:none}.tm-seg.sm i{padding:5px 2px}
.tm-f2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.tm-fld{display:flex;flex-direction:column;gap:3px;background:var(--tc);border-radius:11px;padding:7px 10px}
.tm-fld small{color:var(--mute);font-size:10px}.tm-fld b{font-size:13.5px;font-weight:600}
.tm-cur::after{content:"";display:inline-block;width:1.5px;height:13px;background:var(--accent);margin-left:2px;vertical-align:-2px;animation:trBlink 1s steps(1) infinite}
@keyframes trBlink{50%{opacity:0}}
.tm-slide{display:flex;align-items:center;gap:10px;height:44px;border-radius:999px;background:var(--btn-bg);padding:0 5px;color:var(--btn-fg);font-weight:650}
.tm-slide i{width:34px;height:34px;border-radius:50%;background:var(--btn-fg);color:var(--btn-bg);display:grid;place-items:center}.tm-slide i svg{width:16px;height:16px}
.tm-slide b{flex:1;text-align:center;margin-right:40px}
.tm-btn{display:block;text-align:center;padding:12px;border-radius:13px;background:var(--btn-bg);color:var(--btn-fg);font-weight:650}
.tm-btn.ghost{background:none;border:1px solid var(--line2);color:var(--fg)}
.tm-btns{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.tm-split{background:var(--tc);border-radius:12px;padding:10px}
.tm-sbar{display:flex;gap:3px;height:8px;border-radius:4px;overflow:hidden}
.tm-sbar i{width:0;background:var(--fg);transition:width .9s cubic-bezier(.2,.7,.2,1) .15s}
.tm-sbar i+i{background:color-mix(in srgb,var(--fg) 35%,transparent)}
.tr-scr.is-sp .tm-sbar i,.tr-still .tm-sbar i{width:var(--w)}
.tm-sl{display:flex;justify-content:space-between;margin-top:8px}
.tm-sl span{display:flex;flex-direction:column}.tm-sl span+span{text-align:right}
.tm-sl small{color:var(--mute)}
.tm-pad{padding:6px 14px 0;display:flex;flex-direction:column;gap:9px}
.tm-h{font-size:14px;font-weight:650;display:flex;justify-content:space-between;align-items:baseline;margin-top:4px}
.tm-h small{font-weight:500;color:var(--mute);font-size:11px}
.tm-search{background:var(--tc);border-radius:12px;padding:9px 12px;color:var(--dim)}
.tm-coin{display:flex;align-items:center;gap:9px;padding:9px 8px;border-radius:12px}
.tm-cl{background:var(--tc);border-radius:16px;padding:4px}
.tm-ch{display:flex;justify-content:space-between;padding:8px 10px 2px;color:var(--mute);font-size:10.5px}.tm-ch span:first-child{flex:1}.tm-ch span+span{width:74px;text-align:right}
.tm-cr{width:74px}.tm-mut{color:var(--mute)}
.tm-front{display:flex;flex-direction:column;gap:3px;background:var(--tc);border-radius:16px;padding:12px;backface-visibility:hidden;transition:transform .6s cubic-bezier(.3,.7,.2,1)}
.tm-front small{color:var(--mute);font-size:10.5px}.tm-front .tm-pos{color:var(--pos)}.tm-front .tm-big{font-size:24px;letter-spacing:-.03em}
.tm-spark{width:100%;height:50px;margin-top:4px}.tm-spark path{fill:none;stroke:var(--fg);stroke-width:1.6;vector-effect:non-scaling-stroke}.tm-spark path.avg{stroke:var(--mute);stroke-dasharray:4 4}
.tm-mos{display:flex;gap:6px}.tm-mo{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;border:1px solid var(--line2);border-radius:12px;padding:7px 4px}.tm-mo small{color:var(--mute);font-size:10px}.tm-mo .tm-pos{color:var(--pos)}.tm-mo.cur{border-color:var(--fg)}
.tm-alloc{margin:8px 12px 0;padding:10px 12px;gap:7px}
.tm-cb{width:30px;height:30px;border-radius:50%;background:var(--c);color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px}
.tm-cc,.tm-cr{display:flex;flex-direction:column;gap:2px}.tm-cc{flex:1}.tm-cr{text-align:right}
.tm-cc b,.tm-cr b{font-size:13px}.tm-cc small{color:var(--mute)}
.tm-flip{position:relative;perspective:700px}
.tm-back{position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr;align-content:center;gap:12px 10px;background:var(--tc2);border-radius:16px;padding:12px 14px;
  backface-visibility:hidden;transform:rotateY(180deg);transition:transform .6s cubic-bezier(.3,.7,.2,1)}
.tm-back span{display:flex;flex-direction:column;gap:2px}.tm-back small{color:var(--mute);font-size:10px}.tm-back b{font-size:14px}
.tr-scr.is-flip .tm-flip .tm-front{transform:rotateY(-180deg)}
.tr-scr.is-flip .tm-back{transform:none}
.tr-still .tm-back{transform:none;opacity:0}.tr-still .is-flip .tm-back{opacity:1}
.tm-card{background:var(--tc);border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:9px}
.tm-abar{display:flex;gap:3px;height:10px;border-radius:5px;overflow:hidden}.tm-abar i{width:var(--w);background:var(--c)}
.tm-al{display:flex;gap:12px;font-size:11px;color:var(--mute)}.tm-al i{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--c);margin-right:5px}
.tm-gauge{padding:6px 2px 0}
.tm-gt{position:relative;height:8px;border-radius:4px;background:var(--tc2)}
.tm-gm{position:absolute;top:50%;left:6%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:var(--fg);box-shadow:0 0 0 3px var(--bg2);transition:left 1.8s cubic-bezier(.3,.6,.2,1) .1s}
.tr-scr.is-go .tm-gm,.tr-still .tm-gm{left:32%}
.tm-gs{position:relative;height:30px}
.tm-gs span{position:absolute;left:var(--x);top:0;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:4px}
.tm-gs span i{width:2px;height:8px;background:var(--line2);margin-top:-8px}
.tm-gs small{color:var(--mute);font-size:9.5px;white-space:nowrap}
.tm-note{margin:0;color:var(--mute);font-size:11px}
.tm-meter{height:6px;border-radius:3px;background:var(--tc2);overflow:hidden}.tm-meter i{display:block;height:100%;width:var(--w);background:var(--fg);opacity:.8}
.tm-list{display:flex;flex-direction:column;gap:6px}
.tm-row{display:flex;align-items:center;gap:10px;background:var(--tc);border-radius:14px;padding:10px 12px}
.tm-ri{width:30px;height:30px;border-radius:50%;background:var(--tc2);display:grid;place-items:center;flex:none}.tm-ri svg{width:15px;height:15px}
.tm-rc{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}.tm-rc b{font-size:12.5px;font-weight:600}.tm-rc small{color:var(--mute);font-size:10.5px}
.tm-chev{color:var(--dim);font-size:16px}
.tm-amt{font-size:12.5px}
.tm-n{font-size:12px}
.tm-pl{width:20px;height:20px;display:grid;place-items:center}.tm-pl svg{width:14px;height:14px}
.tm-sw{width:36px;height:22px;border-radius:11px;background:var(--line2);position:relative;flex:none}
.tm-sw i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff}
.tm-sw.on{background:var(--pos)}.tm-sw.on i{left:17px}
.tm-keys{opacity:.35;transition:opacity .4s ease}.tm-kin{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.tm-keys span{background:var(--tc);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:3px}
.tm-keys svg{width:16px;height:16px;color:var(--dim);transition:color .4s ease}
.tm-keys small{color:var(--mute);font-size:10.5px}
.tr-scr.is-k .tm-keys{opacity:1}.tr-scr.is-k .tm-keys svg{color:var(--pos)}
.tm-sig{opacity:0;transform:translateY(8px);transition:opacity .45s ease,transform .45s ease}.tm-si{background:var(--tc2);border-radius:14px;padding:11px 12px;display:flex;flex-direction:column;gap:3px}
.tm-sig small{color:var(--mute)}
.tr-scr.is-sig .tm-sig{opacity:1;transform:none}
.tm-cap{position:absolute;left:14px;right:14px;bottom:66px;opacity:0;transform:translateY(8px);transition:opacity .4s ease,transform .4s ease}
.tm-ci{display:flex;align-items:center;gap:8px;background:var(--tc2);border-radius:16px;padding:10px 12px}
.tm-ci>i{width:10px;height:10px;border-radius:50%;background:var(--accent);flex:none}
.tm-ci>span:not(.tm-mic){color:var(--fg)}.tm-ci>b{flex:none}
.tr-scr.is-cap .tm-cap:not(.tm-ask){opacity:1;transform:none}
.tm-ask{bottom:146px}
.tr-scr.is-ask .tm-ask{opacity:1;transform:none}
.tm-mic{width:26px;height:26px;border-radius:50%;background:var(--btn-bg);color:var(--btn-fg);display:grid;place-items:center;flex:none}.tm-mic svg{width:14px;height:14px}
.tm-intro{height:100%;box-sizing:border-box;padding:24px 18px 40px;display:flex;flex-direction:column;justify-content:center;gap:26px}
.tm-brand p{margin:8px 0 0;color:var(--mute);font-size:13px;max-width:240px}
.tm-dca{background:var(--tc);border-radius:16px;padding:12px;position:relative;display:flex;flex-direction:column;gap:8px}
.tm-bars{display:flex;align-items:flex-end;gap:8px;height:56px}
.tm-bars i{flex:1;height:100%;display:flex;align-items:flex-end}
.tm-bars b{display:block;width:100%;height:46%;border-radius:4px;background:var(--fg);opacity:.85;animation:trBar .6s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--i) * 110ms + 200ms);transform-origin:bottom}
@keyframes trBar{from{transform:scaleY(0)}to{transform:none}}
.tm-line{position:absolute;left:12px;right:12px;top:12px;width:calc(100% - 24px);height:56px;overflow:visible}
.tm-line path{fill:none;stroke:var(--accent);stroke-width:2;stroke-dasharray:1;stroke-dashoffset:1;animation:trDraw 1.6s ease .4s forwards;vector-effect:non-scaling-stroke}
.tr-still .tm-line path{stroke-dashoffset:0}
@keyframes trDraw{to{stroke-dashoffset:0}}
.tm-dca small{color:var(--mute);font-size:10.5px}
.tm-nc{align-items:flex-start;padding:18px 16px}.tm-nc b{font-size:19px;letter-spacing:-.02em}.tm-nc p{margin:0;color:var(--mute);font-size:13.5px;line-height:1.45}
.tm-seg2{margin-top:6px}
/* предложение после входа */
.tr-off{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:4px 2px}
.tr-off-i{width:52px;height:52px;border-radius:50%;background:var(--btn-bg);color:var(--btn-fg);display:grid;place-items:center;margin-bottom:6px}
.tr-off-i svg{width:22px;height:22px;margin-left:3px}
.tr-off b{font-size:18px;font-weight:650;letter-spacing:-.02em}
.tr-off small{color:var(--mute);font-size:13px}
.tr-off p{margin:6px 0 0;color:var(--mute);line-height:1.5}
.tr-row-i{color:var(--fg)}.tr-row-i svg{margin-left:2px}
@media (prefers-reduced-motion:reduce){#tour,#tour *{transition:none!important;animation:none!important}.tm-back{transform:none!important;opacity:0}.is-flip .tm-back{opacity:1}}
@media (max-height:700px){.tr-sub{font-size:14.5px;min-height:calc(4 * 1.42em)}.tr-k h2{font-size:18px}.tr-ctl{margin-top:8px}}
`;
  if (!document.getElementById('tour-css')) { const st = document.createElement('style'); st.id = 'tour-css'; st.textContent = CSS; document.head.appendChild(st); }

  window.mlTour = {
    open, close, badge: PLAY_BADGE,
    debug: {
      state: () => P ? { open: true, i: P.i, n: SC.length, playing: P.playing, sound: P.sound, voice: !!(P.sound && synth() && VOICE), sub: $('trSub').textContent, title: $('trTitle').textContent,
        fill: P.fill, prog: [...P.el.querySelectorAll('.tr-prog i')].map(e => e.classList.contains('done') ? 1 : e.classList.contains('cur') ? 0.5 : 0) } : { open: false, n: SC.length },
      speed: k => { SPEED = +k || 1; }, go: i => go(i), scenes: () => SC.map(s => ({ t: L(s.t), s: L(s.s) })),
      total: () => SC.reduce((a, s) => a + Math.min(22, Math.max(5, L(s.s).length / 15.5 + 1)) + 0.7, 0),
      say: t => sayText(t), offer: () => offer(), canOffer: () => canOffer(),
      /* все шаги подсветки текущей сцены сразу — для скриншотов */
      steps: () => { if (!P) return; const scr = $('trFit').querySelector('.tr-scr:not(.out)'), st = SC[P.i].st; st.forEach(x => step(scr, x)); const lastF = st[st.length - 1]; focusOn(scr, lastF.f, false); }
    }
  };
})();
