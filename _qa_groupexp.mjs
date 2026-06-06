// P3.1 + P4.2/P4.3 — group member ops + edit/delete expense across views.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9444, BASE='http://localhost:8001';
const child=spawn(CHROME,['--headless=new','--disable-gpu',`--remote-debugging-port=${PORT}`,'--no-first-run','--no-default-browser-check','--user-data-dir=C:\\tmp\\orbit-qa-profG','about:blank'],{stdio:'ignore'});
await sleep(1500);
const nt=await fetch(`http://127.0.0.1:${PORT}/json/new`,{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(nt.webSocketDebuggerUrl);
const pending=new Map();let idc=0;let errs=[];
const send=(m,p={})=>new Promise(res=>{const id=++idc;pending.set(id,res);ws.send(JSON.stringify({id,method:m,params:p}));});
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result||m.error);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errs.push('EXC');});
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
"return (async()=>{ const A=window.OrbitApp,T=A.__test; const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const out={}; const cents=x=>Math.round(x*100);",
" // fresh local group: self + rohan",
" const g={id:'g_ge', name:'GE Test', category:'friends', currency:'INR', members:['u_self','u_rohan'], createdAt:new Date().toISOString(), emoji:'GE'};",
" await OrbitDB.put('groups',g); A.State.groups.push(g);",
" // --- T-GRP-03: add the SAME existing contact twice -> idempotent ---",
" async function addMember(name){ location.hash='#/groups/g_ge'; await sleep(400);",
"   const chip=[...document.querySelectorAll('#main .member-chip')].find(c=>/\\+ Add/.test(c.textContent)); chip.click(); await sleep(200);",
"   const nin=document.querySelector('#modalRoot input'); nin.value=name; nin.dispatchEvent(new Event('input',{bubbles:true}));",
"   const ab=[...document.querySelectorAll('#modalRoot button')].find(b=>b.textContent.trim()==='Add'); ab.click(); await sleep(350);",
"   if(document.querySelector('#modalRoot').children.length){ try{document.querySelector('#modalRoot .close').click();}catch(e){} await sleep(50);} }",
" await addMember('Priya'); const after1=A.State.groups.find(x=>x.id==='g_ge').members.length;",
" await addMember('Priya'); const after2=A.State.groups.find(x=>x.id==='g_ge').members.length;",
" out.idempotentAdd = after1===3 && after2===3; out.idemD='after1='+after1+' after2='+after2;",
" // --- P4.2: add an expense, then EDIT amount; balances recompute + zero-sum ---",
" const gm=A.State.groups.find(x=>x.id==='g_ge'); const priya=A.State.users.find(u=>u.name==='Priya').id;",
" const exp={id:'e_ge', groupId:'g_ge', title:'GE dinner', amount:300, currency:'INR', paidBy:'u_self', splitMode:'equal', splits:gm.members.map(m=>({userId:m,amount:100})), category:'food', date:new Date().toISOString(), note:''};",
" await OrbitDB.put('expenses',exp); A.State.expenses.push(exp);",
" const beforeNet=T.computeGroupMatrix('g_ge').net['u_self'];",
" location.hash='#/dashboard'; await sleep(150); location.hash='#/groups/g_ge'; await sleep(450);",
" const eb=[...document.querySelectorAll('#main .col-actions button')].find(b=>/✎/.test(b.textContent)); out.editBtn=!!eb;",
" if(eb){ eb.click(); await sleep(250); const amt=document.querySelector('#modalRoot .input-money'); amt.value='600'; amt.dispatchEvent(new Event('input',{bubbles:true})); await sleep(60);",
"   [...document.querySelectorAll('#modalRoot .modal-foot button')].find(b=>/Save changes/.test(b.textContent)).click(); await sleep(350); }",
" const afterEdit=T.computeGroupMatrix('g_ge'); ",
" out.editRecomputes = cents(afterEdit.net['u_self'])!==cents(beforeNet) && cents(Object.values(afterEdit.net).reduce((a,b)=>a+b,0))===0;",
" out.editD='before='+beforeNet+' afterSelf='+afterEdit.net['u_self']+' zero='+cents(Object.values(afterEdit.net).reduce((a,b)=>a+b,0));",
" // dashboard KPI reflects it too (your share changed) — just assert no crash + expense amount=600",
" out.editedTo600 = (A.State.expenses.find(e=>e.id==='e_ge')||{}).amount===600;",
" // --- T-GRP-05: removing a member WITH a balance shows a warning ---",
" location.hash='#/groups/g_ge'; await sleep(400);",
" const rohanChip=[...document.querySelectorAll('#main .member-chip')].find(c=>/Rohan/.test(c.textContent));",
" const rx=rohanChip&&rohanChip.querySelector('.x'); out.removeXFound=!!rx; if(rx){ rx.click(); await sleep(250); }",
" const modalText=(document.querySelector('#modalRoot')||{}).innerText||''; out.removeWarning = /unsettled|Heads up|owes the group|owed by the group/i.test(modalText); out.removeD=modalText.slice(0,90);",
" // cancel the remove",
" const cancel=[...document.querySelectorAll('#modalRoot button')].find(b=>b.textContent.trim()==='Cancel'); if(cancel){cancel.click(); await sleep(100);}",
" // --- P4.3: delete expense reverts balances to baseline ---",
" location.hash='#/groups/g_ge'; await sleep(400);",
" const xb=[...document.querySelectorAll('#main .col-actions button')].find(b=>/✕/.test(b.textContent)); out.delBtn=!!xb;",
" if(xb){ xb.click(); await sleep(200); const del=[...document.querySelectorAll('#modalRoot button')].find(b=>b.textContent.trim()==='Delete'); if(del){del.click(); await sleep(350);} }",
" const afterDel=T.computeGroupMatrix('g_ge'); out.deleteReverts = Object.values(afterDel.net).every(v=>Math.abs(v)<0.01) && !A.State.expenses.some(e=>e.id==='e_ge');",
" out.delD='nets='+JSON.stringify(afterDel.net);",
" // --- P4.3 EX-2: deleting the ONLY expense -> empty state, no crash ---",
" location.hash='#/dashboard'; await sleep(150); location.hash='#/groups/g_ge'; await sleep(450);",
" const bodyTxt=document.querySelector('#main').innerText||''; out.emptyState = /no expenses|add one|quiet|nothing/i.test(bodyTxt) && !document.querySelector('#main .col-actions');",
" out.emptyD=bodyTxt.slice(0,0);",
" return out; })();"
].join("\n");
const r=await send('Runtime.evaluate',{expression:'(async()=>{'+script+'})()',returnByValue:true,awaitPromise:true});
if(r&&r.exceptionDetails) console.log('EVAL ERR', JSON.stringify(r.exceptionDetails).slice(0,500));
const o=r&&r.result&&r.result.value||{};
console.log('\n===== P3.1 / P4.2 / P4.3 — GROUP + EXPENSE OPS =====');
const chk=(n,c,d)=>console.log((c?'✓ PASS':'✗ FAIL')+'  '+n+(d?'   ('+d+')':''));
chk('T-GRP-03 add same member twice → idempotent (no duplicate)', o.idempotentAdd, o.idemD);
chk('P4.2 edit amount → balances recompute + group zero-sum', o.editRecomputes && o.editedTo600, o.editD);
chk('T-GRP-05 remove member with balance → warning shown', o.removeWarning, o.removeD);
chk('P4.3 delete expense → balances revert to zero baseline', o.deleteReverts, o.delD);
chk('P4.3 delete only expense → empty state, no crash', o.emptyState);
console.log('exceptions:', errs.length);
ws.close();child.kill();process.exit(0);
