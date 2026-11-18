/* MoneyLife — уведомления на телефон для напоминаний Ориона (18.11.2026, по просьбе владельца). Серверная функция Supabase.
   1) {op:'pub'} от вошедшего человека — публичный ключ VAPID для подписки телефона.
   2) Раз в минуту её вызывает расписание базы (pg_cron) с ключом x-cron-key. Она:
   - читает напоминания людей (копия в аккаунте: docs app/orion-rem) — наступившие больше 40 с назад и ещё не выполненные
     (40 с — запас: если приложение открыто, Орион скажет сам и отметит выполненным, двойного не будет);
   - шлёт пуш на телефоны человека (подписки: docs app/push-subs) и ставит метку «отправлено» в хранилище push/sent/…;
   - умершие подписки (404/410) убирает;
   - (этап 5) сверяет оповещения о цене (docs app/orion-alerts) с ценами Binance и шлёт сработавшие;
   - (этап 5) ступени лестницы и цель BTC, конец месяца — план не выполнен или серия под угрозой (docs app/orion-signals).
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
  const [{ data: arows }, { data: srows }] = await Promise.all([
    sb.from('docs').select('owner,data').eq('col', 'app').eq('id', 'orion-alerts'),
    sb.from('docs').select('owner,data').eq('col', 'app').eq('id', 'orion-signals')
  ]);
  const al = (arows || []).map(r => ({ owner: r.owner as string, data: r.data || {}, items: (((r.data || {}).items) || []).filter((a: Al) => a && a.id && a.sym && +a.price > 0 && (a.dir === 'up' || a.dir === 'down')) as Al[] })).filter(r => r.items.length);
  const sg = (srows || []).filter(r => r.data && r.data.on);
  const want = new Set(al.flatMap(r => r.items.map(a => String(a.sym).toUpperCase()))); if (sg.length) want.add('BTC');
  const px = want.size ? await prices(Array.from(want).slice(0, 100)) : {};
  let fired = 0, sig = 0;
  if (al.length) {
    for (const r of al) {
      const hit = r.items.filter(a => { const p = px[String(a.sym).toUpperCase()]; return p > 0 && (a.dir === 'up' ? p >= +a.price : p <= +a.price); });
      if (!hit.length) continue;
      const marks = await Promise.all(hit.map(a => store.download(`push/sent/${r.owner}/al-${a.id}`).then(x => !!x.data).catch(() => false)));
      const todo = hit.filter((_, i) => !marks[i]);
      if (!todo.length) continue;
      const { data: sd } = await sb.from('docs').select('data').eq('owner', r.owner).eq('col', 'app').eq('id', 'push-subs').maybeSingle();
      const subs: Sub[] = ((sd && sd.data && sd.data.items) || []).filter((s: Sub) => s && s.endpoint && s.keys && s.keys.p256dh && s.keys.auth);
      const uk = r.data.lang === 'uk', silent = isNight(r.data.tz, now);   /* №12: ночью — без звука */
      for (const a of todo) {
        const p = px[String(a.sym).toUpperCase()], up = a.dir === 'up';
        const msg = { silent, title: a.sym + (up ? (uk ? ' піднявся до ' : ' поднялся до ') : (uk ? ' опустився до ' : ' опустился до ')) + usdTxt(+a.price), body: (uk ? 'Зараз ' : 'Сейчас ') + usdTxt(p) + (uk ? '. Сповіщення спрацювало і зняте.' : '. Оповещение сработало и снято.'), url: './', tag: 'al:' + a.id };
        for (const s of subs) { try { const st = await sendPush(s, msg, JWK, PUB, CONTACT); if (st >= 200 && st < 300) sent++; else console.error('orion-push: al status', st); } catch (e) { console.error('orion-push: al send', String(e).slice(0, 200)); } }
        await store.upload(`push/sent/${r.owner}/al-${a.id}`, new Blob(['1'], { type: 'text/plain' }), { upsert: true }).catch(() => null);
        fired++;
      }
      const ids = new Set(todo.map(a => a.id)), was = Array.isArray(r.data.fired) ? r.data.fired : [];
      await sb.from('docs').update({ data: { ...r.data, items: (r.data.items || []).filter((a: Al) => !ids.has(a.id)), fired: was.concat(todo.map(a => ({ id: a.id, at: now, now: px[String(a.sym).toUpperCase()] }))).slice(-20) }, updated_at: new Date().toISOString() }).eq('owner', r.owner).eq('col', 'app').eq('id', 'orion-alerts');
    }
  }
  /* 18.11.2026 (этап 5, часть 2): ступени лестницы и цель BTC (ключ 1 — по цене), конец месяца: план не выполнен / серия под угрозой.
     Копия сигналов: docs app/orion-signals (пишет телефон, когда включены «Сигналы на телефоне»). Отправленное — в data.sent: телефон заберёт и не повторит */
  const btc = +px.BTC || 0;
  for (const r of sg) {
    const d = r.data, uk = d.lang === 'uk', sentK: Record<string, number> = { ...(d.sent || {}) }, ev: { k: string; title: string; body: string }[] = [];
    if (btc > 0) {
      for (const l of Array.isArray(d.levels) ? d.levels : []) {
        if (!l || !(+l.price > 0) || btc > +l.price) continue;
        const b = 'lv:' + (d.athDate || d.ath) + ':' + l.n + (l.r ? ':r' + l.r : ''), k = b + ':k1';
        if (sentK[b + ':go']) continue;   /* «можно докупить» уже показан телефоном — «ступень открыта» не нужна */
        ev.push({ k, title: (uk ? 'Сходинка ' : 'Ступень ') + l.n + (uk ? ' відкрита' : ' открыта'), body: (uk ? 'BTC дійшов до −' : 'BTC дошёл до −') + l.drop + (uk ? '% від максимуму ($' : '% от максимума ($') + Math.round(+l.price).toLocaleString('ru-RU') + (uk ? '). Ключ 2 перевірить застосунок.' : '). Ключ 2 проверит приложение.') });
      }
      if (+d.goal > 0 && btc >= +d.goal) ev.push({ k: 'goal:' + d.goal, title: uk ? 'BTC дійшов до твоєї цілі' : 'BTC дошёл до твоей цели', body: (uk ? 'Ціна вище $' : 'Цена выше $') + Math.round(+d.goal).toLocaleString('ru-RU') + (uk ? '. Що робити далі — за твоїм планом.' : '. Что делать дальше — по твоему плану.') });
    }
    const m = monthNote(d, now, uk); if (m) ev.push(m);
    const dn = depNote(d, now, uk); if (dn) ev.push(dn);
    const todo: typeof ev = [];
    for (const e of ev) {
      if (sentK[e.k]) continue;
      const mk = `push/sent/${r.owner}/sig-${e.k.replace(/[^A-Za-z0-9_-]+/g, '_')}`;
      const was = await store.download(mk).then(x => !!x.data).catch(() => false);
      if (was) { sentK[e.k] = now; continue; }
      todo.push(e); await store.upload(mk, new Blob(['1'], { type: 'text/plain' }), { upsert: true }).catch(() => null); sentK[e.k] = now;
    }
    if (todo.length) {
      const { data: sd } = await sb.from('docs').select('data').eq('owner', r.owner).eq('col', 'app').eq('id', 'push-subs').maybeSingle();
      const subs: Sub[] = ((sd && sd.data && sd.data.items) || []).filter((s: Sub) => s && s.endpoint && s.keys && s.keys.p256dh && s.keys.auth);
      for (const e of todo) { sig++; for (const s of subs) { try { const st = await sendPush(s, { title: e.title, body: e.body, url: './', tag: e.k, silent: isNight(d.tz, now) }, JWK, PUB, CONTACT); if (st >= 200 && st < 300) sent++; } catch (x) { console.error('orion-push: sig send', String(x).slice(0, 200)); } } }
    }
    if (Object.keys(sentK).length !== Object.keys(d.sent || {}).length) {
      const keep: Record<string, number> = {}; Object.keys(sentK).sort((a, b) => sentK[b] - sentK[a]).slice(0, 40).forEach(k => { keep[k] = sentK[k]; });
      await sb.from('docs').update({ data: { ...d, sent: keep }, updated_at: new Date().toISOString() }).eq('owner', r.owner).eq('col', 'app').eq('id', 'orion-signals');
    }
  }
  return json({ ok: true, due, sent, dead, fired, sig });
});

