// P3.2 + P6.3 + P9 — XSS inertness, create-group validation, search robustness.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9455, BASE='http://localhost:8001';
const child=spawn(CHROME,['--headless=new','--disable-gpu',`--remote-debugging-port=${PORT}`,'--no-first-run','--no-default-browser-check','--user-data-dir=C:\\tmp\\orbit-qa-profX','about:blank'],{stdio:'ignore'});
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
"return (async()=>{ const A=window.OrbitApp; const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const out={}; window.__xss=0;",
" // XSS payload that sets window.__xss if it ever executes (img onerror / svg onload).",
" const XSS='<img src=x onerror=\"window.__xss=1\"><svg onload=\"window.__xss=1\"></svg>';",
" // Inject a group + expense + user name carrying the payload, straight into the store.",
" const xu={id:'u_xss', name:XSS, isSelf:false, avatar:'av-c2', email:'', phone:'', upi:''};",
" await OrbitDB.put('users',xu); ",
" const xg={id:'g_xss', name:XSS, category:'friends', currency:'INR', members:['u_self','u_xss'], createdAt:new Date().toISOString(), emoji:'XS'};",
" await OrbitDB.put('groups',xg);",
" const xe={id:'e_xss', groupId:'g_xss', title:XSS, amount:100, currency:'INR', paidBy:'u_self', splitMode:'equal', splits:[{userId:'u_self',amount:50},{userId:'u_xss',amount:50}], category:'food', date:new Date().toISOString(), note:XSS};",
" await OrbitDB.put('expenses',xe);",
" A.State.users=await OrbitDB.getAll('users'); A.State.groups=await OrbitDB.getAll('groups'); A.State.expenses=await OrbitDB.getAll('expenses');",
" // Render every view that shows names/titles.",
" for(const h of ['#/dashboard','#/groups','#/expenses','#/activity','#/analytics','#/settle','#/groups/g_xss']){ location.hash=h; await sleep(250); }",
" // open the expense (edit) + confirm-delete dialog (uses bodyHtml with escapeHtml)",
" location.hash='#/groups/g_xss'; await sleep(350);",
" const xb=[...document.querySelectorAll('#main .col-actions button')].find(b=>/✕/.test(b.textContent)); if(xb){ xb.click(); await sleep(200); }",
" await sleep(300);",
" out.xssDidNotExecute = window.__xss===0;",
" // the payload must appear as TEXT somewhere (escaped), not as a live <img>/<svg>",
" out.noLiveInjected = !document.querySelector('#app img[src=\"x\"]') && !document.querySelector('#app svg[onload]');",
" out.renderedAsText = (document.body.innerText||'').includes('<img src=x');",
" // close any modal",
" try{ const c=[...document.querySelectorAll('#modalRoot button')].find(b=>/Cancel|×/.test(b.textContent)); if(c)c.click(); }catch(e){}",
" // --- T-GRP-11: create group with empty name -> rejected ---",
" location.hash='#/dashboard'; await sleep(200); const beforeG=A.State.groups.length;",
" document.querySelector('#sidebarNewGroup').click(); await sleep(200);",
" // leave name empty, click Create",
" const cbtn=[...document.querySelectorAll('#modalRoot button')].find(b=>/Create|Save/.test(b.textContent)); ",
" if(cbtn){ cbtn.click(); await sleep(250); }",
" out.emptyNameRejected = A.State.groups.length===beforeG && !!document.querySelector('#modalRoot').children.length;",
" const t=[...document.querySelectorAll('#toastRoot .toast')]; out.emptyNameToast=t.length?t[t.length-1].textContent:'';",
" try{ document.querySelector('#modalRoot .close').click(); }catch(e){}",
" // --- P6.3 / F-2: search special chars literal, no crash ---",
" location.hash='#/expenses'; await sleep(300);",
" const si=document.querySelector('#globalSearch'); let crashed=false;",
" for(const q of ['.*','(','[a-z','<script>','\\\\','$^']){ try{ si.value=q; si.dispatchEvent(new Event('input',{bubbles:true})); await sleep(120); }catch(e){ crashed=true; } }",
" out.searchNoCrash = !crashed && !!document.querySelector('#main');",
" si.value=''; si.dispatchEvent(new Event('input',{bubbles:true}));",
" return out; })();"
].join("\n");
const r=await send('Runtime.evaluate',{expression:'(async()=>{'+script+'})()',returnByValue:true,awaitPromise:true});
if(r&&r.exceptionDetails) console.log('EVAL ERR', JSON.stringify(r.exceptionDetails).slice(0,500));
const o=r&&r.result&&r.result.value||{};
console.log('\n===== P3.2 / P6.3 / P9 — SECURITY & VALIDATION =====');
const chk=(n,c,d)=>console.log((c?'✓ PASS':'✗ FAIL')+'  '+n+(d?'   ('+d+')':''));
chk('P9 XSS in group/expense/user names does NOT execute', o.xssDidNotExecute);
chk('P9 no live <img>/<svg> injected (payload escaped)', o.noLiveInjected);
chk('P9 payload rendered as inert text', o.renderedAsText);
chk('T-GRP-11 create group with empty name rejected', o.emptyNameRejected, 'toast='+o.emptyNameToast);
chk('P6.3 search special chars (.* ( [ <script> \\\\) no crash', o.searchNoCrash);
console.log('exceptions:', errs.length);
ws.close();child.kill();process.exit(0);
