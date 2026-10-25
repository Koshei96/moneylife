/* MoneyLife — прослойка для самостоятельной версии.
   Даёт приложению тот же интерфейс, что и в Claude:
   claude.use('db')  → документы в Supabase (таблица docs) с живыми обновлениями;
   claude.use('mcp') → цены и графики напрямую с CoinGecko.
   Вход — почта и пароль (Supabase Auth). */
(function () {
  'use strict';
  const CFG = window.ML_CONFIG || {};
  window.ML_STANDALONE = true;

  /* ---------- Supabase ---------- */
  let sb = null, uid = null;
  const ready = new Promise(res => { window.__mlAuthed = res; });

  function client() {
    if (sb) return sb;
    if (!window.supabase || !CFG.supabaseUrl || !CFG.supabaseKey) return null;
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ml-auth' }
    });
    return sb;
  }

  /* локальная копия всех документов пользователя: Map('col/id' → data) */
  const cache = new Map();
  const listeners = new Set();
  let loaded = false;
  const key = (c, id) => c + '/' + id;
  const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
  function emit() { for (const l of [...listeners]) { try { l(); } catch (e) { console.error(e); } } }

  async function loadAll() {
    const c = client();
    let from = 0; const page = 1000; cache.clear();
    for (;;) {
      const { data, error } = await c.from('docs').select('col,id,data').range(from, from + page - 1);
      if (error) throw error;
      for (const r of data) cache.set(key(r.col, r.id), r.data || {});
      if (data.length < page) break;
      from += page;
    }
    loaded = true; emit();
    c.channel('docs-' + uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: 'owner=eq.' + uid }, p => {
        const row = p.new && p.new.col ? p.new : p.old;
        if (!row || !row.col) return;
        if (p.eventType === 'DELETE') cache.delete(key(row.col, row.id));
        else cache.set(key(row.col, row.id), p.new.data || {});
        emit();
      })
      .subscribe();
  }

  const genId = () => {
    const a = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = '';
    const r = crypto.getRandomValues(new Uint8Array(20)); for (const b of r) s += a[b % a.length]; return s;
  };

  async function writeSet(c, id, data) {
    cache.set(key(c, id), clone(data)); emit();
    const { error } = await client().from('docs').upsert({ owner: uid, col: c, id, data, updated_at: new Date().toISOString() }, { onConflict: 'owner,col,id' });
    if (error) throw error;
  }
  async function writeUpdate(c, id, patch) {
    const cur = cache.get(key(c, id)) || {};
    const next = Object.assign({}, cur);
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v && typeof v === 'object' && v.__delete__ === true) delete next[k]; else next[k] = clone(v);
    }
    cache.set(key(c, id), next); emit();
    const { error } = await client().rpc('doc_merge', { p_col: c, p_id: id, p_patch: patch });
    if (error) throw error;
  }
  async function writeDelete(c, id) {
    cache.delete(key(c, id)); emit();
    const { error } = await client().from('docs').delete().match({ owner: uid, col: c, id });
    if (error) throw error;
  }

  function docRef(path) {
    const [c, id] = path.split('/');
    return {
      id,
      async get() { const d = cache.get(key(c, id)); return { id, exists: d !== undefined, data: () => clone(d) }; },
      set: d => writeSet(c, id, d),
      update: d => writeUpdate(c, id, d),
      delete: () => writeDelete(c, id),
      onSnapshot(cb) {
        let last;
        const fire = () => {
          if (!loaded) return;
          const d = cache.get(key(c, id)), s = JSON.stringify(d);
          if (s === last) return; last = s;
          cb({ id, exists: d !== undefined, data: () => clone(d) });
        };
        listeners.add(fire); fire();
        return () => listeners.delete(fire);
      }
    };
  }

  function collRef(c, opts) {
    opts = opts || {};
    const q = {
      limit: n => collRef(c, Object.assign({}, opts, { limit: n })),
      orderBy: (f, dir) => collRef(c, Object.assign({}, opts, { order: [f, dir || 'asc'] })),
      doc: id => docRef(c + '/' + (id || genId())),
      async add(d) { const id = genId(); await writeSet(c, id, d); return { id }; },
      onSnapshot(cb) {
        let last;
        const fire = () => {
          if (!loaded) return;
          let rows = [];
          for (const [k, v] of cache) if (k.startsWith(c + '/') && k.indexOf('/', c.length + 1) < 0) rows.push({ id: k.slice(c.length + 1), v });
          if (opts.order) {
            const [f, dir] = opts.order, m = dir === 'desc' ? -1 : 1;
            rows.sort((a, b) => String(a.v[f] ?? '').localeCompare(String(b.v[f] ?? '')) * m);
          }
          if (opts.limit) rows = rows.slice(0, opts.limit);
          const s = JSON.stringify(rows); if (s === last) return; last = s;
          cb({ docs: rows.map(r => ({ id: r.id, data: () => clone(r.v) })), size: rows.length });
        };
        listeners.add(fire); fire();
        return () => listeners.delete(fire);
      }
    };
    return q;
  }
  const dbApi = { doc: docRef, collection: c => collRef(c) };

  /* ---------- цены — CoinGecko, история цены — Binance (запасной вариант — CoinGecko) ---------- */
  const CG = 'https://api.coingecko.com/api/v3';
  const hdr = () => (CFG.coingeckoKey ? { 'x-cg-demo-api-key': CFG.coingeckoKey } : {});
  const mem = new Map(), inflight = new Map(), LS = 'cg3:';
  /* прошлые версии кэша — убираем */
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && (k.startsWith('cg:') || k.startsWith('cg2:'))) localStorage.removeItem(k); } } catch (e) {}
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function fetchT(url, ms, opts) {
    const ac = typeof AbortController === 'function' ? new AbortController() : null;
    const tm = ac ? setTimeout(() => ac.abort(), ms) : 0;
    try { return await fetch(url, Object.assign({}, opts || {}, { signal: ac ? ac.signal : undefined })); }
    finally { clearTimeout(tm); }
  }
  /* CoinGecko без ключа даёт ~10–30 запросов в минуту на адрес — запросы идут по очереди с паузой */
  let cgLast = 0, cgChain = Promise.resolve();
  function cgSlot(gap) {
    const p = cgChain.then(async () => { const w = cgLast + gap - Date.now(); if (w > 0) await sleep(w); cgLast = Date.now(); });
    cgChain = p.catch(() => {});
    return p;
  }
  async function cgJson(url) {
    for (let a = 0; ; a++) {
      await cgSlot(a ? 6000 : 1500);
      let err;
      try {
        const r = await fetchT(url, 15000, { headers: hdr() });
        if (r.ok) return await r.json();
        err = new Error('CoinGecko ' + r.status); err.code = r.status === 429 ? 'rate_limited' : 'tool_error'; err.retryable = r.status === 429 || r.status >= 500;
      } catch (e) { err = e; err.retryable = true; }
      if (a >= 1 || !err.retryable) throw err;
    }
  }
  /* кэш в памяти и на телефоне; staleOk — при сбое отдать прошлые данные */
  function cached(key, ttl, load, staleOk) {
    const now = Date.now();
    let m = mem.get(key);
    if (!m) { try { m = JSON.parse(localStorage.getItem(LS + key) || 'null'); if (m) mem.set(key, m); } catch (e) {} }
    if (m && now - m.at < ttl) return Promise.resolve(m);
    if (inflight.has(key)) return inflight.get(key);
    const p = Promise.resolve().then(load).then(body => {
      const rec = { body, at: Date.now() };
      mem.set(key, rec);
      try { localStorage.setItem(LS + key, JSON.stringify(rec)); } catch (e) {}
      return rec;
    }, err => { if (staleOk && m) return m; throw err; })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }
  /* из ответа CoinGecko запоминаем тикер и текущую цену монеты — для запроса к Binance и сверки */
  const SYM = { bitcoin: 'BTC', ethereum: 'ETH' }, PRICE = {};
  let symReady; const symP = new Promise(r => { symReady = r; });
  async function markets(input, ttl) {
    const ids = (input.ids || []).join(',');
    const url = CG + '/coins/markets?vs_currency=usd&ids=' + encodeURIComponent(ids) + '&sparkline=true&price_change_percentage=24h&per_page=250';
    const { body, at } = await cached(url, ttl == null ? 60000 : ttl, () => cgJson(url));
    for (const c of body) { if (c.symbol) SYM[c.id] = String(c.symbol).toUpperCase(); if (typeof c.current_price === 'number') PRICE[c.id] = c.current_price; }
    symReady();
    const coins = body.map(c => ({
      id: c.id, symbol: c.symbol, name: c.name, image: c.image,
      currentPrice: c.current_price, marketCap: c.market_cap, marketCapRank: c.market_cap_rank,
      totalVolume: c.total_volume, priceChangePercentage24h: c.price_change_percentage_24h,
      fullyDilutedValuation: c.fully_diluted_valuation, circulatingSupply: c.circulating_supply, maxSupply: c.max_supply,
      sparkline7d: c.sparkline_in_7d && c.sparkline_in_7d.price
    }));
    return { payload: { coins }, cache: { storedAt: at } };
  }
  /* как в Claude: не больше 120 равномерных точек — иначе телефону тяжело рисовать график */
  const CH_N = 120;
  function thin(p) {
    const n = p.length; if (n <= CH_N) return p;
    const out = []; for (let i = 0; i < CH_N; i++) out.push(p[Math.round(i * (n - 1) / (CH_N - 1))]);
    return out;
  }
  /* Binance: открытые рыночные данные без ключа, история с 2017 года, лимиты намного выше */
  const BN = ['https://data-api.binance.vision', 'https://api.binance.com'];
  const BN_PLAN = { '1': ['15m', 96], '7': ['1h', 168], '14': ['2h', 168], '30': ['6h', 120], '90': ['12h', 180], '180': ['1d', 180], '365': ['1d', 365], 'max': ['1w', 1000] };
  const NOT_BN = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'BUSD', 'USD1', 'PYUSD']);
  let bnSkip = {}; try { bnSkip = JSON.parse(localStorage.getItem('bnSkip') || '{}') || {}; } catch (e) {}
  const skipPair = pair => { bnSkip[pair] = Date.now(); try { localStorage.setItem('bnSkip', JSON.stringify(bnSkip)); } catch (e) {} };
  let bnDownUntil = 0;
  async function fromBinance(id, days) {
    if (!SYM[id]) await Promise.race([symP, sleep(4000)]);
    const s = SYM[id];
    if (!s || NOT_BN.has(s) || Date.now() < bnDownUntil) return null;
    const pair = s + 'USDT';
    if (bnSkip[pair] && Date.now() - bnSkip[pair] < 7 * 864e5) return null;   /* этой пары на Binance нет — проверим снова через неделю */
    const plan = BN_PLAN[days] || ['1d', Math.max(2, Math.min(1000, Math.round(+days) || 365))];
    let reached = false;
    for (const h of BN) {
      let r;
      try { r = await fetchT(h + '/api/v3/klines?symbol=' + pair + '&interval=' + plan[0] + '&limit=' + plan[1], 10000); }
      catch (e) { continue; }
      reached = true;
      if (r.status === 400) { skipPair(pair); return null; }
      if (!r.ok) continue;
      const k = await r.json();
      if (!Array.isArray(k) || k.length < 2) return null;
      const last = +k[k.length - 1][4], ref = PRICE[id];
      if (ref && last && Math.abs(last / ref - 1) > 0.2) { skipPair(pair); return null; }   /* тот же тикер, но другая монета */
      const p = thin(k.map(x => [+x[0], +x[4]]));
      return { prices: p.map(x => x[1]), startTs: p[0][0], endTs: Math.min(Date.now(), +k[k.length - 1][6] || Date.now()), src: 'binance' };
    }
    if (!reached) bnDownUntil = Date.now() + 10 * 60000;   /* Binance не отвечает — 10 минут берём CoinGecko */
    return null;
  }
  async function fromCoinGecko(id, days) {
    const d = days === 'max' || +days > 365 ? '365' : days;   /* без ключа CoinGecko отдаёт историю только за 365 дней */
    const raw = await cgJson(CG + '/coins/' + encodeURIComponent(id) + '/market_chart?vs_currency=usd&days=' + encodeURIComponent(d));
    const p = thin((raw && raw.prices) || []);
    if (p.length < 2) { const e = new Error('Нет истории цены'); e.code = 'tool_error'; throw e; }
    return { prices: p.map(x => x[1]), startTs: p[0][0], endTs: p[p.length - 1][0], src: 'coingecko' };
  }
  async function chart(input) {
    const id = String(input.id || ''), days = String(input.days || '365');
    const ttl = days === '365' || days === 'max' ? 6 * 3600000 : 3600000;   /* текущая цена всё равно дорисовывается вживую */
    const { body, at } = await cached('ch:' + id + '|' + days, ttl, async () => (await fromBinance(id, days)) || fromCoinGecko(id, days), true);
    return { payload: body, cache: { storedAt: at } };
  }
  const watches = new Set();
  const mcpApi = {
    async callTool(server, tool, input) {
      if (server === 'CoinGecko' && tool === 'get-coin-markets') return markets(input || {});
      if (server === 'CoinGecko' && tool === 'get-coin-market-chart') return chart(input || {});
      const e = new Error('Недоступно в этой версии'); e.code = 'unavailable'; throw e;
    },
    watchTool(server, tool, input, handler, opts) {
      const every = (opts && opts.refetchInterval) || 300000;
      let stop = false;
      const run = async force => {
        try { const r = await markets(input || {}, force ? 0 : 60000); if (!stop) handler({ type: 'data', result: r, cache: r.cache }); }
        catch (err) { if (!stop) handler({ type: 'error', error: err }); }
      };
      const w = { run }; watches.add(w); run(false);
      const t = setInterval(() => run(true), every);
      return () => { stop = true; clearInterval(t); watches.delete(w); };
    },
    async invalidate() { for (const w of watches) w.run(true); }
  };

  window.claude = {
    use: async name => {
      if (name === 'mcp') return mcpApi;
      if (name === 'db') { await ready; return dbApi; }
      return null;
    }
  };

  /* ---------- вход ---------- */
  function overlay() {
    const o = document.createElement('div');
    o.id = 'mlAuth';
    o.innerHTML = `<div class="mla-card">
      <h1 class="wm" aria-label="MoneyLife"><span>Money</span><span class="wm-l">Life</span></h1>
      <p class="mla-sub">Вход в твой личный кабинет</p>
      <label class="field"><span>Почта</span><input type="email" id="mlaEmail" autocomplete="username" inputmode="email"></label>
      <label class="field"><span>Пароль</span><input type="password" id="mlaPass" autocomplete="current-password"></label>
      <p class="err" id="mlaErr" role="alert"></p>
      <button type="button" class="btn block" id="mlaIn">Войти</button>
      ${CFG.allowSignup===false?'':'<button type="button" class="btn block ghost" id="mlaUp">Создать аккаунт</button>'}
      <p class="mla-note">Данные хранятся в твоей базе Supabase и видны только тебе.</p></div>`;
    document.body.appendChild(o);
    const err = m => { o.querySelector('#mlaErr').textContent = m || ''; };
    const go = async up => {
      const email = o.querySelector('#mlaEmail').value.trim(), password = o.querySelector('#mlaPass').value;
      if (!email || password.length < 8) { err('Введи почту и пароль не короче 8 символов.'); return; }
      err('');
      const c = client();
      const r = up ? await c.auth.signUp({ email, password }) : await c.auth.signInWithPassword({ email, password });
      if (r.error) { err(up ? 'Не удалось создать аккаунт: ' + r.error.message : 'Неверная почта или пароль.'); return; }
      if (up && !r.data.session) { err('Аккаунт создан. Напиши Claude в чат «аккаунт создан» — он подтвердит его и перенесёт твои данные. Письмо от Supabase можно не открывать.'); return; }
    };
    o.querySelector('#mlaIn').addEventListener('click', () => go(false));
    const up = o.querySelector('#mlaUp'); if (up) up.addEventListener('click', () => go(true));
    o.querySelector('#mlaPass').addEventListener('keydown', e => { if (e.key === 'Enter') go(false); });
    return o;
  }

  async function boot() {
    const c = client();
    if (!c) { document.body.insertAdjacentHTML('beforeend', '<div id="mlAuth"><div class="mla-card"><p>Приложение ещё не настроено: нет адреса базы.</p></div></div>'); return; }
    let o = null;
    const onSession = async s => {
      if (!s || !s.user) { if (!o) o = overlay(); return; }
      if (uid === s.user.id) return;
      uid = s.user.id;
      if (o) { o.remove(); o = null; }
      try { await loadAll(); } catch (e) { console.error(e); }
      window.__mlAuthed();
    };
    const { data } = await c.auth.getSession();
    await onSession(data.session);
    c.auth.onAuthStateChange((ev, s) => { if (ev === 'SIGNED_OUT') { location.reload(); return; } onSession(s); });
  }
  window.mlSignOut = async () => { try { await client().auth.signOut(); } catch (e) {} location.reload(); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  /* ---------- обновления и установка ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(reg => {
        const ask = w => {
          const b = document.createElement('div'); b.id = 'mlUpd';
          b.innerHTML = '<span>Доступна новая версия</span><button type="button" class="btn sm">Обновить</button>';
          b.querySelector('button').onclick = () => { w.postMessage('skip'); };
          document.body.appendChild(b);
        };
        if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing; if (!w) return;
          w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ask(w); });
        });
        setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      }).catch(() => {});
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded) return; reloaded = true; location.reload(); });
    });
  }
})();
