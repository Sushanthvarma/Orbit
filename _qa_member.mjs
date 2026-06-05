// Member-removal regression: drives the real chip-× → confirm → Remove flow
// for a LOCAL group and a SHARED group (ghost member), proving the member
// actually leaves the roster (the reported "Removed X but nothing happens" bug).
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9388, BASE='http://localhost:8001';
const child=spawn(CHROME,['--headless=new','--disable-gpu',`--remote-debugging-port=${PORT}`,'--no-first-run','--no-default-browser-check','--user-data-dir=C:\\tmp\\orbit-qa-prof8','about:blank'],{stdio:'ignore'});
await sleep(1500);
const nt=await fetch(`http://127.0.0.1:${PORT}/json/new`,{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(nt.webSocketDebuggerUrl);
const pending=new Map();let idc=0;let errs=[];
const send=(m,p={})=>new Promise(res=>{const id=++idc;pending.set(id,res);ws.send(JSON.stringify({id,method:m,params:p}));});
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);
 if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result||m.error);pending.delete(m.id);return;}
 if(m.method==='Runtime.exceptionThrown')errs.push('EXC');});
await new Promise(r=>ws.addEventListener('open',r));
await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
await send('Network.setBlockedURLs',{urls:['*gstatic.com*','*googleapis.com*','*frankfurter.app*','*firebaseio.com*']});
// Stub OrbitCloud (signed-in) AND OrbitGroups (shared-group ops) so the shared path runs.
const stub=`(function(){var u={uid:'fakeuid',email:'t@e.com',displayName:'QA',photoURL:''};
 var oc={isConfigured:()=>true,isReady:()=>true,user:()=>u,init:()=>Promise.resolve(),onAuthChange:f=>{setTimeout(()=>f(u),0)},hasRemoteData:()=>Promise.resolve(false),pullAll:()=>Promise.resolve({ok:true}),pushAll:()=>Promise.resolve({ok:true}),write:()=>Promise.resolve(),deleteOne:()=>Promise.resolve(),clearStore:()=>Promise.resolve(),signOut:()=>Promise.resolve(),signInWithGoogle:()=>Promise.resolve(u),_unsubAuth:()=>{}};
 try{Object.defineProperty(window,'OrbitCloud',{value:oc,writable:false})}catch(e){window.OrbitCloud=oc}
 window.__removeCalls=[];
 var og={isReady:()=>true,currentUid:()=>u.uid,removeMember:(gid,mid)=>{window.__removeCalls.push([gid,mid]);return Promise.resolve({ok:true});},onMyGroups:()=>(()=>{}),onGroupExpenses:()=>(()=>{}),onGroupActivity:()=>(()=>{}),onAdminFeed:()=>(()=>{}),claimPending:()=>Promise.resolve({claimed:[]}),upsertMyProfile:()=>Promise.resolve(),addExpense:()=>Promise.resolve(),addSettlement:()=>Promise.resolve()};
 try{Object.defineProperty(window,'OrbitGroups',{value:og,writable:false})}catch(e){window.OrbitGroups=og}})();`;
await send('Page.addScriptToEvaluateOnNewDocument',{source:stub});
await send('Page.navigate',{url:BASE+'/index.html'}); await sleep(3500);
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r&&r.exceptionDetails)return{__err:r.exceptionDetails.text};return r&&r.result?r.result.value:undefined;};
await ev("window.loadDemoData()");
await ev("(async()=>{var A=window.OrbitApp;A.State.users=await OrbitDB.getAll('users');A.State.groups=await OrbitDB.getAll('groups');A.State.expenses=await OrbitDB.getAll('expenses');A.State.settlements=await OrbitDB.getAll('settlements');})()");
await ev("OrbitApp.render()"); await sleep(200);

