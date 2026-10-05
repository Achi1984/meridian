import crypto from 'node:crypto';

export const HOUR=60*60*1000;
export const FUNDING_INTERVAL=8*HOUR;

export const CROSS_VENUE_FUNDING_EDGE_V2_SOURCE=Object.freeze({
  schema:'CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-1',
  symbol:'BTCUSDT',
  start:'2022-03-01T00:00:00.000Z',
  fundingCoverageEnd:'2026-09-30T08:00:00.000Z',
  markCoverageEnd:'2026-10-03T23:00:00.000Z',
  coverageEnd:'2026-09-30T08:00:00.000Z',
  decisionWindowEnd:'2026-09-29T00:00:00.000Z',
  decisionReserveHours:26,
  markIntervalMs:HOUR,
  fundingIntervalMs:FUNDING_INTERVAL,
  timestampToleranceMs:1000,
  recoverySettlements:3,
  minCommonFundingDecisions:100,
  venues:Object.freeze({
    binance:Object.freeze({market:'USD-M-PERPETUAL',source:'BINANCE_VISION'}),
    okx:Object.freeze({market:'USDT-SWAP',source:'OKX_PUBLIC_HISTORY'})
  }),
  coverageEvidence:Object.freeze({
    workflowRunId:37280311203,
    probeHeadSha:'80e7afddc7849197b608875bf6d6abec4f1b9bce',
    binanceFundingSha256:'913cd31b8f924a06717a2fac17f3df6132c24ccded209eb3e4ae7d83e1b247f2',
    okxFundingSha256:'ce5a600e578678a73294a316592afea9cc2a7f0702bf15d56eb0c9ee68fa5a65',
    binanceMarkSha256:'3ebf19fd6e1d4ca842691a5d3ef0d80aaacafb00143b5628556a0e9fd92c4a4e',
    okxMarkPageSha256:'7d957103d496ebd83034713bd98921c2f84fdd8e452c3bde8d03528426a3e519'
  })
});

const NUMERIC=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');

export function strictNumber(value,label='VALUE'){
  if(typeof value==='number'){
    if(Number.isFinite(value))return value;
    throw new Error('CROSS_VENUE_V2_SOURCE_'+label);
  }
  if(typeof value==='string'&&value.trim()!==''&&NUMERIC.test(value.trim())){
    const n=Number(value.trim());
    if(Number.isFinite(n))return n;
  }
  throw new Error('CROSS_VENUE_V2_SOURCE_'+label);
}

export function strictTimestamp(value,label='TIMESTAMP'){
  const n=strictNumber(value,label);
  if(!Number.isSafeInteger(n)||n<=0)throw new Error('CROSS_VENUE_V2_SOURCE_'+label);
  return n;
}

export function canonicalScheduledFundingTime(value,contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  let t;
  try{t=strictTimestamp(value,'FUNDING_TIME');}catch{return null}
  const canonical=Math.round(t/contract.fundingIntervalMs)*contract.fundingIntervalMs;
  return Math.abs(t-canonical)<=contract.timestampToleranceMs?canonical:null;
}

export function normalizeFunding(rows=[],venue,contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  if(!Array.isArray(rows))throw new Error('CROSS_VENUE_V2_SOURCE_FUNDING_NOT_ARRAY');
  return rows.map((x,i)=>({
    venue,
    rawTime:strictTimestamp(x?.fundingTime,'FUNDING_TIME_'+i),
    time:canonicalScheduledFundingTime(x?.fundingTime,contract),
    rate:strictNumber(x?.fundingRate,'FUNDING_RATE_'+i)
  })).sort((a,b)=>a.rawTime-b.rawTime);
}

export function normalizeMarks(rows=[],venue){
  if(!Array.isArray(rows))throw new Error('CROSS_VENUE_V2_SOURCE_MARKS_NOT_ARRAY');
  return rows.map((x,i)=>({
    venue,
    openTime:strictTimestamp(x?.openTime,'MARK_TIME_'+i),
    open:strictNumber(x?.open,'MARK_OPEN_'+i),
    high:strictNumber(x?.high,'MARK_HIGH_'+i),
    low:strictNumber(x?.low,'MARK_LOW_'+i),
    close:strictNumber(x?.close,'MARK_CLOSE_'+i),
    confirmed:x?.confirmed===true
  })).sort((a,b)=>a.openTime-b.openTime);
}

