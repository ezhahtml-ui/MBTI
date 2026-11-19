const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const http=require('http'),fs=require('fs'),path=require('path'),root='/home/claude/work';
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(root,p);if(!fs.existsSync(f)){r.writeHead(404);return r.end()}
 const ct={'.html':'text/html','.js':'text/javascript','.json':'application/json'}[path.extname(f)]||'application/octet-stream';r.writeHead(200,{'Content-Type':ct+'; charset=utf-8'});fs.createReadStream(f).pipe(r)}).listen(8096);
let bad=0;const log=(n,ok,d='')=>{if(!ok)bad++;console.log((ok?'PASS ':'FAIL ')+n+(d?' | '+d:''))};
const MOCK=(fail)=>{window.__calls=[];const mk=(t)=>{const o={t,op:null,args:null,f:[]};const b={insert(a){o.op='insert';o.args=a;return b},upsert(a,opt){o.op='upsert';o.args=a;o.opt=opt;return b},update(a){o.op='update';o.args=a;return b},delete(){o.op='delete';return b},eq(k,v){o.f.push(['eq',k,v]);return b},not(k,a,v){o.f.push(['not',k,v]);return b},
  then(ok,no){window.__calls.push(o);return Promise.resolve(window.__fail&&window.__fail(o)?{error:{code:'X',message:'down'}}:{error:null}).then(ok,no)}};return b};
 window.__db={from:mk};window.__user={id:'11111111-1111-1111-1111-111111111111',user_metadata:{}}};
(async()=>{const br=await chromium.launch();
 for(const mode of ['loggedin','anon','failing']){
 const pg=await (await br.newContext({viewport:{width:390,height:800}})).newPage();const errs=[];pg.on('pageerror',e=>errs.push(e.message));
 await pg.goto('http://localhost:8096/index.html',{waitUntil:'domcontentloaded'});await pg.waitForTimeout(700);
 if(mode!=='anon')await pg.evaluate(MOCK); else await pg.evaluate(()=>{window.__calls=[];window.__db=null;window.__user=null});
 if(mode==='failing')await pg.evaluate(()=>{window.__fail=()=>true});
 const click=s=>pg.evaluate(s=>document.querySelector(s).click(),s);
 const ans=async v=>{await click('#mBody [data-act="aans"][data-v="'+v+'"]');await pg.waitForTimeout(280)};
 await click('[data-box="mbti"]');await click('#mBody [data-act="tests"]');await click('#mBody [data-act="astart"]');await pg.waitForTimeout(800);
 console.log('--- mode',mode);
 for(const v of [100,75,50])await ans(v);
 await click('#mBody [data-act="aprev"]');await pg.waitForTimeout(200);
 const lv=[100,75,100,50,100,75,20,100];
 for(let i=0;i<60;i++){if(!await pg.evaluate(()=>!!document.querySelector('#mBody [data-act="aans"]')))break;await ans(lv[i%8])}
 await pg.waitForTimeout(500);
 const calls=await pg.evaluate(()=>window.__calls);
 const done=await pg.evaluate(()=>!!document.querySelector('#mBody .m-hero'));
 log(mode+': test still completes and shows result',done);
 log(mode+': no JS errors',errs.length===0,JSON.stringify(errs));
 if(mode==='anon'){log('anon: zero DB calls',calls.length===0);continue}
 if(mode==='failing'){log('failing server: user still gets result + local progress cleared',done&&await pg.evaluate(()=>localStorage.getItem('mbti_adp_v1')===null));continue}
 const ins=calls.filter(c=>c.t==='test_sessions'&&c.op==='insert');
 log('exactly 1 session inserted (status default in_progress, own user_id)',ins.length===1&&ins[0].args.user_id==='11111111-1111-1111-1111-111111111111'&&!ins[0].args.status,JSON.stringify(ins[0]&&ins[0].args));
 const sid=ins[0].args.id;
 const del=calls.filter(c=>c.t==='test_responses'&&c.op==='delete');
 log('undo deleted exactly the removed response',del.some(c=>c.f.some(f=>f[1]==='item_id')&&c.f.some(f=>f[1]==='session_id'&&f[2]===sid)),JSON.stringify(del[0]&&del[0].f));
 const ups=calls.filter(c=>c.t==='test_responses'&&c.op==='upsert');
 const last=ups[ups.length-1].args;
 log('responses upserted with PK onConflict',ups.every(c=>c.opt.onConflict==='session_id,item_id'));
 log('every row valid: session_id, item_id, content_id, answer in {20,50,75,100}',last.every(r=>r.session_id===sid&&/^Q\d+/.test(r.item_id)&&/^[A-Z]{2}-\d+-[A-Z]$/.test(r.content_id)&&[20,50,75,100].includes(r.answer)),last.length+' rows');
 log('no duplicate item in final upsert',new Set(last.map(r=>r.item_id)).size===last.length);
 const res=calls.filter(c=>c.t==='test_results'&&c.op==='insert');
 log('exactly 1 result inserted, valid type regex',res.length===1&&/^[EI][SN][TF][JP]$/.test(res[0].args.mbti_type),res[0]&&res[0].args.mbti_type);
 log('result dichotomies: 4 entries with letter + confidence_label (needed by Migration D)',res[0].args.dichotomies.length===4&&res[0].args.dichotomies.every(d=>d.letter&&d.confidence_label));
 log('result facets is an object ({} when all "unknown")',typeof res[0].args.facets==='object'&&!Array.isArray(res[0].args.facets),JSON.stringify(res[0].args.facets));
 const comp=calls.filter(c=>c.t==='test_sessions'&&c.op==='update'&&c.args.status==='completed');
 log('session marked completed once, with completed_at',comp.length===1&&!!comp[0].args.completed_at);
 log('order: responses -> result -> completed',calls.indexOf(ups[ups.length-1])<calls.indexOf(res[0])&&calls.indexOf(res[0])<calls.indexOf(comp[0]));
 log('session id cleared locally after completion',await pg.evaluate(()=>localStorage.getItem('mbti_adp_sid')===null));
 // new test after an unfinished one -> abandons old
 await click('#mBody [data-act="tests"]');await click('#mBody [data-act="astart"]');await pg.waitForTimeout(700);await ans(100);await pg.waitForTimeout(400);
 await click('#mBack');await pg.waitForTimeout(150);
 await pg.evaluate(()=>{window.__calls.length=0});
 await click('#mBody [data-act="astart"]');await pg.waitForTimeout(700);
 const ab=await pg.evaluate(()=>window.__calls.filter(c=>c.t==='test_sessions'&&c.op==='update'&&c.args.status==='abandoned').length);
 log('starting a new test abandons the unfinished server session',ab===1,String(ab));
 }
 await br.close();srv.close();console.log('FAILED',bad)})().catch(e=>{console.log('CRASH',e.stack.slice(0,400));process.exit(1)});
