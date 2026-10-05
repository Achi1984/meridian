import crypto from 'node:crypto';
import {strictNum} from './cross-venue-funding-edge-v2.js';

const HOUR=60*60*1000;
const FUNDING=8*HOUR;

export const CROSS_VENUE_FUNDING_EDGE_V2_SOURCE=Object.freeze({
  schema:'CROSS-VENUE-FUNDING-EDGE-V2-SOURCE-1',
  symbol:'BTCUSDT',
  okxInstrument:'BTC-USDT-SWAP',
  rawStart:'2022-03-01T00:00:00.000Z',
  fundingCoverageEnd:'2026-09-30T08:00:00.000Z',
  markCoverageEnd:'2026-10-03T23:00:00.000Z',
  coverageEnd:'2026-09-30T08:00:00.000Z',
  decisionWindowEnd:'2026-09-29T00:00:00.000Z',
  markIntervalMs:HOUR,
  fundingIntervalMs:FUNDING,
  timestampToleranceMs:1000,
  decisionReserveHours:26,
  recoveryCommonSettlements:3,
  minCommonFundingDecisions:100,
  scheduleUtcHours:Object.freeze([0,8,16]),
  venues:Object.freeze({
    binance:Object.freeze({market:'USD-M-PERPETUAL',source:'BINANCE_VISION'}),
    okx:Object.freeze({market:'USDT-SWAP',source:'OKX_PUBLIC_HISTORY'})
  })
});

const sha256=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');

function finite(value){return Number.isFinite(strictNum(value))}
function strictTime(value){
  const n=strictNum(value);
  return Number.isSafeInteger(n)&&n>0?n:null;
}
function timeOf(iso){return Date.parse(iso)}
function sortEvents(events){
  return [...events].sort((a,b)=>
    a.detectionTime-b.detectionTime||
    String(a.venue).localeCompare(String(b.venue))||
    String(a.kind).localeCompare(String(b.kind))||
    Number(a.scheduledTime??a.rawTime??0)-Number(b.scheduledTime??b.rawTime??0)
  );
}
function stable(value){
  if(Array.isArray(value))return value.map(stable).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().filter(k=>k!=='collectedAt').map(k=>[k,stable(value[k])]));
  }
  return value;
}

export function canonicalFundingTime(value,contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  const t=strictTime(value);
  if(t===null)return null;
  const step=contract.fundingIntervalMs;
  const canonical=Math.round(t/step)*step;
  if(Math.abs(t-canonical)>contract.timestampToleranceMs)return null;
  const hour=new Date(canonical).getUTCHours();
  return contract.scheduleUtcHours.includes(hour)?canonical:null;
}

export function normalizeFunding(rows=[],venue,contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  if(!Array.isArray(rows))return[];
  return rows.map((x,sourceOrdinal)=>{
    const hasTime=x&&typeof x==='object'&&Object.hasOwn(x,'fundingTime');
    const hasRate=x&&typeof x==='object'&&Object.hasOwn(x,'fundingRate');
    const rawTime=hasTime?strictTime(x.fundingTime):null;
    const rate=hasRate?strictNum(x.fundingRate):NaN;
    return{
      venue,
      sourceOrdinal,
      rawTime,
      time:rawTime===null?null:canonicalFundingTime(rawTime,contract),
      rate
    };
  }).sort((a,b)=>(a.rawTime??Infinity)-(b.rawTime??Infinity)||a.sourceOrdinal-b.sourceOrdinal);
}

export function normalizeMarks(rows=[],venue){
  if(!Array.isArray(rows))return[];
  return rows.map((x,sourceOrdinal)=>{
    const obj=x&&typeof x==='object'&&!Array.isArray(x)?x:{};
    const openTime=Object.hasOwn(obj,'openTime')?strictTime(obj.openTime):null;
    const open=Object.hasOwn(obj,'open')?strictNum(obj.open):NaN;
    const high=Object.hasOwn(obj,'high')?strictNum(obj.high):NaN;
    const low=Object.hasOwn(obj,'low')?strictNum(obj.low):NaN;
    const close=Object.hasOwn(obj,'close')?strictNum(obj.close):NaN;
    const confirmed=obj.confirmed===true||obj.confirmed==='1';
    return{venue,sourceOrdinal,openTime,open,high,low,close,confirmed};
  }).sort((a,b)=>(a.openTime??Infinity)-(b.openTime??Infinity)||a.sourceOrdinal-b.sourceOrdinal);
}

