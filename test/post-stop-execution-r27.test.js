import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {analyzePostStop,buildSuccessorPlan} from '../post-stop-learning.js';
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
function harness(){
 let stored=null;const events=[];
 const params={tradeScore:74,cautionScore:66,fullRiskPct:.5,cautionRiskPct:.25,weights:{technical:.42,candidate:.38,entryDistance:.2},maxOpenPositions:1,maxTradesPerDay:8,maxPortfolioRiskPct:3,maxDailyLossPct:3,maxDrawdownPct:8,cooldownMinutes:180,postStopReentryMinutes:720,parameterVersion:'test'};
 const state={account:{cash:10000,equity:10000,peakEquity:10000,dayStartEquity:10000,realizedPnl:0},positions:[],trades:[],equityCurve:[],parameters:params,lifecycle:{status:'ACTIVE_PAPER'}};
 const context=vm.createContext({structuredClone,crypto,console,config:{symbols:['BTCUSDT','ETHUSDT'],maxEntryDistanceAtr:1,feeBps:5,marketStaleMs:60000},CHALLENGER_V2_START:10000,CHALLENGER_V2_TRADE_SCORE:72,CHALLENGER_V2_CAUTION_SCORE:62,CHALLENGER_V2_FULL_RISK_PCT:1,buildSuccessorPlan,analyzePostStop,
 getState:async()=>structuredClone(stored),setState:async(k,v)=>{await Promise.resolve();stored=structuredClone(v);},addEvent:async(k,v)=>events.push({k,v}),rollover:x=>x,today:()=>new Date().toISOString().slice(0,10),shadowRegime:()=> 'TREND',challengerRegimeAdjustment:()=>0,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),round:(v,d)=>+Number(v).toFixed(d),openRisk:p=>p.reduce((s,x)=>s+x.riskPct,0),slip:x=>x,last:a=>a.at(-1)});
 const mark=server.match(/function markPosition\(.*\n/)[0];
 const close=server.match(/function closePaperPosition\(.*\n/)[0];
 const exit=server.match(/function exitReason\(.*\n/)[0];
 vm.runInContext(mark+close+exit+server.slice(server.indexOf('// Challenger V3 is created once'),server.indexOf('// MERIDIAN REGIME V1')),context);
 return {context,events,state,set:s=>{stored=structuredClone(s)},get:()=>stored,call:(name,...args)=>context[name](...args)};
}
const signal={symbol:'BTCUSDT',side:'LONG',entry:100,sl:90,tp1:120,status:'READY',technical:100,candidate:100,distanceAtr:0};
test('concurrent scan and entries cannot overwrite positions or exceed position limit',async()=>{
 const h=harness();h.set(h.state);
 const result=await Promise.all([h.call('submitChallengerV3',signal),h.call('observeChallengerV3Scan',[signal],h.state),h.call('submitChallengerV3',{...signal,symbol:'ETHUSDT'})]);
 assert.equal(result[0].accepted,true);assert.equal(result[2].accepted,false);assert.equal(h.get().positions.length,1);assert.ok(h.get().lastScanAt);
});
test('open fee counted once; missing quote preserves unrealized value',async()=>{
 const h=harness();h.set(h.state);await h.call('submitChallengerV3',signal);
 await h.call('challengerV3Cycle',{quotes:{BTCUSDT:{price:100,ts:Date.now()}}});
 assert.equal(h.get().account.equity,9999.5);
 await h.call('challengerV3Cycle',{quotes:{}});assert.equal(h.get().account.equity,9999.5);
});
test('opposite-side intervening trade cannot bypass stop cooldown; reason persists',async()=>{
 const h=harness();h.state.trades=[{symbol:'BTCUSDT',side:'LONG',exitReason:'SL',closedAt:new Date(Date.now()-5*3600000).toISOString()},{symbol:'BTCUSDT',side:'SHORT',exitReason:'TP1',closedAt:new Date(Date.now()-4*3600000).toISOString()}];h.set(h.state);
 const result=await h.call('submitChallengerV3',signal);assert.equal(result.reasons[0],'POST_STOP_COOLDOWN');assert.equal(h.get().lastSignal.gate.reasons[0],'POST_STOP_COOLDOWN');
});
test('invalid stop, nonfinite risk and zero equity reject before position creation',()=>{
 const h=harness();for(const [s,r,e] of [[{...signal,sl:110},.5,10000],[signal,NaN,10000],[signal,.5,0]]){h.state.account.equity=e;const gate=h.call('challengerV3RiskGate',{state:h.state,signal:s,riskPct:r});assert.equal(gate.ok,false);}
});
test('stop analysis is durable and drawdown stop cannot silently restart after recovery',async()=>{
 const h=harness();h.state.account.cash=9100;h.state.account.equity=9100;h.set(h.state);
 await h.call('challengerV3Cycle',{quotes:{}});assert.equal(h.get().lifecycle.status,'STOPPED_REVIEW');assert.equal(h.get().stopAnalysis.triggered,true);
 const recovered=h.get();recovered.account.cash=10000;recovered.account.equity=10000;h.set(recovered);
 const result=await h.call('submitChallengerV3',signal);assert.equal(result.accepted,false);assert.ok(result.reasons.includes('STOPPED_REVIEW'));assert.equal(h.events.filter(x=>x.k==='CHALLENGER_V3_STOP_REVIEW').length,1);
});
test('drawdown threshold uses raw values and small parent risk is never increased',()=>{
 const state={account:{equity:9200.4,peakEquity:10000},trades:[]};assert.equal(analyzePostStop(state).triggered,false);
 state.account.equity=9100;state.trades=Array.from({length:20},()=>({status:'CLOSED',realized:-1}));const plan=buildSuccessorPlan(state,{}, {fullRiskPct:.05});assert.ok(plan.parameters.fullRiskPct<.05);
});