function sortedEvents(events=[]){
  const priority={DUPLICATE_FUNDING:1,OFF_GRID_FUNDING:2,MISSING_FUNDING:3,DUPLICATE_MARK:4,UNCONFIRMED_MARK:5,MISSING_MARK:6};
  return [...events].sort((a,b)=>a.detectedAt-b.detectedAt||(priority[a.type]??99)-(priority[b.type]??99)||String(a.venue).localeCompare(String(b.venue)));
}

function exactHourlyRange(from,to){
  const first=Math.ceil(from/HOUR)*HOUR,out=[];
  for(let t=first;t<=to;t+=HOUR)out.push(t);
  return out;
}

function scheduledFundingRange(from,to,step=FUNDING_INTERVAL){
  const first=Math.ceil(from/step)*step,out=[];
  for(let t=first;t<=to;t+=step)out.push(t);
  return out;
}

function groupBy(rows,key){
  const m=new Map();
  for(const row of rows){
    const k=key(row);
    if(!m.has(k))m.set(k,[]);
    m.get(k).push(row);
  }
  return m;
}

export function fundingSelection(rows=[],venue,contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  const funding=normalizeFunding(rows,venue,contract);
  const events=[];
  const eligible=funding.filter(x=>x.time!==null);
  const byCanonical=groupBy(eligible,x=>x.time);
  const selected=new Map();

  for(const row of funding){
    if(row.time===null)events.push({type:'OFF_GRID_FUNDING',venue,detectedAt:row.rawTime,rawTime:row.rawTime});
  }
  for(const [time,xs] of byCanonical){
    if(xs.length!==1){
      events.push({type:'DUPLICATE_FUNDING',venue,detectedAt:Math.max(...xs.map(x=>x.rawTime)),time,count:xs.length});
      continue;
    }
    selected.set(time,xs[0]);
  }

  const start=Date.parse(contract.start),end=Date.parse(contract.fundingCoverageEnd);
  for(const time of scheduledFundingRange(start,end,contract.fundingIntervalMs)){
    if(!byCanonical.has(time)){
      events.push({type:'MISSING_FUNDING',venue,detectedAt:time+contract.timestampToleranceMs+1,time});
    }
  }
  return{rows:funding,selected,events:sortedEvents(events)};
}

export function markSelection(rows=[],venue,contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  const marks=normalizeMarks(rows,venue);
  const events=[],byTime=groupBy(marks,x=>x.openTime),selected=new Map();
  for(const [time,xs] of byTime){
    if(xs.length!==1){
      events.push({type:'DUPLICATE_MARK',venue,detectedAt:time,time,count:xs.length});
      continue;
    }
    if(xs[0].confirmed!==true){
      events.push({type:'UNCONFIRMED_MARK',venue,detectedAt:time+HOUR,time});
      continue;
    }
    selected.set(time,xs[0]);
  }
  const start=Date.parse(contract.start),end=Date.parse(contract.markCoverageEnd);
  for(const time of exactHourlyRange(start,end)){
    if(!byTime.has(time))events.push({type:'MISSING_MARK',venue,detectedAt:time+HOUR,time});
  }
  return{rows:marks,selected,events:sortedEvents(events)};
}

export function commonFundingTimes(binanceFunding=[],okxFunding=[],contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  const b=fundingSelection(binanceFunding,'BINANCE',contract).selected;
  const o=fundingSelection(okxFunding,'OKX',contract).selected;
  const end=Date.parse(contract.decisionWindowEnd);
  return [...b.keys()].filter(t=>t<=end&&o.has(t)).sort((a,b)=>a-b);
}

export function splitCommonTimes(times=[]){
  if(!Array.isArray(times))throw new Error('CROSS_VENUE_V2_SOURCE_COMMON_TIMES_NOT_ARRAY');
  const xs=[...new Set(times.map((x,i)=>strictTimestamp(x,'COMMON_TIME_'+i)))].sort((a,b)=>a-b);
  if(xs.length<5)return{ok:false,reason:'INSUFFICIENT_COMMON_TIMES'};
  const a=Math.floor(xs.length*.6),b=Math.floor(xs.length*.8);
  return{
    ok:true,total:xs.length,
    discovery:{from:xs[0],to:xs[a-1],count:a},
    validation:{from:xs[a],to:xs[b-1],count:b-a},
    holdout:{from:xs[b],to:xs.at(-1),count:xs.length-b}
  };
}

