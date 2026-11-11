/* MoneyLife — голос Ориона (11.11.2026). Серверная функция Supabase: текст → озвучка ElevenLabs (mp3).
   Ключ и голос — только в секретах Supabase (ELEVENLABS_API_KEY, ORION_VOICE_ID); в приложение не попадают.
   - пускает только вошедших пользователей (JWT из приложения);
   - готовые фразы хранит в закрытом хранилище orion-voice: одна и та же фраза одним голосом озвучивается один раз;
   - лимиты: на человека в сутки (ORION_DAY_LIMIT фраз, по умолчанию 80) и на всё приложение в месяц
     (ORION_MONTH_CHARS знаков, по умолчанию 120 000) — дальше приложение говорит голосом телефона;
   - модель — ORION_MODEL (по умолчанию eleven_multilingual_v2).
   Ответ: 200 audio/mpeg; 4xx/5xx JSON {error: 'auth'|'bad_text'|'day_limit'|'month_limit'|'not_configured'|'tts'} —
   приложение в этих случаях молча переходит на голос телефона. */
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const KEY = Deno.env.get('ELEVENLABS_API_KEY') || '';
const VOICE = Deno.env.get('ORION_VOICE_ID') || '';
const MODEL = Deno.env.get('ORION_MODEL') || 'eleven_multilingual_v2';
const DAY_LIMIT = +(Deno.env.get('ORION_DAY_LIMIT') || 80);
const MONTH_CHARS = +(Deno.env.get('ORION_MONTH_CHARS') || 120000);
/* интонация: настраивается секретами без нового выпуска. Выше стабильность — ровнее и спокойнее; style 0 — без «игры», реже странные ударения */
const VS = {
  stability: +(Deno.env.get('ORION_STABILITY') || 0.7),
  similarity_boost: +(Deno.env.get('ORION_SIMILARITY') || 0.8),
  style: +(Deno.env.get('ORION_STYLE') || 0),
  use_speaker_boost: true,
  speed: +(Deno.env.get('ORION_SPEED') || 1)
};
const BUCKET = 'orion-voice';
const URL_ = Deno.env.get('SUPABASE_URL') || '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'x-orion'
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'content-type': 'application/json' } });

async function sha256(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!KEY || !VOICE || !URL_ || !SERVICE) return json({ error: 'not_configured' }, 503);

  const sb = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: u } = await sb.auth.getUser(jwt);
  const user = u && u.user;
  if (!user) return json({ error: 'auth' }, 401);

  let text = '';
  try { const b = await req.json(); text = String((b && b.text) || ''); } catch (_) { /* пусто */ }
  text = text.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 700) return json({ error: 'bad_text' }, 400);

  const hash = await sha256(VOICE + '|' + MODEL + '|' + JSON.stringify(VS) + '|' + text);
  const path = 'phrases/' + hash.slice(0, 2) + '/' + hash + '.mp3';
  const store = sb.storage.from(BUCKET);

  /* 1. фраза уже озвучена — отдаём из хранилища, кредиты не тратятся */
  const hit = await store.download(path);
  if (hit.data) return new Response(hit.data, { headers: { ...CORS, 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=31536000', 'x-orion': 'cache' } });

  /* 2. лимиты: на человека в сутки и на приложение в месяц (счётчики — маленькие файлы в том же хранилище) */
  const now = new Date(), day = now.toISOString().slice(0, 10), month = day.slice(0, 7);
  const readNum = async (p: string) => { const r = await store.download(p); if (!r.data) return 0; try { return +(await r.data.text()) || 0; } catch (_) { return 0; } };
  const writeNum = (p: string, n: number) => store.upload(p, new Blob([String(n)], { type: 'text/plain' }), { upsert: true });
  const dayKey = 'usage/day/' + day + '/' + user.id + '.txt', monthKey = 'usage/month/' + month + '.txt';
  const [dn, mn] = await Promise.all([readNum(dayKey), readNum(monthKey)]);
  if (dn >= DAY_LIMIT) return json({ error: 'day_limit' }, 429);
  if (mn + text.length > MONTH_CHARS) return json({ error: 'month_limit' }, 429);

  /* 3. озвучка ElevenLabs */
  const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(VOICE) + '?output_format=mp3_44100_64', {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: MODEL, voice_settings: VS })
  });
  if (!r.ok) { let detail = ''; try { detail = (await r.text()).slice(0, 200); } catch (_) { /* пусто */ } return json({ error: 'tts', status: r.status, detail }, 502); }
  const audio = new Uint8Array(await r.arrayBuffer());

  /* 4. сохраняем фразу и счётчики (ошибка записи не мешает ответу) */
  await Promise.allSettled([
    store.upload(path, new Blob([audio], { type: 'audio/mpeg' }), { upsert: true, contentType: 'audio/mpeg' }),
    writeNum(dayKey, dn + 1),
    writeNum(monthKey, mn + text.length)
  ]);
  return new Response(audio, { headers: { ...CORS, 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=31536000', 'x-orion': 'new' } });
});