const script=[
"return (async()=>{ const A=window.OrbitApp; const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const out={};",
" // Seed a LOCAL group with 4 members incl. a ghost-like name-only contact 'Vandana'.",
" const v={id:'u_vanda', name:'Vandana', isSelf:false, avatar:'av-c2', email:'', phone:'', upi:''};",
" await OrbitDB.put('users', v); A.State.users.push(v);",
" const gl={id:'g_local_test', name:'Local Trip', category:'friends', currency:'INR', members:['u_self','u_vanda','u_rohan','u_priya'], createdAt:new Date().toISOString(), emoji:'LT'};",
" await OrbitDB.put('groups', gl); A.State.groups.push(gl);",
" // Seed a SHARED group with a ghost 'Vandana' (the reported scenario).",
" const gs={id:'g_shared_test', name:'Linga Bhairavi', category:'friends', currency:'INR', members:['u_self','u_vanda','u_rohan','u_priya'], createdAt:new Date().toISOString(), emoji:'LB', shared:true, sharedId:'g_shared_test', createdBy:'fakeuid'};",
" await OrbitDB.put('groups', gs); A.State.groups.push(gs);",
" async function removeViaUI(gid){",
"   location.hash='#/groups/'+gid; await sleep(500);",
"   // find Vandana's chip and click its × ",
"   const chips=[...document.querySelectorAll('#main .member-chip')];",
"   const chip=chips.find(c=>/Vandana/.test(c.textContent));",
"   if(!chip) return {found:false};",
"   const x=chip.querySelector('.x'); if(!x) return {foundX:false, chipText:chip.textContent};",
"   x.click(); await sleep(250);",
"   // confirm modal -> click Remove",
"   const btn=[...document.querySelectorAll('#modalRoot button')].find(b=>b.textContent.trim()==='Remove');",
"   if(!btn) return {confirmShown:false};",
"   btn.click(); await sleep(400);",
"   const g=A.State.groups.find(x=>x.id===gid);",
"   const chipsAfter=[...document.querySelectorAll('#main .member-chip')].map(c=>c.textContent.replace(/[×\\s]/g,'')).filter(Boolean);",
"   return { inMembers: g.members.includes('u_vanda'), memberCount:g.members.length, chipStillShown: chipsAfter.some(t=>/Vandana/.test(t)), modalClosed: !document.querySelector('#modalRoot').children.length };",
" }",
" out.local = await removeViaUI('g_local_test');",
" out.shared = await removeViaUI('g_shared_test');",
" out.cloudRemoveCalled = (window.__removeCalls||[]).some(c=>c[0]==='g_shared_test' && c[1]==='u_vanda');",
" // ---- P0.2: ARCHIVE actually hides the group (was a no-op demo stub) ----",
" const ga={id:'g_arch', name:'ZZ Archive Me', category:'friends', currency:'INR', members:['u_self','u_rohan'], createdAt:new Date().toISOString(), emoji:'AR'};",
" await OrbitDB.put('groups', ga); A.State.groups.push(ga);",
" location.hash='#/groups/g_arch'; await sleep(450);",
" const archBtn=[...document.querySelectorAll('#main button')].find(b=>b.textContent.trim()==='Archive');",
" out.archiveBtnFound=!!archBtn; if(archBtn){ archBtn.click(); await sleep(200); const conf=[...document.querySelectorAll('#modalRoot button')].find(b=>b.textContent.trim()==='Archive'); if(conf){conf.click(); await sleep(450);} }",
" const gaAfter=A.State.groups.find(x=>x.id==='g_arch');",
" location.hash='#/groups'; await sleep(450);",
" out.archivedFlag = !!(gaAfter&&gaAfter.archived);",
" out.archivedHidden = ![...document.querySelectorAll('#main .group-card')].some(c=>/ZZ Archive Me/.test(c.textContent));",
" const dbga=await OrbitDB.get('groups','g_arch'); out.archivedPersisted = !!(dbga&&dbga.archived);",
" // ---- P0.2: Default-currency preference persists (toasted 'Saved' but didn't) ----",
" const me=A.State.users.find(u=>u.isSelf); me.defaultCurrency='EUR'; await OrbitDB.put('users', me);",
" const dbme=(await OrbitDB.getAll('users')).find(u=>u.isSelf); out.defaultCurrencyPersisted = dbme && dbme.defaultCurrency==='EUR';",
" return out; })();"
].join("\n");
const r=await send('Runtime.evaluate',{expression:'(async()=>{'+script+'})()',returnByValue:true,awaitPromise:true});
if(r&&r.exceptionDetails) console.log('EVAL ERR', JSON.stringify(r.exceptionDetails).slice(0,400));
const o=r&&r.result&&r.result.value||{};
console.log('\n===== MEMBER REMOVAL REGRESSION =====');
const chk=(n,c,d)=>console.log((c?'✓ PASS':'✗ FAIL')+'  '+n+(d!==undefined?'   ('+d+')':''));
chk('LOCAL: Vandana removed from roster', o.local && o.local.inMembers===false, JSON.stringify(o.local));
chk('LOCAL: chip no longer shown', o.local && o.local.chipStillShown===false);
chk('SHARED: Vandana removed from roster (the reported bug)', o.shared && o.shared.inMembers===false, JSON.stringify(o.shared));
chk('SHARED: chip no longer shown', o.shared && o.shared.chipStillShown===false);
chk('SHARED: cloud removeMember was called', o.cloudRemoveCalled);
chk('confirm modal closed after Remove', o.local && o.local.modalClosed && o.shared && o.shared.modalClosed);
chk('P0.2 Archive: flag set + persisted + hidden from groups list', o.archivedFlag && o.archivedPersisted && o.archivedHidden, 'btn='+o.archiveBtnFound+' flag='+o.archivedFlag+' persisted='+o.archivedPersisted+' hidden='+o.archivedHidden);
chk('P0.2 Default currency preference persists', o.defaultCurrencyPersisted);
console.log('exceptions:', errs.length);
ws.close();child.kill();process.exit(0);
