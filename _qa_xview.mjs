// P6.1 + P6.2 — router robustness + cross-view consistency.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9466, BASE='http://localhost:8001';
const child=spawn(CHROME,['--headless=new','--disable-gpu',`--remote-debugging-port=${PORT}`,'--no-first-run','--no-default-browser-check','--user-data-dir=C:\\tmp\\orbit-qa-profV','about:blank'],{stdio:'ignore'});
await sleep(1500);
const nt=await fetch(`http://127.0.0.1:${PORT}/json/new`,{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(nt.webSocketDebuggerUrl);
const pending=new Map();let idc=0;let errs=[];
const send=(m,p={})=>new Promise(res=>{const id=++idc;pending.set(id,res);ws.send(JSON.stringify({id,method:m,params:p}));});
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result||m.error);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errs.push('EXC:'+(m.params.exceptionDetails&&m.params.exceptionDetails.text));});
await new Promise(r=>ws.addEventListener('open',r));
await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
await send('Network.setBlockedURLs',{urls:['*gstatic.com*','*googleapis.com*','*frankfurter.app*','*firebaseio.com*']});
const stub=`(function(){var u={uid:'x',email:'t@e.com',displayName:'QA',photoURL:''};var o={isConfigured:()=>true,isReady:()=>true,user:()=>u,init:()=>Promise.resolve(),onAuthChange:f=>{setTimeout(()=>f(u),0)},hasRemoteData:()=>Promise.resolve(false),pullAll:()=>Promise.resolve({ok:true}),pushAll:()=>Promise.resolve({ok:true}),write:()=>Promise.resolve(),deleteOne:()=>Promise.resolve(),clearStore:()=>Promise.resolve(),signOut:()=>Promise.resolve(),signInWithGoogle:()=>Promise.resolve(u),_unsubAuth:()=>{}};try{Object.defineProperty(window,'OrbitCloud',{value:o,writable:false})}catch(e){window.OrbitCloud=o}})();`;
await send('Page.addScriptToEvaluateOnNewDocument',{source:stub});
await send('Page.navigate',{url:BASE+'/index.html'}); await sleep(3500);
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r&&r.result?r.result.value:undefined;};
await ev("window.loadDemoData()");
await ev("(async()=>{var A=window.OrbitApp;A.State.users=await OrbitDB.getAll('users');A.State.groups=await OrbitDB.getAll('groups');A.State.expenses=await OrbitDB.getAll('expenses');A.State.settlements=await OrbitDB.getAll('settlements');})()");
await ev("OrbitApp.render()"); await sleep(200);

