import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9366, BASE='http://localhost:8001';
const child=spawn(CHROME,['--headless=new','--disable-gpu',`--remote-debugging-port=${PORT}`,'--no-first-run','--no-default-browser-check','--user-data-dir=C:\\tmp\\orbit-qa-prof6','about:blank'],{stdio:'ignore'});
await sleep(1500);
const nt=await fetch(`http://127.0.0.1:${PORT}/json/new`,{method:'PUT'}).then(r=>r.json());
const ws=new WebSocket(nt.webSocketDebuggerUrl);
const pending=new Map();let idc=0;let logs=[];
const send=(m,p={})=>new Promise(res=>{const id=++idc;pending.set(id,res);ws.send(JSON.stringify({id,method:m,params:p}));});
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);
 if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result||m.error);pending.delete(m.id);return;}
 if(m.method==='Runtime.consoleAPICalled'&&(m.params.type==='error'||m.params.type==='warning'))logs.push(m.params.type.toUpperCase()+': '+(m.params.args||[]).map(a=>a.value??a.description??'').join(' '));
 if(m.method==='Runtime.exceptionThrown'){const e=m.params.exceptionDetails;logs.push('EXCEPTION: '+((e.exception&&(e.exception.description||e.exception.value))||e.text));}});
await new Promise(r=>ws.addEventListener('open',r));
await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
await send('Network.setBlockedURLs',{urls:['*gstatic.com*','*googleapis.com*','*frankfurter.app*','*firebaseio.com*']});
const stub=`(function(){var u={uid:'x',email:'t@e.com',displayName:'QA',photoURL:''};var o={isConfigured:()=>true,isReady:()=>true,user:()=>u,init:()=>Promise.resolve(),onAuthChange:f=>{setTimeout(()=>f(u),0)},hasRemoteData:()=>Promise.resolve(false),pullAll:()=>Promise.resolve({ok:true}),pushAll:()=>Promise.resolve({ok:true}),write:()=>Promise.resolve(),deleteOne:()=>Promise.resolve(),clearStore:()=>Promise.resolve(),signOut:()=>Promise.resolve(),signInWithGoogle:()=>Promise.resolve(u),_unsubAuth:()=>{}};try{Object.defineProperty(window,'OrbitCloud',{value:o,writable:false})}catch(e){window.OrbitCloud=o}})();`;
await send('Page.addScriptToEvaluateOnNewDocument',{source:stub});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});return r&&r.result?r.result.value:undefined;};
await send('Page.navigate',{url:BASE+'/index.html'}); await sleep(3500);
await ev("window.loadDemoData()");
await ev("(async()=>{var A=window.OrbitApp;A.State.users=await OrbitDB.getAll('users');A.State.groups=await OrbitDB.getAll('groups');A.State.expenses=await OrbitDB.getAll('expenses');A.State.settlements=await OrbitDB.getAll('settlements');})()");
await ev("OrbitApp.render()"); await sleep(300);
const out={};
const routes=['#/dashboard','#/groups','#/expenses','#/trips','#/activity','#/analytics','#/settle','#/profile'];
for(const r of routes){ logs=[]; await ev("location.hash='"+r+"'"); await sleep(700); out[r]=logs.slice(); }
const gids=await ev("OrbitApp.State.groups.map(g=>g.id)");
for(const g of (gids||[])){ logs=[]; await ev("location.hash='#/groups/"+g+"'"); await sleep(500); if(logs.length) out['group '+g]=logs.slice(); }
// open + close expense modal, settle modal — exercise modal a11y path
await ev("location.hash='#/dashboard'"); await sleep(350);
logs=[]; out['clickResult']=await ev("(function(){try{document.querySelector('#newExpenseTop').click();return 'ok';}catch(e){return 'ERR:'+(e&&e.message);}})()"); await sleep(400);
out['modalRootChildren']=await ev("document.querySelector('#modalRoot').children.length");
out['modal role']=await ev("(document.querySelector('#modalRoot .modal')||{}).getAttribute&&document.querySelector('#modalRoot .modal').getAttribute('role')");
out['app inert']=await ev("document.querySelector('#app').hasAttribute('inert')");
await ev("document.querySelector('#modalRoot .modal-head .close').click()"); await sleep(150);
out['modal closed + inert removed']=await ev("(!document.querySelector('#modalRoot').children.length)&&!document.querySelector('#app').hasAttribute('inert')");
out['modal-open errors']=logs.slice();
let total=0; for(const k of routes) total+=out[k].length;
console.log(JSON.stringify(out,null,1));
console.log('\nTOTAL route errors/warnings:', total, '| modal role:', out['modal role'], '| inert on open:', out['app inert'], '| clean close:', out['modal closed + inert removed']);
ws.close();child.kill();process.exit(0);
