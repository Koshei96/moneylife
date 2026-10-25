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

  /* ---------- CoinGecko напрямую ---------- */
  const CG = 'https://api.coingecko.com/api/v3';
  const hdr = () => (CFG.coingeckoKey ? { 'x-cg-demo-api-key': CFG.coingeckoKey } : {});
  const mem = new Map();
  async function cgFetch(url, ttl) {
    const now = Date.now(), m = mem.get(url);
    if (m && now - m.at < ttl) return { body: m.body, at: m.at };
    try {
      const ls = JSON.parse(localStorage.getItem('cg:' + url) || 'null');
      if (ls && now - ls.at < ttl) { mem.set(url, ls); return ls; }
    } catch (e) {}
    const r = await fetch(url, { headers: hdr() });
    if (!r.ok) { const e = new Error('CoinGecko ' + r.status); e.code = r.status === 429 ? 'rate_limited' : 'tool_error'; e.retryable = r.status === 429 || r.status >= 500; throw e; }
    const body = await r.json(), rec = { body, at: now };
    mem.set(url, rec);
    try { localStorage.setItem('cg:' + url, JSON.stringify(rec)); } catch (e) {}
    return rec;
  }
  async function markets(input, ttl) {
    const ids = (input.ids || []).join(',');
    const url = CG + '/coins/markets?vs_currency=usd&ids=' + encodeURIComponent(ids) + '&sparkline=true&price_change_percentage=24h&per_page=250';
    const { body, at } = await cgFetch(url, ttl == null ? 60000 : ttl);
    const coins = body.map(c => ({
      id: c.id, symbol: c.symbol, name: c.name, image: c.image,
      currentPrice: c.current_price, marketCap: c.market_cap, marketCapRank: c.market_cap_rank,
      totalVolume: c.total_volume, priceChangePercentage24h: c.price_change_percentage_24h,
      fullyDilutedValuation: c.fully_diluted_valuation, circulatingSupply: c.circulating_supply, maxSupply: c.max_supply,
      sparkline7d: c.sparkline_in_7d && c.sparkline_in_7d.price
    }));
    return { payload: { coins }, cache: { storedAt: at } };
  }
  async function chart(input) {
    const url = CG + '/coins/' + encodeURIComponent(input.id) + '/market_chart?vs_currency=usd&days=' + encodeURIComponent(input.days || '365');
    const { body, at } = await cgFetch(url, 3600000);
    const p = body.prices || [];
    return { payload: { prices: p.map(x => x[1]), startTs: p.length ? p[0][0] : null, endTs: p.length ? p[p.length - 1][0] : null }, cache: { storedAt: at } };
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