/* местные дата и час человека (часовой пояс телефона) */
function localParts(tz0: unknown, now: number) {
  let tz = String(tz0 || 'Europe/Kyiv'); try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); } catch (_) { tz = 'Europe/Kyiv'; }
  const p: Record<string, string> = {}; for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, day: +p.day, h: +p.hour, ymd: p.year + '-' + p.month + '-' + p.day };
}
/* №12: тихие часы — с 23 до 7 по местному времени уведомления о цене и сигналах приходят без звука; напоминания — как обычно */
const isNight = (tz: unknown, now: number) => { const h = localParts(tz, now).h; return h >= 23 || h < 7; };
/* №13: день пополнения (из настроек) — с 10 до 20, если пополнения сегодня ещё не было; раз в день. Без сумм */
// deno-lint-ignore no-explicit-any
function depNote(d: any, now: number, uk: boolean) {
  const dep = d.dep || {}, dd = +dep.day || 0; if (!(dd >= 1 && dd <= 31)) return null;
  const L = localParts(d.tz, now), last = new Date(Date.UTC(L.y, L.mo, 0)).getUTCDate();
  if (L.day !== Math.min(dd, last) || L.h < 10 || L.h >= 20 || dep.last === L.ymd) return null;
  return { k: 'dep:' + L.ymd, title: uk ? 'MoneyLife · день поповнення' : 'MoneyLife · день пополнения', body: uk ? 'Сьогодні ваш день поповнення біржі. Поповнили — запишіть у застосунку, щоб план місяця порахувався.' : 'Сегодня ваш день пополнения биржи. Пополнили — запишите в приложении, чтобы план месяца посчитался.' };
}

