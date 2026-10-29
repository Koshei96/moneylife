/* Имитация Supabase для автотестов MoneyLife.
   Подставляется в страницу ДО загрузки приложения (Playwright add_init_script).
   Настройка сценария — через window.__ML_TEST перед этим скриптом:
     { session: true|false, docs: [{col,id,data}], failLoad: false,
       otherDocs: [{col,id,data}]   — записи ДРУГОГО пользователя в той же базе (приложению не видны),
       accountDelete: true          — включить кнопку «Удалить аккаунт» (флаг из config.js),
       persist: true                — сохранить состояние базы при перезагрузке страницы (sessionStorage) }
   Все записи хранятся в памяти страницы; сеть не нужна.
   rpc('delete_my_account') — как SQL-функция supabase/delete_my_account.sql: без входа — ошибка,
   иначе удаляет только записи вошедшего и его аккаунт; повторный вызов ничего не ломает.
   Журнал вызовов — window.__mlCalls (для проверок в тестах). */
(function () {
  'use strict';
  const T = window.__ML_TEST || {};
  const USER = { id: 'test-user-0001', email: 'tester@example.com', app_metadata: { provider: 'email' } };
  const OTHER = 'other-user-0002';
  const rows = new Map(), foreign = new Map();   /* rows — записи USER, foreign — записи OTHER */
  const KEY = '__mlMockState';
  let saved = null;
  if (T.persist) { try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) {} }
  const put = (m, d) => m.set(d.col + '/' + d.id, { col: d.col, id: d.id, data: JSON.parse(JSON.stringify(d.data || {})) });
  for (const d of (saved ? saved.rows : (T.docs || []))) put(rows, d);
  for (const d of (saved ? saved.foreign : (T.otherDocs || []))) put(foreign, d);
  const deletedUsers = new Set(saved ? saved.deleted : []);
  const calls = (window.__mlCalls = []);
  const log = (op, a) => calls.push({ op, a: a === undefined ? null : JSON.parse(JSON.stringify(a)) });
  const ok = data => Promise.resolve({ data, error: null });
  let session = saved ? (saved.session ? { access_token: 'test', user: USER } : null) : (T.session === false ? null : { access_token: 'test', user: USER });
  if (T.persist) addEventListener('pagehide', () => { try { sessionStorage.setItem(KEY, JSON.stringify({ rows: [...rows.values()], foreign: [...foreign.values()], deleted: [...deletedUsers], session: !!session })); } catch (e) {} });
  if (T.accountDelete) {   /* config.js присваивает window.ML_CONFIG — подменяем только флаг accountDelete */
    let cfg; Object.defineProperty(window, 'ML_CONFIG', { configurable: true, get: () => cfg, set: v => { cfg = Object.assign({}, v, { accountDelete: true }); } });
  }
  const authCbs = [];

  function query(table) {
    if (table !== 'docs') throw new Error('mock: неизвестная таблица ' + table);
    return {
      select() {
        return {
          range(a, b) {
            log('select', { a, b });
            if (T.failLoad) return Promise.resolve({ data: null, error: { message: 'mock: сеть недоступна' } });
            return ok([...rows.values()].slice(a, b + 1).map(r => ({ col: r.col, id: r.id, data: JSON.parse(JSON.stringify(r.data)) })));
          }
        };
      },
      upsert(r) { log('upsert', r); rows.set(r.col + '/' + r.id, { col: r.col, id: r.id, data: JSON.parse(JSON.stringify(r.data || {})) }); return ok(null); },
      delete() { return { match(m) { log('delete', m); rows.delete(m.col + '/' + m.id); return ok(null); } }; }
    };
  }

  const client = {
    from: query,
    rpc(name, p) {
      log('rpc:' + name, p);
      if (name === 'doc_merge') {
        const k = p.p_col + '/' + p.p_id, cur = rows.get(k) || { col: p.p_col, id: p.p_id, data: {} };
        const next = Object.assign({}, cur.data);
        for (const key of Object.keys(p.p_patch || {})) {
          const v = p.p_patch[key];
          if (v && typeof v === 'object' && v.__delete__ === true) delete next[key]; else next[key] = v;
        }
        rows.set(k, { col: cur.col, id: cur.id, data: next });
        return ok(null);
      }
      if (name === 'delete_my_account') {
        try { sessionStorage.setItem('__mlDelCalls', String(+(sessionStorage.getItem('__mlDelCalls') || 0) + 1)); } catch (e) {}   /* счёт вызовов переживает перезагрузку */
        if (!session) return Promise.resolve({ data: null, error: { message: 'not signed in', code: '42501' } });
        rows.clear();                       /* delete from public.docs where owner = auth.uid() */
        deletedUsers.add(session.user.id);  /* delete from auth.users where id = auth.uid() — повторно: 0 строк */
        return ok(null);
      }
      return ok(null);
    },
    channel() { const ch = { on() { return ch; }, subscribe() { return ch; }, unsubscribe() {} }; return ch; },
    removeChannel() {},
    auth: {
      getSession: () => ok({ session }),
      getUser: () => ok({ user: session ? session.user : null }),
      onAuthStateChange(cb) { authCbs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword(c) { log('signIn', { email: c && c.email }); if (deletedUsers.has(USER.id)) return Promise.resolve({ data: { session: null, user: null }, error: { message: 'Invalid login credentials', status: 400 } }); session = { access_token: 'test', user: USER }; setTimeout(() => authCbs.forEach(f => f('SIGNED_IN', session)), 0); return ok({ session, user: USER }); },
      signUp(c) { log('signUp', { email: c && c.email }); return ok({ user: USER, session: null }); },
      signInWithOAuth() { log('oauth'); return ok({}); },
      signOut() { log('signOut'); session = null; return ok(null); },
      resetPasswordForEmail() { log('reset'); return ok({}); },
      updateUser() { log('updateUser'); return ok({ user: USER }); },
      resend() { log('resend'); return ok({}); }
    }
  };

  window.__mlRows = rows;
  window.__mlForeign = foreign;
  window.__mlDeletedUsers = deletedUsers;
  window.supabase = { createClient: () => client };
})();
