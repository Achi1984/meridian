import crypto from 'node:crypto';
import {validateSource,sourceReceipt,EDGE_V1_SOURCE} from './paper-edge-v1-data-contract.js';
import {aggregateDaily,dailyContextForTrigger,conservativeFill} from './paper-edge-v1-foundation.js';
import {indicators,dailyRegime,pullbackCandidate,triggerFromPullback,exitEvents,applyEvent,atrTrail,oppositeRegimeExit,nextBarEntry,fundingCashflow} from './paper-edge-v1-state-machine.js';
import {commonTimes,frozenSplit,gate,frozenCosts,openCandidate} from './paper-edge-v1-discovery-engine.js';
import {EDGE_V1_STAGE_LOCK} from './edge-v1-stage-lock.js';

export const EDGE_V1_DISCOVERY_SOURCE_LOCK=Object.freeze({
 runId:37231163461,
 artifactId:11313901895,
 sourceHeadSha:'000e6864a0aabdb5053a5988a5ccc46cee2b9e0b',
 artifactZipDigest:'sha256:8113b45cf2cebc957416e2ef69a3bd1fc510a41441591fbec0d7b47c49cca91d',
 receiptDigest:'d05b6c2916900ffac602c11166376e33a2f606e70967d0ecc988a1201df8ad08',
 artifactName:'paper-edge-v1-source'
});
export const EDGE_V1_DISCOVERY_CONVENTIONS=Object.freeze({
 startingEquityUsd:100000,
 baseline:{feeBps:5,slippageBps:3},
 stress:{feeBps:8,slippageBps:8},
 stressMethod:'same frozen trade path and fill notionals; higher declared per-fill costs only',
 setupReset:'after a three-bar trigger window expires, new pullback search resumes on the next completed 4h bar',
 sameTimestampEntryOrder:[...EDGE_V1_SOURCE.symbols],
 fundingWithinExitBar:'after open-time regime/gap exits and entries, before non-gap intrabar stop/target fills',
 intrabarExitTimestamp:'completed 4h bar close timestamp; prices remain frozen stop/target conventions',
 splitBoundary:'force-close remaining Discovery positions at the final Discovery bar close with normal exit costs',
 drawdown:'baseline marked-to-market equity sampled at each completed 4h close',
 windowAttribution:'trade net PnL attributed to the 4h bar containing its final exit'
});
const STEP=EDGE_V1_SOURCE.intervalMs, SYMBOLS=[...EDGE_V1_SOURCE.symbols], EPS=1e-10;
const sign=side=>side==='LONG'?1:-1;
const sha256=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const finite=x=>Number.isFinite(Number(x));

