const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const http=require('http'),fs=require('fs'),path=require('path'),root='/home/claude/work';
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(root,p);if(!fs.existsSync(f)){r.writeHead(404);return r.end()}
 const ct={'.html':'text/html','.js':'text/javascript','.json':'application/json'}[path.extname(f)]||'application/octet-stream';r.writeHead(200,{'Content-Type':ct+'; charset=utf-8'});fs.createReadStream(f).pipe(r)}).listen(8097);
let bad=0;const log=(n,ok,d='')=>{if(!ok)bad++;console.log((ok?'PASS ':'FAIL ')+n+(d?' | '+d:''))};
(async()=>{const br=await chromium.launch();const pg=await (await br.newContext({viewport:{width:390,height:800}})).newPage();const errs=[];pg.on('pageerror',e=>errs.push(e.message));
 const U='http://localhost:8097/index.html';
 await pg.goto(U,{waitUntil:'domcontentloaded'});await pg.waitForTimeout(700);
 const click=s=>pg.evaluate(s=>document.querySelector(s).click(),s);
 await click('[data-box="mbti"]');await click('#mBody [data-act="tests"]');
 await click('#mBody [data-act="start"][data-n="20"]');await pg.waitForTimeout(150);
 for(let i=0;i<5;i++){await click('#mBody [data-act="ans"][data-v="2"]');await pg.waitForTimeout(260)}
 let p=await pg.evaluate(()=>JSON.parse(localStorage.getItem('mbti_prog_v1')));log('legacy: progress saved under mbti_prog_v1 (5 of 20)',p&&p.n===20&&p.a.length===5);
 await pg.reload({waitUntil:'domcontentloaded'});await pg.waitForTimeout(700);
 await click('[data-box="mbti"]');await click('#mBody [data-act="tests"]');
 log('legacy: resume row present after reload',await pg.evaluate(()=>!!document.querySelector('#mBody [data-act="resume"]')));
 await click('#mBody [data-act="resume"]');await pg.waitForTimeout(150);
 for(let i=0;i<15;i++){await click('#mBody [data-act="ans"][data-v="'+(i%2?-2:2)+'"]');await pg.waitForTimeout(260)}
 log('legacy: finishes 20 questions with a 4-letter type',await pg.evaluate(()=>/^[EI][SN][TF][JP]$/.test(window.__mLast||'')),await pg.evaluate(()=>window.__mLast));
 log('legacy: progress key cleared after finish',await pg.evaluate(()=>localStorage.getItem('mbti_prog_v1')===null));
 log('no JS errors',errs.length===0,JSON.stringify(errs));
 await br.close();srv.close();console.log('FAILED',bad)})().catch(e=>{console.log('CRASH',e.message);process.exit(1)});
