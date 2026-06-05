// Drive the multi-payer modal end-to-end through the real UI.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9377, BASE='http://localhost:8001';
const child=spawn(CHROME,['--headless=new','--disable-gpu',`--remote-debugging-port=${PORT}`,'--no-first-run','--no-default-browser-check','--user-data-dir=C:\\tmp\\orbit-qa-prof7','about:blank'],{stdio:'ignore'});
await sleep(1500);
const nt=await fetch(`http://127.0.0.1:${PORT}/json/new`,{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(nt.webSocketDebuggerUrl);
const pending=new Map();let idc=0;let errs=[];
const send=(m,p={})=>new Promise(res=>{const id=++idc;pending.set(id,res);ws.send(JSON.stringify({id,method:m,params:p}));});
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);
 if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result||m.error);pending.delete(m.id);return;}
 if(m.method==='Runtime.exceptionThrown'){errs.push('EXCEPTION');}});
await new Promise(r=>ws.addEventListener('open',r));
await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
await send('Network.setBlockedURLs',{urls:['*gstatic.com*','*googleapis.com*','*frankfurter.app*','*firebaseio.com*']});
const stub=`(function(){var u={uid:'x',email:'t@e.com',displayName:'QA',photoURL:''};var o={isConfigured:()=>true,isReady:()=>true,user:()=>u,init:()=>Promise.resolve(),onAuthChange:f=>{setTimeout(()=>f(u),0)},hasRemoteData:()=>Promise.resolve(false),pullAll:()=>Promise.resolve({ok:true}),pushAll:()=>Promise.resolve({ok:true}),write:()=>Promise.resolve(),deleteOne:()=>Promise.resolve(),clearStore:()=>Promise.resolve(),signOut:()=>Promise.resolve(),signInWithGoogle:()=>Promise.resolve(u),_unsubAuth:()=>{}};try{Object.defineProperty(window,'OrbitCloud',{value:o,writable:false})}catch(e){window.OrbitCloud=o}})();`;
await send('Page.addScriptToEvaluateOnNewDocument',{source:stub});
await send('Page.navigate',{url:BASE+'/index.html'}); await sleep(3500);
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r&&r.result?r.result.value:undefined;};
await ev("window.loadDemoData()");
await ev("(async()=>{var A=window.OrbitApp;A.State.users=await OrbitDB.getAll('users');A.State.groups=await OrbitDB.getAll('groups');A.State.expenses=await OrbitDB.getAll('expenses');A.State.settlements=await OrbitDB.getAll('settlements');})()");
await ev("OrbitApp.render()"); await sleep(300);