export function assertDiscoveryStage(){
 if(EDGE_V1_STAGE_LOCK.stage!=='DISCOVERY'||EDGE_V1_STAGE_LOCK.validation!==false||EDGE_V1_STAGE_LOCK.holdout!==false||EDGE_V1_STAGE_LOCK.live!==false)throw new Error('EDGE_V1_STAGE_LOCK_VIOLATION');
 return true;
}
export function verifyLockedSource(pkg){
 assertDiscoveryStage();
 if(pkg?.schema!=='PAPER-EDGE-V1-SOURCE-PACKAGE-1'||pkg?.researchOnly!==true||pkg?.executionImpact!==false)throw new Error('EDGE_V1_SOURCE_PACKAGE_FLAGS');
 const validation=validateSource(pkg);if(!validation.ok)throw new Error(`EDGE_V1_SOURCE_INVALID:${JSON.stringify(validation)}`);
 const receipt=sourceReceipt(pkg);
 if(receipt.digest!==EDGE_V1_DISCOVERY_SOURCE_LOCK.receiptDigest)throw new Error(`EDGE_V1_SOURCE_DIGEST_MISMATCH:${receipt.digest}`);
 if(pkg?.receipt?.digest!==receipt.digest)throw new Error('EDGE_V1_SOURCE_RECEIPT_MISMATCH');
 const split=frozenSplit(pkg.barsBySymbol);if(!split.ok)throw new Error(`EDGE_V1_SPLIT_INVALID:${split.reason}`);
 if(split.total!==12594||split.discovery.count!==7556||split.validation.count!==2519||split.holdout.count!==2519)throw new Error('EDGE_V1_SPLIT_LOCK_MISMATCH');
 if(split.discovery.from!==1609459200000||split.discovery.to!==1718251200000||split.validation.from!==1718265600000||split.holdout.from!==1754539200000)throw new Error('EDGE_V1_SPLIT_BOUNDARY_MISMATCH');
 return{receipt,split,validation};
}
export function profitFactor(trades=[],key='netPnlBaseline'){
 let wins=0,losses=0;for(const t of trades){const x=Number(t?.[key]);if(!Number.isFinite(x))throw new Error('EDGE_V1_NONFINITE_TRADE_PNL');if(x>0)wins+=x;else if(x<0)losses-=x;}
 return losses===0?(wins>0?Infinity:0):wins/losses;
}
export function fiveWindows(timestamps=[]){
 const xs=[...timestamps];if(xs.length<5)throw new Error('EDGE_V1_WINDOW_TIMESTAMPS');const out=[];
 for(let i=0;i<5;i++){const a=Math.floor(xs.length*i/5),b=(i===4?xs.length:Math.floor(xs.length*(i+1)/5))-1;out.push({from:xs[a],to:xs[b]});}
 return out;
}
function prepare(rows){return{four:indicators(rows),daily:dailyRegime(aggregateDaily(rows))}}
function regimeAt(prepared,openTime){return dailyContextForTrigger(prepared.daily,openTime)?.regime??'FLAT'}
function gapStop(p,bar){return p.side==='LONG'?bar.open<=p.stop:bar.open>=p.stop}
function markedEquity(state,priceField='close'){
 let e=state.cash;for(const s of SYMBOLS){const p=state.positions[s];if(!p||p.remaining<=EPS)continue;const bar=state.currentBars[s],px=Number(bar?.[priceField]);if(!finite(px))throw new Error('EDGE_V1_MARK_PRICE');e+=sign(p.side)*(px-p.entry)*p.qty*p.remaining;}return e;
}
function costPair(notional){return{baseline:frozenCosts(notional,EDGE_V1_DISCOVERY_CONVENTIONS.baseline),stress:frozenCosts(notional,EDGE_V1_DISCOVERY_CONVENTIONS.stress)}}
function addFillCost(state,p,{type,time,barOpenTime,price,fraction}){
 const qty=p.qty*fraction,notional=Math.abs(qty*price),cost=costPair(notional),gross=type==='ENTRY'?0:sign(p.side)*(price-p.entry)*qty;
 if(type==='ENTRY')state.cash-=cost.baseline;else state.cash+=gross-cost.baseline;
 p.trade.grossPricePnl+=gross;p.trade.baselineCosts+=cost.baseline;p.trade.stressCosts+=cost.stress;
 p.trade.fills.push({type,time,barOpenTime,price,qty,fraction,notional,baselineCost:cost.baseline,stressCost:cost.stress,grossPricePnl:gross});
 return{gross,cost};
}
function finalizeTrade(state,p,{exitTime,exitBarOpenTime,exitReason}){
 const t=p.trade;t.exitTime=exitTime;t.exitBarOpenTime=exitBarOpenTime;t.exitReason=exitReason;
 t.netPnlBaseline=t.grossPricePnl+t.fundingPnl-t.baselineCosts;t.netPnlStress=t.grossPricePnl+t.fundingPnl-t.stressCosts;t.expectancyR=t.netPnlBaseline/t.initialRiskCash;
 const exitFraction=t.fills.filter(x=>x.type!=='ENTRY').reduce((a,x)=>a+x.fraction,0);if(Math.abs(exitFraction-1)>1e-8)throw new Error(`EDGE_V1_EXIT_FRACTION:${exitFraction}`);
 state.trades.push(t);state.positions[p.symbol]=null;
}
function settleEvent(state,p,event,bar,{time=bar.closeTime,barOpenTime=bar.openTime,reason=event.type,price=null}={}){
 const fillPrice=price??(event.type==='STOP'?conservativeFill({side:p.side,stop:p.stop},bar):event.type==='TP1'?p.tp1:event.type==='TP2'?p.tp2:Number(bar.close));
 addFillCost(state,p,{type:event.type,time,barOpenTime,price:fillPrice,fraction:event.fraction});
 const next=applyEvent(p,event);state.positions[p.symbol]=next;
 if(next.remaining<=EPS){next.remaining=0;finalizeTrade(state,next,{exitTime:time,exitBarOpenTime:barOpenTime,exitReason:reason});return null;}return next;
}
function openPosition(state,symbol,prepared,trigger,equity,bar){
 const openPositions=SYMBOLS.map(s=>state.positions[s]).filter(Boolean),p=openCandidate({symbol,prepared,trigger,equity,openPositions});
 if(!p)return null;p.entryTime=bar.openTime;p.entryBarOpenTime=bar.openTime;
 p.trade={id:`${symbol}-${bar.openTime}-${++state.tradeSeq}`,symbol,side:p.side,entryTime:bar.openTime,entryBarOpenTime:bar.openTime,entryPrice:p.entry,initialStop:p.stop,qty:p.qty,initialRiskCash:p.initialRisk*p.qty,grossPricePnl:0,fundingPnl:0,baselineCosts:0,stressCosts:0,fundingEvents:0,fills:[]};
 state.positions[symbol]=p;addFillCost(state,p,{type:'ENTRY',time:bar.openTime,barOpenTime:bar.openTime,price:p.entry,fraction:1});return p;
}
function applyFunding(state,p,events=[]){
 for(const x of events){if(!(x.time>p.entryTime))continue;const cash=fundingCashflow({side:p.side,qty:p.qty*p.remaining,entryPrice:p.entry,rate:Number(x.rate)});if(!finite(cash))throw new Error('EDGE_V1_FUNDING_NONFINITE');state.cash+=cash;p.trade.fundingPnl+=cash;p.trade.fundingEvents++;}
}
function finalizeBoundary(state,barBySymbol){
 for(const s of SYMBOLS){const p=state.positions[s];if(!p)continue;const bar=barBySymbol[s],event={type:'SPLIT_BOUNDARY',fraction:p.remaining};settleEvent(state,p,event,bar,{time:bar.closeTime,barOpenTime:bar.openTime,reason:'SPLIT_BOUNDARY',price:bar.close});}
}
function maxDrawdownPct(curve,starting){let peak=starting,max=0;for(const x of curve){if(!finite(x.equity))throw new Error('EDGE_V1_EQUITY_NONFINITE');peak=Math.max(peak,x.equity);if(peak>0)max=Math.max(max,(peak-x.equity)/peak*100);}return max}
function groupSummary(trades,key,groupKey,values){const out={};for(const v of values){const xs=trades.filter(t=>t[groupKey]===v);out[v]={closedTrades:xs.length,netPnl:xs.reduce((a,t)=>a+t[key],0),profitFactor:profitFactor(xs,key)};}return out}
function concentrationPct(byAsset){const xs=Object.values(byAsset).map(x=>Math.max(0,x.netPnl)),sum=xs.reduce((a,x)=>a+x,0);return sum>0?Math.max(...xs)/sum*100:Infinity}
function canonicalTradeDigest(trades){return sha256(trades.map(t=>({symbol:t.symbol,side:t.side,entryTime:t.entryTime,entryPrice:t.entryPrice,exitTime:t.exitTime,exitReason:t.exitReason,netPnlBaseline:t.netPnlBaseline,netPnlStress:t.netPnlStress,fills:t.fills.map(f=>({type:f.type,time:f.time,price:f.price,qty:f.qty}))})))}
function safePf(x){return Number.isFinite(x)?x:(x===Infinity?'Infinity':'-Infinity')}
function serialSummary(s){return{...s,profitFactor:safePf(s.profitFactor),stressProfitFactor:safePf(s.stressProfitFactor),positivePnlConcentrationPct:finite(s.positivePnlConcentrationPct)?s.positivePnlConcentrationPct:'Infinity',byAsset:Object.fromEntries(Object.entries(s.byAsset).map(([k,v])=>[k,{...v,profitFactor:safePf(v.profitFactor)}])),bySide:Object.fromEntries(Object.entries(s.bySide).map(([k,v])=>[k,{...v,profitFactor:safePf(v.profitFactor)}]))}}