function groupBy(rows,key){
  const map=new Map();
  for(const row of rows){
    const value=row[key];
    if(value===null||value===undefined||!Number.isFinite(value))continue;
    if(!map.has(value))map.set(value,[]);
    map.get(value).push(row);
  }
  return map;
}

export function usableFundingMap(rows=[]){
  const groups=groupBy(rows.filter(x=>x.time!==null&&finite(x.rate)),'time');
  const out=new Map();
  for(const [time,xs] of groups)if(xs.length===1)out.set(time,xs[0]);
  return out;
}

export function fundingIntegrityEvents(rows=[],venue,contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  const events=[];
  const rawGroups=groupBy(rows,'rawTime');
  const canonicalGroups=groupBy(rows.filter(x=>x.time!==null),'time');

  for(const [rawTime,xs] of rawGroups){
    if(xs.length>1)events.push({kind:'DUPLICATE_FUNDING',venue,detectionTime:rawTime,rawTime,count:xs.length});
  }
  for(const [time,xs] of canonicalGroups){
    if(xs.length>1)events.push({kind:'DUPLICATE_CANONICAL_FUNDING',venue,detectionTime:Math.max(...xs.map(x=>x.rawTime)),scheduledTime:time,count:xs.length});
  }
  for(const row of rows){
    if(row.rawTime!==null&&finite(row.rate)&&row.time===null)
      events.push({kind:'OFF_GRID_FUNDING',venue,detectionTime:row.rawTime,rawTime:row.rawTime});
  }

  const start=timeOf(contract.rawStart),end=timeOf(contract.fundingCoverageEnd);
  for(let t=start;t<=end;t+=contract.fundingIntervalMs){
    const xs=canonicalGroups.get(t)||[];
    if(xs.length===0)events.push({
      kind:'MISSING_SCHEDULED_FUNDING',
      venue,
      detectionTime:t+contract.timestampToleranceMs+1,
      scheduledTime:t
    });
  }

  const validRaw=rows.filter(x=>x.rawTime!==null&&finite(x.rate)).sort((a,b)=>a.rawTime-b.rawTime);
  for(let i=1;i<validRaw.length;i++){
    const gap=validRaw[i].rawTime-validRaw[i-1].rawTime;
    if(gap>contract.fundingIntervalMs+contract.timestampToleranceMs){
      events.push({
        kind:'FUNDING_GAP',
        venue,
        detectionTime:validRaw[i-1].rawTime+contract.fundingIntervalMs+contract.timestampToleranceMs+1,
        after:validRaw[i-1].rawTime,
        before:validRaw[i].rawTime,
        gapMs:gap
      });
    }
  }
  return sortEvents(events);
}

export function confirmedUniqueMarkSet(rows=[]){
  const groups=groupBy(rows,'openTime');
  const set=new Set();
  for(const [time,xs] of groups){
    if(xs.length===1&&xs[0].confirmed===true&&[xs[0].open,xs[0].high,xs[0].low,xs[0].close].every(Number.isFinite))
      set.add(time);
  }
  return set;
}

export function markIntegrityEvents(rows=[],venue,contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  const events=[];
  const groups=groupBy(rows,'openTime');
  for(const [time,xs] of groups){
    if(xs.length>1)events.push({kind:'DUPLICATE_MARK',venue,detectionTime:time+contract.markIntervalMs,openTime:time,count:xs.length});
    if(xs.length===1&&!xs[0].confirmed)events.push({kind:'UNCONFIRMED_MARK',venue,detectionTime:time+contract.markIntervalMs,openTime:time});
  }
  const start=timeOf(contract.rawStart),end=timeOf(contract.markCoverageEnd);
  for(let t=start;t<=end;t+=contract.markIntervalMs){
    if(!groups.has(t))events.push({kind:'MISSING_MARK',venue,detectionTime:t+contract.markIntervalMs,openTime:t});
  }
  return sortEvents(events);
}

export function integrityEventsForSource({binanceFunding=[],okxFunding=[],binanceMarks=[],okxMarks=[]}={},contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  return sortEvents([
    ...fundingIntegrityEvents(binanceFunding,'BINANCE',contract),
    ...fundingIntegrityEvents(okxFunding,'OKX',contract),
    ...markIntegrityEvents(binanceMarks,'BINANCE',contract),
    ...markIntegrityEvents(okxMarks,'OKX',contract)
  ]);
}

