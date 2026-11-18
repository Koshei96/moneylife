/* MoneyLife — уведомления на телефон для напоминаний Ориона (18.11.2026, по просьбе владельца). Серверная функция Supabase.
   1) {op:'pub'} от вошедшего человека — публичный ключ VAPID для подписки телефона.
   2) Раз в минуту её вызывает расписание базы (pg_cron) с ключом x-cron-key. Она:
   - читает напоминания людей (копия в аккаунте: docs app/orion-rem) — наступившие больше 40 с назад и ещё не выполненные
     (40 с — запас: если приложение открыто, Орион скажет сам и отметит выполненным, двойного не будет);
   - шлёт пуш на телефоны человека (подписки: docs app/push-subs) и ставит метку «отправлено» в хранилище push/sent/…;
   - умершие подписки (404/410) убирает;
   - (этап 5) сверяет оповещения о цене (docs app/orion-alerts) с ценами Binance и шлёт сработавшие.
   Ключи VAPID функция создаёт сама при первом запуске и хранит в закрытом хранилище (push/vapid.json) — в приложение уходит только публичный.
   Ключ расписания проверяется по отпечатку SHA-256: сам ключ в коде не лежит. Текст напоминания — слова самого человека; больше ничего не уходит. */
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { sendPush, b64u } from './webpush.ts';

const URL_ = Deno.env.get('SUPABASE_URL') || '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CRON_SHA = '0a8d4a358e2e0e63c990342056852367588fd9c1f75bd8e96b0b505f2c085c44';
const CONTACT = 'https://koshei96.github.io/moneylife/';   /* контакт для службы пушей (RFC 8292): адрес приложения */
const GRACE = 40e3, MAX_LATE = 24 * 3600e3;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'content-type': 'application/json' } });
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(x => x.toString(16).padStart(2, '0')).join('');

// deno-lint-ignore no-explicit-any
async function vapid(store: any): Promise<{ pub: string; jwk: JsonWebKey } | null> {
  const r = await store.download('push/vapid.json');
  if (r.data) { try { const j = JSON.parse(await r.data.text()); if (j.pub && j.jwk) return j; } catch (_) { /* дальше */ } }
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey), pub = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
  const up = await store.upload('push/vapid.json', new Blob([JSON.stringify({ pub, jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, at: Date.now() })], { type: 'application/json' }), { upsert: false });
  if (up.error) { const again = await store.download('push/vapid.json'); if (again.data) { try { return JSON.parse(await again.data.text()); } catch (_) { return null; } } return null; }
  return { pub, jwk };
}

