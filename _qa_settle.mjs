// P5.1 — Smart-settle (debt simplification) algorithm tests.
// Exercises the REAL simplifyDebts() + the per-currency settle view.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9433, BASE='http://localhost:8001';
const child=spawn(CHROME,['--headless=new','--disable-gpu',`--remote-debugging-port=${PORT}`,'--no-first-run','--no-default-browser-check','--user-data-dir=C:\\tmp\\orbit-qa-profS','about:blank'],{stdio:'ignore'});
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
" // helper: apply txs back onto a net map; everyone must end at ~0",
" function settlesToZero(net, txs){ const m=Object.assign({},net); for(const t of txs){ m[t.from]=(m[t.from]||0)+t.amount; m[t.to]=(m[t.to]||0)-t.amount; } return Object.values(m).every(v=>Math.abs(v)<0.01); }",
" // S-1: A owes B 100, B owes C 100 -> net A:-100,B:0,C:+100 -> ONE tx A->C 100",
" { const net={A:-100,B:0,C:100}; const txs=T.simplifyDebts(net,'INR');",
"   out.S1 = txs.length===1 && txs[0].from==='A' && txs[0].to==='C' && cents(txs[0].amount)===10000; out.S1d='txs='+JSON.stringify(txs); }",
" // S-2: circular A->B->C->A all 50 -> net all 0 -> ZERO txs",
" { const net={A:0,B:0,C:0}; const txs=T.simplifyDebts(net,'INR'); out.S2 = txs.length===0; }",
" // S-3: 8-person mixed, balanced to 0 -> <= n-1 txs AND settles to zero",
" { const net={a:120,b:80,c:-50,d:-30,e:45,f:-90,g:-15,h:-60}; const sum=Object.values(net).reduce((x,y)=>x+y,0);",
"   const txs=T.simplifyDebts(net,'INR'); out.S3 = sum===0 && txs.length<=7 && settlesToZero(net,txs); out.S3d='n=8 txs='+txs.length; }",
" // S-4: mixed currencies settle separately (render #/settle, expect INR + EUR cards)",
" { location.hash='#/settle'; await sleep(500); const heads=[...document.querySelectorAll('#main .card-header h3')].map(h=>h.textContent);",
"   out.S4 = heads.some(t=>/in INR/.test(t)) && heads.some(t=>/in EUR/.test(t)); out.S4d='cards='+JSON.stringify(heads); }",
" // S-5: all settled -> empty state, no crash",
" { const net={A:0,B:0}; const txs=T.simplifyDebts(net,'INR'); out.S5algo = txs.length===0;",
"   // wipe data and render settle -> empty state",
"   await OrbitDB.clear('expenses'); await OrbitDB.clear('settlements'); A.State.expenses=[]; A.State.settlements=[];",
"   location.hash='#/dashboard'; await sleep(200); location.hash='#/settle'; await sleep(450); const txt=document.querySelector('#main').innerText||'';",
"   out.S5empty = /settled up|all settled|no outstanding/i.test(txt) && !document.querySelector('#main .owes-row'); out.S5d=txt.slice(0,80); }",
" // restore demo for the float test",
" await window.loadDemoData(); A.State.expenses=await OrbitDB.getAll('expenses'); A.State.settlements=await OrbitDB.getAll('settlements');",
" // S-6: float precision — 100 split 33.33/33.33/33.34 -> txs sum EXACTLY to 100",
" { const net={payer:100, x:-33.33, y:-33.33, z:-33.34}; const txs=T.simplifyDebts(net,'INR');",
"   const tot=txs.reduce((s,t)=>s+t.amount,0); out.S6 = cents(tot)===10000 && settlesToZero(net,txs); out.S6d='sum='+tot+' txs='+txs.length; }",
" // PROPERTY: 500 random balanced nets -> simplify zeroes everyone, <= n-1 txs",
" { let bad=0,over=0; let s=7; const rnd=()=>{s=(s*9301+49297)%233280;return s/233280;};",
"   for(let i=0;i<500;i++){ const n=2+Math.floor(rnd()*9); const net={}; let acc=0;",
"     for(let k=0;k<n-1;k++){ const v=Math.round((rnd()*2000-1000))/1; net['u'+k]=v; acc+=v; } net['u'+(n-1)]=-acc;",
"     const txs=T.simplifyDebts(net,'INR'); if(!settlesToZero(net,txs)) bad++; if(txs.length>n-1) over++; }",
"   out.PROP = bad===0 && over===0; out.PROPd='settleFail='+bad+' overN='+over; }",
" return out; })();"
].join("\n");
const r=await send('Runtime.evaluate',{expression:'(async()=>{'+script+'})()',returnByValue:true,awaitPromise:true});
if(r&&r.exceptionDetails) console.log('EVAL ERR', JSON.stringify(r.exceptionDetails).slice(0,500));
const o=r&&r.result&&r.result.value||{};
console.log('\n===== P5.1 SMART-SETTLE (debt simplification) =====');
const chk=(n,c,d)=>console.log((c?'✓ PASS':'✗ FAIL')+'  '+n+(d?'   ('+d+')':''));
chk('S-1 chain A→B→C collapses to ONE tx (A→C 100)', o.S1, o.S1d);
chk('S-2 circular debt → 0 transactions', o.S2);
chk('S-3 8-person mixed → ≤ n-1 txs and settles to zero', o.S3, o.S3d);
chk('S-4 mixed currencies settle as separate INR + EUR cards', o.S4, o.S4d);
chk('S-5 all-settled → empty state, no crash', o.S5algo && o.S5empty, o.S5d);
chk('S-6 float 33.33/33.33/33.34 → txs sum EXACTLY 100', o.S6, o.S6d);
chk('PROPERTY 500 random nets → always zeroes everyone in ≤ n-1 txs', o.PROP, o.PROPd);
console.log('exceptions:', errs.length);
ws.close();child.kill();process.exit(0);
