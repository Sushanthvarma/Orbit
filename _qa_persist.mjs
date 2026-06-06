// P2.1 — IndexedDB multi-store write atomicity. Proves OrbitDB.writeTx commits
// all-or-nothing, and that saveExpense persists expense + activity together.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9421, BASE='http://localhost:8001';
const child=spawn(CHROME,['--headless=new','--disable-gpu',`--remote-debugging-port=${PORT}`,'--no-first-run','--no-default-browser-check','--user-data-dir=C:\\tmp\\orbit-qa-profP','about:blank'],{stdio:'ignore'});
await sleep(1500);
const nt=await fetch(`http://127.0.0.1:${PORT}/json/new`,{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(nt.webSocketDebuggerUrl);
const pending=new Map();let idc=0;let errs=[];
const send=(m,p={})=>new Promise(res=>{const id=++idc;pending.set(id,res);ws.send(JSON.stringify({id,method:m,params:p}));});
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result||m.error);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errs.push('EXC');});
await new Promise(r=>ws.addEventListener('open',r));
await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
await send('Network.setBlockedURLs',{urls:['*gstatic.com*','*googleapis.com*','*frankfurter.app*','*firebaseio.com*']});
const stub=`(function(){window.__cloudWrites=[];var u={uid:'x',email:'t@e.com',displayName:'QA',photoURL:''};var o={isConfigured:()=>true,isReady:()=>true,user:()=>u,init:()=>Promise.resolve(),onAuthChange:f=>{setTimeout(()=>f(u),0)},hasRemoteData:()=>Promise.resolve(false),pullAll:()=>Promise.resolve({ok:true}),pushAll:()=>Promise.resolve({ok:true}),write:(s,ob)=>{window.__cloudWrites.push([s,ob&&ob.id]);return Promise.resolve();},deleteOne:()=>Promise.resolve(),clearStore:()=>Promise.resolve(),signOut:()=>Promise.resolve(),signInWithGoogle:()=>Promise.resolve(u),_unsubAuth:()=>{}};try{Object.defineProperty(window,'OrbitCloud',{value:o,writable:false})}catch(e){window.OrbitCloud=o}})();`;
await send('Page.addScriptToEvaluateOnNewDocument',{source:stub});
await send('Page.navigate',{url:BASE+'/index.html'}); await sleep(3500);
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r&&r.result?r.result.value:undefined;};
await ev("window.loadDemoData()");
await ev("(async()=>{var A=window.OrbitApp;A.State.users=await OrbitDB.getAll('users');A.State.groups=await OrbitDB.getAll('groups');A.State.expenses=await OrbitDB.getAll('expenses');A.State.settlements=await OrbitDB.getAll('settlements');A.State.activity=await OrbitDB.getAll('activity');})()");
await ev("OrbitApp.render()"); await sleep(200);

