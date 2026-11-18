/* MoneyLife — уведомления на телефон для напоминаний Ориона (18.11.2026, по просьбе владельца). Серверная функция Supabase.
   1) {op:'pub'} от вошедшего человека — публичный ключ VAPID для подписки телефона.
   2) Раз в минуту её вызывает расписание базы (pg_cron) с ключом x-cron-key. Она:
   - читает напоминания людей (копия в аккаунте: docs app/orion-rem) — наступившие больше 40 с назад и ещё не выполненные
     (40 с — запас: если приложение открыто, Орион скажет сам и отметит выполненным, двойного не будет);
   - шлёт пуш на телефоны человека (подписки: docs app/push-subs) и ставит метку «отправлено» в хранилище push/sent/…;
   - умершие подписки (404/410) убирает.
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
  return json({ ok: true, due, sent, dead });
});
