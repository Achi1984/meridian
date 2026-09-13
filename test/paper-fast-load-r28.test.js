import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../v8-clean/data.js',import.meta.url),'utf8');
async function model(){
 const calls=[];
 const account={equity:9970,startEquity:10000,peakEquity:10780,realizedPnl:-30};
 globalThis.window={MERIDIAN_V8_CONFIG:{apiBase:''}};
 globalThis.localStorage={getItem:()=> 'test'};
 const challenger={enabled:true,account,closedCount:23,profitFactor:.98,openPositions:[],lastEvaluations:[],recentClosed:[]};
 const overview={status:{engine:{running:true,marketFresh:true}},baseline:{account,trades:[],positions:[]},challengerV2:challenger,challengerV3:challenger,directionalV4:{},fundingCarryV2:{}};
 globalThis.fetch=async path=>{calls.push(path);const data=path==='/api/paper/overview'?overview:{};return{ok:true,json:async()=>data};};
 const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 return {calls,module};
}
test('first PAPER load excludes full analytics and activity; retains real account results',async()=>{
 const {calls,module}=await model();const x=await module.loadPaper();
 assert.equal(x.ok,true);assert.equal(x.detailsLoaded,false);assert.equal(calls.length,1);assert.deepEqual(calls,['/api/paper/overview']);assert.ok(!calls.includes('/api/research-analytics'));
 assert.equal(x.botHealth.bots.challenger.metrics.pnl,-30);assert.equal(x.botHealth.bots.challenger.metrics.profitFactor,.98);
 await module.loadPaper({details:true});assert.ok(calls.includes('/api/research-analytics'));
});
test('missing authorization never becomes a zero-performance bot',async()=>{
 const {module}=await model();globalThis.fetch=async()=>({ok:false,status:401});const x=await module.loadPaper();assert.equal(x.locked,true);assert.equal(x.botHealth,undefined);
});
test('existing exit sampler closes whole position at TP1 and can realize more than planned SL risk',()=>{
 const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const ctx=vm.createContext({config:{feeBps:0},slip:x=>x});
 vm.runInContext(server.match(/function exitReason\(.*\n/)[0]+server.match(/function closePaperPosition\(.*\n/)[0],ctx);
 const p={entry:100,sl:90,tp1:110,tp2:120,side:'LONG',qty:1,feeOpen:0};
 assert.equal(ctx.exitReason(p,110),'TP1');assert.equal(ctx.closePaperPosition(p,110,'TP1').status,'CLOSED');
 assert.equal(ctx.closePaperPosition(p,87,'SL').realized,-13);
 assert.equal(ctx.exitReason(p,95),null); // A stop touch between samples cannot be inferred from this quote.
});
