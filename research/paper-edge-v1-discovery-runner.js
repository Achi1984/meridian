import crypto from 'node:crypto';
import {validateSource,EDGE_V1_SOURCE,EDGE_V1_FUNDING_TIMESTAMP_JITTER_MS} from './paper-edge-v1-data-contract.js';
import {commonTimes,frozenSplit,prepareSymbol,eligibleSetup,openCandidate,gate} from './paper-edge-v1-discovery-engine.js';
import {dailyContextForTrigger,conservativeFill} from './paper-edge-v1-foundation.js';
import {triggerFromPullback,exitEvents,applyEvent,atrTrail,fundingCashflow} from './paper-edge-v1-state-machine.js';
import {EDGE_V1_STAGE_LOCK} from './edge-v1-stage-lock.js';

export const EDGE_V1_DISCOVERY_RUNNER='PAPER-EDGE-V1-DISCOVERY-RUNNER-1';
export const EDGE_V1_INITIAL_EQUITY=100000;
export const EDGE_V1_DISCOVERY_SOURCE_LOCK=Object.freeze({runId:37231163461,artifactId:11313901895,sourceHeadSha:'000e6864a0aabdb5053a5988a5ccc46cee2b9e0b',artifactZipDigest:'sha256:8113b45cf2cebc957416e2ef69a3bd1fc510a41441591fbec0d7b47c49cca91d',receiptDigest:'d05b6c2916900ffac602c11166376e33a2f606e70967d0ecc988a1201df8ad08',artifactName:'paper-edge-v1-source'});
export const EDGE_V1_DISCOVERY_SPLIT_LOCK=Object.freeze({total:12594,discovery:{from:1609459200000,to:1718251200000,count:7556},validation:{from:1718265600000,count:2519},holdout:{from:1754539200000,count:2519}});
const BASE_BPS=8;
const STRESS_BPS=16;
const finite=x=>Number.isFinite(Number(x));
const sideSign=side=>side==='LONG'?1:-1;
const round=(x,n=10)=>Number(Number(x).toFixed(n));
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');

function fillCost(notional,bps){return Math.abs(Number(notional))*Number(bps)/10000}
function netPricePnl(p,price,fraction){return sideSign(p.side)*(Number(price)-p.entry)*p.qty*Number(fraction)}
function unrealized(p,price){return sideSign(p.side)*(Number(price)-p.entry)*p.qty*p.remaining}
function opposite(side){return side==='LONG'?'SHORT':'LONG'}

export function fundingEventsForBar(events=[],openedAt,bar={}){
 const from=Number(bar.openTime),to=Number(bar.closeTime),entry=Number(openedAt);
 return (events||[]).filter(x=>{
  const time=Number(x?.time);if(!finite(time)||time<=entry||time<from||time>to)return false;
  if(entry===from&&time<=from+EDGE_V1_FUNDING_TIMESTAMP_JITTER_MS)return false;
  return true;
 });
}

export function profitFactorFromPnls(pnls=[]){
 const pos=pnls.filter(x=>x>0).reduce((a,b)=>a+b,0),neg=-pnls.filter(x=>x<0).reduce((a,b)=>a+b,0);
 return neg>0?pos/neg:pos>0?Number.MAX_SAFE_INTEGER:0;
}