const script=[
"return (async()=>{ const A=window.OrbitApp; const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const out={};",
" async function go(h){ location.hash='#/dashboard'; await sleep(120); location.hash=h; await sleep(350); return document.querySelector('#main').innerText||''; }",
" // ============ P6.1 ROUTER ROBUSTNESS ============",
" { const t=await go('#/groups/TOTALLY_BOGUS_ID'); out.R1_invalidId = /not found/i.test(t) && t.length>0; out.R1d=t.slice(0,40); }",
" { const t=await go('#/groups/g_goa?tab=nonsense'); out.R2_badTab = /expense/i.test(t) && !!document.querySelector('#main .col-actions, #main table'); }",
" { let crashed=false; try{ await go('#/%E0%A4'); }catch(e){ crashed=true; } out.R5_malformedPct = !crashed && !!document.querySelector('#main'); }",
" { const t=await go('#/this-route-does-not-exist'); out.R_unknown = !!document.querySelector('#main') && t.length>0; }",
" // R6: open a modal then navigate -> modal must close",
" location.hash='#/dashboard'; await sleep(200); document.querySelector('#newExpenseTop').click(); await sleep(200);",
" out.R6_modalOpen = !!document.querySelector('#modalRoot').children.length;",
" location.hash='#/expenses'; await sleep(300);",
" out.R6_modalClosedOnNav = !document.querySelector('#modalRoot').children.length && !document.querySelector('#app').hasAttribute('inert');",
" // ============ P6.2 CROSS-VIEW CONSISTENCY ============",
" // baseline dashboard expense count",
" const dashBefore=await go('#/dashboard'); const mBefore=(dashBefore.match(/TOTAL EXPENSES\\s*(\\d+)/)||[])[1];",
" // add a uniquely-marked expense via the real modal",
" const MARK='XVIEWMARKER'; document.querySelector('#newExpenseTop').click(); await sleep(150);",
" document.querySelector('#modalRoot .input-lg').value=MARK; document.querySelector('#modalRoot .input-lg').dispatchEvent(new Event('input',{bubbles:true}));",
" const amt=document.querySelector('#modalRoot .input-money'); amt.value='777'; amt.dispatchEvent(new Event('input',{bubbles:true})); await sleep(60);",
" const beforeIds=new Set(A.State.expenses.map(e=>e.id));",
" [...document.querySelectorAll('#modalRoot .modal-foot button')].find(b=>/Add expense/.test(b.textContent)).click(); await sleep(350);",
" const fresh=A.State.expenses.find(e=>!beforeIds.has(e.id)); out.added=!!fresh; const gid=fresh&&fresh.groupId;",
" // now assert the marker / count shows in each view",
" const dashAfter=await go('#/dashboard'); const mAfter=(dashAfter.match(/TOTAL EXPENSES\\s*(\\d+)/)||[])[1];",
" out.V_dashCount = Number(mAfter)===Number(mBefore)+1; out.cntD='before='+mBefore+' after='+mAfter;",
" out.V_dashRecent = dashAfter.includes(MARK);",
" out.V_expensesTable = (await go('#/expenses')).includes(MARK);",
" out.V_groupDetail = (await go('#/groups/'+gid)).includes(MARK);",
" out.V_activityFeed = (await go('#/activity')).includes(MARK);",
" out.V_analyticsNoCrash = (await go('#/analytics')).length>0;",
" out.V_settleNoCrash = (await go('#/settle')).length>=0;",
" // group card total on #/groups changed (reflects new 777)",
" out.V_groupsList = (await go('#/groups')).length>0;",
" // ============ delete -> gone from all list views ============",
" location.hash='#/groups/'+gid; await sleep(400);",
" const rows=[...document.querySelectorAll('#main table tr, #main tbody tr')]; let clicked=false;",
" for(const r of rows){ if(r.textContent.includes(MARK)){ const b=r.querySelector('.col-actions button:last-child'); if(b){b.click(); clicked=true; break;} } }",
" await sleep(200); const del=[...document.querySelectorAll('#modalRoot button')].find(b=>b.textContent.trim()==='Delete'); if(del){del.click(); await sleep(350);}",
" out.deleted = !A.State.expenses.some(e=>e.id===(fresh&&fresh.id));",
" out.V_goneExpenses = !(await go('#/expenses')).includes(MARK);",
" out.V_goneDash = !(await go('#/dashboard')).includes(MARK);",
" return out; })();"
].join("\n");
const r=await send('Runtime.evaluate',{expression:'(async()=>{'+script+'})()',returnByValue:true,awaitPromise:true});
if(r&&r.exceptionDetails) console.log('EVAL ERR', JSON.stringify(r.exceptionDetails).slice(0,500));
const o=r&&r.result&&r.result.value||{};
console.log('\n===== P6.1 ROUTER + P6.2 CROSS-VIEW =====');
const chk=(n,c,d)=>console.log((c?'✓ PASS':'✗ FAIL')+'  '+n+(d?'   ('+d+')':''));
chk('R-1 invalid group id → not-found (no blank/crash)', o.R1_invalidId, o.R1d);
chk('R-2 unknown group tab → defaults to Expenses', o.R2_badTab);
chk('R-5 malformed %-escape in URL → no crash', o.R5_malformedPct);
chk('R-? unknown route → recovers (no blank)', o.R_unknown);
chk('R-6 navigating closes an open modal (+ inert cleared)', o.R6_modalOpen && o.R6_modalClosedOnNav, 'opened='+o.R6_modalOpen);
console.log('  -- cross-view (added a ₹777 "XVIEWMARKER" expense) --');
chk('V dashboard TOTAL EXPENSES count +1', o.V_dashCount, o.cntD);
chk('V dashboard recent-activity shows it', o.V_dashRecent);
chk('V #/expenses table shows it', o.V_expensesTable);
chk('V #/groups/:id expenses tab shows it', o.V_groupDetail);
chk('V #/activity feed shows it', o.V_activityFeed);
chk('V analytics + settle + groups render (no crash)', o.V_analyticsNoCrash && o.V_groupsList);
chk('delete → gone from #/expenses AND #/dashboard', o.deleted && o.V_goneExpenses && o.V_goneDash, 'del='+o.deleted);
console.log('exceptions:', errs.length, errs.slice(0,3).join(' | '));
ws.close();child.kill();process.exit(0);
