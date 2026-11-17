// MBTI service worker v3: network-first (with timeout) + offline fallback + Web Push
const CACHE='mbti-v3';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
const CDN='cdn.jsdelivr.net';           // supabase-js + astronomy-engine (cached so the app opens offline)
const TIMEOUT=4000;

self.addEventListener('install',e=>{
  // each file is cached on its own: one missing file no longer breaks the whole precache
  e.waitUntil(caches.open(CACHE).then(c=>Promise.all(SHELL.map(u=>c.add(u).catch(()=>{})))));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});

function netFirst(r,fallbackToShell){
  const net=new Promise((ok,no)=>{
    const t=setTimeout(()=>no(new Error('timeout')),TIMEOUT);
    fetch(r).then(res=>{clearTimeout(t);ok(res)},err=>{clearTimeout(t);no(err)});
  });
  return net.then(res=>{
    if(res&&res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(r,copy)).catch(()=>{})}
    return res;
  }).catch(()=>caches.match(r).then(m=>m||(fallbackToShell?caches.match('./index.html'):Response.error())));
}
function cacheFirst(r){
  return caches.match(r).then(m=>m||fetch(r).then(res=>{
    if(res&&(res.ok||res.type==='opaque')){const copy=res.clone();caches.open(CACHE).then(c=>c.put(r,copy)).catch(()=>{})}
    return res;
  }));
}
self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET')return;
  const u=new URL(r.url);
  if(u.hostname===CDN){e.respondWith(cacheFirst(r));return}          // pinned library versions
  if(u.origin!==location.origin)return;                               // never touch Supabase API etc.
  e.respondWith(netFirst(r,r.mode==='navigate'));                     // HTML fallback only for page loads
});

// ---- Web Push (sent by the Supabase Edge Function) ----
self.addEventListener('push',e=>{
  let d={};
  try{d=e.data?e.data.json():{}}catch(_){d={body:e.data?e.data.text():''}}
  e.waitUntil(self.registration.showNotification(d.title||'MBTI',{
    body:d.body||'',icon:'./icon-192.png',badge:'./icon-192.png',
    tag:d.tag||'zday',lang:'ckb',dir:'rtl',data:{url:d.url||'./'}
  }));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=new URL((e.notification.data&&e.notification.data.url)||'./',self.registration.scope).href;
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{
    for(const c of l){if(c.url.startsWith(self.registration.scope)&&'focus' in c)return c.focus()}
    return clients.openWindow(url);
  }));
});
