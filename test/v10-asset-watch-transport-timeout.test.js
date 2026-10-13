import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../v9/v9.js',import.meta.url),'utf8');
function harness(){
 let fire,delay,cleared=0,calls=0,requestSignal;
 const context=vm.createContext({
  API_BASE:'https://p01--achi-meridian--ttvk44grdlp7.code.run',token:()=>'',AbortController,
  setTimeout(fn,ms){fire=fn;delay=ms;return 17;},
  clearTimeout(id){assert.equal(id,17);cleared++;},
  fetch(_url,{signal}){calls++;requestSignal=signal;return new Promise((_resolve,reject)=>{
   const abort=()=>reject(Object.assign(new Error('synthetic abort'),{name:'AbortError'}));
   if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  });}
 });
 vm.runInContext(source.slice(source.indexOf('async function manageAssetWatchShare('),source.indexOf('const PORTFOLIO_TICKER_CACHE_MS')),context);
 return {manage:context.manageAssetWatchShare,expire:()=>fire(),state:()=>({delay,cleared,calls,aborted:requestSignal?.aborted})};
}
test('share transport ten-second timer aborts pending fetch and releases timer',async()=>{
 const h=harness(),pending=h.manage('rotate','synthetic-once');
 const rejected=assert.rejects(pending,{name:'AbortError'});
 assert.deepEqual(h.state(),{delay:10000,cleared:0,calls:1,aborted:false});
 h.expire();await rejected;
 assert.deepEqual(h.state(),{delay:10000,cleared:1,calls:1,aborted:true});
});
test('share transport forwards caller cancellation and removes the listener',async()=>{
 const h=harness(),controller=new AbortController();let removed=0;
 const signal={get aborted(){return controller.signal.aborted;},addEventListener:(...args)=>controller.signal.addEventListener(...args),removeEventListener:(...args)=>{removed++;controller.signal.removeEventListener(...args);}};
 const pending=h.manage('revoke','synthetic-once',signal),rejected=assert.rejects(pending,{name:'AbortError'});
 controller.abort();await rejected;
 assert.equal(h.state().aborted,true);assert.equal(h.state().cleared,1);assert.equal(removed,1);
});
test('share transport respects an already aborted caller signal',async()=>{
 const h=harness(),controller=new AbortController();controller.abort();
 await assert.rejects(h.manage('rotate','synthetic-once',controller.signal),{name:'AbortError'});
 assert.equal(h.state().aborted,true);assert.equal(h.state().cleared,1);
});