export function summarizeDiscovery({trades,equityCurve,discoveryTimes,startingEquity}){
 const byAsset=groupSummary(trades,'netPnlBaseline','symbol',SYMBOLS),bySide=groupSummary(trades,'netPnlBaseline','side',['LONG','SHORT']);
 const windows=fiveWindows(discoveryTimes).map(w=>{const xs=trades.filter(t=>t.exitBarOpenTime>=w.from&&t.exitBarOpenTime<=w.to);return{...w,closedTrades:xs.length,netPnl:xs.reduce((a,t)=>a+t.netPnlBaseline,0)}});
 const summary={closedTrades:trades.length,byAsset,profitFactor:profitFactor(trades,'netPnlBaseline'),stressProfitFactor:profitFactor(trades,'netPnlStress'),expectancyR:trades.length?trades.reduce((a,t)=>a+t.expectancyR,0)/trades.length:0,maxDrawdownPct:maxDrawdownPct(equityCurve,startingEquity),positiveWindows:windows.filter(x=>x.netPnl>0).length,positivePnlConcentrationPct:concentrationPct(byAsset),bySide,integrityOk:true,windows,startingEquity,endingEquity:equityCurve.at(-1)?.equity??startingEquity,netPnl:trades.reduce((a,t)=>a+t.netPnlBaseline,0)};
 const accountingDelta=(summary.endingEquity-startingEquity)-summary.netPnl;if(Math.abs(accountingDelta)>Math.max(1e-6,Math.abs(summary.netPnl)*1e-9))throw new Error(`EDGE_V1_ACCOUNTING_DELTA:${accountingDelta}`);
 return summary;
}

