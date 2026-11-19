const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = '/home/claude/work';
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { r.writeHead(404); return r.end('nf'); }
  const ct = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webmanifest':'application/manifest+json'}[path.extname(f)]||'application/octet-stream';
  r.writeHead(200, {'Content-Type': ct+'; charset=utf-8'}); fs.createReadStream(f).pipe(r);
}).listen(8098);
const res = [];
const log = (n, ok, d='') => { res.push(ok); console.log((ok?'PASS ':'FAIL ')+n+(d?' | '+d:'')); };
const U='http://localhost:8098/index.html';
async function open(page){ await page.goto(U,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(800);
  await page.evaluate(()=>{document.querySelector('[data-box="mbti"]').click()}); await page.waitForTimeout(200);
  await page.evaluate(()=>{document.querySelector('#mBody [data-act="tests"]').click()}); await page.waitForTimeout(100); }
const q = page => page.evaluate(()=>{const p=document.querySelector('#mBody .m-qc p');return p?p.textContent:null});
async function ans(page,v){ await page.evaluate(v=>{document.querySelector('#mBody [data-act="aans"][data-v="'+v+'"]').click()},v); await page.waitForTimeout(260); }
(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport:{width:390,height:800}, serviceWorkers:'allow' });
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await open(page);
  // start adaptive
  await page.evaluate(()=>{document.querySelector('#mBody [data-act="astart"]').click()}); await page.waitForTimeout(800);
  const q1 = await q(page); log('adaptive starts and shows a question', !!q1, (q1||'').slice(0,40));
  // double click protection
  await page.evaluate(()=>{const b=document.querySelector('#mBody [data-act="aans"][data-v="100"]');b.click();b.click();b.click()}); await page.waitForTimeout(400);
  let st = await page.evaluate(()=>JSON.parse(localStorage.getItem('mbti_adp_v1')));
  log('triple click on one answer records exactly 1 answer', st && st.answers.length===1, st&&st.answers.length);
  // empty / invalid answer via engine
  // answer 4 more, then change via prev
  for (const v of [75,50,20]) await ans(page,v);
  st = await page.evaluate(()=>JSON.parse(localStorage.getItem('mbti_adp_v1'))); log('4 answers saved in localStorage', st.answers.length===4);
  const qBefore = await q(page);
  await page.evaluate(()=>{document.querySelector('#mBody [data-act="aprev"]').click()}); await page.waitForTimeout(200);
  st = await page.evaluate(()=>JSON.parse(localStorage.getItem('mbti_adp_v1'))); log('previous question: answers 4 -> 3', st.answers.length===3);
  await ans(page,100);
  st = await page.evaluate(()=>JSON.parse(localStorage.getItem('mbti_adp_v1'))); log('changed answer re-recorded (3 -> 4)', st.answers.length===4 && st.answers[3].level===100);
  // close app mid-test = reload; resume
  const qNow = await q(page);
  await page.reload({waitUntil:'domcontentloaded'}); await page.waitForTimeout(800);
  await page.evaluate(()=>{document.querySelector('[data-box="mbti"]').click()}); await page.waitForTimeout(150);
  await page.evaluate(()=>{document.querySelector('#mBody [data-act="tests"]').click()}); await page.waitForTimeout(100);
  const hasResume = await page.evaluate(()=>!!document.querySelector('#mBody [data-act="aresume"]'));
  log('after reload a resume button exists', hasResume);
  await page.evaluate(()=>{document.querySelector('#mBody [data-act="aresume"]').click()}); await page.waitForTimeout(800);
  log('resume shows the SAME next question', (await q(page))===qNow);
  // run to the end, collect question texts
  const seen=[qNow]; let n=4, lvl=[100,75,100,50,100,75,20,100];
  for(let i=0;i<150;i++){
    const t=await q(page); if(!t) break;
    if(i>0) seen.push(t);
    await ans(page, lvl[i%lvl.length]); n++;
  }
  const done = await page.evaluate(()=>!!document.querySelector('#mBody .m-hero'));
  log('test finishes with a result screen', done, 'answered≈'+n);
  log('no question text repeated', new Set(seen).size===seen.length, seen.length+' unique '+new Set(seen).size);
  log('min 20 answered / max 120', seen.length>=19 && seen.length<=120, String(seen.length+1));
  const cleared = await page.evaluate(()=>localStorage.getItem('mbti_adp_v1')===null);
  log('in-progress state cleared after finish', cleared);
  const txt = await page.evaluate(()=>document.querySelector('#mBody').innerText);
  log('result says facets unknown (هێشتا نادیار)', txt.includes('هێشتا نادیار'));
  log('result shows uncalibrated note', txt.includes('کالیبرە نەکراون'));
  log('save status shows failure honestly when not logged in', txt.includes('نەتوانرا هەڵبگیرێت')||txt.includes('هەڵدەگیرێت'), (txt.match(/ئەنجامەکە پیشان درا[^.]*\./)||[''])[0].slice(0,60));
  // BUG PROBE: re-open saved adaptive result via "دوایین ئەنجامت"
  await page.evaluate(()=>{window.__user={user_metadata:{mbti_type:'ENTJ',mbti_scores:{adp:{v:1,n:40,st:'bank_exhausted',d:[['E',0.4,'clear'],['N',0.3,'moderate'],['T',0.5,'clear'],['J',0.2,'low']]}}}}});
  await page.evaluate(()=>{document.querySelector('#mBody [data-act="tests"]').click()}); await page.waitForTimeout(100);
  await page.evaluate(()=>{document.querySelector('#mBody [data-act="res"]').click()}); await page.waitForTimeout(150);
  const pos = await page.evaluate(()=>[...document.querySelectorAll('#mBody .m-bp i')].map(e=>e.style.insetInlineStart||e.getAttribute('style')));
  const labs = await page.evaluate(()=>[...document.querySelectorAll('#mBody .m-cf')].map(e=>e.textContent));
  const ttl = await page.evaluate(()=>document.getElementById('mTitle').textContent);
  log('re-opened adaptive result renders 4 real positions (saved mu), not 4x50%', pos.length===4 && new Set(pos).size>1, JSON.stringify(pos));
  log('re-opened adaptive result keeps honest confidence labels', labs.length===4 && labs[3].includes('نادڵنیا'), JSON.stringify(labs));
  log('re-opened result has a title and no legacy 50% text', ttl.length>0 && !(await page.evaluate(()=>document.querySelector('#mBody').innerText)).includes('٥٠٪'));
  // legacy-format saved result must still render exactly as before
  await page.evaluate(()=>{window.__user={user_metadata:{mbti_type:'ENTJ',mbti_scores:{E:80,N:70,T:90,J:60}}}});
  await page.evaluate(()=>{document.querySelector('#mBody [data-act="tests"]').click()}); await page.waitForTimeout(100);
  await page.evaluate(()=>{document.querySelector('#mBody [data-act="res"]').click()}); await page.waitForTimeout(150);
  const leg = await page.evaluate(()=>[...document.querySelectorAll('#mBody .pc')].map(e=>e.textContent));
  log('legacy (60-question) saved result still renders with its percentages', leg.length===4 && leg[0].includes('٨٠') && leg[2].includes('٩٠'), JSON.stringify(leg));
  console.log('PAGEERRORS(non-network):', JSON.stringify(errs));
  // OFFLINE
  await br.close();
  // fresh context for SW/offline tests
  const br2 = await chromium.launch(); const c2 = await br2.newContext({serviceWorkers:'allow'}); const p2 = await c2.newPage();
  await p2.goto(U,{waitUntil:'load'}); await p2.waitForTimeout(2500);
  const swInfo = await p2.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();const ks=await caches.keys();const out={};for(const k of ks){out[k]=(await (await caches.open(k)).keys()).map(x=>new URL(x.url).pathname)}return {reg:!!r,out}});
  console.log('SW', JSON.stringify(swInfo));
  const cachedEngine = Object.values(swInfo.out).flat().includes('/adaptive-engine.js'), cachedBank = Object.values(swInfo.out).flat().includes('/question-bank.v1.json');
  log('SW registered', swInfo.reg);
  log('adaptive-engine.js is cached after 1st online visit', cachedEngine);
  log('question bank is cached after 1st online visit (before user opens adaptive test)', cachedBank);
  await c2.setOffline(true);
  await p2.reload({waitUntil:'domcontentloaded'}).catch(e=>console.log('reload offline err',e.message.slice(0,80))); await p2.waitForTimeout(800);
  log('offline reload still opens the app', await p2.evaluate(()=>!!document.getElementById('mBody')));
  log('offline: engine still available', await p2.evaluate(()=>!!window.MbtiAdaptive));
  await p2.evaluate(()=>{document.querySelector('[data-box="mbti"]').click()}); await p2.waitForTimeout(150);
  await p2.evaluate(()=>{document.querySelector('#mBody [data-act="tests"]').click()});
  await p2.evaluate(()=>{document.querySelector('#mBody [data-act="astart"]').click()}); await p2.waitForTimeout(900);
  log('offline: adaptive test can start (bank cached)', !!(await q(p2)), (await p2.evaluate(()=>document.querySelector('#mBody').innerText)).slice(0,60));
  await br2.close(); srv.close();
  console.log('\nTOTAL',res.length,'FAILED',res.filter(x=>!x).length);
})().catch(e=>{console.log('CRASH',e.stack.slice(0,500)); process.exit(1)});