export function integrityLedger({binanceFunding=[],okxFunding=[],binanceMarks=[],okxMarks=[]}={},contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  const bf=fundingSelection(binanceFunding,'BINANCE',contract),of=fundingSelection(okxFunding,'OKX',contract);
  const bm=markSelection(binanceMarks,'BINANCE',contract),om=markSelection(okxMarks,'OKX',contract);
  return sortedEvents([...bf.events,...of.events,...bm.events,...om.events]);
}

export function degradationImpact({positionOpen=false,pendingEntryFillTime=null,detectionTime}={}){
  const detected=strictTimestamp(detectionTime,'DETECTION_TIME');
  if(positionOpen===true)return{outcome:'INCONCLUSIVE',terminal:true,reason:'OPEN_POSITION_AT_DEGRADATION'};
  if(pendingEntryFillTime!==null&&pendingEntryFillTime!==undefined){
    const fill=strictTimestamp(pendingEntryFillTime,'PENDING_ENTRY_FILL_TIME');
    if(fill<=detected)return{outcome:'INCONCLUSIVE',terminal:true,reason:'ENTRY_FILL_AT_OR_BEFORE_DEGRADATION'};
    return{outcome:'DATA_DEGRADED',terminal:false,entryBlocked:true,reason:'PENDING_ENTRY_BLOCKED'};
  }
  return{outcome:'DATA_DEGRADED',terminal:false,entryBlocked:true,reason:'FLAT_AT_DEGRADATION'};
}

export function transitionFromOutcome({outcome,targetRuleset='CROSS-VENUE-FUNDING-EDGE-V2'}={}){
  if(outcome==='INCONCLUSIVE')return{allowed:false,reason:'INCONCLUSIVE_TERMINAL_NEW_PREREGISTERED_RULESET_REQUIRED'};
  if(targetRuleset!=='CROSS-VENUE-FUNDING-EDGE-V2')return{allowed:false,reason:'RULESET_TRANSITION_REQUIRES_SEPARATE_PREREGISTRATION'};
  return{allowed:true};
}

function marksCompleteBetween(selection,from,to){
  for(const time of exactHourlyRange(from,to))if(!selection.has(time))return false;
  return true;
}

export function recoveryPoint({degradationDetectedAt,commonTimes=[],integrityEvents=[],binanceMarks=[],okxMarks=[]}={},contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  const start=strictTimestamp(degradationDetectedAt,'DEGRADATION_DETECTED_AT');
  const times=[...commonTimes].map((x,i)=>strictTimestamp(x,'RECOVERY_COMMON_'+i)).filter(t=>t>start).sort((a,b)=>a-b);
  const events=sortedEvents(integrityEvents).filter(x=>x.detectedAt>start);
  const bm=markSelection(binanceMarks,'BINANCE',contract).selected,om=markSelection(okxMarks,'OKX',contract).selected;
  let streak=[];
  let cursor=start;
  for(const time of times){
    const intervening=events.filter(x=>x.detectedAt>cursor&&x.detectedAt<=time);
    if(intervening.length){streak=[];cursor=Math.max(...intervening.map(x=>x.detectedAt));continue}
    streak.push(time);
    if(streak.length>contract.recoverySettlements)streak=streak.slice(-contract.recoverySettlements);
    if(streak.length===contract.recoverySettlements){
      const markFrom=Math.ceil(start/HOUR)*HOUR;
      if(marksCompleteBetween(bm,markFrom,time)&&marksCompleteBetween(om,markFrom,time))return time;
    }
    cursor=time;
  }
  return null;
}

export function entryInputsFresh({decisionTime,binanceFunding=[],okxFunding=[],binanceMarks=[],okxMarks=[],integrityState='HEALTHY'}={},contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  if(integrityState!=='HEALTHY')return{eligible:false,reason:'DATA_DEGRADED'};
  const t=strictTimestamp(decisionTime,'DECISION_TIME');
  if(t>Date.parse(contract.decisionWindowEnd))return{eligible:false,reason:'OUTSIDE_DECISION_WINDOW'};
  const bf=fundingSelection(binanceFunding,'BINANCE',contract),of=fundingSelection(okxFunding,'OKX',contract);
  if(!bf.selected.has(t)||!of.selected.has(t))return{eligible:false,reason:'FUNDING_NOT_COMPLETE_FRESH'};
  const entryTime=t+HOUR;
  const bm=markSelection(binanceMarks,'BINANCE',contract),om=markSelection(okxMarks,'OKX',contract);
  if(!bm.selected.has(entryTime)||!om.selected.has(entryTime))return{eligible:false,reason:'ENTRY_MARK_NOT_COMPLETE_FRESH'};
  return{eligible:true,entryTime};
}

