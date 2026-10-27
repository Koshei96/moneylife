/* MoneyLife service worker — версия подставляется при сборке */
const V='ml-20261027163000';
/* KEEP — неизменные файлы (логотипы, голос с хэшем в имени, библиотеки, шрифты): переживают обновления версии и не качаются заново */
const KEEP='ml-keep-6';
const IMM=['three.min.js','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js'];
/* картинки монет CoinGecko — с CORS, поэтому кэшируются как обычные файлы */
const CGIMG='coin-images.coingecko.com';
const isKeep=u=>(u.origin===location.origin&&(/\/logos\//.test(u.pathname)||/\.bin$/.test(u.pathname)||/three\.min\.js$/.test(u.pathname)||/\/data\/coins-[ab]\.[0-9a-f]+\.json$/.test(u.pathname)))||/supabase-js@[0-9.]+\//.test(u.href)||u.hostname.includes('gstatic')||u.hostname===CGIMG;
const SHELL=['./','index.html','shim.js','config.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png','mascot.js?v=20261027163000'];
self.addEventListener('install',e=>{e.waitUntil(Promise.all([caches.open(V).then(c=>c.addAll(SHELL)).catch(()=>{}),caches.open(KEEP).then(async c=>{for(const x of IMM){if(!(await c.match(x)))await c.add(x).catch(()=>{});}})]));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V&&k!==KEEP).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('message',e=>{if(e.data==='skip')self.skipWaiting();});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET')return;
  if(/(^|\.)(supabase\.co|coingecko\.com|binance\.com|binance\.vision)$/.test(u.hostname)&&u.hostname!==CGIMG)return; // данные и цены — только из сети
  /* оглавление справочника монет: сначала сеть (раз в неделю обновляется), без сети — сохранённая копия */
  if(u.origin===location.origin&&/\/data\/coins\.json$/.test(u.pathname)){
    e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(KEEP).then(x=>x.put('data/coins.json',c));}return r;}).catch(()=>caches.open(KEEP).then(c=>c.match('data/coins.json')).then(m=>m||Response.error())));
    return;}
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(V).then(x=>x.put('index.html',c));return r;}).catch(()=>caches.match('index.html')));
    return;}
  if(isKeep(u)){e.respondWith(caches.open(KEEP).then(c=>c.match(e.request).then(m=>m||fetch(e.request).then(r=>{if(r.ok||r.type==='opaque')c.put(e.request,r.clone());return r;}))));return;}
  e.respondWith(caches.match(e.request).then(m=>m||fetch(e.request).then(r=>{if(r.ok&&(u.origin===location.origin||u.hostname.includes('jsdelivr')||u.hostname.includes('gstatic')||u.hostname.includes('googleapis'))){const c=r.clone();caches.open(V).then(x=>x.put(e.request,c));}return r;})));
});
/* push-уведомления (этап 2) */
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{};}catch(x){d={body:e.data&&e.data.text()};}
  e.waitUntil(self.registration.showNotification(d.title||'MoneyLife',{body:d.body||'',icon:'icons/icon-192.png',badge:'icons/icon-192.png',data:{url:d.url||'./'}}));});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(self.clients.matchAll({type:'window'}).then(cs=>{for(const c of cs){if('focus' in c)return c.focus();}return self.clients.openWindow(e.notification.data&&e.notification.data.url||'./');}));});