export function commonFundingTimes(binanceFunding=[],okxFunding=[],contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  const b=usableFundingMap(binanceFunding),o=usableFundingMap(okxFunding);
  const start=timeOf(contract.rawStart),end=timeOf(contract.decisionWindowEnd);
  return [...b.keys()].filter(t=>o.has(t)&&t>=start&&t<=end).sort((a,b)=>a-b);
}

export function splitCommonTimes(times=[]){
  const xs=[...new Set((times||[]).filter(Number.isFinite))].sort((a,b)=>a-b);
  const n=xs.length,d=Math.floor(n*.60),v=Math.floor(n*.20);
  const pack=a=>Object.freeze({count:a.length,start:a[0]??null,end:a.at(-1)??null,times:Object.freeze(a)});
  return Object.freeze({
    discovery:pack(xs.slice(0,d)),
    validation:pack(xs.slice(d,d+v)),
    holdout:pack(xs.slice(d+v))
  });
}

export function decisionWithinCoverage(value,contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  const t=strictTime(value);
  if(t===null||canonicalFundingTime(t,contract)!==t)return false;
  const start=timeOf(contract.rawStart),decisionEnd=timeOf(contract.decisionWindowEnd),coverageEnd=timeOf(contract.coverageEnd);
  return t>=start&&t<=decisionEnd&&t+contract.decisionReserveHours*HOUR<=coverageEnd;
}

export function marksCompleteBetween(rows=[],start,end,contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  const a=strictTime(start),b=strictTime(end);
  if(a===null||b===null||b<a)return false;
  const set=confirmedUniqueMarkSet(rows);
  for(let t=a;t<=b;t+=contract.markIntervalMs)if(!set.has(t))return false;
  return true;
}

export function recoveryAt({episodeStart,commonTimes=[],integrityEvents=[],binanceMarks=[],okxMarks=[]}={},contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  const start=strictTime(episodeStart);
  if(start===null)return null;
  const xs=[...new Set(commonTimes.filter(Number.isFinite))].filter(t=>t>start).sort((a,b)=>a-b);
  const events=sortEvents(integrityEvents.filter(x=>Number.isFinite(x?.detectionTime)&&x.detectionTime>start));
  const need=contract.recoveryCommonSettlements;
  for(let i=0;i+need-1<xs.length;i++){
    const seq=xs.slice(i,i+need);
    if(seq.some((t,j)=>j>0&&t-seq[j-1]!==contract.fundingIntervalMs))continue;
    const first=seq[0],last=seq.at(-1);
    if(events.some(e=>e.detectionTime>=first&&e.detectionTime<=last))continue;
    if(!marksCompleteBetween(binanceMarks,first,last,contract)||!marksCompleteBetween(okxMarks,first,last,contract))continue;
    return last;
  }
  return null;
}

export function entryInputsReady({decisionTime,binanceFunding=[],okxFunding=[],binanceMarks=[],okxMarks=[],activeDegradation=false}={},contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  if(activeDegradation===true)return{ready:false,reason:'DATA_DEGRADED'};
  const t=strictTime(decisionTime);
  if(t===null||!decisionWithinCoverage(t,contract))return{ready:false,reason:'DECISION_OUTSIDE_FROZEN_WINDOW'};
  const b=usableFundingMap(binanceFunding),o=usableFundingMap(okxFunding);
  const required=[t-2*contract.fundingIntervalMs,t-contract.fundingIntervalMs,t];
  if(required.some(x=>!b.has(x)||!o.has(x)))return{ready:false,reason:'FUNDING_INPUTS_INCOMPLETE_OR_STALE'};
  const entryOpen=t+contract.markIntervalMs;
  const bm=confirmedUniqueMarkSet(binanceMarks),om=confirmedUniqueMarkSet(okxMarks);
  if(!bm.has(entryOpen)||!om.has(entryOpen))return{ready:false,reason:'MARK_INPUTS_INCOMPLETE_OR_STALE'};
  return{ready:true,reason:'READY',entryOpenTime:entryOpen};
}