type Rem = { id: string; when: number; t: string; done?: boolean };
type Sub = { endpoint: string; keys: { p256dh: string; auth: string }; at?: number };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!URL_ || !SERVICE) return json({ error: 'not_configured' }, 503);
  const sb = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const store = sb.storage.from('orion-voice');
  const ck = req.headers.get('x-cron-key') || '';
  if (!ck || (await sha(ck)) !== CRON_SHA) {   /* не расписание — значит телефон просит публичный ключ */
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await sb.auth.getUser(jwt);
    if (!u || !u.user) return json({ error: 'auth' }, 401);
    const v = await vapid(store); if (!v) return json({ error: 'keys' }, 500);
    return json({ pub: v.pub });
  }
  const v = await vapid(store); if (!v) return json({ error: 'keys' }, 500);
  const JWK = v.jwk, PUB = v.pub;
  const now = Date.now();
  const { data: rows, error } = await sb.from('docs').select('owner,data').eq('col', 'app').eq('id', 'orion-rem');
  if (error) { console.error('orion-push: rem', error.message); return json({ error: 'db' }, 500); }
  let sent = 0, dead = 0, due = 0;
  for (const row of rows || []) {
    const items: Rem[] = ((row.data || {}).items || []).filter((x: Rem) => x && x.id && !x.done && +x.when <= now - GRACE && now - +x.when < MAX_LATE);
    if (!items.length) continue;
    const marks = await Promise.all(items.map(x => store.download(`push/sent/${row.owner}/${x.id}`).then(r => !!r.data).catch(() => false)));
    const todo = items.filter((_, i) => !marks[i]);
    if (!todo.length) continue;
    due += todo.length;
    const { data: sd } = await sb.from('docs').select('data').eq('owner', row.owner).eq('col', 'app').eq('id', 'push-subs').maybeSingle();
    const subs: Sub[] = ((sd && sd.data && sd.data.items) || []).filter((s: Sub) => s && s.endpoint && s.keys && s.keys.p256dh && s.keys.auth);
    /* метку ставим и без подписок: иначе каждую минуту одно и то же */
    const bad = new Set<string>();
    for (const x of todo) {
      const msg = { title: 'Напоминание · MoneyLife', body: String(x.t).slice(0, 200), url: './', tag: 'rem:' + x.id };
      for (const s of subs) {
        let st = 0; try { st = await sendPush(s, msg, JWK, PUB, CONTACT); } catch (e) { console.error('orion-push: send', String(e).slice(0, 200)); }
        if (st === 404 || st === 410) bad.add(s.endpoint); else if (st >= 200 && st < 300) sent++; else console.error('orion-push: status', st);
      }
      await store.upload(`push/sent/${row.owner}/${x.id}`, new Blob(['1'], { type: 'text/plain' }), { upsert: true }).catch(() => null);
    }
    if (bad.size) {
      dead += bad.size;
      await sb.from('docs').update({ data: { ...(sd && sd.data), items: subs.filter(s => !bad.has(s.endpoint)) }, updated_at: new Date().toISOString() }).eq('owner', row.owner).eq('col', 'app').eq('id', 'push-subs');
    }
  }
  /* 18.11.2026 (этап 5): оповещения о цене — точно в срок. Копия оповещений в аккаунте: docs app/orion-alerts.
     Цены — Binance раз в минуту, только если оповещения у кого-то есть. Сработавшее убираем из копии и пишем в fired — телефон снимет его у себя */
  const { data: arows } = await sb.from('docs').select('owner,data').eq('col', 'app').eq('id', 'orion-alerts');
  const al = (arows || []).map(r => ({ owner: r.owner as string, data: r.data || {}, items: (((r.data || {}).items) || []).filter((a: Al) => a && a.id && a.sym && +a.price > 0 && (a.dir === 'up' || a.dir === 'down')) as Al[] })).filter(r => r.items.length);
  let fired = 0;
  if (al.length) {
    const px = await prices(Array.from(new Set(al.flatMap(r => r.items.map(a => String(a.sym).toUpperCase())))).slice(0, 100));
    for (const r of al) {
      const hit = r.items.filter(a => { const p = px[String(a.sym).toUpperCase()]; return p > 0 && (a.dir === 'up' ? p >= +a.price : p <= +a.price); });
      if (!hit.length) continue;
      const marks = await Promise.all(hit.map(a => store.download(`push/sent/${r.owner}/al-${a.id}`).then(x => !!x.data).catch(() => false)));
      const todo = hit.filter((_, i) => !marks[i]);
      if (!todo.length) continue;
      const { data: sd } = await sb.from('docs').select('data').eq('owner', r.owner).eq('col', 'app').eq('id', 'push-subs').maybeSingle();
      const subs: Sub[] = ((sd && sd.data && sd.data.items) || []).filter((s: Sub) => s && s.endpoint && s.keys && s.keys.p256dh && s.keys.auth);
      const uk = r.data.lang === 'uk';
      for (const a of todo) {
        const p = px[String(a.sym).toUpperCase()], up = a.dir === 'up';
        const msg = { title: a.sym + (up ? (uk ? ' піднявся до ' : ' поднялся до ') : (uk ? ' опустився до ' : ' опустился до ')) + usdTxt(+a.price), body: (uk ? 'Зараз ' : 'Сейчас ') + usdTxt(p) + (uk ? '. Сповіщення спрацювало і зняте.' : '. Оповещение сработало и снято.'), url: './', tag: 'al:' + a.id };
        for (const s of subs) { try { const st = await sendPush(s, msg, JWK, PUB, CONTACT); if (st >= 200 && st < 300) sent++; else console.error('orion-push: al status', st); } catch (e) { console.error('orion-push: al send', String(e).slice(0, 200)); } }
        await store.upload(`push/sent/${r.owner}/al-${a.id}`, new Blob(['1'], { type: 'text/plain' }), { upsert: true }).catch(() => null);
        fired++;
      }
      const ids = new Set(todo.map(a => a.id)), was = Array.isArray(r.data.fired) ? r.data.fired : [];
      await sb.from('docs').update({ data: { ...r.data, items: (r.data.items || []).filter((a: Al) => !ids.has(a.id)), fired: was.concat(todo.map(a => ({ id: a.id, at: now, now: px[String(a.sym).toUpperCase()] }))).slice(-20) }, updated_at: new Date().toISOString() }).eq('owner', r.owner).eq('col', 'app').eq('id', 'orion-alerts');
    }
  }
  return json({ ok: true, due, sent, dead, fired });
});

type Al = { id: string; sym: string; price: number; dir: 'up' | 'down' };
const usdTxt = (v: number) => '$' + (v >= 100 ? Math.round(v).toLocaleString('ru-RU') : String(+v.toPrecision(4)).replace('.', ','));
/* цены монет к USDT; монеты, которых нет на Binance, просто пропускаем */
async function prices(syms: string[]) {
  const out: Record<string, number> = {}; const list = syms.filter(s => /^[A-Z0-9]{2,12}$/.test(s) && s !== 'USDT');
  if (!list.length) return out;
  for (const h of ['https://data-api.binance.vision', 'https://api.binance.com']) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), 6000);
    try {
      const r = await fetch(h + '/api/v3/ticker/price', { signal: c.signal }); if (!r.ok) continue;
      const all = await r.json(); if (!Array.isArray(all)) continue;
      const want = new Set(list.map(s => s + 'USDT'));
      for (const x of all) if (want.has(x.symbol)) out[String(x.symbol).replace(/USDT$/, '')] = +x.price || 0;
      return out;
    } catch (_) { /* следующий адрес */ } finally { clearTimeout(t); }
  }
  return out;
}