/* конец месяца по местному времени человека: последние 3 дня, с 10 до 20 часов, один раз за месяц. Без сумм — уведомление видно на экране блокировки */
// deno-lint-ignore no-explicit-any
function monthNote(d: any, now: number, uk: boolean) {
  let tz = String(d.tz || 'Europe/Kyiv'); try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); } catch (_) { tz = 'Europe/Kyiv'; }
  const p: Record<string, string> = {}; for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now))) p[x.type] = x.value;
  const y = +p.year, mo = +p.month, day = +p.day, h = +p.hour, last = new Date(Date.UTC(y, mo, 0)).getUTCDate(), left = last - day;
  if (left > 2 || h < 10 || h >= 20) return null;
  const ym = y + '-' + String(mo).padStart(2, '0'), prev = (mo === 1 ? (y - 1) + '-12' : y + '-' + String(mo - 1).padStart(2, '0'));
  const pl = d.plan || {}, st = d.streak || {};
  const planNeed = pl.ym === ym ? !!pl.need : !!pl.hasPlan;   /* телефон в этом месяце не открывали — значит, план месяца ещё не начат */
  const n = st.ym === ym ? (st.thisMonth ? 0 : +st.n || 0) : st.ym === prev && st.thisMonth ? +st.n || 0 : 0;
  if (!planNeed && !(n >= 2)) return null;
  const lw = left === 0 ? (uk ? 'Сьогодні останній день місяця.' : 'Сегодня последний день месяца.') : (uk ? 'До кінця місяця ' + left + (left === 1 ? ' день.' : ' дні.') : 'До конца месяца ' + left + (left === 1 ? ' день.' : ' дня.'));
  const bits: string[] = [];
  if (planNeed) bits.push(uk ? 'План покупок ще не виконано' : 'План покупок ещё не выполнен');
  if (n >= 2) bits.push(uk ? 'серія ' + n + ' міс. поспіль під загрозою' : 'серия ' + n + ' мес. подряд под угрозой');
  const b = bits.join(', '); return { k: 'month:' + ym, title: uk ? 'MoneyLife · кінець місяця' : 'MoneyLife · конец месяца', body: lw + ' ' + b.charAt(0).toUpperCase() + b.slice(1) + (uk ? '. Рішення — за вами.' : '. Решение — за вами.') };
}

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