function stableProvenance(p={}){
  const sortJson=(a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b));
  return{
    binance:{provider:p?.binance?.provider??null,archive:p?.binance?.archive??null,receipts:[...(p?.binance?.receipts||[])].map(x=>({kind:x?.kind??null,scope:x?.scope??null,rel:x?.rel??null,sha256:x?.sha256??null})).sort((a,b)=>String(a.rel).localeCompare(String(b.rel)))},
    okx:{provider:p?.okx?.provider??null,baseUrl:p?.okx?.baseUrl??null,fundingQueryReceipts:[...(p?.okx?.fundingQueryReceipts||[])].map(x=>({endpoint:x?.endpoint??null,params:x?.params??{},sha256:x?.sha256??null})).sort(sortJson),fundingArchiveReceipts:[...(p?.okx?.fundingArchiveReceipts||[])].map(x=>({filename:x?.filename??null,url:x?.url??null,dateTs:x?.dateTs??null,sha256:x?.sha256??null})).sort((a,b)=>String(a.filename).localeCompare(String(b.filename))),markPageReceipts:[...(p?.okx?.markPageReceipts||[])].map(x=>({endpoint:x?.endpoint??null,params:x?.params??{},sha256:x?.sha256??null})).sort(sortJson)},
    binanceChecksumsVerified:p?.binanceChecksumsVerified===true,
    okxFundingArchivesHashed:p?.okxFundingArchivesHashed===true,
    okxMarkPagesHashed:p?.okxMarkPagesHashed===true,
    strategyPnlCalculated:p?.strategyPnlCalculated===true
  };
}

export function sourceReceipt(pack={},contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  const common=commonFundingTimes(pack.binanceFunding,pack.okxFunding,contract);
  const split=splitCommonTimes(common);
  const events=integrityLedger(pack,contract);
  const core={
    schema:contract.schema,
    contract,
    provenance:stableProvenance(pack.provenance),
    counts:{binanceFunding:pack.binanceFunding?.length??0,okxFunding:pack.okxFunding?.length??0,binanceMarks:pack.binanceMarks?.length??0,okxMarks:pack.okxMarks?.length??0},
    commonFundingDecisions:common.length,
    split,
    integrityEvents:events
  };
  return{...core,digest:hash(core)};
}

export function validateCrossVenueSource(pack={},contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  let bf,of,bm,om;
  try{
    bf=fundingSelection(pack.binanceFunding,'BINANCE',contract);
    of=fundingSelection(pack.okxFunding,'OKX',contract);
    bm=markSelection(pack.binanceMarks,'BINANCE',contract);
    om=markSelection(pack.okxMarks,'OKX',contract);
  }catch(error){
    return{ok:false,reason:'DATA_DEGRADED_PARSE_OR_SCHEMA',inconclusive:false,error:String(error.message||error)};
  }
  if(pack?.provenance?.binanceChecksumsVerified!==true)return{ok:false,reason:'BINANCE_CHECKSUMS_NOT_VERIFIED'};
  if(pack?.provenance?.okxFundingArchivesHashed!==true)return{ok:false,reason:'OKX_FUNDING_ARCHIVES_NOT_HASHED'};
  if(pack?.provenance?.okxMarkPagesHashed!==true)return{ok:false,reason:'OKX_MARK_PAGE_RECEIPTS_NOT_VERIFIED'};
  if(pack?.provenance?.strategyPnlCalculated===true)return{ok:false,reason:'SOURCE_COLLECTOR_MUST_NOT_CALCULATE_PNL'};
  const common=commonFundingTimes(pack.binanceFunding,pack.okxFunding,contract);
  if(common.length<contract.minCommonFundingDecisions)return{ok:false,reason:'COMMON_FUNDING_DECISIONS_LT_'+contract.minCommonFundingDecisions,count:common.length};
  const split=splitCommonTimes(common);if(!split.ok)return{ok:false,reason:split.reason};
  const events=sortedEvents([...bf.events,...of.events,...bm.events,...om.events]);
  return{ok:true,integrityState:events.length?'DATA_DEGRADED':'HEALTHY',integrityEvents:events,commonFundingDecisions:common.length,split,receipt:sourceReceipt(pack,contract)};
}
