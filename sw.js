/* MoneyLife service worker — версия подставляется при сборке */
const V='ml-20261110134500';
/* KEEP — неизменные файлы (логотипы, голос с хэшем в имени, библиотеки, шрифты): переживают обновления версии и не качаются заново */
const KEEP='ml-keep-6';
/* CFGC — настройки сигналов, которые кладёт приложение (plus.js): ступени лестницы, цель BTC, уже показанные события */
const CFGC='ml-cfg';
const IMM=['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js'];
/* картинки монет CoinGecko — с CORS, поэтому кэшируются как обычные файлы */
const CGIMG='coin-images.coingecko.com';
const isKeep=u=>(u.origin===location.origin&&(/\/logos\//.test(u.pathname)||/\.bin$/.test(u.pathname)||/three\.min\.js$/.test(u.pathname)||/\/data\/coins-[ab]\.[0-9a-f]+\.json$/.test(u.pathname)))||/supabase-js@[0-9.]+\//.test(u.href)||u.hostname.includes('gstatic')||u.hostname===CGIMG;
const SHELL=['./','index.html','shim.js','config.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png','icons/icon-maskable-512.png','icons/badge-96.png','plus.js?v=20261110134500','mascot.js?v=20261110134500'];
self.addEventListener('install',e=>{e.waitUntil(Promise.all([caches.open(V).then(c=>c.addAll(SHELL)).catch(()=>{}),caches.open(KEEP).then(async c=>{for(const x of IMM){if(!(await c.match(x)))await c.add(x).catch(()=>{});}})]));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V&&k!==KEEP&&k!==CFGC).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
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
    /* под именем index.html кэшируем только само приложение, а не privacy.html/delete.html — иначе без сети откроется не та страница */
    const app=/\/(index\.html)?$/.test(u.pathname);
    e.respondWith(fetch(e.request).then(r=>{if(app&&r.ok){const c=r.clone();caches.open(V).then(x=>x.put('index.html',c));}return r;}).catch(()=>app?caches.match('index.html'):caches.match(e.request).then(m=>m||caches.match('index.html'))));
    return;}
  if(isKeep(u)){e.respondWith(caches.open(KEEP).then(c=>c.match(e.request).then(m=>m||fetch(e.request).then(r=>{if(r.ok||r.type==='opaque')c.put(e.request,r.clone());return r;}))));return;}
  e.respondWith(caches.match(e.request).then(m=>m||fetch(e.request).then(r=>{if(r.ok&&(u.origin===location.origin||u.hostname.includes('jsdelivr')||u.hostname.includes('gstatic')||u.hostname.includes('googleapis'))){const c=r.clone();caches.open(V).then(x=>x.put(e.request,c));}return r;})));
});
/* push-уведомления (этап 2) */
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{};}catch(x){d={body:e.data&&e.data.text()};}
  e.waitUntil(self.registration.showNotification(d.title||'MoneyLife',{body:d.body||'',icon:'icons/icon-192.png',badge:'icons/badge-96.png',data:{url:d.url||'./'}}));});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(self.clients.matchAll({type:'window'}).then(cs=>{for(const c of cs){if('focus' in c)return c.focus();}return self.clients.openWindow(e.notification.data&&e.notification.data.url||'./');}));});
/* сигналы в фоне (10.11.2026): раз в несколько часов, когда разрешит телефон, сверяем цену BTC со ступенями лестницы (ключ 1) и с целью.
   Ключ 2 в фоне не проверяется — его считает приложение по записям человека. Та же логика событий — в plus.js (sigEvents). */
function mlEvents(cfg,btc){const ev=[],seen=cfg.seen||{};if(!(btc>0))return ev;
  for(const l of cfg.levels||[]){if(!(btc<=l.price))continue;const k='lv:'+(cfg.athDate||cfg.ath)+':'+l.n+':k1';if(seen[k]||seen['lv:'+(cfg.athDate||cfg.ath)+':'+l.n+':go'])continue;
    ev.push({k,title:'Ступень '+l.n+' открыта',body:'BTC дошёл до −'+l.drop+'% от максимума ($'+Math.round(l.price).toLocaleString('ru-RU')+'). Ключ 2 проверит приложение.'});}
  if(cfg.goal>0&&btc>=cfg.goal){const k='goal:'+cfg.goal;if(!seen[k])ev.push({k,title:'BTC дошёл до твоей цели',body:'Цена выше $'+Math.round(cfg.goal).toLocaleString('ru-RU')+'. Что делать дальше — по твоему плану.'});}
  return ev;}
async function mlCheck(){const ch=await caches.open(CFGC),r=await ch.match('cfg.json');if(!r)return;let cfg;try{cfg=await r.json();}catch(e){return;}if(!cfg||!cfg.on)return;
  let btc=0;for(const h of ['https://data-api.binance.vision','https://api.binance.com']){try{const j=await (await fetch(h+'/api/v3/ticker/price?symbol=BTCUSDT')).json();btc=+j.price||0;if(btc)break;}catch(e){}}
  const ev=mlEvents(cfg,btc);if(!ev.length)return;cfg.seen=cfg.seen||{};
  for(const e of ev){cfg.seen[e.k]=Date.now();await self.registration.showNotification(e.title,{body:e.body,tag:e.k,icon:'icons/icon-192.png',badge:'icons/badge-96.png',data:{url:'./'}});}
  await ch.put('cfg.json',new Response(JSON.stringify(cfg),{headers:{'content-type':'application/json'}}));}
self.addEventListener('periodicsync',e=>{if(e.tag==='ml-check')e.waitUntil(mlCheck());});
