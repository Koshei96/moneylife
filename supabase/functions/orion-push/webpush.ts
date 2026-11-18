/* Web Push без библиотек (18.11.2026): подпись VAPID (RFC 8292) и шифрование aes128gcm (RFC 8291) на встроенной WebCrypto.
   Ключи: публичный — в приложении, закрытый (JWK) — только на сервере, в закрытом хранилище. */
const te = new TextEncoder();
export const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64u = (s: string) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); const r = atob(t + '==='.slice((t.length + 3) % 4)); return Uint8Array.from(r, c => c.charCodeAt(0)); };
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
export async function vapidAuth(endpoint: string, jwk: JsonWebKey, pub: string, sub: string) {
  const key = await crypto.subtle.importKey('jwk', { ...jwk, key_ops: ['sign'], ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const h = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const c = b64u(te.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(h + '.' + c)));
  return `vapid t=${h}.${c}.${b64u(sig)}, k=${pub}`;
}
export async function encrypt(payload: Uint8Array, p256dh: string, auth: string, fixed?: { salt: Uint8Array; pair: CryptoKeyPair }) {
  const ua = unb64u(p256dh), sec = unb64u(auth);
  const pair = fixed ? fixed.pair : await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256));
  const ikm = await hkdf(sec, shared, cat(te.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = fixed ? fixed.salt : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, cat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   /* размер записи 4096 */
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
/* отправка: {status} — 201 доставлено; 404/410 — подписка умерла (удалить) */
export async function sendPush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, data: unknown, jwk: JsonWebKey, pub: string, contact: string) {
  const body = await encrypt(te.encode(JSON.stringify(data)), sub.keys.p256dh, sub.keys.auth);
  const r = await fetch(sub.endpoint, { method: 'POST', headers: { Authorization: await vapidAuth(sub.endpoint, jwk, pub, contact), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' }, body });
  await r.body?.cancel().catch(() => {});
  return r.status;
}