export function runDiscovery(pkg){
 const locked=verifyLockedSource(pkg),split=locked.split,discoveryTimes=commonTimes(pkg.barsBySymbol).slice(0,split.discovery.count),lastOpen=split.discovery.to;
 const prepared={},fundingByBar={};
 for(const s of SYMBOLS){const rows=pkg.barsBySymbol[s].filter(b=>b.openTime>=split.discovery.from&&b.openTime<=lastOpen);if(rows.length!==split.discovery.count||rows.some((b,i)=>b.openTime!==discoveryTimes[i]))throw new Error(`EDGE_V1_DISCOVERY_BAR_ALIGNMENT:${s}`);prepared[s]=prepare(rows);const m=new Map();for(const f of pkg.fundingBySymbol[s]){if(f.time<split.discovery.from||f.time>rows.at(-1).closeTime)continue;const open=Math.floor(f.time/STEP)*STEP;if(!m.has(open))m.set(open,[]);m.get(open).push(f);}fundingByBar[s]=m;}
 const state={cash:EDGE_V1_DISCOVERY_CONVENTIONS.startingEquityUsd,positions:Object.fromEntries(SYMBOLS.map(s=>[s,null])),pending:Object.fromEntries(SYMBOLS.map(s=>[s,null])),scheduled:Object.fromEntries(SYMBOLS.map(s=>[s,null])),previousRegime:Object.fromEntries(SYMBOLS.map(s=>[s,'FLAT'])),currentBars:{},trades:[],tradeSeq:0,equityCurve:[{time:split.discovery.from-1,equity:EDGE_V1_DISCOVERY_CONVENTIONS.startingEquityUsd}]};
 for(let i=0;i<discoveryTimes.length;i++){
  const isLast=i===discoveryTimes.length-1,regimes={};for(const s of SYMBOLS){state.currentBars[s]=prepared[s].four[i];regimes[s]=regimeAt(prepared[s],state.currentBars[s].openTime);}
  // Open-time strategy exits occur before the funding timestamp a few milliseconds after 00/08/16 UTC.
  for(const s of SYMBOLS){let p=state.positions[s],bar=state.currentBars[s];if(p&&oppositeRegimeExit(p,state.previousRegime[s],regimes[s]))p=settleEvent(state,p,{type:'REGIME',fraction:p.remaining},bar,{time:bar.openTime,barOpenTime:bar.openTime,reason:'REGIME',price:bar.open});if(p&&gapStop(p,bar))settleEvent(state,p,{type:'STOP',fraction:p.remaining},bar,{time:bar.openTime,barOpenTime:bar.openTime,reason:'STOP_GAP',price:bar.open});}
  // Entries due at this bar are admitted deterministically in frozen universe order using one pre-entry equity snapshot.
  const due=SYMBOLS.filter(s=>state.scheduled[s]?.entryIndex===i),entryEquity=markedEquity(state,'open');
  for(const s of due){const trigger=state.scheduled[s];openPosition(state,s,prepared[s],trigger,entryEquity,state.currentBars[s]);state.scheduled[s]=null;}
  // Funding is booked before non-gap intrabar exits in the same 4h bar.
  for(const s of SYMBOLS){const p=state.positions[s];if(p)applyFunding(state,p,fundingByBar[s].get(state.currentBars[s].openTime)||[]);}
  // Frozen stop-first / target logic, then ATR trailing only after completed-bar processing.
  for(const s of SYMBOLS){let p=state.positions[s],bar=state.currentBars[s];if(!p)continue;for(const event of exitEvents(p,bar)){p=settleEvent(state,p,event,bar,{time:bar.closeTime,barOpenTime:bar.openTime,reason:event.type});if(!p)break;}if(p){p=atrTrail(p,bar,bar.atr14);state.positions[s]=p;}}
  if(isLast)finalizeBoundary(state,state.currentBars);
  state.equityCurve.push({time:Math.max(...SYMBOLS.map(s=>state.currentBars[s].closeTime)),equity:markedEquity(state,'close')});
  if(!isLast){
   for(const s of SYMBOLS){if(state.positions[s]||state.scheduled[s]){state.pending[s]=null;continue;}const pending=state.pending[s],row=prepared[s].four[i];let expired=false;if(pending){const k=i-pending.index,currentRegime=regimeAt(prepared[s],row.openTime);if(currentRegime!==pending.side){state.pending[s]=null;}else if(k>=1&&k<=3&&triggerFromPullback(pending.pullback,row,pending.side,k)){const entry=nextBarEntry(i,prepared[s].four);if(entry&&entry.index<prepared[s].four.length)state.scheduled[s]={...pending,triggerIndex:i,entryIndex:entry.index,entry:entry.open};state.pending[s]=null;continue;}else if(k>=3){state.pending[s]=null;expired=true;}}if(!state.pending[s]&&!state.scheduled[s]&&!expired){const d=dailyContextForTrigger(prepared[s].daily,row.openTime);if(d&&['LONG','SHORT'].includes(d.regime)&&pullbackCandidate(row,d.regime))state.pending[s]={side:d.regime,pullback:row,index:i,daily:d};}}
  }
  for(const s of SYMBOLS)state.previousRegime[s]=regimes[s];
 }
 if(SYMBOLS.some(s=>state.positions[s]))throw new Error('EDGE_V1_FINAL_POSITION_OPEN');
 const summary=summarizeDiscovery({trades:state.trades,equityCurve:state.equityCurve,discoveryTimes,startingEquity:EDGE_V1_DISCOVERY_CONVENTIONS.startingEquityUsd}),g=gate(summary);
 const result={schema:'PAPER-EDGE-V1-DISCOVERY-RESULT-1',researchOnly:true,executionImpact:false,sourceLock:EDGE_V1_DISCOVERY_SOURCE_LOCK,sourceReceipt:locked.receipt,stageLock:EDGE_V1_STAGE_LOCK,split:{discovery:split.discovery,validation:{...split.validation,status:'LOCKED'},holdout:{...split.holdout,status:'LOCKED'}},conventions:EDGE_V1_DISCOVERY_CONVENTIONS,summary:serialSummary(summary),gate:g,tradeDigest:canonicalTradeDigest(state.trades),nextStage:g.pass?'VALIDATION_REQUIRES_SEPARATE_AUTHORIZATION':'V1_FROZEN_FAILED',paperShadowPermitted:false,livePermitted:false,trades:state.trades,equityCurve:state.equityCurve};
 return result;
}
