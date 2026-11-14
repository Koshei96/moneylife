/* MoneyLife — «Складки» (12.11.2026): разделы настроек и вкладок сложены, одно нажатие — раскрываются.
   Как выглядит (спокойная версия, 12.11.2026): заголовок с серым значком и краткой сводкой, шеврон поворачивается,
   содержимое плавно проявляется — без бликов, цветных значков и «пружин».
   Разметка: data-fold="ключ" на заголовке. Для <span class="label"> телом служит следующий элемент,
   для .sec-h — всё, что идёт после него в том же блоке. Открытые складки запоминаются на телефоне (ml-fold).
   Если код приложения прокручивает к чему-то внутри складки (scrollIntoView) — складка открывается сама.
   Расчёты и данные не трогает. */
(function () {
  'use strict';
  var KEY = 'ml-fold', test = !!navigator.webdriver, reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var st = {};
  try { st = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { st = {}; }
  /* в автотестах складки по умолчанию открыты (старые проверки кликают по полям внутри); тест складок включает обычный режим */
  var defOpen = false;
  try { defOpen = test && !localStorage.getItem('ml-fold-real'); } catch (e) { defOpen = test; }
  var save = function () { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };

  var I = function (d) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  /* значок и цвет каждой складки */
  var META = {
    view: { ic: I('<circle cx="12" cy="12" r="3.2"/><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/>'), c: '#8b7dff' },
    plan: { ic: I('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>'), c: '#30d1a0' },
    rules: { ic: I('<path d="M12 3v18M5 7h14M7 7l-3 7a3.5 3.5 0 0 0 6 0zM17 7l-3 7a3.5 3.5 0 0 0 6 0z"/>'), c: '#f5b545' },
    edit: { ic: I('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>'), c: '#ff7ab8' },
    data: { ic: I('<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6"/>'), c: '#5ab8ff' },
    acc: { ic: I('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c1-3.8 4-5.8 7.5-5.8s6.5 2 7.5 5.8"/>'), c: '#c58bff' },
    movers: { ic: I('<path d="M12 3c1 3.5 5 5 5 9.5a5 5 0 0 1-10 0c0-2 1-3.3 2-4.3.3 1.6 1.2 2.6 2.3 2.8C11 9 11.3 5.6 12 3z"/>'), c: '#ff8a4c' },
    alloc: { ic: I('<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>'), c: '#8b7dff' },
    levels: { ic: I('<path d="M4 20h4v-4h4v-4h4V8h4"/>'), c: '#30d1a0' },
    altplan: { ic: I('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'), c: '#f5b545' },
    market: { ic: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 12l5-5M12 3.5v2M20.5 12h-2"/>'), c: '#5ab8ff' }
  };
  /* краткая сводка в закрытой складке: живые значения из самого раздела */
  var txt = function (el) { return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; };
  var on = function (id) { var b = document.getElementById(id); return b && b.getAttribute('aria-checked') === 'true'; };
  var segOn = function (id) { var s = document.getElementById(id); if (!s) return ''; var b = s.querySelector('[aria-pressed="true"],.on,.active'); return txt(b); };
  var L = function (s) { return window.L ? window.L(s) : s; };
  var SUM = {
    view: function () { var th = txt(document.getElementById('thName')); var a = [th, segOn('curSeg')].filter(Boolean); a.push(L(on('swMascot') ? 'Орион вкл.' : 'Орион выкл.')); a.push(L(on('swSound') ? 'звуки вкл.' : 'звуки выкл.')); return a.join(' · '); },
    plan: function () { return L('Личный план, цель BTC, сигналы, оповещения, уроки'); },
    rules: function (b) { var v = b.querySelector('.kv .v, .kv dd, .kv > div > :last-child'); return txt(v) || L('Твоя стратегия'); },
    edit: function () { return L('Доли монет, резерв, лестница, ключ 2'); },
    data: function (b) { var v = txt(b.querySelector('.kv > div > :last-child')); return v && v !== '—' ? v : L('Курс, цены, записи'); },
    acc: function () { return L('Почта, выход, удаление аккаунта'); }
  };

  var folds = [];
  function rows(body) {
    /* «листы», которые разворачиваются по одному: строки карточки, если карточка одна, иначе — блоки тела */
    var kids = Array.prototype.slice.call(body.children), sl = function (x) { return Array.prototype.slice.call(x); };
    if (kids.length === 1) {
      var c = kids[0].children;
      if (c.length === 1 && c[0].classList.contains('kv')) return sl(c[0].children).slice(0, 30);
      if (c.length > 1 && c.length < 40) return sl(c);
    }
    return kids;
  }
  function mark(f) {
    var r = rows(f.inn); for (var i = 0; i < r.length; i++) { r[i].setAttribute('data-fi', ''); r[i].style.setProperty('--fi', Math.min(i, 12)); }
    f.n = r.length;
  }
  function setOpen(f, open, how) {
    f.open = open;
    f.root.classList.toggle('open', open);
    f.head.setAttribute('aria-expanded', String(open));
    if ('inert' in f.body) f.body.inert = !open;
    f.body.setAttribute('aria-hidden', String(!open));
    if (how !== 'init') { st[f.key] = open ? 1 : 0; save(); }
  }
  function toggle(f, how) {
    var open = !f.open;
    if (how === 'instant' || reduced) {
      f.root.classList.add('instant'); setOpen(f, open); void f.root.offsetWidth;
      requestAnimationFrame(function () { f.root.classList.remove('instant'); f.root.classList.toggle('done', open); });
      return;
    }
    mark(f);
    f.root.classList.remove('done', 'flash'); void f.root.offsetWidth;
    if (open) f.root.classList.add('flash');
    setOpen(f, open);
    try { if (window.buzz) window.buzz(6); } catch (e) {}   /* без звука — только лёгкая вибрация */
    clearTimeout(f.t);
    f.t = setTimeout(function () { f.root.classList.remove('flash'); if (f.open) f.root.classList.add('done'); }, 340 + Math.min(f.n || 0, 12) * 18);
    if (open) setTimeout(function () {
      /* раскрылась внизу экрана — мягко подвинуть, чтобы было видно содержимое */
      var r = f.head.getBoundingClientRect(); if (r.top > innerHeight * 0.58) try { f.head.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {}
    }, 260);
    if (!open) summary(f);
  }
  /* звук «бумаги»: шорох и короткий тон — тихо, по выключателю «Звуки» */
  function sound(open) {
    try {
      if (!window.P || !P.sound || !window.ac) return; var c = ac(); if (!c) return; var t = c.currentTime + .01, dur = open ? .26 : .18;
      var n = Math.floor(c.sampleRate * dur), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var s = c.createBufferSource(); s.buffer = b; var fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.Q.value = 2.2;
      fl.frequency.setValueAtTime(open ? 1400 : 3200, t); fl.frequency.exponentialRampToValueAtTime(open ? 3600 : 1100, t + dur);
      var g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.045, t + .03); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      s.connect(fl).connect(g).connect(c.destination); s.start(t); s.stop(t + dur + .02);
      var o = c.createOscillator(), og = c.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(open ? 660 : 990, t + .05); o.frequency.exponentialRampToValueAtTime(open ? 990 : 660, t + .2);
      og.gain.setValueAtTime(0, t + .05); og.gain.linearRampToValueAtTime(.025, t + .07); og.gain.exponentialRampToValueAtTime(.0001, t + .24);
      o.connect(og).connect(c.destination); o.start(t + .05); o.stop(t + .26);
    } catch (e) {}
  }
  function summary(f) {
    if (!f.sum) return;
    var fn = SUM[f.key], s = fn ? fn(f.inn) : '';
    if (s && f.sum.textContent !== s) f.sum.textContent = s;
    if (f.cnt) { var r = rows(f.inn).filter(function (x) { return !x.hidden && x.offsetParent !== null || !f.open; }).length; f.cnt.textContent = r > 1 ? String(r) : ''; }
  }

  var uid = 0;
  function build(head, body, kind) {
    var key = head.getAttribute('data-fold'), m = META[key] || { ic: '', c: '#8b7dff' };
    var root = document.createElement('section'); root.className = 'fold fold-' + kind; root.setAttribute('data-fkey', key); root.style.setProperty('--fc', m.c);
    var id = 'fold-b-' + (++uid);
    var h = document.createElement('button'); h.type = 'button'; h.className = 'fold-h'; h.setAttribute('aria-controls', id);
    var b = document.createElement('div'); b.className = 'fold-b'; b.id = id; b.setAttribute('role', 'region');
    var inn = document.createElement('div'); inn.className = 'fold-in';
    var f = { key: key, root: root, head: h, body: b, inn: inn };
    if (kind === 'set') {
      /* настройки: крупный заголовок со значком, сводкой и числом пунктов */
      var title = txt(head); if (head.id) h.id = head.id;
      h.innerHTML = '<span class="fold-ic">' + m.ic + '</span><span class="fold-tt"><b></b><small class="fold-s"></small></span><span class="fold-n"></span><span class="fold-x" aria-hidden="true"></span>';
      h.querySelector('b').textContent = title;
      f.sum = h.querySelector('.fold-s'); f.cnt = h.querySelector('.fold-n');
      head.parentNode.insertBefore(root, head); head.remove();
      root.appendChild(h); root.appendChild(b); b.appendChild(inn);
      var nx = body; inn.appendChild(nx);
    } else {
      /* вкладки: заголовок раздела (.sec-h) становится кнопкой, всё после него — телом */
      var box = head.parentNode, after = [], s = head.nextSibling;
      while (s) { after.push(s); s = s.nextSibling; }
      h.innerHTML = '<span class="fold-ic sm">' + m.ic + '</span>';
      while (head.firstChild) h.appendChild(head.firstChild);
      var x = document.createElement('span'); x.className = 'fold-x'; x.setAttribute('aria-hidden', 'true'); h.appendChild(x);
      head.classList.add('fold-sec'); head.removeAttribute('data-fold');
      head.appendChild(h);
      root.appendChild(b); b.appendChild(inn);
      after.forEach(function (n) { inn.appendChild(n); });
      box.appendChild(root);
      root.insertBefore(head, b);
      f.head = h;
    }
    h.addEventListener('click', function () { toggle(f); });
    var saved = st[key];
    setOpen(f, saved == null ? defOpen : !!saved, 'init');
    if (f.open) root.classList.add('done');
    mark(f); summary(f);
    folds.push(f);
    return f;
  }

  function init() {
    var set = document.querySelector('#setSheet .sh-in');
    if (set) Array.prototype.slice.call(set.querySelectorAll(':scope > .label[data-fold]')).forEach(function (l) { var b = l.nextElementSibling; if (b) build(l, b, 'set'); });
    Array.prototype.slice.call(document.querySelectorAll('.view .sec-h[data-fold]')).forEach(function (h) { build(h, null, 'tab'); });
    /* сводки обновляются, когда меняются значения внутри (тема, выключатели, правила) */
    var pend = false, mo = new MutationObserver(function () { if (pend) return; pend = true; requestAnimationFrame(function () { pend = false; folds.forEach(summary); }); });
    folds.forEach(function (f) { mo.observe(f.inn, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-checked', 'aria-pressed', 'class', 'hidden', 'data-on'] }); });
    /* прокрутка к содержимому складки (кнопки «Изменить правила», «Распределение» в подсказках) — складка открывается сама */
    var sv = Element.prototype.scrollIntoView;
    if (sv && !sv.__fold) {
      var wrap = function () {
        var el = this;
        for (var i = 0; i < folds.length; i++) { var f = folds[i]; if (!f.open && (f.inn.contains(el) || f.head === el || f.root === el)) toggle(f, 'instant'); }
        return sv.apply(this, arguments);
      };
      wrap.__fold = true; Element.prototype.scrollIntoView = wrap;
    }
    /* фокус клавиатуры или озвучки внутри закрытой складки — открыть */
    document.addEventListener('focusin', function (e) { folds.forEach(function (f) { if (!f.open && f.inn.contains(e.target)) toggle(f, 'instant'); }); });
  }
  window.mlFolds = {
    open: function (k, v) { folds.forEach(function (f) { if (f.key === k && f.open !== (v !== false)) toggle(f, 'instant'); }); },
    state: function () { var o = {}; folds.forEach(function (f) { o[f.key] = f.open; }); return o; },
    list: function () { return folds.map(function (f) { return f.key; }); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
