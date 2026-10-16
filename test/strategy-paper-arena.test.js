import test from 'node:test';
import assert from 'node:assert/strict';
import {ARENA_SYMBOLS,ARENA_RULESET,ARENA_MODEL,replayStrategyPaperArena} from '../research/strategy-paper-arena.js';
const DAY=86400000,START=Date.UTC(2024,0,1);
function fixture(n=235,price=(i,s)=>100+i*0.3+s*2){return Object.fromEntries(ARENA_SYMBOLS.map((s,k)=>[s,Array.from({length:n},(_,i)=>{const p=price(i,k);return{openTime:START+i*DAY,open:p,high:p*1.01,low:p*.99,close:p,closeTime:START+(i+1)*DAY-1};})]));}
function replay(data=fixture(),options={}){return replayStrategyPaperArena({data,asOf:data.BTC.at(-1).closeTime,sourceKind:'SYNTHETIC',...options});}
function near(a,b,tol=1e-7){assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);}

test('arena produces four isolated unproven experiments, cash/control and blocked H9',()=>{
  const r=replay();assert.equal(r.ruleset,ARENA_RULESET);assert.equal(r.mode,'PAPER_SIMULATION');assert.equal(r.sourceKind,'SYNTHETIC');
  assert.deepEqual(r.candidates.map(c=>c.id),['H1-B','H1-E','H7-B','H7-R','H9']);
  assert.equal(r.candidates[4].status,'BLOCKED_DATA');assert.equal(r.candidates[4].netPnl,null);
  assert.equal(r.liveAuthorized,false);assert.equal(r.autoPromotion,false);assert.equal(r.validation,'UNPROVEN');assert.equal(r.legacyCRVCompatibility,'UNRESOLVED');
  for(const c of r.candidates.slice(0,4)){assert.equal(c.baseline.startingEquity,10000);assert.equal(c.baseline.currency,'USDT');assert.equal(c.baseline.riskPolicy,'PORTFOLIO_LEVEL_NO_STOP');assert.equal(c.baseline.paperReadiness,false);}
  assert.equal(r.controls.cash.baseline.equity,10000);assert.equal(r.controls.cash.baseline.costs,0);assert.equal(r.controls.cash.baseline.fills.length,0);assert.equal(r.controls.cash.baseline.profitFactor,null);
});
test('buy-and-hold charges all entry and diagnostic exit costs without minting cash',()=>{
  const data=fixture(205,()=>100),r=replay(data,{liquidateAtEnd:true});
  for(const [lane,rate] of [['baseline',.0008],['stress',.0016]]){
    const c=r.controls.buyAndHold[lane],notional=10000/(1+rate),expected=notional*(1-rate);
    near(c.equity,expected);near(c.costs,10000-expected);near(c.netPnl,-c.costs);near(c.turnoverNotional,2*notional);
    assert.equal(c.openPositions,0);assert.equal(c.closedTrades,8);assert.equal(c.profitFactor,0);assert.equal(c.endTreatment,'DIAGNOSTIC_END_CLOSE_LIQUIDATION');
    assert.ok(c.fills.filter(f=>f.side==='SELL').every(f=>f.signalTime===null&&f.reason==='DIAGNOSTIC_END_CLOSE_LIQUIDATION'));
  }
});
test('future candle perturbations cannot change earlier signals or fills',()=>{
  const original=fixture(),changed=structuredClone(original),cut=START+220*DAY;
  for(const s of ARENA_SYMBOLS)for(let i=220;i<changed[s].length;i++){for(const k of ['open','high','low','close'])changed[s][i][k]*=0.4;}
  const a=replay(original),b=replay(changed);
  for(let j=0;j<4;j++)for(const lane of ['baseline','stress']){
    assert.deepEqual(a.candidates[j][lane].fills.filter(x=>x.executionTime<cut),b.candidates[j][lane].fills.filter(x=>x.executionTime<cut));
    assert.ok(a.candidates[j][lane].fills.every(f=>f.signalTime<f.executionTime));
  }
});
test('weekly H7 uses Saturday fills, post-fee 25% targets and cash minimum; drift marked separately',()=>{
  const r=replay();for(const id of ['H7-B','H7-R']){
    const c=r.candidates.find(x=>x.id===id).baseline;
    for(const d of c.decisions.filter(x=>x.reason==='WEEKLY_RANK_REBALANCE')){
      assert.equal(new Date(d.executionTime).getUTCDay(),6);assert.ok(d.signalTime<d.executionTime);
      assert.ok(d.cash/d.equity>=.25-1e-10);assert.ok(Object.values(d.weights).every(w=>w<=.25+1e-10));
    }
    assert.ok(c.cash>=0);assert.match(r.model.weightLimitApplies,/DRIFT/);
  }
});
test('stress changes transaction costs, not frozen H1-E entry buffer policy',()=>{
  const r=replay(),c=r.candidates.find(x=>x.id==='H1-E');
  assert.deepEqual(c.baseline.fills.map(f=>[f.symbol,f.side,f.signalTime,f.executionTime]),c.stress.fills.map(f=>[f.symbol,f.side,f.signalTime,f.executionTime]));
  assert.ok(c.stress.costs>c.baseline.costs);assert.ok(c.stress.equity<c.baseline.equity);
  assert.equal(c.baseline.profitFactor,null); // Open marked gains are not closed trade evidence.
});
test('daily SMA exit is executed at next open including a gap loss',()=>{
  const data=fixture(211);for(const s of ARENA_SYMBOLS){for(let i=205;i<211;i++){const p=i===205?70:50;Object.assign(data[s][i],{open:p,high:p*1.01,low:p*.99,close:p});}}
  const r=replay(data),c=r.candidates[0].baseline,sells=c.fills.filter(f=>f.side==='SELL');
  assert.equal(sells.length,8);assert.ok(sells.every(f=>f.executionTime===START+206*DAY&&f.signalTime===START+206*DAY-1&&f.price===50));
  assert.equal(c.openPositions,0);assert.ok(c.maxDrawdownPct>50);near(c.equity,10000+c.trades.reduce((v,t)=>v+t.netPnl,0));
});
test('invalid histories fail closed rather than dropping rows or inventing fills',()=>{
  const mutations=[d=>d.BTC.pop(),d=>d.BTC[201].openTime=d.BTC[200].openTime,d=>d.BTC[201].close=NaN,d=>d.BTC[201].low=-1,d=>d.BTC[201].openTime+=1,d=>d.BTC[201].closeTime+=1,d=>delete d.SUI,d=>d.EXTRA=[]];
  for(const mutate of mutations){const d=fixture();mutate(d);assert.throws(()=>replay(d));}
  assert.throws(()=>replayStrategyPaperArena({data:fixture(),sourceKind:'SYNTHETIC'}));
  assert.throws(()=>replay(fixture(),{sourceKind:'UNKNOWN'}));
  assert.throws(()=>replay(fixture(),{asOf:START+220*DAY}));
  assert.throws(()=>replay(fixture(201)));
});
test('replay is deterministic, pure and does not mutate input',()=>{
  const d=fixture(),copy=structuredClone(d),a=replay(d),b=replay(d);assert.deepEqual(a,b);assert.deepEqual(d,copy);
});
test('H1-E fixed 16bps entry threshold has strict below/above boundary in both cost lanes',()=>{
  assert.equal(ARENA_MODEL.thresholdH1E,0.0016);
  for(const [distance,enters] of [[.001599,false],[.001601,true]]){
    const p=19900*(1+distance)/(199-distance),d=fixture(202,i=>i<199?100:p),r=replay(d),c=r.candidates.find(x=>x.id==='H1-E');
    for(const lane of ['baseline','stress'])assert.equal(c[lane].fills.some(f=>f.side==='BUY'),enters);
    assert.equal(r.candidates[0].baseline.fills.filter(f=>f.side==='BUY').length,8);
  }
});
test('H7-R retains rank four but drops rank five; H7-B rotates both out',()=>{
  const d={};for(let k=0;k<8;k++){let p=100;d[ARENA_SYMBOLS[k]]=Array.from({length:210},(_,i)=>{
    const amp=i>=202?(k===0?.00112:k===1?.00125:(k+1)*.0001):(k+1)*.0001;
    p*=Math.exp(.003+amp*(i%2?1:-1));return{openTime:START+i*DAY,closeTime:START+(i+1)*DAY-1,open:p,high:p*1.01,low:p*.99,close:p};
  });}
  // At second Saturday, the measured volatility order is SOL, XRP, HBAR, BTC, ETH, LINK, AVAX, SUI.
  const rank=ARENA_SYMBOLS.map(s=>{const rets=[];for(let j=178;j<=207;j++)rets.push(Math.log(d[s][j].close)-Math.log(d[s][j-1].close));const mean=rets.reduce((a,b)=>a+b,0)/30;return{s,v:Math.sqrt(rets.reduce((a,b)=>a+(b-mean)**2,0)/30)};}).sort((a,b)=>a.v-b.v).map(x=>x.s);
  assert.deepEqual(rank.slice(0,5),['SOL','XRP','HBAR','BTC','ETH']);
  const r=replay(d),at208=id=>r.candidates.find(c=>c.id===id).baseline.decisions.find(x=>x.executionTime===START+208*DAY).weights;
  assert.ok(at208('H7-R').BTC>0);assert.equal(at208('H7-R').ETH,0);assert.equal(at208('H7-B').BTC,0);assert.equal(at208('H7-B').ETH,0);
});
test('H7 daily risk exit bypasses weekly rebalance date',()=>{
  const d=fixture(207);for(const s of ARENA_SYMBOLS)for(let i=203;i<207;i++)Object.assign(d[s][i],{open:60,high:61,low:59,close:60});
  const r=replay(d);for(const id of ['H7-B','H7-R']){
    const sells=r.candidates.find(c=>c.id===id).baseline.fills.filter(f=>f.side==='SELL');
    assert.equal(sells.length,3);assert.ok(sells.every(f=>f.executionTime===START+204*DAY&&f.reason==='DAILY_TREND_EXIT'));assert.notEqual(new Date(sells[0].executionTime).getUTCDay(),6);
  }
});
test('derived numerical overflow fails closed, scale-safe SMA remains valid and PF absence is explicit',()=>{
  const huge=fixture(205,i=>1e307*(1+i*.001)),r=replay(huge);
  assert.equal(r.candidates[0].baseline.fills.filter(x=>x.side==='BUY').length,8);
  assert.equal(r.candidates[0].baseline.profitFactorReason,'NO_CLOSED_TRADES');assert.equal(r.candidates[0].baseline.drawdownSampling,'DAILY_CLOSE_ONLY');
  const tiny=fixture(205,()=>1e-320);assert.throws(()=>replay(tiny),/NONFINITE|INVALID/);
  const extreme=fixture(205,i=>i<150?1e-307:1e307);assert.throws(()=>replay(extreme),/NONFINITE_DERIVED_FEATURE/);
});