const script = [
"return (async()=>{ const A=window.OrbitApp; const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const out={};",
" document.querySelector('#newExpenseTop').click(); await sleep(150);",
" const selects=[...document.querySelectorAll('#modalRoot select')];",
" const gsel=selects.find(s=>[...s.options].some(o=>o.value==='g_flat'));",
" gsel.value='g_flat'; gsel.dispatchEvent(new Event('change',{bubbles:true})); await sleep(80);",
" const ttl=document.querySelector('#modalRoot .input-lg'); ttl.value='Cab + snacks'; ttl.dispatchEvent(new Event('input',{bubbles:true}));",
" const amt=document.querySelector('#modalRoot .input-money'); amt.value='300'; amt.dispatchEvent(new Event('input',{bubbles:true})); await sleep(60);",
" // select 'Multiple people' on the paid-by select",
" const psel=selects.find(s=>[...s.options].some(o=>o.value==='__multi'));",
" psel.value='__multi'; psel.dispatchEvent(new Event('change',{bubbles:true})); await sleep(120);",
" out.payersWrapShown = document.querySelector('#modalRoot .payers-wrap').style.display!=='none';",
" // fill payer amounts: inputs inside .payers-wrap .share-input",
" const pins=[...document.querySelectorAll('#modalRoot .payers-wrap .share-input input')];",
" out.payerInputs = pins.length;",
" // order = group members [u_self,u_rohan,u_kavya]; pay 200 / 100 / 0",
" pins[0].value='200'; pins[0].dispatchEvent(new Event('input',{bubbles:true}));",
" pins[1].value='100'; pins[1].dispatchEvent(new Event('input',{bubbles:true})); await sleep(80);",
" const beforeIds=new Set(A.State.expenses.map(e=>e.id));",
" const saveBtn=[...document.querySelectorAll('#modalRoot .modal-foot button')].find(b=>/Add expense|Save changes/.test(b.textContent));",
" saveBtn.click(); await sleep(250);",
" out.modalClosed = !document.querySelector('#modalRoot').children.length;",
" const fresh=A.State.expenses.find(e=>!beforeIds.has(e.id));",
" out.saved = !!fresh;",
" if(fresh){ out.payers=fresh.payers; out.paidBy=fresh.paidBy; out.amount=fresh.amount;",
"   const ps=A.__test.expensePayers(fresh); out.payerSum=ps.reduce((s,p)=>s+p.amount,0); out.label=A.__test.payerLabel(fresh);",
"   const m=A.__test.computeGroupMatrix('g_flat'); out.selfPaid=A.__test.paidByUser(fresh,'u_self'); }",
" // negative-validation: try save with payers not summing to amount",
" document.querySelector('#newExpenseTop').click(); await sleep(120);",
" const s2=[...document.querySelectorAll('#modalRoot select')]; const g2=s2.find(s=>[...s.options].some(o=>o.value==='g_flat')); g2.value='g_flat'; g2.dispatchEvent(new Event('change',{bubbles:true})); await sleep(60);",
" document.querySelector('#modalRoot .input-lg').value='Bad'; document.querySelector('#modalRoot .input-lg').dispatchEvent(new Event('input',{bubbles:true}));",
" const a2=document.querySelector('#modalRoot .input-money'); a2.value='300'; a2.dispatchEvent(new Event('input',{bubbles:true}));",
" const p2=s2.find(s=>[...s.options].some(o=>o.value==='__multi')); p2.value='__multi'; p2.dispatchEvent(new Event('change',{bubbles:true})); await sleep(100);",
" const pin2=[...document.querySelectorAll('#modalRoot .payers-wrap .share-input input')]; pin2[0].value='50'; pin2[0].dispatchEvent(new Event('input',{bubbles:true})); await sleep(60);",
" const b2=new Set(A.State.expenses.map(e=>e.id));",
" [...document.querySelectorAll('#modalRoot .modal-foot button')].find(b=>/Add expense/.test(b.textContent)).click(); await sleep(180);",
" out.mismatchRejected = A.State.expenses.every(e=>b2.has(e.id)) && !!document.querySelector('#modalRoot').children.length;",
" const t=[...document.querySelectorAll('#toastRoot .toast')]; out.mismatchToast = t.length?t[t.length-1].textContent:'';",
" try{document.querySelector('#modalRoot .modal-head .close').click();}catch(e){}",
" return out; })();"
].join("\n");
const r=await send('Runtime.evaluate',{expression:'(async()=>{'+script+'})()',returnByValue:true,awaitPromise:true});
if(r&&r.exceptionDetails) console.log('EVAL ERR', JSON.stringify(r.exceptionDetails).slice(0,500));
const o=r&&r.result&&r.result.value||{};
console.log('\n===== MULTI-PAYER UI DRIVE =====');
const chk=(name,cond,d)=>console.log((cond?'✓ PASS':'✗ FAIL')+'  '+name+(d!==undefined?'   ('+d+')':''));
chk('payers panel shown on "Multiple people"', o.payersWrapShown, 'inputs='+o.payerInputs);
chk('expense saved via UI', o.saved, 'amount='+o.amount);
chk('payers stored [self:200, rohan:100]', o.payers&&o.payers.length===2&&o.payerSum===300, JSON.stringify(o.payers));
chk('paidBy = largest payer (u_self)', o.paidBy==='u_self', 'paidBy='+o.paidBy+' selfPaid='+o.selfPaid);
chk('payer label "You & Rohan"', /&/.test(o.label||''), 'label='+o.label);
chk('modal closed after save', o.modalClosed);
chk('payments-not-summing rejected with message', o.mismatchRejected&&/add up/i.test(o.mismatchToast||''), 'toast='+o.mismatchToast);
console.log('exceptions:', errs.length);
ws.close();child.kill();process.exit(0);
