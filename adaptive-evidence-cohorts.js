// ACHI MERIDIAN Adaptive Evidence Cohort Builder — v7.74
// Research-only. Builds portfolio-independent normalized-R signal cohorts from prepared 15m events.

import { simulateExitModel } from './exit-lab.js';
import { observationsFromSignal } from './adaptive-evidence.js';

export const ADAPTIVE_COHORT_VERSION='7.74-ADAPTIVE-COHORTS-V1';
const HOUR=3600000,DAY=86400000;
const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const round=(v,d=4)=>Number.isFinite(Number(v))?Math.round(Number(v)*10**d)/10**d:null;

function lowerBound(rows,t){let lo=0,hi=rows.length;while(lo<hi){const m=(lo+hi)>>1;if(rows[m].ts<=t)lo=m+1;else hi=m}return lo}

function candleIndex(events=[]){
  const bySymbol={};
  for(const ev of events){
    for(const [symbol,c] of Object.entries(ev?.candles||{})){
      const a=bySymbol[symbol]||(bySymbol[symbol]=[]);
      a.push({...c,ts:num(c.closeTime,ev.t)});
    }
  }
  for(const rows of Object.values(bySymbol))rows.sort((a,b)=>a.ts-b.ts);
  return bySymbol;
}

function futureCandles(rows,t,end){
  const i=lowerBound(rows,t),out=[];
  for(let n=i;n<rows.length;n++){if(rows[n].ts>end)break;out.push(rows[n])}
  return out;
}

export function buildSignalCohort(events=[],opts={}){
  const sampleEveryMs=Math.max(15*60000,num(opts.sampleEveryMs,4*HOUR));
  const horizonMs=Math.max(HOUR,num(opts.horizonDays,14)*DAY);
  const feeBps=num(opts.feeBps,5),slippageBps=num(opts.slippageBps,3);
  const start=num(opts.start,-Infinity),end=num(opts.end,Infinity);
  const candles=candleIndex(events),lastSample=new Map(),rows=[];
  for(const ev of [...events].sort((a,b)=>a.t-b.t)){
    if(ev.t<start||ev.t>end)continue;
    for(const [symbol,signal] of Object.entries(ev?.signals||{})){
      if(!signal||!(num(signal.entry)>0)||!(num(signal.sl)>0)||!(num(signal.tp1)>0))continue;
      const prev=lastSample.get(symbol)??-Infinity;
      if(ev.t-prev<sampleEveryMs)continue;
      lastSample.set(symbol,ev.t);
      const future=futureCandles(candles[symbol]||[],ev.t,Math.min(end,ev.t+horizonMs));
      if(!future.length)continue;
      let outcome;
      try{outcome=simulateExitModel(signal,future,'A_CURRENT',{feeBps,slippageBps})}catch{continue}
      const observations=observationsFromSignal(signal);
      rows.push({
        version:ADAPTIVE_COHORT_VERSION,
        ts:ev.t,
        symbol,
        side:signal.side,
        regime:signal.regime,
        status:signal.status,
        observations,
        realizedR:num(outcome.realizedR),
        maxOpenR:num(outcome.maxOpenR),
        exitReason:outcome.runnerReason,
        tp1Hit:Boolean(outcome.tp1Hit),
        horizonEnd:Math.min(end,ev.t+horizonMs),
        researchOnly:true
      });
    }
  }
  return rows;
}

function median(xs){if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function stats(rows){
  const rs=rows.map(x=>num(x.realizedR));
  const pos=rs.filter(x=>x>0),neg=rs.filter(x=>x<0);
  return{
    n:rs.length,
    avgR:rs.length?round(rs.reduce((a,b)=>a+b,0)/rs.length):null,
    medianR:rs.length?round(median(rs)):null,
    winRate:rs.length?round(pos.length/rs.length*100,2):null,
    positiveR:round(pos.reduce((a,b)=>a+b,0)),
    negativeR:round(neg.reduce((a,b)=>a+b,0)),
    totalR:round(rs.reduce((a,b)=>a+b,0))
  };
}

function keysFor(row){const o=row.observations||{};return{
  side:o.side,
  regime:`${o.side}|${o.regime}`,
  mtfAlignment:`${o.side}|${o.mtfAlignment}`,
  momentum:`${o.side}|${o.momentum}`,
  volume:`${o.side}|${o.volume}`,
  volatility:`${o.side}|${o.volatility}`,
  asset:`${o.asset}|${o.side}`,
  baselineStatus:`${o.side}|${o.baselineStatus}`
}}

export function buildEvidenceMap(rows=[],windows=[]){
  const buckets={};
  for(const row of rows){
    for(const [dimension,key] of Object.entries(keysFor(row))){
      if(!key||key.includes('undefined'))continue;
      (((buckets[dimension]||(buckets[dimension]={}))[key])||((buckets[dimension][key])=[])).push(row);
    }
  }
  const out={};
  for(const [dimension,groups] of Object.entries(buckets)){
    out[dimension]={};
    for(const [key,group] of Object.entries(groups)){
      const s=stats(group);
      const winStats=(windows||[]).map(w=>{
        const subset=group.filter(r=>r.ts>=w.start&&r.ts<=w.end),x=stats(subset);
        return{id:w.id??`${w.start}-${w.end}`,start:w.start,end:w.end,n:x.n,avgR:x.avgR};
      }).filter(x=>x.n>0);
      out[dimension][key]={...s,windows:winStats};
    }
  }
  return out;
}

export function rollingWindows({start,end,count=5}){
  const span=(end-start)/Math.max(1,count),out=[];
  for(let i=0;i<count;i++)out.push({id:`W${i+1}`,start:i===0?start:start+i*span+1,end:i===count-1?end:start+(i+1)*span});
  return out;
}

export function cohortSummary(rows=[]){
  const s=stats(rows);
  const bySide={};
  for(const side of ['LONG','SHORT'])bySide[side]=stats(rows.filter(r=>String(r.side).toUpperCase()===side));
  return{version:ADAPTIVE_COHORT_VERSION,researchOnly:true,...s,bySide};
}
