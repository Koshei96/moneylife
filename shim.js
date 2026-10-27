/* MoneyLife — прослойка для самостоятельной версии.
   Даёт приложению тот же интерфейс, что и в Claude:
   claude.use('db')  → документы в Supabase (таблица docs) с живыми обновлениями;
   claude.use('mcp') → цены и графики напрямую с CoinGecko.
   Вход — почта и пароль или Google (Supabase Auth); восстановление пароля по письму. */
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
  function emit() { for (const l of [...listeners]) { try { l(); } catch (e) { console.error(e); } } if (loaded && uid) saveLocal(); }

  /* ---------- копия данных на телефоне: приложение открывается и без интернета ---------- */
  const LS_UID = 'ml-last-uid', lsDocs = () => 'ml-docs:' + uid;
  let saveT = 0, offlineAt = null, chan = null, retrying = false;
  function saveLocal() {
    clearTimeout(saveT);
    saveT = setTimeout(() => { try { localStorage.setItem(lsDocs(), JSON.stringify({ at: Date.now(), rows: [...cache] })); } catch (e) {} }, 400);
  }
  function loadLocal() {
    try {
      const j = JSON.parse(localStorage.getItem(lsDocs()) || 'null');
      if (!j || !Array.isArray(j.rows) || !j.rows.length) return null;
      cache.clear(); for (const [k, v] of j.rows) cache.set(k, v);
      loaded = true; for (const l of [...listeners]) { try { l(); } catch (e) {} }
      return j.at || 0;
    } catch (e) { return null; }
  }
  const fmtAt = t => { try { return new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
  /* плашка вверху: at = время копии; 0 — копии нет; null — связь есть, плашку убрать */
  function setOffline(at) {
    offlineAt = at;
    const b = document.getElementById('offline'); if (!b) return;
    const sp = b.querySelector('span');
    if (sp && b.dataset.orig == null) b.dataset.orig = sp.textContent;
    if (at == null) { if (b.dataset.ml) { b.hidden = true; delete b.dataset.ml; if (sp) sp.textContent = b.dataset.orig; } return; }
    if (sp) sp.textContent = at ? 'Нет связи с базой — показаны данные, сохранённые ' + fmtAt(at) + '. Новые записи пока не сохраняются.' : b.dataset.orig;
    b.hidden = false; b.dataset.ml = '1';
  }
  /* связь вернулась — догружаем свежие данные */
  async function retry() {
    if (retrying || offlineAt == null || !uid) return; retrying = true;
    try { await loadAll(); setOffline(null); } catch (e) {} finally { retrying = false; }
  }
  window.addEventListener('online', () => setTimeout(retry, 800));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) retry(); });

  async function loadAll() {
    const c = client();
    let from = 0; const page = 1000; const next = new Map();
    for (;;) {
      const { data, error } = await c.from('docs').select('col,id,data').range(from, from + page - 1);
      if (error) throw error;
      for (const r of data) next.set(key(r.col, r.id), r.data || {});
      if (data.length < page) break;
      from += page;
    }
    cache.clear(); for (const [k, v] of next) cache.set(k, v);
    loaded = true; emit();
    if (chan) return;
    chan = c.channel('docs-' + uid)
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

  function canWrite() { if (offlineAt != null || navigator.onLine === false) { const e = new Error('Нет интернета — запись не сохранена'); e.code = 'offline'; throw e; } }
  function rollback(k, prev) { if (prev === undefined) cache.delete(k); else cache.set(k, prev); emit(); }
  async function writeSet(c, id, data) {
    canWrite();
    const k = key(c, id), prev = cache.get(k);
    cache.set(k, clone(data)); emit();
    let r; try { r = await client().from('docs').upsert({ owner: uid, col: c, id, data, updated_at: new Date().toISOString() }, { onConflict: 'owner,col,id' }); } catch (e) { r = { error: e }; }
    if (r.error) { rollback(k, prev); throw r.error; }
  }
  async function writeUpdate(c, id, patch) {
    canWrite();
    const k0 = key(c, id), prev = cache.get(k0);
    const cur = prev || {};
    const next = Object.assign({}, cur);
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v && typeof v === 'object' && v.__delete__ === true) delete next[k]; else next[k] = clone(v);
    }
    cache.set(k0, next); emit();
    let r; try { r = await client().rpc('doc_merge', { p_col: c, p_id: id, p_patch: patch }); } catch (e) { r = { error: e }; }
    if (r.error) { rollback(k0, prev); throw r.error; }
  }
  async function writeDelete(c, id) {
    canWrite();
    const k = key(c, id), prev = cache.get(k);
    cache.delete(k); emit();
    let r; try { r = await client().from('docs').delete().match({ owner: uid, col: c, id }); } catch (e) { r = { error: e }; }
    if (r.error) { rollback(k, prev); throw r.error; }
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

  /* ---------- цены и история цены ----------
     Текущие цены — CoinGecko (как в Claude); если бесплатный CoinGecko упёрся в лимит — Binance и Gate.
     История цены — Binance → Gate → CoinGecko (без ключа не дальше 365 дней).
     Монету с чужим тикером на бирже отсеивает сверка с известной ценой. */
  const CG = 'https://api.coingecko.com/api/v3';
  const BN = ['https://data-api.binance.vision', 'https://api.binance.com'];
  const GT = 'https://api.gateio.ws/api/v4';
  const hdr = () => (CFG.coingeckoKey ? { 'x-cg-demo-api-key': CFG.coingeckoKey } : {});
  const mem = new Map(), inflight = new Map(), LS = 'cg3:';
  /* прошлые версии кэша — убираем */
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && (k.startsWith('cg:') || k.startsWith('cg2:') || k === 'bnSkip')) localStorage.removeItem(k); } } catch (e) {}
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
  /* после отказа CoinGecko 90 секунд текущие цены берём с бирж, не дёргая его */
  let cgCoolUntil = 0;
  async function cgJson(url, retry) {
    for (let a = 0; ; a++) {
      await cgSlot(a ? 6000 : 1500);
      let err;
      try {
        const r = await fetchT(url, 15000, { headers: hdr() });
        if (r.ok) return await r.json();
        err = new Error('CoinGecko ' + r.status); err.code = r.status === 429 ? 'rate_limited' : 'tool_error'; err.retryable = r.status === 429 || r.status >= 500;
      } catch (e) { err = e; err.retryable = true; }
      if (err.retryable) cgCoolUntil = Date.now() + 90000;
      if (!retry || a >= 1 || !err.retryable) throw err;
    }
  }

  /* биржи: адрес, который 3 раза подряд не ответил, пропускаем минуту (один сбой — не повод) */
  const hostFail = {};
  const hostUp = h => !hostFail[h] || Date.now() >= hostFail[h].until;
  function hostBad(h) { const f = hostFail[h] || (hostFail[h] = { n: 0, until: 0 }); if (++f.n >= 3) { f.until = Date.now() + 60000; f.n = 0; } }
  /* null — такой пары на бирже нет; исключение — сбой сети или сервера */
  async function exJson(host, path) {
    if (!hostUp(host)) throw new Error('пропуск ' + host);
    let r;
    try { r = await fetchT(host + path, 10000); } catch (e) { hostBad(host); throw e; }
    delete hostFail[host];
    if (r.status === 400 || r.status === 404) return null;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  /* «пары нет» или «под этим тикером другая монета» — помним неделю */
  let miss = {}; try { miss = JSON.parse(localStorage.getItem('exMiss') || '{}') || {}; } catch (e) {}
  const missed = k => miss[k] && Date.now() - miss[k] < 7 * 864e5;
  const setMiss = k => { miss[k] = Date.now(); try { localStorage.setItem('exMiss', JSON.stringify(miss)); } catch (e) {} };

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

  /* тикер монеты: из ответа CoinGecko, а если его не было — из списка монет самого приложения */
  const SYM = { bitcoin: 'BTC', ethereum: 'ETH' }, PRICE = {};
  const TRUST = new Set(['bitcoin', 'ethereum']);
  const NOT_EX = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'BUSD', 'USD1', 'PYUSD']);
  function appSym(id) {
    try { const m = cgMap(); for (const k in m) if (m[k] === id) return k; } catch (e) {}
    return null;
  }
  const exSym = id => SYM[id] || appSym(id);
  /* известная цена: CoinGecko сейчас → живые цены приложения → последний снимок цен в базе */
  function refPrice(id) {
    if (PRICE[id]) return PRICE[id];
    const k = appSym(id); if (!k) return null;
    try { return +S.live.prices[k] || +((S.market && S.market.prices) || {})[k] || null; } catch (e) { return null; }
  }
  /* true — та же монета; false — другая; null — сверить не с чем */
  function verdict(id, price) {
    if (TRUST.has(id)) return true;
    const ref = refPrice(id);
    if (!ref || !(price > 0)) return null;
    return Math.abs(price / ref - 1) <= 0.2;
  }

  /* как в Claude: не больше 120 равномерных точек — иначе телефону тяжело рисовать график */
  const CH_N = 120;
  function thin(p) {
    const n = p.length; if (n <= CH_N) return p;
    const out = []; for (let i = 0; i < CH_N; i++) out.push(p[Math.round(i * (n - 1) / (CH_N - 1))]);
    return out;
  }
  const pack = (p, endTs, src) => ({ prices: p.map(x => x[1]), startTs: p[0][0], endTs, src });

  const BN_PLAN = { '1': ['15m', 96], '7': ['1h', 168], '14': ['2h', 168], '30': ['6h', 120], '90': ['12h', 180], '180': ['1d', 180], '365': ['1d', 365], 'max': ['1w', 1000] };
  const GT_PLAN = { '1': ['15m', 96], '7': ['1h', 168], '14': ['4h', 84], '30': ['4h', 180], '90': ['8h', 270], '180': ['1d', 180], '365': ['1d', 365], 'max': ['7d', 1000] };
  const planFor = (P, days) => P[days] || ['1d', Math.max(2, Math.min(1000, Math.round(+days) || 365))];
  async function binanceChart(id, sym, days) {
    const [iv, lim] = planFor(BN_PLAN, days);
    for (const h of BN) {
      let k;
      try { k = await exJson(h, '/api/v3/klines?symbol=' + sym + 'USDT&interval=' + iv + '&limit=' + lim); } catch (e) { continue; }
      if (k === null) { setMiss('bn:' + sym); return null; }
      if (!Array.isArray(k) || k.length < 2) return null;
      const v = verdict(id, +k[k.length - 1][4]);
      if (v === false) setMiss('bn:' + sym);
      if (v !== true) return null;
      return pack(thin(k.map(x => [+x[0], +x[4]])), Math.min(Date.now(), +k[k.length - 1][6] || Date.now()), 'binance');
    }
    return null;
  }
  async function gateChart(id, sym, days) {
    const [iv, lim] = planFor(GT_PLAN, days);
    let k;
    try { k = await exJson(GT, '/spot/candlesticks?currency_pair=' + sym + '_USDT&interval=' + iv + '&limit=' + lim); } catch (e) { return null; }
    if (k === null) { setMiss('gt:' + sym); return null; }
    if (!Array.isArray(k) || k.length < 2) return null;
    const v = verdict(id, +k[k.length - 1][2]);
    if (v === false) setMiss('gt:' + sym);
    if (v !== true) return null;
    return pack(thin(k.map(x => [+x[0] * 1000, +x[2]])), Date.now(), 'gate');
  }
  async function exchangeChart(id, days) {
    const sym = exSym(id);
    if (!sym || NOT_EX.has(sym)) return null;
    if (!missed('bn:' + sym)) { const r = await binanceChart(id, sym, days); if (r) return r; }
    if (!missed('gt:' + sym)) { const r = await gateChart(id, sym, days); if (r) return r; }
    return null;
  }
  async function coingeckoChart(id, days) {
    const d = days === 'max' || +days > 365 ? '365' : days;   /* без ключа CoinGecko отдаёт историю только за 365 дней */
    const raw = await cgJson(CG + '/coins/' + encodeURIComponent(id) + '/market_chart?vs_currency=usd&days=' + encodeURIComponent(d), true);
    const p = thin((raw && raw.prices) || []);
    if (p.length < 2) { const e = new Error('Нет истории цены'); e.code = 'tool_error'; throw e; }
    return pack(p, p[p.length - 1][0], 'coingecko');
  }
  async function chart(input) {
    const id = String(input.id || ''), days = String(input.days || '365');
    const ttl = days === '365' || days === 'max' ? 6 * 3600000 : 3600000;   /* текущая цена всё равно дорисовывается вживую */
    const { body, at } = await cached('ch:' + id + '|' + days, ttl, async () => (await exchangeChart(id, days)) || coingeckoChart(id, days), true);
    return { payload: body, cache: { storedAt: at } };
  }

  /* текущие цены с бирж — когда CoinGecko не отвечает (без мини-графиков за 7 дней) */
  async function exchangeMarkets(ids) {
    const out = [], onBn = [], rest = [];
    for (const id of ids) { const s = exSym(id); if (!s || NOT_EX.has(s)) continue; (missed('bn:' + s) ? rest : onBn).push([id, s]); }
    if (onBn.length) {
      const got = new Map();
      for (const h of BN) {
        let r;
        try { r = await exJson(h, '/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(onBn.map(x => x[1] + 'USDT')))); } catch (e) { continue; }
        if (Array.isArray(r)) { const by = new Map(r.map(t => [t.symbol, t])); for (const [id, s] of onBn) if (by.has(s + 'USDT')) got.set(id, by.get(s + 'USDT')); }
        else if (r === null) {   /* среди пар есть несуществующая — спрашиваем по одной */
          await Promise.all(onBn.map(async ([id, s]) => {
            try { const t = await exJson(h, '/api/v3/ticker/24hr?symbol=' + s + 'USDT'); if (t === null) setMiss('bn:' + s); else got.set(id, t); } catch (e) {}
          }));
        }
        break;
      }
      for (const [id, s] of onBn) {
        const t = got.get(id), price = t ? +t.lastPrice : 0, v = t ? verdict(id, price) : false;
        if (v === true) { out.push({ id, symbol: s.toLowerCase(), currentPrice: price, priceChangePercentage24h: +t.priceChangePercent }); continue; }
        if (t && v === false) setMiss('bn:' + s);
        if (v === false) rest.push([id, s]);
      }
    }
    await Promise.all(rest.map(async ([id, s]) => {
      if (missed('gt:' + s)) return;
      let t;
      try { t = await exJson(GT, '/spot/tickers?currency_pair=' + s + '_USDT'); } catch (e) { return; }
      if (t === null) { setMiss('gt:' + s); return; }
      t = Array.isArray(t) ? t[0] : t; if (!t) return;
      const price = +t.last, v = verdict(id, price);
      if (v === false) setMiss('gt:' + s);
      if (v === true) out.push({ id, symbol: s.toLowerCase(), currentPrice: price, priceChangePercentage24h: +t.change_percentage });
    }));
    return out;
  }
  async function markets(input, ttl) {
    const idList = input.ids || [];
    const url = CG + '/coins/markets?vs_currency=usd&ids=' + encodeURIComponent(idList.join(',')) + '&sparkline=true&price_change_percentage=24h&per_page=250';
    let rec = null, err = null;
    if (Date.now() >= cgCoolUntil) {
      try { rec = await cached(url, ttl == null ? 60000 : ttl, () => cgJson(url, false)); } catch (e) { err = e; }
    } else { err = new Error('CoinGecko временно ограничил запросы'); err.code = 'rate_limited'; }
    if (!rec) {   /* CoinGecko не ответил — цены с бирж сразу, без ожидания */
      const coins = await exchangeMarkets(idList).catch(() => []);
      if (!coins.length) throw err;
      return { payload: { coins }, cache: { storedAt: Date.now() } };
    }
    const { body, at } = rec;
    for (const c of body) { if (c.symbol) SYM[c.id] = String(c.symbol).toUpperCase(); if (typeof c.current_price === 'number') PRICE[c.id] = c.current_price; }
    const coins = body.map(c => ({
      id: c.id, symbol: c.symbol, name: c.name, image: c.image,
      currentPrice: c.current_price, marketCap: c.market_cap, marketCapRank: c.market_cap_rank,
      totalVolume: c.total_volume, priceChangePercentage24h: c.price_change_percentage_24h,
      fullyDilutedValuation: c.fully_diluted_valuation, circulatingSupply: c.circulating_supply, maxSupply: c.max_supply,
      sparkline7d: c.sparkline_in_7d && c.sparkline_in_7d.price
    }));
    return { payload: { coins }, cache: { storedAt: at } };
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
  /* что пришло в адресе после письма или входа через Google — читаем до того, как Supabase его очистит */
  const URLH = (location.hash || '').slice(1), URLQ = new URLSearchParams(URLH.includes('=') ? URLH : '');
  const fromMail = URLQ.get('type');                       /* signup | recovery | magiclink | email_change */
  const urlErr = URLQ.get('error_description') || '';
  const SITE = CFG.siteUrl || (location.origin + location.pathname);
  const okPass = p => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
  const PASS_HINT = 'От 8 символов: латинские буквы и цифры.';
  function authErr(e, mode) {
    const m = String((e && (e.code || e.message)) || '');
    if (/invalid_credentials|Invalid login/i.test(m)) return 'Неверная почта или пароль.';
    if (/email_not_confirmed|not confirmed/i.test(m)) return 'Почта ещё не подтверждена — открой ссылку из письма.';
    if (/user_already_exists|already registered/i.test(m)) return 'Эта почта уже зарегистрирована. Войди или восстанови пароль.';
    if (/weak_password|Password should/i.test(m)) return 'Слабый пароль. ' + PASS_HINT;
    if (/signup_disabled|Signups not allowed/i.test(m)) return 'Регистрация пока закрыта.';
    if (/over_email_send_rate_limit|rate limit|security purposes|only request this/i.test(m)) return 'Слишком часто. Подожди минуту и попробуй снова.';
    if (/email_address_invalid|invalid format|Unable to validate email/i.test(m)) return 'Проверь адрес почты.';
    if (/same_password|different from the old/i.test(m)) return 'Новый пароль должен отличаться от старого.';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Нет связи. Проверь интернет.';
    return (mode === 'up' ? 'Не удалось создать аккаунт: ' : 'Не получилось: ') + m;
  }
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const G_ICON = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.6 44 33 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

  /* экраны: in — вход, up — регистрация, forgot — забыли пароль, sent — письмо отправлено, newpass — новый пароль */
  function overlay(mode, note) {
    const o = document.getElementById('mlAuth') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'mlAuth' }));
    let email = (o.dataset.email || ''), sentKind = 'signup', wait = 0, waitT = 0;
    const c = client();
    const canUp = CFG.allowSignup !== false, google = !!CFG.google;
    const field = (id, label, type, ac, val) => `<label class="field"><span>${label}</span><input type="${type}" id="${id}" autocomplete="${ac}"${type === 'email' ? ' inputmode="email" autocapitalize="none" spellcheck="false"' : ''} value="${esc(val || '')}"></label>`;
    const passField = (id, label, ac) => `<label class="field"><span>${label}</span><span class="mla-pw"><input type="password" id="${id}" autocomplete="${ac}"><button type="button" class="mla-eye" data-eye="${id}" aria-label="Показать пароль"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button></span></label>`;
    const gBtn = google ? `<div class="mla-or"><span>или</span></div><button type="button" class="btn block mla-g" id="mlaG">${G_ICON}<span>Войти через Google</span></button>` : '';
    const priv = '<a href="privacy.html" target="_blank" rel="noopener">политикой конфиденциальности</a>';
    function draw() {
      const head = '<h1 class="wm" aria-label="MoneyLife"><span>Money</span><span class="wm-l">Life</span></h1>';
      let h = '';
      if (mode === 'in') h = `${head}<p class="mla-sub">Вход в личный кабинет</p>${field('mlaEmail', 'Почта', 'email', 'username', email)}${passField('mlaPass', 'Пароль', 'current-password')}
        <p class="err" id="mlaErr" role="alert"></p><button type="button" class="btn block" id="mlaGo">Войти</button>
        <button type="button" class="mla-link" data-to="forgot">Забыли пароль?</button>${gBtn}
        ${canUp ? '<p class="mla-foot">Нет аккаунта? <button type="button" class="mla-link" data-to="up">Создать</button></p>' : ''}`;
      else if (mode === 'up') h = `${head}<p class="mla-sub">Новый аккаунт</p>${field('mlaEmail', 'Почта', 'email', 'username', email)}${passField('mlaPass', 'Пароль', 'new-password')}
        <p class="mla-hint">${PASS_HINT}</p>
        <label class="mla-check"><input type="checkbox" id="mlaAgree"><span>Понимаю: Money Life — дневник и калькулятор, а не инвестиционный совет. Согласен с ${priv}.</span></label>
        <p class="err" id="mlaErr" role="alert"></p><button type="button" class="btn block" id="mlaGo">Создать аккаунт</button>${gBtn}
        <p class="mla-foot">Уже есть аккаунт? <button type="button" class="mla-link" data-to="in">Войти</button></p>`;
      else if (mode === 'forgot') h = `${head}<p class="mla-sub">Восстановление пароля</p><p class="mla-text">Пришлём на почту ссылку. По ней ты задашь новый пароль.</p>${field('mlaEmail', 'Почта', 'email', 'username', email)}
        <p class="err" id="mlaErr" role="alert"></p><button type="button" class="btn block" id="mlaGo">Прислать ссылку</button>
        <button type="button" class="mla-link" data-to="in">Назад ко входу</button>`;
      else if (mode === 'sent') h = `${head}<div class="mla-mail" aria-hidden="true">✉</div><p class="mla-sub">Письмо отправлено</p>
        <p class="mla-text">${sentKind === 'recovery' ? 'Открой ссылку из письма на' : 'Подтверди почту: открой ссылку из письма на'} <b>${esc(email)}</b>. ${sentKind === 'recovery' ? 'Откроется приложение, и ты задашь новый пароль.' : 'После этого вход произойдёт сам.'} Письма нет — проверь «Спам».</p>
        <p class="err" id="mlaErr" role="alert"></p><button type="button" class="btn block ghost" id="mlaAgain" disabled>Отправить ещё раз</button>
        <button type="button" class="mla-link" data-to="in">Назад ко входу</button>`;
      else if (mode === 'newpass') h = `${head}<p class="mla-sub">Новый пароль</p>${passField('mlaPass', 'Новый пароль', 'new-password')}<p class="mla-hint">${PASS_HINT}</p>
        <p class="err" id="mlaErr" role="alert"></p><button type="button" class="btn block" id="mlaGo">Сохранить пароль</button>`;
      o.innerHTML = `<div class="mla-card" role="dialog" aria-modal="true">${h}${mode === 'in' || mode === 'up' ? '<p class="mla-note">Твои записи видны только тебе.</p>' : ''}</div>`;
      wire();
      const hadNote = !!note;
      if (note) { const e = o.querySelector('#mlaErr'); if (e) { e.textContent = note.text; e.classList.toggle('ok', !!note.ok); } note = null; }
      if (mode === 'sent') tick(hadNote ? 0 : 60);
    }
    const err = (m, ok) => { const e = o.querySelector('#mlaErr'); if (e) { e.textContent = m || ''; e.classList.toggle('ok', !!ok); } };
    const val = id => { const e = o.querySelector('#' + id); return e ? e.value : ''; };
    const busy = (b, on) => { if (b) { b.disabled = on; b.classList.toggle('busy', on); } };
    function tick(n) { wait = n; clearInterval(waitT); const b = o.querySelector('#mlaAgain'); const up = () => { if (!b) return; b.disabled = wait > 0; b.textContent = wait > 0 ? 'Отправить ещё раз через ' + wait + ' с' : 'Отправить ещё раз'; }; up(); waitT = setInterval(() => { wait--; up(); if (wait <= 0) clearInterval(waitT); }, 1000); }
    async function go() {
      const b = o.querySelector('#mlaGo'); err('');
      if (mode !== 'newpass') { email = val('mlaEmail').trim(); o.dataset.email = email; if (!/^\S+@\S+\.\S+$/.test(email)) { err('Впиши почту.'); return; } }
      const pass = val('mlaPass');
      busy(b, true);
      try {
        if (mode === 'in') {
          if (!pass) { err('Впиши пароль.'); return; }
          const r = await c.auth.signInWithPassword({ email, password: pass });
          if (r.error) { if (/email_not_confirmed|not confirmed/i.test(r.error.code || r.error.message || '')) { sentKind = 'signup'; mode = 'sent'; note = { text: 'Почта ещё не подтверждена.' }; draw(); return; } err(authErr(r.error)); }
        } else if (mode === 'up') {
          if (!okPass(pass)) { err(PASS_HINT); return; }
          if (!o.querySelector('#mlaAgree').checked) { err('Отметь, что понимаешь условия.'); return; }
          const r = await c.auth.signUp({ email, password: pass, options: { emailRedirectTo: SITE, data: { agreed_at: new Date().toISOString() } } });
          if (r.error) { err(authErr(r.error, 'up')); return; }
          if (!r.data.session) { sentKind = 'signup'; mode = 'sent'; draw(); }
        } else if (mode === 'forgot') {
          const r = await c.auth.resetPasswordForEmail(email, { redirectTo: SITE });
          if (r.error) { err(authErr(r.error)); return; }
          sentKind = 'recovery'; mode = 'sent'; draw();
        } else if (mode === 'newpass') {
          if (!okPass(pass)) { err(PASS_HINT); return; }
          const r = await c.auth.updateUser({ password: pass });
          if (r.error) { err(authErr(r.error)); return; }
          o.remove(); window.mlToast && window.mlToast('Пароль изменён');
        }
      } catch (e) { err(authErr(e, mode)); }
      finally { busy(b, false); }
    }
    async function again() {
      const b = o.querySelector('#mlaAgain'); busy(b, true); err('');
      try {
        const r = sentKind === 'recovery' ? await c.auth.resetPasswordForEmail(email, { redirectTo: SITE }) : await c.auth.resend({ type: 'signup', email, options: { emailRedirectTo: SITE } });
        if (r.error) err(authErr(r.error)); else { err('Отправили ещё раз.', true); tick(60); }
      } catch (e) { err(authErr(e)); } finally { if (wait <= 0) busy(b, false); }
    }
    function wire() {
      const g = o.querySelector('#mlaGo'); if (g) g.addEventListener('click', go);
      o.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter' && i.type !== 'checkbox') go(); }));
      o.querySelectorAll('[data-to]').forEach(x => x.addEventListener('click', () => { const e = o.querySelector('#mlaEmail'); if (e) { email = e.value.trim(); o.dataset.email = email; } mode = x.dataset.to; clearInterval(waitT); draw(); }));
      o.querySelectorAll('[data-eye]').forEach(x => x.addEventListener('click', () => { const i = o.querySelector('#' + x.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password'; x.setAttribute('aria-label', i.type === 'password' ? 'Показать пароль' : 'Скрыть пароль'); }));
      const a = o.querySelector('#mlaAgain'); if (a) a.addEventListener('click', again);
      const gg = o.querySelector('#mlaG'); if (gg) gg.addEventListener('click', async () => { busy(gg, true); try { const r = await c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: SITE } }); if (r.error) { err(authErr(r.error)); busy(gg, false); } } catch (e) { err(authErr(e)); busy(gg, false); } });
    }
    draw();
    return o;
  }

  /* удаление аккаунта и выгрузка данных — для настроек приложения */
  window.mlUser = null;
  window.mlExport = () => {
    const out = { app: 'Money Life', exportedAt: new Date().toISOString(), user: window.mlUser && window.mlUser.email, docs: [] };
    for (const [k, v] of cache) { const i = k.indexOf('/'); out.docs.push({ col: k.slice(0, i), id: k.slice(i + 1), data: v }); }
    return out;
  };
  window.mlDeleteAccount = async () => {
    const c = client(); if (!c || !uid) throw new Error('not signed in');
    if (navigator.onLine === false) { const e = new Error('offline'); e.code = 'offline'; throw e; }
    const r = await c.rpc('delete_my_account'); if (r.error) throw r.error;
    try { localStorage.removeItem(lsDocs()); localStorage.removeItem(LS_UID); localStorage.removeItem('ml-cmeta'); } catch (e) {}
    try { await c.auth.signOut({ scope: 'local' }); } catch (e) {}
    history.replaceState(null, '', location.pathname + '#deleted'); location.reload();   /* экран входа покажет «аккаунт удалён» */
  };

  async function boot() {
    const c = client();
    if (!c) { document.body.insertAdjacentHTML('beforeend', '<div id="mlAuth"><div class="mla-card"><p>Приложение ещё не настроено: нет адреса базы.</p></div></div>'); return; }
    let o = null;
    const startNote = urlErr ? { text: /expired|invalid/i.test(urlErr) ? 'Ссылка устарела или уже использована — запроси новую.' : 'Не получилось: ' + urlErr } : (URLH === 'deleted' ? { text: 'Аккаунт и все записи удалены.', ok: true } : (URLH === 'delete' ? { text: 'Войди, чтобы удалить аккаунт.' } : null));
    const onSession = async s => {
      if (!s || !s.user) { if (!o) o = overlay(urlErr && /expired|invalid/i.test(urlErr) ? 'forgot' : 'in', startNote); return; }
      window.mlUser = { id: s.user.id, email: s.user.email || '', provider: (s.user.app_metadata && s.user.app_metadata.provider) || 'email' };
      if (uid === s.user.id && offlineAt == null) return;
      uid = s.user.id; try { localStorage.setItem(LS_UID, uid); } catch (e) {}
      if (o) { o.remove(); o = null; }
      const at = loaded ? (offlineAt || Date.now()) : loadLocal();
      if (at != null) window.__mlAuthed();          /* копия есть — показываем сразу, не ждём сеть */
      try { await loadAll(); setOffline(null); }
      catch (e) { console.error(e); setOffline(at != null ? at : 0); }
      window.__mlAuthed();
    };
    let ses = null, serr = null;
    try { const r = await c.auth.getSession(); ses = r.data && r.data.session; serr = r.error; } catch (e) { serr = e; }
    /* нет сети, а вход просрочился: открываем сохранённую копию последнего пользователя только для просмотра */
    if (!ses && (serr || navigator.onLine === false)) {
      let last = null; try { last = localStorage.getItem(LS_UID); } catch (e) {}
      if (last) {
        uid = last; const at = loadLocal();
        if (at != null) {
          window.__mlAuthed(); setOffline(at);
          const back = async () => { window.removeEventListener('online', back); const r = await c.auth.getSession().catch(() => ({ data: {} })); await onSession(r.data && r.data.session); };
          window.addEventListener('online', back);
          c.auth.onAuthStateChange((ev, s) => { if (ev === 'SIGNED_OUT') { location.reload(); return; } if (s) onSession(s); });
          return;
        }
        uid = null;
      }
    }
    await onSession(ses);
    if (ses && fromMail === 'recovery') overlay('newpass');                                  /* пришёл по ссылке «новый пароль» */
    else if (ses && fromMail === 'signup') setTimeout(() => window.mlToast && window.mlToast('Почта подтверждена — добро пожаловать!'), 1500);
    c.auth.onAuthStateChange((ev, s) => { if (ev === 'SIGNED_OUT') { location.reload(); return; } if (ev === 'PASSWORD_RECOVERY') { overlay('newpass'); } onSession(s); });
  }
  window.mlSignOut = async () => {
    try { if (uid) localStorage.removeItem(lsDocs()); localStorage.removeItem(LS_UID); } catch (e) {}   /* выход — копия с телефона удаляется */
    try { await client().auth.signOut(); } catch (e) {} location.reload();
  };

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