export function sourceReceipt(packageData,normalized,events,common,contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  const provenance=stable(packageData?.provenance||{});
  const split=splitCommonTimes(common);
  const compactEvents=sortEvents(events).map(x=>stable(x));
  const fundingRows=x=>x.map(r=>[r.venue,r.rawTime,r.time,r.rate,r.sourceOrdinal]);
  const markRows=x=>x.map(r=>[r.venue,r.openTime,r.open,r.high,r.low,r.close,r.confirmed,r.sourceOrdinal]);
  const receipt={
    schema:contract.schema,
    ruleset:'CROSS-VENUE-FUNDING-EDGE-V2',
    contract,
    symbols:{binance:contract.symbol,okx:contract.okxInstrument},
    commonFundingDecisions:common.length,
    split,
    integrityEventCount:compactEvents.length,
    integrityDigest:sha256(JSON.stringify(compactEvents)),
    dataDigests:{
      binanceFunding:sha256(JSON.stringify(fundingRows(normalized.binanceFunding))),
      okxFunding:sha256(JSON.stringify(fundingRows(normalized.okxFunding))),
      binanceMarks:sha256(JSON.stringify(markRows(normalized.binanceMarks))),
      okxMarks:sha256(JSON.stringify(markRows(normalized.okxMarks)))
    },
    provenanceDigest:sha256(JSON.stringify(provenance))
  };
  return Object.freeze({...receipt,digest:sha256(JSON.stringify(receipt))});
}

export function validateCrossVenueV2Source(packageData={},contract=CROSS_VENUE_FUNDING_EDGE_V2_SOURCE){
  const p=packageData?.provenance||{};
  if(p.binanceChecksumsVerified!==true)return{ok:false,reason:'BINANCE_CHECKSUMS_NOT_VERIFIED'};
  if(p.okxFundingArchivesHashed!==true)return{ok:false,reason:'OKX_FUNDING_ARCHIVES_NOT_HASHED'};
  if(p.okxMarkPagesHashed!==true)return{ok:false,reason:'OKX_MARK_PAGE_RECEIPTS_NOT_VERIFIED'};
  if(p.deterministicParsing!==true)return{ok:false,reason:'DETERMINISTIC_PARSING_NOT_VERIFIED'};

  const normalized={
    binanceFunding:normalizeFunding(packageData.binanceFunding,'BINANCE',contract),
    okxFunding:normalizeFunding(packageData.okxFunding,'OKX',contract),
    binanceMarks:normalizeMarks(packageData.binanceMarks,'BINANCE'),
    okxMarks:normalizeMarks(packageData.okxMarks,'OKX')
  };

  for(const [venue,rows] of [['BINANCE',normalized.binanceFunding],['OKX',normalized.okxFunding]]){
    if(!rows.length||rows.some(x=>x.rawTime===null||!finite(x.rate)))return{ok:false,reason:venue+'_INVALID_FUNDING'};
    const map=usableFundingMap(rows),end=timeOf(contract.fundingCoverageEnd);
    if(![...map.keys()].some(t=>t===end))return{ok:false,reason:venue+'_FUNDING_END_INCOMPLETE'};
  }
  for(const [venue,rows] of [['BINANCE',normalized.binanceMarks],['OKX',normalized.okxMarks]]){
    if(!rows.length||rows.some(x=>x.openTime===null||![x.open,x.high,x.low,x.close].every(Number.isFinite)))
      return{ok:false,reason:venue+'_INVALID_MARK'};
    const set=confirmedUniqueMarkSet(rows),end=timeOf(contract.markCoverageEnd);
    if(!set.has(end))return{ok:false,reason:venue+'_MARK_END_INCOMPLETE'};
  }

  const events=integrityEventsForSource(normalized,contract);
  const common=commonFundingTimes(normalized.binanceFunding,normalized.okxFunding,contract);
  if(common.length<contract.minCommonFundingDecisions)return{ok:false,reason:'COMMON_FUNDING_DECISIONS_LT_MIN',commonFundingDecisions:common.length};
  const receipt=sourceReceipt(packageData,normalized,events,common,contract);
  return{
    ok:true,
    state:events.length?'VALID_WITH_INTEGRITY_EPISODES':'VALID_CLEAN',
    commonFundingDecisions:common.length,
    integrityEvents:events,
    split:receipt.split,
    receipt
  };
}
