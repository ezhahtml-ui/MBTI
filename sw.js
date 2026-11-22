// MBTI service worker v5: network-first (with timeout) + offline fallback + Web Push
const CACHE='mbti-v25';   // v6: images moved out of index.html into img/ (cached below)
const SHELL=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./adaptive-engine.js','./question-bank.v1.json'];
const IMGS=["lb1.webp", "lb10.webp", "lb11.webp", "lb2.webp", "lb3.webp", "lb4.webp", "lb5.webp", "lb6.webp", "lb7.webp", "lb8.webp", "lb9.webp", "z0.webp", "z1.webp", "z10.webp", "z11.webp", "z2.webp", "z3.webp", "z4.webp", "z5.webp", "z6.webp", "z7.webp", "z8.webp", "z9.webp", "zi0.webp", "zi1.webp", "zi10.webp", "zi11.webp", "zi2.webp", "zi3.webp", "zi4.webp", "zi5.webp", "zi6.webp", "zi7.webp", "zi8.webp", "zi9.webp", "vip1.webp", "vip2.webp", "vip3.webp", "vip4.webp", "vip5.webp", "vip6.webp", "vf1.webp", "vn1.webp", "vf2.webp", "vn2.webp", "vf3.webp", "vn3.webp", "vf4.webp", "vn4.webp", "vf5.webp", "vn5.webp", "vf6.webp", "vn6.webp"].map(f=>'./img/'+f);
SHELL.push(...IMGS);
const CDN='cdn.jsdelivr.net';           // supabase-js + astronomy-engine (cached so the app opens offline)
const TIMEOUT=3000;

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
  if(/\.(webp|png|jpg|jpeg|svg|woff2?)$/i.test(u.pathname)){e.respondWith(cacheFirst(r));return}  // images/fonts never change: no network wait, no re-write
  e.respondWith(netFirst(r,r.mode==='navigate'));                     // HTML fallback only for page loads
});

// ---- Web Push (sent by the Supabase Edge Function) ----
self.addEventListener('push',e=>{
  let d={};
  try{d=e.data?e.data.json():{}}catch(_){d={body:e.data?e.data.text():''}}
  const o={
    body:d.body||'',icon:'./icon-192.png',badge:'./icon-192.png',
    lang:'ckb',dir:'rtl',vibrate:[200,100,200],silent:false,data:{url:d.url||'./'}
  };
  // renotify (sound/vibration again when a notification with the same tag is replaced) is only valid together with a tag
  if(d.tag){o.tag=d.tag;o.renotify=true}
  e.waitUntil(self.registration.showNotification(d.title||'MBTI',o)); /* iOS requires every push to show a notification */
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=new URL((e.notification.data&&e.notification.data.url)||'./',self.registration.scope).href;
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{
    for(const c of l){if(c.url.startsWith(self.registration.scope)&&'focus' in c)return c.focus()}
    return clients.openWindow(url);
  }));
});
