/* MoneyLife service worker — версия подставляется при сборке */
const V='ml-20261027021500';
const SHELL=['./','index.html','shim.js','config.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','icons/apple-touch-icon.png','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js','three.min.js','mascot.js?v=20261027021500'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).catch(()=>{}));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('message',e=>{if(e.data==='skip')self.skipWaiting();});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET')return;
  if(/(^|\.)(supabase\.co|coingecko\.com|binance\.com|binance\.vision)$/.test(u.hostname))return; // данные и цены — только из сети
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(V).then(x=>x.put('index.html',c));return r;}).catch(()=>caches.match('index.html')));
    return;}
  e.respondWith(caches.match(e.request).then(m=>m||fetch(e.request).then(r=>{if(r.ok&&(u.origin===location.origin||u.hostname.includes('jsdelivr')||u.hostname.includes('gstatic')||u.hostname.includes('googleapis'))){const c=r.clone();caches.open(V).then(x=>x.put(e.request,c));}return r;})));
});
/* push-уведомления (этап 2) */
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{};}catch(x){d={body:e.data&&e.data.text()};}
  e.waitUntil(self.registration.showNotification(d.title||'MoneyLife',{body:d.body||'',icon:'icons/icon-192.png',badge:'icons/icon-192.png',data:{url:d.url||'./'}}));});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(self.clients.matchAll({type:'window'}).then(cs=>{for(const c of cs){if('focus' in c)return c.focus();}return self.clients.openWindow(e.notification.data&&e.notification.data.url||'./');}));});
