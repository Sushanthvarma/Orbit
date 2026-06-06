// P8 recurring + P7.2 JSON restore + P10 perf + OCR extraction.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9477, BASE='http://localhost:8001';
const child=spawn(CHROME,['--headless=new','--disable-gpu',`--remote-debugging-port=${PORT}`,'--no-first-run','--no-default-browser-check','--user-data-dir=C:\\tmp\\orbit-qa-profM','about:blank'],{stdio:'ignore'});
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
"return (async()=>{ const A=window.OrbitApp; const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const out={}; const R=window.OrbitRecurring;",
" // ===== P8 recurring addInterval (use local-noon to avoid TZ date rollover) =====",
" const iso=(y,m,d)=>new Date(y,m,d,12,0,0).toISOString(); const parse=s=>new Date(s);",
" { const r=parse(R.addInterval(iso(2026,0,31),'monthly')); out.R_jan31 = r.getMonth()===1 && r.getDate()<=29; out.R_jan31d=r.toDateString(); } // Jan31 -> Feb (not Mar!)",
" { const r=parse(R.addInterval(iso(2024,0,31),'monthly')); out.R_leapFeb = r.getMonth()===1 && r.getDate()===29; out.R_leapd=r.toDateString(); } // 2024 leap -> Feb 29",
" { const r=parse(R.addInterval(iso(2024,1,29),'yearly')); out.R_yearLeap = r.getMonth()===1 && r.getDate()===28; out.R_yeard=r.toDateString(); } // Feb29 2024 +1y -> Feb 28 2025",
" { const r=parse(R.addInterval(iso(2026,2,15),'monthly')); out.R_normal = r.getMonth()===3 && r.getDate()===15; } // Mar15 -> Apr15",
" { const r=parse(R.addInterval(iso(2026,0,15),'weekly')); out.R_weekly = r.getDate()===22; }",
" // processRecurring spawns overdue clones (capped at 12)",
" { await OrbitDB.clear('expenses'); A.State.expenses=[];",
"   const tmpl={id:'rec_t', groupId:'g_flat', title:'Rent', amount:1000, currency:'INR', paidBy:'u_self', splitMode:'equal', splits:[{userId:'u_self',amount:1000}], category:'rent', date:iso(2020,0,1), recurring:{freq:'monthly', anchorDate:iso(2020,0,1), nextDue:iso(2020,0,1), active:true, parentId:null}};",
"   await OrbitDB.put('expenses',tmpl); A.State.expenses=await OrbitDB.getAll('expenses');",
"   const res=await R.processRecurring(OrbitDB, A.State); out.R_spawnCapped = res.spawned<=12 && res.spawned>0; out.R_spawnd='spawned='+res.spawned;",
"   const children=A.State.expenses.filter(e=>e.recurring&&e.recurring.parentId==='rec_t'); out.R_children = children.length===res.spawned; }",
" // restore demo",
" await window.loadDemoData(); A.State.expenses=await OrbitDB.getAll('expenses'); A.State.settlements=await OrbitDB.getAll('settlements'); A.State.groups=await OrbitDB.getAll('groups'); A.State.users=await OrbitDB.getAll('users');",
" // ===== P7.2 JSON backup / restore =====",
" { const snap=await OrbitDB.exportAll(); const expCount=snap.expenses.length;",
"   // wipe then restore",
"   await OrbitDB.clear('expenses'); await OrbitDB.clear('groups');",
"   const res=await OrbitDB.importAll(snap); A.State.expenses=await OrbitDB.getAll('expenses'); A.State.groups=await OrbitDB.getAll('groups');",
"   out.JB_restore = A.State.expenses.length===expCount && res.counts.expenses===expCount; out.JBd='restored='+A.State.expenses.length+'/'+expCount;",
"   // meta NOT restored (no meta in restorable set)",
"   out.JB_noMeta = !res.stores.includes('meta'); }",
" { let threw=false; try{ await OrbitDB.importAll({expenses:[{id:'bad'}]}); }catch(e){ threw=true; } out.JB_rejectsCorrupt = threw; } // expense missing amount/splits",
" { let threw=false; try{ await OrbitDB.importAll({nonsense:true}); }catch(e){ threw=true; } out.JB_rejectsGarbage = threw; }",
" { let threw=false; try{ await OrbitDB.importAll(null); }catch(e){ threw=true; } out.JB_rejectsNull = threw; }",
" // ===== P10 perf: 1000 expenses render time =====",
" { const groups=A.State.groups.map(g=>g.id); const big=[];",
"   for(let i=0;i<1000;i++){ const gid=groups[i%groups.length]; big.push({id:'perf_'+i, groupId:gid, title:'Perf '+i, amount:100+(i%900), currency:'INR', paidBy:'u_self', splitMode:'equal', splits:[{userId:'u_self',amount:100}], category:'food', date:new Date(2026,0,1+(i%300)).toISOString(), note:''}); }",
"   await OrbitDB.putAll('expenses', big); A.State.expenses=await OrbitDB.getAll('expenses');",
"   out.perfCount=A.State.expenses.length;",
"   const t0=performance.now(); location.hash='#/dashboard'; A.render(); const tDash=performance.now()-t0;",
"   const t1=performance.now(); location.hash='#/expenses'; A.render(); const tExp=performance.now()-t1;",
"   const t2=performance.now(); location.hash='#/analytics'; A.render(); const tAna=performance.now()-t2;",
"   out.perf = tDash<2500 && tExp<2500 && tAna<2500; out.perfD='dash='+Math.round(tDash)+'ms exp='+Math.round(tExp)+'ms ana='+Math.round(tAna)+'ms n='+A.State.expenses.length; }",
" // ===== OCR extractLines heuristic =====",
" { const O=window.OrbitOCR; const sample='CAFE BILL\\nMasala Dosa  120\\nFilter Coffee  60\\nCGST  9\\nSGST  9\\nTOTAL  198';",
"   const ex=O.extractLines(sample); out.OCR_total = ex.total===198; out.OCR_items = ex.lines.filter(l=>!l.isTaxOrFee).length>=2; out.OCRd='total='+ex.total+' items='+ex.lines.length;",
"   const junk=O.extractLines('just some\\nrandom text\\nno numbers here'); out.OCR_graceful = junk.total===null || junk.lines.length===0; }",
" return out; })();"
].join("\n");
const r=await send('Runtime.evaluate',{expression:'(async()=>{'+script+'})()',returnByValue:true,awaitPromise:true});
if(r&&r.exceptionDetails) console.log('EVAL ERR', JSON.stringify(r.exceptionDetails).slice(0,500));
const o=r&&r.result&&r.result.value||{};
console.log('\n===== P8 / P7.2 / P10 / OCR =====');
const chk=(n,c,d)=>console.log((c?'✓ PASS':'✗ FAIL')+'  '+n+(d?'   ('+d+')':''));
chk('P8 monthly Jan-31 → February (no skip to March)', o.R_jan31, o.R_jan31d);
chk('P8 monthly Jan-31 in leap year → Feb 29', o.R_leapFeb, o.R_leapd);
chk('P8 yearly Feb-29 → Feb 28 next year', o.R_yearLeap, o.R_yeard);
chk('P8 monthly normal (Mar-15 → Apr-15) + weekly +7d', o.R_normal && o.R_weekly);
chk('P8 processRecurring spawns overdue clones, capped ≤12', o.R_spawnCapped && o.R_children, o.R_spawnd);
chk('P7.2 export → wipe → restore reproduces all expenses', o.JB_restore, o.JBd);
chk('P7.2 restore skips meta (keys/flags not clobbered)', o.JB_noMeta);
chk('P7.2 rejects corrupt / garbage / null backups', o.JB_rejectsCorrupt && o.JB_rejectsGarbage && o.JB_rejectsNull);
chk('P10 dashboard/expenses/analytics render <2.5s @ 1000 expenses', o.perf, o.perfD);
chk('OCR extractLines: total + items parsed; junk handled gracefully', o.OCR_total && o.OCR_items && o.OCR_graceful, o.OCRd);
console.log('exceptions:', errs.length);
ws.close();child.kill();process.exit(0);