const script=[
"return (async()=>{ const A=window.OrbitApp; const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const out={};",
" // 1) HAPPY PATH: writeTx commits both ops",
" const exp1={id:'tx_e1', groupId:'g_flat', title:'TxOK', amount:100, currency:'INR', paidBy:'u_self', splitMode:'equal', splits:[{userId:'u_self',amount:100}], category:'food', date:new Date().toISOString(), note:''};",
" const act1={id:'tx_a1', ts:new Date().toISOString(), actorId:'u_self', action:'add', entityType:'expense', entityId:'tx_e1', groupId:'g_flat', snapshot:exp1, prev:null, meta:null};",
" await OrbitDB.writeTx([{store:'expenses',op:'put',value:exp1},{store:'activity',op:'put',value:act1}]);",
" out.happyExpense = !!(await OrbitDB.get('expenses','tx_e1'));",
" out.happyActivity = !!(await OrbitDB.get('activity','tx_a1'));",
" // 2) ROLLBACK: one op is invalid (activity missing its keyPath 'id') -> whole tx aborts",
" const exp2={id:'tx_e2', groupId:'g_flat', title:'TxBAD', amount:200, currency:'INR', paidBy:'u_self', splitMode:'equal', splits:[{userId:'u_self',amount:200}], category:'food', date:new Date().toISOString(), note:''};",
" const badAct={ ts:new Date().toISOString(), action:'add' }; // NO id -> put fails on inline keyPath",
" let threw=false; try { await OrbitDB.writeTx([{store:'expenses',op:'put',value:exp2},{store:'activity',op:'put',value:badAct}]); } catch(e){ threw=true; }",
" out.rollbackThrew = threw;",
" out.rollbackExpenseAbsent = !(await OrbitDB.get('expenses','tx_e2')); // exp2 must NOT have persisted",
" // 3) saveExpense persists expense + an activity entry together (real flow)",
" const beforeAct=(await OrbitDB.getAll('activity')).length;",
" const beforeExpIds=new Set((await OrbitDB.getAll('expenses')).map(e=>e.id));",
" document.querySelector('#newExpenseTop').click(); await sleep(150);",
" const ttl=document.querySelector('#modalRoot .input-lg'); ttl.value='Atomic dinner'; ttl.dispatchEvent(new Event('input',{bubbles:true}));",
" const amt=document.querySelector('#modalRoot .input-money'); amt.value='90'; amt.dispatchEvent(new Event('input',{bubbles:true})); await sleep(60);",
" [...document.querySelectorAll('#modalRoot .modal-foot button')].find(b=>/Add expense/.test(b.textContent)).click(); await sleep(300);",
" const allExp=await OrbitDB.getAll('expenses'); const newExp=allExp.find(e=>!beforeExpIds.has(e.id) && e.title==='Atomic dinner');",
" const afterAct=await OrbitDB.getAll('activity');",
" out.saveExpensePersisted = !!newExp;",
" out.saveActivityLogged = newExp && afterAct.some(a=>a.entityId===newExp.id && a.action==='add');",
" out.activityGrewByOne = afterAct.length===beforeAct+1;",
" // 4) delete persists atomically (expense gone + delete activity present)",
" if(newExp){ A.State.expenses=await OrbitDB.getAll('expenses'); location.hash='#/groups/'+newExp.groupId; await sleep(450);",
"   const xb=[...document.querySelectorAll('#main .col-actions button')].filter(b=>/✕/.test(b.textContent)); ",
"   // delete the one we just added: open its row edit? simpler: call confirm via the last row's delete and accept",
"   // Find the row with 'Atomic dinner' delete btn",
"   const rows=[...document.querySelectorAll('#main table tr, #main tbody tr')];",
"   let clicked=false; for(const r of rows){ if(/Atomic dinner/.test(r.textContent)){ const b=r.querySelector('.col-actions button:last-child'); if(b){b.click(); clicked=true; break;} } }",
"   await sleep(200); const del=[...document.querySelectorAll('#modalRoot button')].find(b=>b.textContent.trim()==='Delete'); if(del){del.click(); await sleep(300);}",
"   out.deleteClicked=clicked; out.deletedGone = !(await OrbitDB.get('expenses', newExp.id));",
"   out.deleteActivityPresent = (await OrbitDB.getAll('activity')).some(a=>a.entityId===newExp.id && a.action==='delete'); }",
" // 5) updatedAt stamping (LWW version field)",
" const se={id:'tx_e3', groupId:'g_flat', title:'Stamp', amount:10, currency:'INR', paidBy:'u_self', splitMode:'equal', splits:[{userId:'u_self',amount:10}], category:'food', date:new Date().toISOString(), note:''};",
" await OrbitDB.put('expenses', se); const got=await OrbitDB.get('expenses','tx_e3'); out.updatedAtStamped = typeof got.updatedAt==='number' && got.updatedAt>0;",
" // 6) mergeByUpdatedAt last-write-wins",
" const local=[{id:'A',updatedAt:200},{id:'B',updatedAt:100}]; const remote=[{id:'A',updatedAt:100},{id:'C',updatedAt:300}];",
" const merged=OrbitDB.mergeByUpdatedAt(local, remote, 'id'); const mA=merged.find(x=>x.id==='A'); ",
" out.mergeKeepsNewerLocal = mA && mA.updatedAt===200; out.mergeUnion = merged.length===3 && merged.some(x=>x.id==='C') && merged.some(x=>x.id==='B');",
" // 7) writeTx mirrors BOTH ops to the cloud write-through (regression guard)",
" window.__cloudWrites=[]; const we={id:'tx_e4', groupId:'g_flat', title:'CloudMirror', amount:5, currency:'INR', paidBy:'u_self', splitMode:'equal', splits:[{userId:'u_self',amount:5}], category:'food', date:new Date().toISOString(), note:''};",
" const wa={id:'tx_a4', ts:new Date().toISOString(), actorId:'u_self', action:'add', entityType:'expense', entityId:'tx_e4', groupId:'g_flat', snapshot:we, prev:null, meta:null};",
" await OrbitDB.writeTx([{store:'expenses',op:'put',value:we},{store:'activity',op:'put',value:wa}]); await sleep(50);",
" out.writeTxMirrored = window.__cloudWrites.some(c=>c[0]==='expenses'&&c[1]==='tx_e4') && window.__cloudWrites.some(c=>c[0]==='activity'&&c[1]==='tx_a4');",
" return out; })();"
].join("\n");
const r=await send('Runtime.evaluate',{expression:'(async()=>{'+script+'})()',returnByValue:true,awaitPromise:true});
if(r&&r.exceptionDetails) console.log('EVAL ERR', JSON.stringify(r.exceptionDetails).slice(0,400));
const o=r&&r.result&&r.result.value||{};
console.log('\n===== P2.1 PERSISTENCE / ATOMICITY =====');
const chk=(n,c,d)=>console.log((c?'✓ PASS':'✗ FAIL')+'  '+n+(d!==undefined?'   ('+d+')':''));
chk('writeTx happy path commits BOTH stores', o.happyExpense && o.happyActivity);
chk('writeTx rolls back ALL ops on partial failure (atomic)', o.rollbackThrew && o.rollbackExpenseAbsent, 'threw='+o.rollbackThrew+' expenseAbsent='+o.rollbackExpenseAbsent);
chk('saveExpense persists expense + activity together', o.saveExpensePersisted && o.saveActivityLogged && o.activityGrewByOne, 'exp='+o.saveExpensePersisted+' act='+o.saveActivityLogged+' grew1='+o.activityGrewByOne);
chk('delete persists atomically (gone + delete-activity)', o.deletedGone && o.deleteActivityPresent, 'clicked='+o.deleteClicked+' gone='+o.deletedGone+' act='+o.deleteActivityPresent);
chk('P2.2 updatedAt stamped on local write (LWW version)', o.updatedAtStamped);
chk('P2.2 mergeByUpdatedAt keeps newer local + unions both sides', o.mergeKeepsNewerLocal && o.mergeUnion, 'newerLocal='+o.mergeKeepsNewerLocal+' union='+o.mergeUnion);
chk('P2.2 writeTx mirrors BOTH ops to cloud (sync regression guard)', o.writeTxMirrored);
console.log('exceptions:', errs.length);
ws.close();child.kill();process.exit(0);