export function chronologicalWindows(times=[],count=5){
 const xs=[...new Set(times.map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
 if(!xs.length||count<1)return[];
 const out=[];
 for(let i=0;i<count;i++){
  const fromIndex=Math.floor(i*xs.length/count),toIndex=Math.floor((i+1)*xs.length/count)-1;
  if(toIndex<fromIndex)out.push({index:i,from:null,to:null,count:0});
  else out.push({index:i,from:xs[fromIndex],to:xs[toIndex],count:toIndex-fromIndex+1});
 }
 return out;
}

function windowForTime(windows,t){
 return windows.find(w=>w.count>0&&t>=w.from&&t<=w.to)?.index??null;
}

function groupStats(trades=[]){
 const pnls=trades.map(t=>t.netPnl);
 return {
  closedTrades:trades.length,
  netPnl:round(pnls.reduce((a,b)=>a+b,0),8),
  profitFactor:round(profitFactorFromPnls(pnls),8)
 };
}

function summarize(trades,stressTrades,equityCurve,discoveryTimes){
 const byAsset={},bySide={};
 for(const s of EDGE_V1_SOURCE.symbols)byAsset[s]=groupStats(trades.filter(t=>t.symbol===s));
 for(const side of ['LONG','SHORT'])bySide[side]=groupStats(trades.filter(t=>t.side===side));
 const pnls=trades.map(t=>t.netPnl),stressPnls=stressTrades.map(t=>t.netPnl);
 const positiveAssets=Object.values(byAsset).map(x=>x.netPnl).filter(x=>x>0),positiveTotal=positiveAssets.reduce((a,b)=>a+b,0);
 const concentration=positiveTotal>0?Math.max(...positiveAssets)/positiveTotal*100:100;
 const windows=chronologicalWindows(discoveryTimes,5).map(w=>{
  const net=trades.filter(t=>windowForTime([w],t.exitBucketTime)===w.index).reduce((a,t)=>a+t.netPnl,0);
  return {...w,netPnl:round(net,8),positive:net>0};
 });
 let peak=EDGE_V1_INITIAL_EQUITY,maxDd=0;
 for(const p of equityCurve){peak=Math.max(peak,p.equity);if(peak>0)maxDd=Math.max(maxDd,(peak-p.equity)/peak*100)}
 const expectancyR=trades.length?trades.reduce((a,t)=>a+t.r,0)/trades.length:0;
 return {
  closedTrades:trades.length,
  netPnl:round(pnls.reduce((a,b)=>a+b,0),8),
  profitFactor:round(profitFactorFromPnls(pnls),8),
  stressProfitFactor:round(profitFactorFromPnls(stressPnls),8),
  expectancyR:round(expectancyR,8),
  maxDrawdownPct:round(maxDd,8),
  positiveWindows:windows.filter(x=>x.positive).length,
  windows,
  byAsset,
  bySide,
  positivePnlConcentrationPct:round(concentration,8),
  integrityOk:true
 };
}

function targetGapEvents(p,open){
 const long=p.side==='LONG',out=[];
 if(!p.tp1Done&&(long?open>=p.tp1:open<=p.tp1))out.push({type:'TP1',fraction:Math.min(.33,p.remaining)});
 const after=Math.max(0,p.remaining-(out[0]?.fraction??0));
 if(!p.tp2Done&&(long?open>=p.tp2:open<=p.tp2))out.push({type:'TP2',fraction:Math.min(.33,after)});
 return out;
}

function gapStopTouched(p,open){return p.side==='LONG'?open<=p.stop:open>=p.stop}

function stageLockOk(){
 return EDGE_V1_STAGE_LOCK?.stage==='DISCOVERY'&&EDGE_V1_STAGE_LOCK.validation===false&&EDGE_V1_STAGE_LOCK.holdout===false&&EDGE_V1_STAGE_LOCK.live===false;
}

export function runEdgeV1Discovery(sourcePackage,{initialEquity=EDGE_V1_INITIAL_EQUITY}={}){
 if(initialEquity!==EDGE_V1_INITIAL_EQUITY)throw new Error('EDGE_V1_INITIAL_EQUITY_LOCKED');
 if(!stageLockOk())throw new Error('EDGE_V1_STAGE_LOCK_VIOLATION');
 if(sourcePackage?.schema!=='PAPER-EDGE-V1-SOURCE-PACKAGE-1'||sourcePackage?.researchOnly!==true||sourcePackage?.executionImpact!==false)throw new Error('EDGE_V1_SOURCE_PACKAGE_REJECTED');

 const barsBySymbol=sourcePackage.barsBySymbol||{},fundingBySymbol=sourcePackage.fundingBySymbol||{},provenance=sourcePackage.provenance||{};
 const validation=validateSource({barsBySymbol,fundingBySymbol,provenance});
 if(!validation.ok)throw new Error('EDGE_V1_SOURCE_INVALID '+JSON.stringify(validation));
 if(validation.receipt.digest!==EDGE_V1_DISCOVERY_SOURCE_LOCK.receiptDigest)throw new Error('EDGE_V1_SOURCE_DIGEST_MISMATCH '+validation.receipt.digest);
 if(sourcePackage?.receipt?.digest!==EDGE_V1_DISCOVERY_SOURCE_LOCK.receiptDigest)throw new Error('EDGE_V1_SOURCE_RECEIPT_MISMATCH');

 const split=frozenSplit(barsBySymbol);
 if(!split.ok)throw new Error('EDGE_V1_SPLIT_INVALID '+split.reason);
 if(split.total!==EDGE_V1_DISCOVERY_SPLIT_LOCK.total||split.discovery.count!==EDGE_V1_DISCOVERY_SPLIT_LOCK.discovery.count||split.validation.count!==EDGE_V1_DISCOVERY_SPLIT_LOCK.validation.count||split.holdout.count!==EDGE_V1_DISCOVERY_SPLIT_LOCK.holdout.count||split.discovery.from!==EDGE_V1_DISCOVERY_SPLIT_LOCK.discovery.from||split.discovery.to!==EDGE_V1_DISCOVERY_SPLIT_LOCK.discovery.to||split.validation.from!==EDGE_V1_DISCOVERY_SPLIT_LOCK.validation.from||split.holdout.from!==EDGE_V1_DISCOVERY_SPLIT_LOCK.holdout.from)throw new Error('EDGE_V1_SPLIT_LOCK_MISMATCH');
 const discoveryTo=split.discovery.to;
 const discoveryBars={};
 for(const s of EDGE_V1_SOURCE.symbols)discoveryBars[s]=(barsBySymbol[s]||[]).filter(x=>Number(x.openTime)<=discoveryTo);
 const discoveryTimes=commonTimes(discoveryBars);
 if(discoveryTimes.length!==split.discovery.count||discoveryTimes.at(-1)!==discoveryTo)throw new Error('EDGE_V1_DISCOVERY_BOUNDARY_MISMATCH');
 const finalClose=Math.min(...EDGE_V1_SOURCE.symbols.map(s=>Number(discoveryBars[s].at(-1)?.closeTime)));
 const discoveryFunding={};
 for(const s of EDGE_V1_SOURCE.symbols)discoveryFunding[s]=(fundingBySymbol[s]||[]).filter(x=>Number(x.time)<=finalClose);

 const states={},indexByTime={};
 for(const s of EDGE_V1_SOURCE.symbols){
  const prepared=prepareSymbol(discoveryBars[s]);
  states[s]={prepared,position:null,setup:null,pendingEntry:null};
  indexByTime[s]=new Map(prepared.four.map((b,i)=>[Number(b.openTime),i]));
 }
 let cash=initialEquity,stressCash=initialEquity,tradeSeq=0;
 const trades=[],stressTrades=[],equityCurve=[];

 const openPositions=()=>EDGE_V1_SOURCE.symbols.map(s=>states[s].position).filter(Boolean);
 const openPricesAt=t=>Object.fromEntries(EDGE_V1_SOURCE.symbols.map(s=>{
  const i=indexByTime[s].get(t);return[s,states[s].prepared.four[i]?.open];
 }));
 const equityAt=(prices,cashValue=cash)=>cashValue+EDGE_V1_SOURCE.symbols.reduce((sum,s)=>{
  const p=states[s].position,px=prices[s];return sum+(p&&finite(px)?unrealized(p,px):0);
 },0);

 function finalizeIfClosed(s,p,exitTime,exitBucketTime,exitPrice,reason){
  if(p.remaining>1e-12){states[s].position=p;return}
  p.trade.exitTime=Number(exitTime);p.trade.exitBucketTime=Number(exitBucketTime);p.trade.exitPrice=Number(exitPrice);p.trade.exitReason=reason;
  p.trade.netPnl=p.trade.pricePnl+p.trade.funding-p.trade.baseCosts;
  p.trade.stressNetPnl=p.trade.pricePnl+p.trade.funding-p.trade.stressCosts;
  p.trade.r=p.trade.initialRiskCash>0?p.trade.netPnl/p.trade.initialRiskCash:0;
  const clean={...p.trade,netPnl:round(p.trade.netPnl,8),stressNetPnl:round(p.trade.stressNetPnl,8),r:round(p.trade.r,10),pricePnl:round(p.trade.pricePnl,8),funding:round(p.trade.funding,8),baseCosts:round(p.trade.baseCosts,8),stressCosts:round(p.trade.stressCosts,8)};
  trades.push(clean);stressTrades.push({...clean,netPnl:clean.stressNetPnl});
  states[s].position=null;
 }

 function executeFill(s,event,price,time,bucket,reason){
  let p=states[s].position;if(!p||!(event.fraction>0))return;
  const fraction=Math.min(event.fraction,p.remaining),qty=p.qty*fraction,gross=netPricePnl(p,price,fraction),notional=Math.abs(Number(price)*qty);
  const bc=fillCost(notional,BASE_BPS),sc=fillCost(notional,STRESS_BPS);
  cash+=gross-bc;stressCash+=gross-sc;
  p.trade.pricePnl+=gross;p.trade.baseCosts+=bc;p.trade.stressCosts+=sc;
  p=applyEvent(p,{type:event.type,fraction});
  states[s].position=p;
  finalizeIfClosed(s,p,time,bucket,price,reason||event.type);
 }

 function openPosition(s,pending,t,entryEquity){
  const st=states[s],i=indexByTime[s].get(t),bar=st.prepared.four[i];
  if(!bar||!pending||pending.entryTime!==t)return;
  st.pendingEntry=null;
  if(st.position)return;
  const eq=Number(entryEquity);
  if(!(eq>0))throw new Error('EDGE_V1_NONPOSITIVE_EQUITY');
  const existing=openPositions(),trigger={...pending,entry:bar.open,entryIndex:i};
  let p=openCandidate({symbol:s,prepared:st.prepared,trigger,equity:eq,openPositions:existing});
  if(!p)return;
  const entryNotional=Math.abs(p.entry*p.qty),bc=fillCost(entryNotional,BASE_BPS),sc=fillCost(entryNotional,STRESS_BPS);
  cash-=bc;stressCash-=sc;
  const currentDaily=dailyContextForTrigger(st.prepared.daily,t)?.regime??'FLAT';
  p={...p,openedAt:t,lastDailyRegime:currentDaily,trade:{
    id:++tradeSeq,symbol:s,side:p.side,entryTime:t,entryPrice:p.entry,initialStop:p.stop,initialRiskCash:p.qty*p.initialRisk,
    pricePnl:0,funding:0,baseCosts:bc,stressCosts:sc,exitTime:null,exitBucketTime:null,exitPrice:null,exitReason:null
  }};
  st.position=p;
 }

 function applyFunding(s,bar){
  const st=states[s],p=st.position;if(!p)return;
  const events=fundingEventsForBar(discoveryFunding[s],p.openedAt,bar);
  for(const e of events){
   const current=st.position;if(!current)break;
   const cf=fundingCashflow({side:current.side,qty:current.qty*current.remaining,entryPrice:current.entry,rate:Number(e.rate)});
   cash+=cf;stressCash+=cf;current.trade.funding+=cf;
  }
 }

 for(const t of discoveryTimes){
  // 1-2: existing open-time regime exits and gap stops.
  for(const s of EDGE_V1_SOURCE.symbols){
   const st=states[s],i=indexByTime[s].get(t),bar=st.prepared.four[i],p=st.position;if(!p)continue;
   const regime=dailyContextForTrigger(st.prepared.daily,t)?.regime??'FLAT';
   if(regime===opposite(p.side)){executeFill(s,{type:'REGIME',fraction:p.remaining},bar.open,t,t,'OPPOSITE_DAILY_REGIME');continue}
   if(gapStopTouched(p,bar.open)){executeFill(s,{type:'STOP',fraction:p.remaining},bar.open,t,t,'GAP_STOP');continue}
   if(st.position)st.position.lastDailyRegime=regime;
  }

  // 3: entries scheduled by the prior completed trigger bar use one pre-entry marked-equity snapshot.
  const entryEquity=equityAt(openPricesAt(t));
  for(const s of EDGE_V1_SOURCE.symbols){const st=states[s];if(st.pendingEntry?.entryTime===t)openPosition(s,st.pendingEntry,t,entryEquity)}

  // 4: target gaps at the open, after stop priority.
  for(const s of EDGE_V1_SOURCE.symbols){
   const st=states[s],i=indexByTime[s].get(t),bar=st.prepared.four[i];if(!st.position)continue;
   if(gapStopTouched(st.position,bar.open)){executeFill(s,{type:'STOP',fraction:st.position.remaining},bar.open,t,t,'GAP_STOP');continue}
   for(const e of targetGapEvents(st.position,bar.open)){if(!st.position)break;executeFill(s,e,e.type==='TP1'?st.position.tp1:st.position.tp2,t,t,e.type+'_GAP')}
  }

  // 5: authoritative funding after open-time events.
  for(const s of EDGE_V1_SOURCE.symbols){const st=states[s],i=indexByTime[s].get(t);applyFunding(s,st.prepared.four[i])}

  // 6-7: intrabar stop/targets then close-time ATR trail.
  for(const s of EDGE_V1_SOURCE.symbols){
   const st=states[s],i=indexByTime[s].get(t),bar=st.prepared.four[i];if(!st.position)continue;
   const events=exitEvents(st.position,bar);
   for(const e of events){
    if(!st.position)break;
    const price=e.type==='STOP'?conservativeFill({side:st.position.side,stop:st.position.stop},bar):e.type==='BREAKEVEN_STOP'?st.position.stop:e.type==='TP1'?st.position.tp1:st.position.tp2;
    executeFill(s,e,price,bar.closeTime,t,e.type);
   }
   if(st.position)st.position=atrTrail(st.position,bar,bar.atr14);
  }

  // Discovery split is fail-closed: no position may consume the next split.
  if(t===discoveryTo){
   for(const s of EDGE_V1_SOURCE.symbols){
    const st=states[s],i=indexByTime[s].get(t),bar=st.prepared.four[i];
    if(st.position)executeFill(s,{type:'BOUNDARY',fraction:st.position.remaining},bar.close,bar.closeTime,t,'DISCOVERY_BOUNDARY');
    st.setup=null;st.pendingEntry=null;
   }
  }else{
   // 8: completed-bar setup/trigger state update.
   for(const s of EDGE_V1_SOURCE.symbols){
    const st=states[s],i=indexByTime[s].get(t),bar=st.prepared.four[i];
    if(st.position||st.pendingEntry)continue;
    if(st.setup){
     const currentDaily=dailyContextForTrigger(st.prepared.daily,bar.openTime)?.regime??'FLAT';
     if(currentDaily!==st.setup.side)st.setup=null;
     else{
      const barsSince=i-st.setup.index;
      if(barsSince>=1&&barsSince<=3&&triggerFromPullback(st.setup.pullback,bar,st.setup.side,barsSince)){
       const next=st.prepared.four[i+1];
       if(next&&next.openTime<=discoveryTo)st.pendingEntry={side:st.setup.side,pullback:st.setup.pullback,triggerIndex:i,entryTime:next.openTime,entryIndex:i+1,entry:next.open};
       st.setup=null;continue;
      }
      if(barsSince>=3){st.setup=null;continue}
     }
    }
    if(!st.setup){
     const setup=eligibleSetup(st.prepared,i);
     if(setup)st.setup=setup;
    }
   }
  }

  const closes=Object.fromEntries(EDGE_V1_SOURCE.symbols.map(s=>{const i=indexByTime[s].get(t);return[s,states[s].prepared.four[i].close]}));
  equityCurve.push({time:t,equity:round(equityAt(closes),8)});
 }

 if(openPositions().length)throw new Error('EDGE_V1_DISCOVERY_POSITION_LEAK');
 const allFinite=trades.every(t=>[t.entryPrice,t.initialStop,t.initialRiskCash,t.netPnl,t.stressNetPnl,t.r,t.exitPrice].every(finite));
 const baselineNet=trades.reduce((a,t)=>a+Number(t.netPnl),0),stressNet=trades.reduce((a,t)=>a+Number(t.stressNetPnl),0);
 const baselineExpected=initialEquity+baselineNet,stressExpected=initialEquity+stressNet;
 const baseDelta=Math.abs(baselineExpected-cash),stressDelta=Math.abs(stressExpected-stressCash);
 const uniqueIds=new Set(trades.map(t=>t.id)).size===trades.length;
 const timesValid=trades.every(t=>Number(t.entryTime)>=split.discovery.from&&Number(t.exitTime)>=Number(t.entryTime)&&Number(t.exitBucketTime)<=discoveryTo);
 const reconciliation={endingCash:round(cash,8),expectedEndingCash:round(baselineExpected,8),delta:round(baseDelta,10),baseOk:baseDelta<=1e-6,stressEndingCash:round(stressCash,8),stressExpectedEndingCash:round(stressExpected,8),stressDelta:round(stressDelta,10),stressOk:stressDelta<=1e-6,uniqueTradeIds:uniqueIds,timesWithinDiscovery:timesValid};
 const summary=summarize(trades,stressTrades,equityCurve,discoveryTimes);
 summary.integrityOk=allFinite&&equityCurve.length===discoveryTimes.length&&discoveryTimes.at(-1)===discoveryTo&&reconciliation.baseOk&&reconciliation.stressOk&&uniqueIds&&timesValid;
 const verdict=gate(summary);
 const core={
  schema:'PAPER-EDGE-V1-DISCOVERY-RESULT-1',
  researchOnly:true,executionImpact:false,autoPromotion:false,
  ruleset:'PAPER-EDGE-V1',runner:EDGE_V1_DISCOVERY_RUNNER,accounting:'PAPER-EDGE-V1-DISCOVERY-ACCOUNTING-1',
  authorizedStage:'DISCOVERY',
  sourceLock:EDGE_V1_DISCOVERY_SOURCE_LOCK,
  sourceDigest:validation.receipt.digest,
  split:{total:split.total,discovery:split.discovery},
  isolation:{maxBarOpenTime:discoveryTimes.at(-1),maxFundingTime:Math.max(...EDGE_V1_SOURCE.symbols.flatMap(s=>discoveryFunding[s].map(x=>Number(x.time)))),validationValuesRead:false,holdoutValuesRead:false},
  reconciliation,
  summary,
  decision:verdict
 };
 return {...core,digest:hash(core),trades,equityCurve};
}
